import { Injectable } from '@nestjs/common';
import type { ConsumptionOutcomeQueryPort } from '@satori/application';
import type { BusinessContext } from '@satori/domain';
import { cardReadings, dailyInsights, generationTasks, RuntimeInfrastructure } from '@satori/infrastructure';
import { and, eq, sql } from 'drizzle-orm';

@Injectable()
export class PostgresBusinessOutcomeQuery implements ConsumptionOutcomeQueryPort {
  constructor(private readonly infrastructure: RuntimeInfrastructure) {}

  async getOutcome(context: BusinessContext) {
    const [id, attempt] = context.id.split(':');
    if (!id || !/^[a-f0-9-]{36}$/i.test(id)) return 'UNKNOWN' as const;
    if (context.type === 'READING_INTENT_ATTEMPT') {
      return this.infrastructure.database.transaction(async (tx) => {
        // Wait for draw creation to commit before treating a missing row as an orphan.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${id}, 11))`);
        const [reading] = await tx.select().from(cardReadings).where(eq(cardReadings.id, id)).limit(1);
        if (!reading || reading.consumptionAttempt !== Number(attempt)) return 'FAILED' as const;
        if (reading.status === 'READY' || reading.status === 'SETTLING') return 'SUCCEEDED' as const;
        if (reading.status === 'FAILED') return 'FAILED' as const;
        const [task] = await tx
          .select()
          .from(generationTasks)
          .where(
            and(eq(generationTasks.targetType, 'CARD_READING'), eq(generationTasks.targetId, reading.consumptionIntentId ?? reading.id)),
          )
          .limit(1);
        return task?.status === 'FAILED' ? ('FAILED' as const) : ('UNKNOWN' as const);
      });
    }
    if (context.type === 'DAILY_INSIGHT_ATTEMPT') {
      const [insight] = await this.infrastructure.database
        .select()
        .from(dailyInsights)
        .where(eq(dailyInsights.id, id))
        .limit(1);
      if (insight?.status === 'READY') return 'SUCCEEDED' as const;
      if (insight?.status === 'FAILED') return 'FAILED' as const;
    }
    return 'UNKNOWN' as const;
  }
}
