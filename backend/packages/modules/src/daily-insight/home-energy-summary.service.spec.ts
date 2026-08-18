import { SEXAGENARY_CYCLE, type HomeEnergySummary } from '@satori/application';
import { describe, expect, it, vi } from 'vitest';
import { HomeEnergySummaryService, personalizeGreeting } from './home-energy-summary.service.js';

const sharedSummary: HomeEnergySummary = {
  greeting: '你好',
  guidance: '先稳住自己的节奏。',
  energyLevel: '中',
  suitableActions: ['梳理重点'],
  cautions: ['避免急躁'],
  date: '2026年8月18日',
  dayCard: '甲子',
  heavenCard: '乙丑',
  score: 1,
  signals: [],
  ruleVersion: 'rule-v1',
  copyVersion: 'copy-v1',
};

describe('shared home energy summaries', () => {
  it('covers every sexagenary day card exactly once', () => {
    expect(SEXAGENARY_CYCLE).toHaveLength(60);
    expect(new Set(SEXAGENARY_CYCLE)).toHaveLength(60);
  });

  it('personalizes only the response copy without mutating shared cache content', () => {
    expect(personalizeGreeting(sharedSummary, ' 小满 ')).toMatchObject({ greeting: '小满，你好' });
    expect(sharedSummary.greeting).toBe('你好');
    expect(personalizeGreeting({ ...sharedSummary, greeting: '朋友，你好' }, 'Fred').greeting).toBe('Fred，你好');
    expect(personalizeGreeting({ ...sharedSummary, greeting: '早上好' }, '  ').greeting).toBe('你好');
  });

  it('prewarms exactly 60 anonymous shared combinations for one date', async () => {
    const generate = vi.fn((input: { dayCard: string; heavenCard: string; date: string }) =>
      Promise.resolve({
        providerRequestId: `request-${input.dayCard}`,
        summary: { ...sharedSummary, dayCard: input.dayCard, heavenCard: input.heavenCard },
      }),
    );
    const infrastructure = {
      environment: { HOME_ENERGY_SUMMARY_ENABLED: true },
      redis: { set: vi.fn().mockResolvedValue('OK'), eval: vi.fn().mockResolvedValue(0) },
      database: {
        select: vi.fn(() => ({
          from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
        })),
        insert: vi.fn(() => ({
          values: () => ({
            onConflictDoNothing: () => ({ returning: () => Promise.resolve([{ id: 'cache-row' }]) }),
          }),
        })),
      },
    };
    const service = new HomeEnergySummaryService(infrastructure as never, { generate });

    await expect(service.prewarm(['2026-08-18'], 4, 3_000)).resolves.toEqual({
      requested: 60,
      generated: 60,
      cached: 0,
      locked: 0,
      failed: 0,
    });
    expect(generate).toHaveBeenCalledTimes(60);
    expect(infrastructure.redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('slot+spacing'),
      1,
      expect.stringContaining('home-energy-prewarm-rate:'),
      expect.any(Number),
      3_000,
    );
    const generatedInputs = generate.mock.calls.map(([input]) => input);
    expect(generatedInputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ runReference: 'shared-00' }),
        expect.objectContaining({ runReference: 'shared-59' }),
      ]),
    );
    expect(generatedInputs.every((input) => !('userName' in input))).toBe(true);
  });
});
