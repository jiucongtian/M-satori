import { Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import {
  correlationIds,
  errorFields,
  logEvent,
  metrics,
  isCommerceEvent,
  outbox,
  RuntimeInfrastructure,
} from '@satori/infrastructure';
import { and, asc, eq, isNull, lte, sql } from 'drizzle-orm';

@Injectable()
export class OutboxPublisher implements OnModuleInit, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly infrastructure: RuntimeInfrastructure) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.publishBatch(), 1_000);
    this.timer.unref();
    void this.publishBatch();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async publishBatch(limit = 50) {
    if (this.running) return 0;
    this.running = true;
    const started = performance.now();
    try {
      const events = await this.infrastructure.database
        .select()
        .from(outbox)
        .where(and(isNull(outbox.publishedAt), lte(outbox.availableAt, new Date())))
        .orderBy(asc(outbox.createdAt))
        .limit(limit);
      let published = 0;
      for (const event of events) {
        try {
          const queue = isCommerceEvent(event.eventType)
            ? this.infrastructure.commerceQueue
            : this.infrastructure.generationQueue;
          const telemetry = {
            outboxId: event.id,
            traceId: event.requestId ?? event.id,
            ...(event.requestId ? { requestId: event.requestId } : {}),
          };
          await queue.add(
            event.eventType,
            { ...(event.payload as Record<string, unknown>), _telemetry: telemetry },
            { jobId: event.id },
          );
          await this.infrastructure.database
            .update(outbox)
            .set({ publishedAt: new Date(), attempts: sql`${outbox.attempts} + 1` })
            .where(and(eq(outbox.id, event.id), isNull(outbox.publishedAt)));
          published += 1;
          const publishAgeMs = Math.max(0, Date.now() - event.createdAt.getTime());
          metrics.observe('outbox_publish_age_ms', publishAgeMs, { queue: queue.name });
          logEvent('outbox_published', {
            ...correlationIds(event.payload),
            ...telemetry,
            queue: queue.name,
            eventType: event.eventType,
            jobId: event.id,
            publishAgeMs,
          });
        } catch (error) {
          const attempts = event.attempts + 1;
          const backoffMs = Math.min(60_000, this.infrastructure.policy.queue.backoffMs * 2 ** attempts);
          await this.infrastructure.database
            .update(outbox)
            .set({ attempts, availableAt: new Date(Date.now() + backoffMs) })
            .where(eq(outbox.id, event.id));
          metrics.increment('outbox_publish_error');
          logEvent('outbox_publish_failed', { outboxId: event.id, attempts, ...errorFields(error) }, 'error');
        }
      }
      return published;
    } catch (error) {
      metrics.increment('outbox_batch_error');
      logEvent('outbox_batch_failed', errorFields(error), 'error');
      return 0;
    } finally {
      metrics.observe('outbox_batch_ms', performance.now() - started);
      this.running = false;
    }
  }

  async republishUnconfirmed(taskId: string) {
    await this.infrastructure.database
      .update(outbox)
      .set({ publishedAt: null, availableAt: new Date() })
      .where(and(eq(outbox.aggregateId, taskId), isNull(outbox.publishedAt)));
    return this.publishBatch();
  }
}
