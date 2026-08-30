import { describe, expect, it } from 'vitest';
import { buildPrewarmDates } from './home-energy-summary-prewarm.worker.js';

describe('home energy summary prewarm dates', () => {
  it('covers each active timezone for today and the configured future horizon', () => {
    expect(
      buildPrewarmDates(
        new Date('2026-08-17T16:30:00.000Z'),
        ['Asia/Shanghai', 'America/Los_Angeles'],
        3,
      ),
    ).toEqual(['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20']);
  });

  it('uses the product timezone when no user preference exists', () => {
    expect(buildPrewarmDates(new Date('2026-08-17T16:30:00.000Z'), [], 2)).toEqual([
      '2026-08-18',
      '2026-08-19',
    ]);
  });
});
