import { describe, expect, it, vi } from 'vitest';
import { DailyInsightService } from './daily-insight.service.js';

function fixture(row: Record<string, unknown>) {
  const updates: Record<string, unknown>[] = [];
  const database = {
    select: () => ({ from: () => ({ where: () => Object.assign(Promise.resolve([row]), { limit: () => Promise.resolve([row]) }) }) }),
    update: () => ({
      set: (value: Record<string, unknown>) => {
        updates.push(value);
        return { where: () => Promise.resolve(undefined) };
      },
    }),
  };
  const consumption = {
    reserve: vi.fn().mockResolvedValue({ intentId: 'new-intent' }),
    start: vi.fn(),
    commit: vi.fn(),
    release: vi.fn(),
  };
  const service = new DailyInsightService(
    {
      database,
      environment: { CURSOR_SIGNING_SECRET: 'test-cursor-secret' },
      policy: { dailyInsight: { price: 1 } },
    } as never,
    {} as never,
    {} as never,
    { heartbeat: vi.fn() } as never,
    {} as never,
    { generate: vi.fn().mockRejectedValue(new Error('generation unavailable')) },
    consumption as never,
  );
  return { service, consumption, updates };
}

describe('daily insight uses only unified consumption', () => {
  it('retries a settled historical failure with a new consumption intent', async () => {
    const { service, consumption, updates } = fixture({
      id: 'insight',
      ownerUserId: 'user',
      status: 'FAILED',
      consumptionIntentId: null,
      seedReservationEntryId: 'historical-reservation',
      seedSettlementEntryId: 'historical-release',
    });
    await expect(service.generate('task', 'insight')).rejects.toThrow('generation unavailable');
    expect(consumption.reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user',
        serviceType: 'DAILY_INSIGHT',
        attributes: { seedQuantity: 1 },
      }),
      expect.any(String),
    );
    expect(consumption.start).toHaveBeenCalledWith('new-intent', 'new-intent:START');
    expect(updates).toContainEqual(
      expect.objectContaining({
        consumptionIntentId: 'new-intent',
        seedReservationEntryId: null,
        seedSettlementEntryId: null,
      }),
    );
  });

  it('rejects an unsettled historical job instead of deducting from the old account', async () => {
    const { service, consumption } = fixture({
      id: 'insight',
      status: 'GENERATING',
      consumptionIntentId: null,
    });
    await expect(service.generate('task', 'insight')).rejects.toThrow('migration required');
    await expect(service.compensateFailure('task', 'insight')).rejects.toThrow('migration required');
    expect(consumption.reserve).not.toHaveBeenCalled();
    expect(consumption.release).not.toHaveBeenCalled();
  });

  it('releases failed consumption using a stable idempotency key', async () => {
    const { service, consumption } = fixture({
      id: 'insight',
      status: 'GENERATING',
      consumptionIntentId: 'intent',
    });
    await service.compensateFailure('task', 'insight');
    await service.compensateFailure('task', 'insight');
    expect(consumption.release.mock.calls).toEqual([
      ['intent', 'intent:RELEASE'],
      ['intent', 'intent:RELEASE'],
    ]);
  });

  it('does not refund a completed insight during a late compensation callback', async () => {
    const { service, consumption, updates } = fixture({
      id: 'insight',
      status: 'READY',
      consumptionIntentId: 'intent',
    });
    await service.compensateFailure('task', 'insight');
    expect(consumption.release).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });
});
