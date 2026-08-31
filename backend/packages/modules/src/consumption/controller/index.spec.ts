import { describe, expect, it, vi } from 'vitest';
import { ConsumptionController } from './index.js';

describe('ConsumptionController', () => {
  it('adds the versioned card-count seed cost before resolving candidates', async () => {
    const createResolution = vi.fn().mockResolvedValue(resolution());
    const controller = new ConsumptionController({ createResolution } as never);

    await controller.resolve({ auth: { userId: 'user-1' } } as never, 'resolution-key-0001', {
      serviceType: 'CARD_READING',
      quantity: 1,
      cardCount: 3,
      businessContext: { type: 'CARD_READING_INTENT', id: 'reading-1' },
    });

    expect(createResolution).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceType: 'CARD_READING',
        quantity: 1,
        unit: 'READING_CREDIT',
        attributes: {
          cardCount: 3,
          seedQuantity: 5,
          seedCostRuleVersion: 'reading-seed-cost-r1.1-v1',
        },
      }),
      'resolution-key-0001',
    );
  });

  it('requires card count so the seed fallback can always be priced', async () => {
    const controller = new ConsumptionController({ createResolution: vi.fn() } as never);

    await expect(
      controller.resolve({ auth: { userId: 'user-1' } } as never, 'resolution-key-0002', {
        serviceType: 'CARD_READING',
        quantity: 1,
        businessContext: { type: 'CARD_READING_INTENT', id: 'reading-2' },
      }),
    ).rejects.toMatchObject({ response: { code: 'CARD_COUNT_REQUIRED' } });
  });
});

function resolution() {
  const now = new Date('2026-08-31T00:00:00.000Z');
  return {
    resolutionId: 'resolution-1',
    ownerUserId: 'user-1',
    requirement: {
      userId: 'user-1',
      businessSpace: 'SATORI',
      serviceType: 'CARD_READING',
      quantity: 1,
      unit: 'READING_CREDIT',
      businessContext: { type: 'CARD_READING_INTENT', id: 'reading-1' },
    },
    status: 'NO_SOURCE',
    selectionMode: 'SYSTEM_RULE',
    candidates: [],
    selectedSource: null,
    reasonCode: 'PURCHASE_REQUIRED',
    ruleVersion: 'fixed-source-priority-v1',
    resolvedAt: now,
    expiresAt: new Date(now.getTime() + 30 * 60_000),
  } as const;
}
