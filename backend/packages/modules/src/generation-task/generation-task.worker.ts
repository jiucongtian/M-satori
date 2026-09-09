import { Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { GENERATION_QUEUE, isCommerceEvent, queueExecutionPolicy, RuntimeInfrastructure } from '@satori/infrastructure';
import { Worker, type Job } from 'bullmq';
import { GenerationTaskRunner } from './generation-task.runner.js';
import { GenerationTaskService } from './generation-task.service.js';
import { AccountDeletionService } from '../feedback/account-deletion.service.js';

@Injectable()
export class GenerationTaskWorker implements OnModuleInit, OnApplicationShutdown {
  private worker?: Worker;
  private recoveryTimer?: NodeJS.Timeout;

  constructor(
    private readonly infrastructure: RuntimeInfrastructure,
    private readonly tasks: GenerationTaskService,
    private readonly runner: GenerationTaskRunner,
    private readonly accountDeletion: AccountDeletionService,
  ) {}

  onModuleInit() {
    const policy = queueExecutionPolicy(this.infrastructure.environment);
    this.worker = new Worker<{ taskId?: string; requestId?: string }>(
      GENERATION_QUEUE,
      (job) => this.process(job, policy.jobTimeoutMs),
      {
        connection: this.infrastructure.redis,
        prefix: this.infrastructure.environment.QUEUE_PREFIX,
        concurrency: policy.concurrency,
      },
    );
    this.recoveryTimer = setInterval(
      () => void this.tasks.recoverStaleTasks(),
      Math.max(5_000, policy.jobTimeoutMs / 2),
    );
    this.recoveryTimer.unref();
    void this.tasks.recoverStaleTasks();
  }

  async onApplicationShutdown() {
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    await this.worker?.close();
  }

  private async process(job: Job<{ taskId?: string; requestId?: string }>, timeoutMs: number) {
    if (isCommerceEvent(job.name)) {
      // Forward pre-upgrade jobs before acknowledging them. A retry keeps the
      // same job identity; payment handlers retain their business idempotency.
      await this.infrastructure.commerceQueue.add(job.name, job.data, {
        jobId: job.id!,
        attempts: Math.max(1, (job.opts.attempts ?? 1) - job.attemptsMade),
        ...(job.opts.backoff !== undefined ? { backoff: job.opts.backoff } : {}),
      });
      return;
    }
    if (job.name === 'account.deletion.scheduled') {
      if (job.data.requestId) await this.accountDeletion.process(job.data.requestId);
      return;
    }
    if (!job.name.startsWith('generation.task.')) return;
    if (!job.data.taskId) throw new Error('Generation task job is missing taskId');
    const task = await this.tasks.claim(job.data.taskId);
    if (!task) return;
    const heartbeat = setInterval(
      () => void this.tasks.heartbeat(task.id, undefined, task.currentAttempt),
      Math.max(1_000, timeoutMs / 3),
    );
    heartbeat.unref();
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.runner.run(task),
        new Promise<never>(
          (_, reject) =>
            (timeout = setTimeout(
              () =>
                reject(
                  Object.assign(new Error('Generation timed out'), {
                    code: 'GENERATION_TIMEOUT',
                    retryable: true,
                  }),
                ),
              timeoutMs,
            )),
        ),
      ]);
      await this.tasks.succeed(task.id, task.currentAttempt);
    } catch (error) {
      const failure = error as Error & { code?: string; retryable?: boolean };
      const terminal = job.attemptsMade + 1 >= Number(job.opts.attempts ?? 1);
      const failed = await this.tasks.failAttempt(
        task.id,
        {
          code: failure.code ?? 'GENERATION_TEMPORARILY_FAILED',
          message: failure.message,
          retryable: failure.retryable !== false,
        },
        terminal,
        task.currentAttempt,
      );
      if (failed?.status === 'FAILED')
        await this.runner.finalFailure(failed.target.type, failed.taskId, failed.target.id);
      throw error;
    } finally {
      clearInterval(heartbeat);
      if (timeout) clearTimeout(timeout);
    }
  }
}
