import { Inject, Injectable } from '@nestjs/common';
import {
  HOME_ENERGY_SUMMARY_GENERATOR,
  SEXAGENARY_CYCLE,
  type HomeEnergySummary,
  type HomeEnergySummaryGenerator,
} from '@satori/application';
import {
  dailyEnergyHomeSummaries,
  dailyEnergyHomeSummaryCache,
  newId,
  RuntimeInfrastructure,
} from '@satori/infrastructure';
import { and, eq } from 'drizzle-orm';
import { calculateLocalBaziDayV13 } from '../astrology/local-bazi-v1-3.js';

const CACHE_LOCK_MS = 300_000;

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

export interface HomeEnergyPrewarmReport {
  requested: number;
  generated: number;
  cached: number;
  locked: number;
  failed: number;
}

@Injectable()
export class HomeEnergySummaryService {
  constructor(
    private readonly infrastructure: RuntimeInfrastructure,
    @Inject(HOME_ENERGY_SUMMARY_GENERATOR)
    private readonly generator: HomeEnergySummaryGenerator,
  ) {}

  async get(context: HomeEnergySummaryContext): Promise<HomeEnergySummaryProjection> {
    if (!context.profileRevisionId || !context.localDate) return { state: 'NOT_AVAILABLE', data: null };
    const dayCard = getDayCard(context.cards);
    if (!dayCard) return { state: 'NOT_AVAILABLE', data: null };

    const shared = await this.findSharedCached(context.localDate, dayCard);
    if (shared) return { state: 'READY', data: personalizeGreeting(shared, context.userName) };

    // Preserve already-generated per-user rows while a new shared cache is warming up.
    const legacy = await this.findLegacyCached(context.userId, context.localDate);
    if (legacy) return { state: 'READY', data: personalizeGreeting(legacy, context.userName) };

    return { state: 'UNAVAILABLE', data: null };
  }

  async prewarm(dates: string[], concurrency: number, spacingMs = 0): Promise<HomeEnergyPrewarmReport> {
    const uniqueDates = [...new Set(dates)];
    const work = uniqueDates.flatMap((date) =>
      SEXAGENARY_CYCLE.map((dayCard, index) => ({ date, dayCard, index })),
    );
    const report: HomeEnergyPrewarmReport = {
      requested: work.length,
      generated: 0,
      cached: 0,
      locked: 0,
      failed: 0,
    };
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, work.length) }, async () => {
      while (cursor < work.length) {
        const item = work[cursor++];
        if (!item) return;
        const outcome = await this.prewarmOne(item.date, item.dayCard, item.index, spacingMs);
        report[outcome] += 1;
      }
    });
    await Promise.all(workers);
    return report;
  }

  private async prewarmOne(
    localDate: string,
    dayCard: string,
    cycleIndex: number,
    spacingMs: number,
  ): Promise<'generated' | 'cached' | 'locked' | 'failed'> {
    if (await this.findSharedCached(localDate, dayCard)) return 'cached';
    const workflowVersion = this.infrastructure.policy.aqua.homeEnergySummary.workflowVersion;

    const lockKey = `home-energy-prewarm:${workflowVersion}:${localDate}:${dayCard}`;
    const lockToken = newId();
    const acquired = await this.infrastructure.redis.set(lockKey, lockToken, 'PX', CACHE_LOCK_MS, 'NX');
    if (!acquired) return 'locked';

    try {
      if (await this.findSharedCached(localDate, dayCard)) return 'cached';
      const heavenCard = heavenCardFor(localDate);
      await this.waitForProviderSlot(spacingMs);
      const generated = await this.generator.generate({
        runReference: `shared-${String(cycleIndex).padStart(2, '0')}`,
        dayCard,
        heavenCard,
        date: localDate,
      });
      const inserted = await this.infrastructure.database
        .insert(dailyEnergyHomeSummaryCache)
        .values({
          id: newId(),
          localDate,
          dayCard,
          heavenCard,
          workflowVersion,
          content: generated.summary,
          providerRequestId: generated.providerRequestId,
        })
        .onConflictDoNothing()
        .returning({ id: dailyEnergyHomeSummaryCache.id });
      return inserted.length > 0 ? 'generated' : 'cached';
    } catch (error) {
      console.error('home_energy_summary_prewarm_failed', {
        localDate,
        dayCard,
        errorCode: errorCode(error),
      });
      return 'failed';
    } finally {
      await this.infrastructure.redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        lockKey,
        lockToken,
      );
    }
  }

  private async waitForProviderSlot(spacingMs: number): Promise<void> {
    if (spacingMs <= 0) return;
    const waitMs = Number(
      await this.infrastructure.redis.eval(
        "local now=tonumber(ARGV[1]); local spacing=tonumber(ARGV[2]); local next=tonumber(redis.call('get',KEYS[1]) or '0'); local slot=now; if next>slot then slot=next end; redis.call('set',KEYS[1],tostring(slot+spacing),'PX',math.max(spacing*100,60000)); return slot-now",
        1,
        `home-energy-prewarm-rate:${this.infrastructure.policy.aqua.homeEnergySummary.workflowVersion}`,
        Date.now(),
        spacingMs,
      ),
    );
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  private async findSharedCached(localDate: string, dayCard: string): Promise<HomeEnergySummary | null> {
    const [cached] = await this.infrastructure.database
      .select({ content: dailyEnergyHomeSummaryCache.content })
      .from(dailyEnergyHomeSummaryCache)
      .where(
        and(
          eq(dailyEnergyHomeSummaryCache.localDate, localDate),
          eq(dailyEnergyHomeSummaryCache.dayCard, dayCard),
          eq(
            dailyEnergyHomeSummaryCache.workflowVersion,
            this.infrastructure.policy.aqua.homeEnergySummary.workflowVersion,
          ),
        ),
      )
      .limit(1);
    return (cached?.content as HomeEnergySummary | undefined) ?? null;
  }

  private async findLegacyCached(userId: string, localDate: string): Promise<HomeEnergySummary | null> {
    const [cached] = await this.infrastructure.database
      .select({ content: dailyEnergyHomeSummaries.content })
      .from(dailyEnergyHomeSummaries)
      .where(
        and(
          eq(dailyEnergyHomeSummaries.ownerUserId, userId),
          eq(dailyEnergyHomeSummaries.localDate, localDate),
          eq(
            dailyEnergyHomeSummaries.workflowVersion,
            this.infrastructure.policy.aqua.homeEnergySummary.workflowVersion,
          ),
        ),
      )
      .limit(1);
    return (cached?.content as HomeEnergySummary | undefined) ?? null;
  }
}

function getDayCard(cards: unknown[]): string | null {
  const dayCard = cards
    .map((card) => card as { dimension?: unknown; snapshotPillar?: unknown })
    .find((card) => card.dimension === 'FAMILY')?.snapshotPillar;
  return typeof dayCard === 'string' ? dayCard : null;
}

function heavenCardFor(localDate: string): string {
  const [year, month, day] = localDate.split('-').map(Number);
  return calculateLocalBaziDayV13(year!, month!, day!);
}

export function personalizeGreeting(summary: HomeEnergySummary, userName: string): HomeEnergySummary {
  const name = userName.trim().slice(0, 64);
  return { ...summary, greeting: name ? `${name}，你好` : '你好' };
}

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' ? code : 'HOME_ENERGY_PREWARM_UNKNOWN';
}
