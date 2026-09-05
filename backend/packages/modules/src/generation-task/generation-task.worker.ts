import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import {
  FULFILLMENT_COMMAND_PORT,
  REFUND_COMMAND_PORT,
  SEED_PROMOTION_LIFECYCLE_PORT,
  type FulfillmentCommandPort,
  type RefundCommandPort,
  type SeedPromotionLifecyclePort,
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
    @Inject(SEED_PROMOTION_LIFECYCLE_PORT) private readonly seeds: SeedPromotionLifecyclePort,
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
    if (job.name === 'commerce.order.seed-release.requested') {
      const data = job.data as {
        orderId?: string;
        reservationId?: string;
        reason?: 'ORDER_CANCELLED' | 'ORDER_EXPIRED' | 'PAYMENT_FAILED';
        requestId?: string;
      };
      if (!data.orderId || !data.reservationId || !data.reason || !data.requestId) {
        throw new Error('Order seed release payload is incomplete');
      }
      await this.seeds.releaseAfterOrderClosure(
        data.reservationId,
        data.orderId,
        data.reason,
        data.requestId,
      );
      return;
    }
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
