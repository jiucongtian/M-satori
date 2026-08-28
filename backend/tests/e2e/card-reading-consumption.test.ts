import type { ConsumptionIntentView, ConsumptionPort, EntitlementResolutionView } from '@satori/application';
import type { ServiceRequirement } from '@satori/domain';
import { describe, expect, it, vi } from 'vitest';
import {
  CardReadingApplicationService,
  GenerationTaskConsumptionAdapter,
  buildReadingRequirement,
  type ReadingIntent,
  type ReadingIntentRepository,
} from '../../packages/modules/src/card-reading/index.js';

const seedCostPolicy = {
  version: 'reading-seed-cost-e2e-v1',
  costByCardCount: { 1: 2, 2: 3, 3: 5, 4: 7, 5: 9 },
} as const;

describe('card-reading consumption Fake E2E', () => {
  it('resolves and reserves before draw, then commits exactly once on READY', async () => {
    const calls: string[] = [];
    const consumption = new FakeConsumptionPort(calls, 'MEMBERSHIP_ENTITLEMENT');
    const readings = new MemoryReadingRepository();
    const draw = vi.fn(() => {
      calls.push('draw');
      return Promise.resolve({ drawId: 'draw-1', cardIds: ['card-a', 'card-b', 'card-c'] });
    });
    const service = new CardReadingApplicationService(consumption, readings, { draw });
    const terminal = new GenerationTaskConsumptionAdapter(consumption, readings);

    const reading = await service.begin({
      ownerUserId: 'user-1',
      readingIntentId: 'reading-1',
      cardCount: 3,
      seedCostPolicy,
    });

    expect(reading).toMatchObject({ status: 'RUNNING', seedQuantity: 5, consumptionAttempt: 1 });
    expect(calls.slice(0, 3)).toEqual(['reserve', 'start', 'draw']);
    expect(consumption.requirements[0]).toMatchObject({
      unit: 'READING_CREDIT',
      quantity: 1,
      attributes: { cardCount: 3, seedQuantity: 5 },
    });

    const event = {
      eventId: 'generation-ready-1',
      taskId: 'task-1',
      targetType: 'CARD_READING' as const,
      targetId: 'reading-1',
      status: 'READY' as const,
    };
    await terminal.handle(event);
    await terminal.handle(event);

    expect(await readings.get('reading-1')).toMatchObject({ status: 'READY' });
    expect(consumption.committedIntentIds).toEqual(['intent-1']);
  });

  it('releases on generation failure and retries with frozen cards without duplicate settlement', async () => {
    const calls: string[] = [];
    const consumption = new FakeConsumptionPort(calls, 'PURCHASED_ENTITLEMENT');
    const readings = new MemoryReadingRepository();
    const draw = vi.fn(() =>
      Promise.resolve({
        drawId: 'draw-stable',
        cardIds: ['card-1', 'card-2', 'card-3'],
      }),
    );
    const service = new CardReadingApplicationService(consumption, readings, { draw });
    const terminal = new GenerationTaskConsumptionAdapter(consumption, readings);

    const initial = await service.begin({
      ownerUserId: 'user-2',
      readingIntentId: 'reading-retry',
      cardCount: 3,
      seedCostPolicy,
    });
    await terminal.handle({
      eventId: 'generation-failed-1',
      taskId: 'task-retry',
      targetType: 'CARD_READING',
      targetId: initial.readingIntentId,
      status: 'FAILED',
    });
    expect(consumption.releasedIntentIds).toEqual(['intent-1']);

    const retry = await service.retryGeneration(initial.readingIntentId);
    expect(retry).toMatchObject({
      status: 'RUNNING',
      consumptionAttempt: 2,
      consumptionIntentId: 'intent-2',
      draw: initial.draw,
    });
    expect(draw).toHaveBeenCalledOnce();
    expect(consumption.requirements[1]!.businessContext.id).toBe('reading-retry:2');

    const ready = {
      eventId: 'generation-ready-retry',
      taskId: 'task-retry',
      targetType: 'CARD_READING' as const,
      targetId: initial.readingIntentId,
      status: 'READY' as const,
    };
    await terminal.handle(ready);
    await terminal.handle(ready);

    expect(consumption.committedIntentIds).toEqual(['intent-2']);
    expect(consumption.releasedIntentIds).toEqual(['intent-1']);
    expect((await readings.get(initial.readingIntentId))!.draw).toEqual(initial.draw);
  });

  it('keeps the business context opaque and rejects invalid card counts', () => {
    const requirement = buildReadingRequirement({
      ownerUserId: 'user-3',
      readingIntentId: 'opaque-reading-id',
      cardCount: 5,
      seedCostPolicy,
    });
    expect(requirement).toEqual(
      expect.objectContaining({
        businessContext: { type: 'READING_INTENT_ATTEMPT', id: 'opaque-reading-id:1' },
      }),
    );
    expect(requirement.attributes).not.toHaveProperty('question');
    expect(() =>
      buildReadingRequirement({
        ownerUserId: 'user-3',
        readingIntentId: 'invalid-reading',
        cardCount: 6,
        seedCostPolicy,
      }),
    ).toThrow('Card count must be an integer from 1 to 5');
  });
});

