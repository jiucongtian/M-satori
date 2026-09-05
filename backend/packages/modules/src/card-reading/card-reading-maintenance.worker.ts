import { Injectable, type OnModuleInit, type OnApplicationShutdown } from '@nestjs/common';
import { cardReadings, generationTasks, RuntimeInfrastructure } from '@satori/infrastructure';
import { and, eq, inArray } from 'drizzle-orm';
import { CardReadingService } from './card-reading.service.js';

@Injectable()
export class CardReadingMaintenanceWorker implements OnModuleInit, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;
  private running = false;
  constructor(
    private readonly infrastructure: RuntimeInfrastructure,
    private readonly readings: CardReadingService,
  ) {}
  onModuleInit() {
    this.timer = setInterval(() => void this.recover(), 15_000);
    this.timer.unref();
    void this.recover();
  }
  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }
  async recover() {
    if (this.running) return;
    this.running = true;
    try {
      const rows = await this.infrastructure.database
        .select()
        .from(cardReadings)
        .where(inArray(cardReadings.status, ['GENERATING', 'SETTLING']))
        .limit(100);
      for (const row of rows) {
        const targetId = row.consumptionIntentId ?? row.id;
        const [task] = await this.infrastructure.database
          .select()
          .from(generationTasks)
          .where(and(eq(generationTasks.targetType, 'CARD_READING'), eq(generationTasks.targetId, targetId)))
          .limit(1);
        if (task?.status === 'FAILED') await this.readings.finalFailure(task.id, targetId);
        else if (!task) await this.readings.recoverLegacy(row.ownerUserId, row.id);
      }
    } catch (error) {
      console.error('card_reading_recovery_failed', {
        message: error instanceof Error ? error.message : 'unknown',
      });
    } finally {
      this.running = false;
    }
  }
}
