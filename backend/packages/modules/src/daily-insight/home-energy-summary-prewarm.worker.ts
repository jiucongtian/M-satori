import { Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { preferences, RuntimeInfrastructure } from '@satori/infrastructure';
import { HomeEnergySummaryService } from './home-energy-summary.service.js';

@Injectable()
export class HomeEnergySummaryPrewarmWorker implements OnModuleInit, OnApplicationShutdown {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly infrastructure: RuntimeInfrastructure,
    private readonly summaries: HomeEnergySummaryService,
  ) {}

  onModuleInit(): void {
    const prewarmPolicy = this.infrastructure.policy.aqua.homeEnergySummary.prewarm;
    void this.run();
    this.timer = setInterval(() => void this.run(), prewarmPolicy.intervalMs);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const prewarmPolicy = this.infrastructure.policy.aqua.homeEnergySummary.prewarm;
      const timezoneRows = await this.infrastructure.database
        .selectDistinct({ timezone: preferences.timezone })
        .from(preferences);
      const dates = buildPrewarmDates(
        new Date(),
        timezoneRows.map((row) => row.timezone),
        prewarmPolicy.days,
      );
      const report = await this.summaries.prewarm(dates, prewarmPolicy.concurrency, prewarmPolicy.spacingMs);
      console.info('home_energy_summary_prewarm_completed', { dates, ...report });
    } catch (error) {
      console.error('home_energy_summary_prewarm_cycle_failed', {
        errorCode: (error as { code?: string })?.code ?? 'HOME_ENERGY_PREWARM_CYCLE_UNKNOWN',
      });
    } finally {
      this.running = false;
    }
  }
}

export function buildPrewarmDates(now: Date, timezones: string[], days: number): string[] {
  const effectiveTimezones = timezones.length > 0 ? timezones : ['Asia/Shanghai'];
  const dates = new Set<string>();
  for (const timezone of effectiveTimezones) {
    const base = localDateInTimezone(now, timezone);
    for (let offset = 0; offset < days; offset += 1) dates.add(addDays(base, offset));
  }
  return [...dates].sort();
}

function localDateInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function addDays(date: string, offset: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + offset)).toISOString().slice(0, 10);
}
