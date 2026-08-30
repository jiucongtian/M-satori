import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import {
  FULFILLMENT_COMMAND_PORT,
  REFUND_COMMAND_PORT,
  type FulfillmentCommandPort,
  type RefundCommandPort,
} from '@satori/application';
import { GENERATION_QUEUE, queueExecutionPolicy, RuntimeInfrastructure } from '@satori/infrastructure';
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
    @Inject(FULFILLMENT_COMMAND_PORT) private readonly fulfillment: FulfillmentCommandPort,
    @Inject(REFUND_COMMAND_PORT) private readonly refunds: RefundCommandPort,
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
    this.worker.on('failed', (job, error) => void this.onFailed(job, error));
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
    if (job.name === 'commerce.payment.reversal.requested') {
      const data = job.data as { orderId?: string; reason?: string };
      if (!data.orderId) throw new Error('Refund reversal payload is incomplete');
      await this.refunds.reverseExceptional(data.orderId, data.reason ?? 'FULFILLMENT_FAILED');
      return;
    }
    if (job.name === 'commerce.payment.duplicate.detected') {
      const data = job.data as { orderId?: string; paymentAttemptId?: string };
      if (!data.orderId || !data.paymentAttemptId) throw new Error('Duplicate payment payload is incomplete');
      await this.refunds.reverseDuplicate(data.orderId, data.paymentAttemptId);
      return;
    }
    if (job.name === 'commerce.fulfillment.requested') {
      const data = job.data as { orderId?: string; paymentAttemptId?: string };
      if (!data.orderId || !data.paymentAttemptId) throw new Error('Fulfillment job payload is incomplete');
      await this.fulfillment.process(data.orderId, data.paymentAttemptId);
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
    const heartbeat = setInterval(() => void this.tasks.heartbeat(task.id), Math.max(1_000, timeoutMs / 3));
    heartbeat.unref();
    try {
      await Promise.race([
        this.runner.run(task),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                Object.assign(new Error('Generation timed out'), {
                  code: 'GENERATION_TIMEOUT',
                  retryable: true,
                }),
              ),
            timeoutMs,
          ),
        ),
      ]);
      await this.tasks.succeed(task.id);
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async onFailed(job: Job<{ taskId?: string; requestId?: string }> | undefined, error: Error) {
    if (!job || !job.name.startsWith('generation.task.') || !job.data.taskId) return;
    const attempts = Number(job.opts.attempts ?? 1);
    const terminal = job.attemptsMade >= attempts;
    const failed = await this.tasks.failAttempt(
      job.data.taskId,
      {
        code: String((error as Error & { code?: string }).code ?? 'GENERATION_TEMPORARILY_FAILED'),
        message: error.message,
        retryable: (error as Error & { retryable?: boolean }).retryable !== false,
      },
      terminal,
    );
    if (terminal && failed)
      await this.runner.finalFailure(failed.target.type, failed.taskId, failed.target.id);
  }
}
