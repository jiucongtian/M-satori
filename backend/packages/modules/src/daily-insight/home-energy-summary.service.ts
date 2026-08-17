import { Inject, Injectable } from '@nestjs/common';
import {
  HOME_ENERGY_SUMMARY_GENERATOR,
  HOME_ENERGY_WORKFLOW_VERSION,
  type HomeEnergySummary,
  type HomeEnergySummaryGenerator,
} from '@satori/application';
import { dailyEnergyHomeSummaries, newId, RuntimeInfrastructure } from '@satori/infrastructure';
import { and, eq } from 'drizzle-orm';
import { calculateLocalBaziDayV13 } from '../astrology/local-bazi-v1-3.js';

export interface HomeEnergySummaryContext {
  userId: string;
  userName: string;
  profileRevisionId: string | null;
  localDate: string | null | undefined;
  cards: unknown[];
}

export interface HomeEnergySummaryProjection {
  state: 'READY' | 'UNAVAILABLE' | 'NOT_AVAILABLE';
  data: HomeEnergySummary | null;
}

@Injectable()
export class HomeEnergySummaryService {
  constructor(
    private readonly infrastructure: RuntimeInfrastructure,
    @Inject(HOME_ENERGY_SUMMARY_GENERATOR)
    private readonly generator: HomeEnergySummaryGenerator | null,
  ) {}

  async get(context: HomeEnergySummaryContext): Promise<HomeEnergySummaryProjection> {
    if (!context.profileRevisionId || !context.localDate) return { state: 'NOT_AVAILABLE', data: null };
    const cached = await this.findCached(context.userId, context.localDate);
    if (cached) return { state: 'READY', data: cached };
    if (!this.generator || !this.infrastructure.environment.HOME_ENERGY_SUMMARY_ENABLED) {
      return { state: 'UNAVAILABLE', data: null };
    }
    const dayCard = context.cards
      .map((card) => card as { dimension?: unknown; snapshotPillar?: unknown })
      .find((card) => card.dimension === 'FAMILY')?.snapshotPillar;
    if (typeof dayCard !== 'string') return { state: 'NOT_AVAILABLE', data: null };
    const [year, month, day] = context.localDate.split('-').map(Number);
    const heavenCard = calculateLocalBaziDayV13(year!, month!, day!);
    try {
      const generated = await this.generator.generate({
        userId: context.userId,
        userName: context.userName,
        dayCard,
        heavenCard,
        date: context.localDate,
      });
      const inserted = await this.infrastructure.database
        .insert(dailyEnergyHomeSummaries)
        .values({
          id: newId(),
          ownerUserId: context.userId,
          profileRevisionId: context.profileRevisionId,
          localDate: context.localDate,
          workflowVersion: HOME_ENERGY_WORKFLOW_VERSION,
          content: generated.summary,
          providerRequestId: generated.providerRequestId,
        })
        .onConflictDoNothing()
        .returning({ content: dailyEnergyHomeSummaries.content });
      const content = inserted[0]?.content as HomeEnergySummary | undefined;
      if (content) return { state: 'READY', data: content };
      const concurrent = await this.findCached(context.userId, context.localDate);
      return concurrent ? { state: 'READY', data: concurrent } : { state: 'UNAVAILABLE', data: null };
    } catch {
      return { state: 'UNAVAILABLE', data: null };
    }
  }

  private async findCached(userId: string, localDate: string): Promise<HomeEnergySummary | null> {
    const [cached] = await this.infrastructure.database
      .select({ content: dailyEnergyHomeSummaries.content })
      .from(dailyEnergyHomeSummaries)
      .where(
        and(
          eq(dailyEnergyHomeSummaries.ownerUserId, userId),
          eq(dailyEnergyHomeSummaries.localDate, localDate),
          eq(dailyEnergyHomeSummaries.workflowVersion, HOME_ENERGY_WORKFLOW_VERSION),
        ),
      )
      .limit(1);
    return (cached?.content as HomeEnergySummary | undefined) ?? null;
  }
}
