import { Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { outbox, RuntimeInfrastructure } from '@satori/infrastructure';
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
          await this.infrastructure.generationQueue.add(event.eventType, event.payload, { jobId: event.id });
          await this.infrastructure.database
            .update(outbox)
            .set({ publishedAt: new Date(), attempts: sql`${outbox.attempts} + 1` })
            .where(and(eq(outbox.id, event.id), isNull(outbox.publishedAt)));
          published += 1;
        } catch (error) {
          const attempts = event.attempts + 1;
          const backoffMs = Math.min(
            60_000,
            this.infrastructure.environment.QUEUE_BACKOFF_MS * 2 ** attempts,
          );
          await this.infrastructure.database
            .update(outbox)
            .set({ attempts, availableAt: new Date(Date.now() + backoffMs) })
            .where(eq(outbox.id, event.id));
          console.error('outbox_publish_failed', { outboxId: event.id, attempts, error });
        }
      }
      return published;
    } finally {
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
