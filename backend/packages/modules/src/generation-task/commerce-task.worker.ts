import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import {
  FULFILLMENT_COMMAND_PORT,
  REFUND_COMMAND_PORT,
  SEED_PROMOTION_LIFECYCLE_PORT,
  type FulfillmentCommandPort,
  type RefundCommandPort,
  type SeedPromotionLifecyclePort,
} from '@satori/application';
import { COMMERCE_QUEUE, RuntimeInfrastructure } from '@satori/infrastructure';
import { Worker, type Job } from 'bullmq';

@Injectable()
export class CommerceTaskWorker implements OnModuleInit, OnApplicationShutdown {
  private worker?: Worker;

  constructor(
    private readonly infrastructure: RuntimeInfrastructure,
    @Inject(FULFILLMENT_COMMAND_PORT) private readonly fulfillment: FulfillmentCommandPort,
    @Inject(REFUND_COMMAND_PORT) private readonly refunds: RefundCommandPort,
    @Inject(SEED_PROMOTION_LIFECYCLE_PORT) private readonly seeds: SeedPromotionLifecyclePort,
  ) {}

  onModuleInit() {
    this.worker = new Worker(COMMERCE_QUEUE, (job) => this.process(job), {
      connection: this.infrastructure.redis,
      prefix: this.infrastructure.environment.QUEUE_PREFIX,
      concurrency: this.infrastructure.environment.COMMERCE_QUEUE_CONCURRENCY,
    });
  }

  async onApplicationShutdown() {
    await this.worker?.close();
  }

  private async process(job: Job) {
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
    if (job.name === 'commerce.fulfillment.succeeded') return;
    throw new Error(`Unsupported commerce job: ${job.name}`);
  }
}
