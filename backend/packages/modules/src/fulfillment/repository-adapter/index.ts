import { Inject, Injectable } from '@nestjs/common';
import {
  fulfillmentJobs,
  moneyOrders,
  newId,
  orderSnapshots,
  outbox,
  paymentAttempts,
  RuntimeInfrastructure,
} from '@satori/infrastructure';
import { and, eq, inArray, lte, or, sql } from 'drizzle-orm';
import type { FulfillmentRepository } from '../application/index.js';
import { FULFILLMENT_MAX_ATTEMPTS, FULFILLMENT_STALE_AFTER_MS } from '../domain/index.js';

@Injectable()
export class DrizzleFulfillmentRepository implements FulfillmentRepository {
  constructor(@Inject(RuntimeInfrastructure) private readonly infrastructure: RuntimeInfrastructure) {}
  async claim(orderId: string, paymentAttemptId: string) {
    return this.infrastructure.database.transaction(async (tx) => {
      const [order] = await tx
        .select()
        .from(moneyOrders)
        .where(eq(moneyOrders.id, orderId))
        .for('update')
        .limit(1);
      if (!order || order.status === 'FULFILLED') return null;
      if (!['PAID', 'FULFILLING'].includes(order.status)) return null;
      const [payment] = await tx
        .select({ id: paymentAttempts.id })
        .from(paymentAttempts)
        .where(
          and(
            eq(paymentAttempts.id, paymentAttemptId),
            eq(paymentAttempts.orderId, order.id),
            eq(paymentAttempts.status, 'SUCCEEDED'),
          ),
        )
        .limit(1);
      if (!payment) throw new Error('SUCCESSFUL_PAYMENT_ATTEMPT_NOT_FOUND');
      const [snapshot] = await tx
        .select()
        .from(orderSnapshots)
        .where(eq(orderSnapshots.orderId, order.id))
        .limit(1);
      if (!snapshot) throw new Error('ORDER_SNAPSHOT_NOT_FOUND');
      const businessKey = `fulfillment:${order.id}`;
      let [job] = await tx
        .select()
        .from(fulfillmentJobs)
        .where(eq(fulfillmentJobs.businessKey, businessKey))
        .for('update')
        .limit(1);
      if (job?.status === 'SUCCEEDED' || job?.status === 'FAILED') return null;
      if (job?.status === 'RUNNING' && job.updatedAt > new Date(Date.now() - FULFILLMENT_STALE_AFTER_MS))
        return null;
      if (!job) {
        [job] = await tx
          .insert(fulfillmentJobs)
          .values({
            id: newId(),
            orderId: order.id,
            ownerUserId: order.ownerUserId,
            businessSpace: order.businessSpace,
            businessKey,
            fulfillmentType: stringValue(record(snapshot.offeringSnapshot).offeringKind, 'ENTITLEMENT'),
            status: 'RUNNING',
            attempt: 1,
            maxAttempts: FULFILLMENT_MAX_ATTEMPTS,
            requestId: order.requestId,
          })
          .returning();
      } else {
        [job] = await tx
          .update(fulfillmentJobs)
          .set({ status: 'RUNNING', attempt: job.attempt + 1, nextAttemptAt: null, updatedAt: new Date() })
          .where(eq(fulfillmentJobs.id, job.id))
          .returning();
      }
      await tx
        .update(moneyOrders)
        .set({ status: 'FULFILLING', version: order.version + 1, updatedAt: new Date() })
        .where(eq(moneyOrders.id, order.id));
      const offering = record(snapshot.offeringSnapshot);
      return {
        jobId: job!.id,
        orderId: order.id,
        ownerUserId: order.ownerUserId,
        paidAt: order.paidAt!,
        offeringKind: stringValue(offering.offeringKind, 'PACKAGE'),
        offeringVersionId: order.offeringVersionId,
        offeringSnapshot: offering,
        attempt: job!.attempt,
      };
    });
  }
  async succeed(jobId: string, references: Record<string, unknown>) {
    await this.infrastructure.database.transaction(async (tx) => {
      const [job] = await tx
        .update(fulfillmentJobs)
        .set({
          status: 'SUCCEEDED',
          resultReferences: references,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(fulfillmentJobs.id, jobId))
        .returning();
      if (job)
        await tx
          .update(moneyOrders)
          .set({ status: 'FULFILLED', version: sql`${moneyOrders.version} + 1`, updatedAt: new Date() })
          .where(eq(moneyOrders.id, job.orderId));
      if (job)
        await tx.insert(outbox).values({
          id: newId(),
          aggregateType: 'MONEY_ORDER',
          aggregateId: job.orderId,
          eventType: 'commerce.fulfillment.succeeded',
          producer: 'fulfillment',
          requestId: job.requestId,
          payload: { orderId: job.orderId, fulfillmentJobId: job.id, references },
        });
    });
  }
  async fail(jobId: string, failure: { code: string; message: string }, retryable: boolean) {
    return this.infrastructure.database.transaction(async (tx) => {
      const [job] = await tx
        .select()
        .from(fulfillmentJobs)
        .where(eq(fulfillmentJobs.id, jobId))
        .for('update')
        .limit(1);
      if (!job) throw new Error('FULFILLMENT_JOB_NOT_FOUND');
      const retry = retryable && job.attempt < job.maxAttempts;
      const status = retry ? 'RETRY_WAIT' : 'FAILED';
      await tx
        .update(fulfillmentJobs)
        .set({
          status,
          lastFailure: failure,
          nextAttemptAt: retry ? new Date(Date.now() + 2_000 * 2 ** (job.attempt - 1)) : null,
          updatedAt: new Date(),
        })
        .where(eq(fulfillmentJobs.id, job.id));
      if (!retry) {
        await tx
          .update(moneyOrders)
          .set({ status: 'EXCEPTION', version: sql`${moneyOrders.version} + 1`, updatedAt: new Date() })
          .where(eq(moneyOrders.id, job.orderId));
        await tx.insert(outbox).values({
          id: newId(),
          aggregateType: 'MONEY_ORDER',
          aggregateId: job.orderId,
          eventType: 'commerce.payment.reversal.requested',
          producer: 'fulfillment',
          requestId: job.requestId,
          payload: { orderId: job.orderId, fulfillmentJobId: job.id, reason: failure.code },
        });
      }
      return status;
    });
  }
  async listRecoverable(limit: number) {
    const jobs = await this.infrastructure.database
      .select({ orderId: fulfillmentJobs.orderId })
      .from(fulfillmentJobs)
      .where(
        or(
          eq(fulfillmentJobs.status, 'PENDING'),
          and(eq(fulfillmentJobs.status, 'RETRY_WAIT'), lte(fulfillmentJobs.nextAttemptAt, new Date())),
          and(
            eq(fulfillmentJobs.status, 'RUNNING'),
            lte(fulfillmentJobs.updatedAt, new Date(Date.now() - FULFILLMENT_STALE_AFTER_MS)),
          ),
        ),
      )
      .limit(limit);
    const paidOrders = await this.infrastructure.database
      .select({ orderId: moneyOrders.id })
      .from(moneyOrders)
      .where(eq(moneyOrders.status, 'PAID'))
      .limit(limit);
    const orderIds = [
      ...new Set([...jobs.map((job) => job.orderId), ...paidOrders.map((job) => job.orderId)]),
    ];
    if (!orderIds.length) return [];
    const attempts = await this.infrastructure.database
      .select({ orderId: paymentAttempts.orderId, id: paymentAttempts.id })
      .from(paymentAttempts)
      .where(and(inArray(paymentAttempts.orderId, orderIds), eq(paymentAttempts.status, 'SUCCEEDED')));
    return orderIds.flatMap((orderId) => {
      const attempt = attempts.find((item) => item.orderId === orderId);
      return attempt ? [{ orderId, paymentAttemptId: attempt.id }] : [];
    });
  }
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function stringValue(value: unknown, fallback: string) {
  return typeof value === 'string' ? value : fallback;
}