class MemoryReadingRepository implements ReadingIntentRepository {
  private readonly values = new Map<string, ReadingIntent>();

  get(readingIntentId: string) {
    return Promise.resolve(this.values.get(readingIntentId) ?? null);
  }

  create(intent: ReadingIntent) {
    const replay = this.values.get(intent.readingIntentId);
    if (replay) return Promise.resolve(replay);
    this.values.set(intent.readingIntentId, intent);
    return Promise.resolve(intent);
  }

  update(readingIntentId: string, patch: Partial<ReadingIntent>) {
    const current = this.values.get(readingIntentId);
    if (!current) throw new Error('Reading not found');
    const updated = { ...current, ...patch };
    this.values.set(readingIntentId, updated);
    return Promise.resolve(updated);
  }
}

class FakeConsumptionPort implements ConsumptionPort {
  readonly requirements: ServiceRequirement[] = [];
  readonly committedIntentIds: string[] = [];
  readonly releasedIntentIds: string[] = [];
  private readonly states = new Map<string, ConsumptionIntentView['state']>();

  constructor(
    private readonly calls: string[],
    private readonly sourceType: 'MEMBERSHIP_ENTITLEMENT' | 'PURCHASED_ENTITLEMENT',
  ) {}

  resolve(requirement: ServiceRequirement): Promise<EntitlementResolutionView> {
    return Promise.resolve(this.resolution(requirement, `resolution-${this.requirements.length + 1}`));
  }

  reserve(requirement: ServiceRequirement): Promise<ConsumptionIntentView> {
    this.calls.push('reserve');
    this.requirements.push(requirement);
    const intentId = `intent-${this.requirements.length}`;
    this.states.set(intentId, 'RESERVED');
    return Promise.resolve(this.intent(requirement, intentId));
  }

  start(intentId: string): Promise<ConsumptionIntentView> {
    this.calls.push('start');
    this.states.set(intentId, 'RUNNING');
    return Promise.resolve(this.intent(this.requirements.at(-1)!, intentId));
  }

  commit(intentId: string): Promise<ConsumptionIntentView> {
    if (this.states.get(intentId) !== 'COMMITTED') this.committedIntentIds.push(intentId);
    this.states.set(intentId, 'COMMITTED');
    return Promise.resolve(this.intent(this.requirements.at(-1)!, intentId));
  }

  release(intentId: string): Promise<ConsumptionIntentView> {
    if (this.states.get(intentId) !== 'RELEASED') this.releasedIntentIds.push(intentId);
    this.states.set(intentId, 'RELEASED');
    return Promise.resolve(this.intent(this.requirements.at(-1)!, intentId));
  }

  private resolution(requirement: ServiceRequirement, resolutionId: string): EntitlementResolutionView {
    return {
      resolutionId,
      selectedCandidate: {
        sourceId: `${this.sourceType.toLowerCase()}-1`,
        sourceType: this.sourceType,
        serviceType: 'CARD_READING',
        availableQuantity: 1,
        requiredQuantity: requirement.quantity,
        expiresAt: new Date('2026-12-31T00:00:00.000Z'),
        grantedAt: new Date('2026-08-28T00:00:00.000Z'),
        ruleVersion: 'fake-e2e-v1',
      },
      reasonCode: 'SYSTEM_FIXED_PRIORITY',
      ruleVersion: 'fake-e2e-v1',
    };
  }

  private intent(requirement: ServiceRequirement, intentId: string): ConsumptionIntentView {
    return {
      intentId,
      state: this.states.get(intentId)!,
      resolution: this.resolution(requirement, `resolution-${intentId}`),
      reservation: {
        reservationId: `reservation-${intentId}`,
        sourceId: `${this.sourceType.toLowerCase()}-1`,
        sourceType: this.sourceType,
        quantity: requirement.quantity,
        expiresAt: new Date('2026-12-31T00:00:00.000Z'),
      },
    };
  }
}
