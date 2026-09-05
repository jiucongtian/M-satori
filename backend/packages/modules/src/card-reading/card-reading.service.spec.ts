import type { RuntimeInfrastructure } from '@satori/infrastructure';
import type { ConsumptionPort } from '@satori/application';
import { R1_CARD_READING_SEED_COST_RULE } from '@satori/domain';
import { describe, expect, it, vi } from 'vitest';
import type { CardReadingWorkflowService } from '../integrations/card-reading/card-reading-workflow.service.js';
import { generationTasks } from '@satori/infrastructure';
import type { GenerationTaskService } from '../generation-task/generation-task.service.js';
import type { GenerationTaskRunner } from '../generation-task/generation-task.runner.js';
import {
  CARD_DECK,
  CardReadingService,
  cardNumbersFromCodes,
  drawUniqueCardCodes,
} from './card-reading.service.js';

describe('server card draw', () => {
  function drawFixture(denied = false) {
    let stored: Record<string, unknown> | undefined;
    const tx = {
      execute: vi.fn(),
      select: () => ({
        from: () => ({ where: () => ({ limit: () => Promise.resolve(stored ? [stored] : []) }) }),
      }),
      insert: vi.fn(() => ({
        values: (value: Record<string, unknown>) => ({
          returning: () => {
            stored = value;
            return Promise.resolve([value]);
          },
        }),
      })),
    };
    const consumption = {
      reserve: denied
        ? vi.fn().mockRejectedValue(new Error('PURCHASE_REQUIRED'))
        : vi.fn().mockResolvedValue({ intentId: 'intent-1' }),
      start: vi.fn().mockResolvedValue({}),
    };
    const infrastructure = {
      database: { transaction: (callback: (db: typeof tx) => unknown) => callback(tx) },
      policy: { cardReading: { seedCost: R1_CARD_READING_SEED_COST_RULE } },
    };
    const service = new CardReadingService(
      infrastructure as unknown as RuntimeInfrastructure,
      {} as CardReadingWorkflowService,
      consumption as unknown as ConsumptionPort,
      {} as GenerationTaskService,
      {} as GenerationTaskRunner,
    );
    return { service, consumption, tx };
  }
  const command = {
    ownerUserId: 'user-1',
    question: '如何面对工作变化？',
    category: '事业',
    cardCount: 2,
    positionLabels: ['自己', '他人'],
  };

  it('rejects a draw without benefits before creating cards', async () => {
    const { service, tx, consumption } = drawFixture(true);
    await expect(service.createDraw(command, 'draw-request-key-1')).rejects.toThrow('PURCHASE_REQUIRED');
    expect(tx.insert).not.toHaveBeenCalled();
    expect(consumption.start).not.toHaveBeenCalled();
  });

  it('replays the same draw without reserving twice and rejects changed inputs', async () => {
    const { service, consumption } = drawFixture();
    const first = await service.createDraw(command, 'draw-request-key-1');
    const replay = await service.createDraw(command, 'draw-request-key-1');
    expect(replay).toEqual(first);
    expect(consumption.reserve).toHaveBeenCalledOnce();
    expect(consumption.reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        quantity: 1,
        attributes: expect.objectContaining({
          cardCount: 2,
          seedQuantity: R1_CARD_READING_SEED_COST_RULE.costByCardCount[2],
        }) as unknown,
      }),
      expect.any(String),
    );
    await expect(service.createDraw({ ...command, cardCount: 3 }, 'draw-request-key-1')).rejects.toThrow();
  });
  it('never repeats a card inside one spread', () => {
    for (let index = 0; index < 10_000; index += 1) {
      const cards = drawUniqueCardCodes(5);
      expect(new Set(cards).size).toBe(5);
    }
  });

  it('keeps first-position frequency within a statistical tolerance', () => {
    const rounds = 60_000;
    const counts = new Map(CARD_DECK.map((card) => [card.code, 0]));
    for (let index = 0; index < rounds; index += 1) {
      const card = drawUniqueCardCodes(1)[0]!;
      counts.set(card, counts.get(card)! + 1);
    }
    const expected = rounds / CARD_DECK.length;
    const maximumDeviation = expected * 0.2;
    for (const count of counts.values()) expect(Math.abs(count - expected)).toBeLessThan(maximumDeviation);
  });

  it('can be replayed deterministically in tests without changing production entropy', () => {
    expect(drawUniqueCardCodes(3, () => 0)).toEqual(drawUniqueCardCodes(3, () => 0));
  });
});

describe('Aqua card reading generation', () => {
  const now = new Date('2026-09-03T12:00:00.000Z');
  const row = {
    id: '00000000-0000-7000-8000-000000000001',
    ownerUserId: '00000000-0000-7000-8000-000000000002',
    question: '这段关系适合继续吗？',
    category: 'ROMANTIC',
    cardCount: 2,
    positionLabels: ['我', '对方'],
    cardCodes: ['01-jiazi', '60-guihai'],
    status: 'DRAWN',
    consumptionIntentId: 'consumption-1',
    consumptionAttempt: 1,
    content: null,
    generationManifest: null,
    providerRequestId: null,
    failure: null,
    generationStartedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const result = {
    audience: 'C' as const,
    cards: [1, 60],
    missing_fields: [],
    mode: 'dual' as const,
    notice: '内容用于自我观察与成长参考。',
    question_type: 'romantic',
    report: '真实五段式报告',
    status: 'complete',
    title: '在关系里看见彼此的节奏',
  };

  function fixture(execute: ReturnType<typeof vi.fn>) {
    const patches: Array<Record<string, unknown>> = [];
    const state = { ...row, status: 'GENERATING' };
    const task = {
      id: 'task-1',
      status: 'RUNNING',
      currentAttempt: 1,
      failure: { code: 'UPSTREAM_FAILED', retryable: true },
    };
    const returning = vi.fn().mockImplementation(() => {
      const patch = patches.at(-1) ?? {};
      return Promise.resolve([{ ...state, ...patch }]);
    });
    const database = {
      select: vi.fn(() => ({
        from: vi.fn((table: unknown) => ({
          where: vi.fn(() => {
            const query = {
              limit: () => Promise.resolve([table === generationTasks ? task : state]),
              for: () => query,
            };
            return query;
          }),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn((patch: Record<string, unknown>) => {
          patches.push(patch);
          Object.assign(state, patch);
          return { where: vi.fn(() => ({ returning })) };
        }),
      })),
    };
    const infrastructure = {
      database: {
        ...database,
        transaction: (callback: (tx: typeof database) => unknown) => callback(database),
      },
    };
    const consumption = { commit: vi.fn().mockResolvedValue({}), release: vi.fn().mockResolvedValue({}) };
    const service = new CardReadingService(
      infrastructure as unknown as RuntimeInfrastructure,
      { execute } as unknown as CardReadingWorkflowService,
      consumption as unknown as ConsumptionPort,
      {} as GenerationTaskService,
      {} as GenerationTaskRunner,
    );
    return { service, patches, consumption, state, task };
  }

  it('uses frozen cards, persists the real Aqua report and returns it', async () => {
    const execute = vi.fn().mockResolvedValue({
      result,
      requestId: 'aqua-request-1',
      manifest: { workflowVersion: 'ai-card-reading/1.0.0' },
    });
    const { service, state, consumption } = fixture(execute);

    await service.generate('task-1', row.consumptionIntentId);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    expect(execute).toHaveBeenCalledWith(
      {
        audience: 'C',
        question: row.question,
        cards: [1, 60],
        context: {
          category: row.category,
          position_labels: row.positionLabels,
          presentation_requirements: expect.objectContaining({
            report_title: expect.stringContaining('不罗列卡牌编号') as unknown,
            section_count: expect.stringContaining('5 至 9') as unknown,
            section_titles: expect.stringContaining('完整故事') as unknown,
          }) as unknown,
        },
      },
      row.id,
      expect.stringMatching(/^[a-z0-9]+$/),
    );
    await vi.waitFor(() =>
      expect(state).toEqual(
        expect.objectContaining({
          status: 'READY',
          content: result,
          providerRequestId: 'aqua-request-1',
          failure: null,
        }),
      ),
    );
    expect(consumption.commit).toHaveBeenCalledWith('consumption-1', 'consumption-1:COMMIT');
    expect(consumption.release).not.toHaveBeenCalled();
  });

  it('keeps reservation during automatic retries and releases on final task failure', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('upstream failed'));
    const { service, patches, consumption, task } = fixture(execute);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(service.generate('task-1', row.consumptionIntentId)).rejects.toThrow('Card reading generation failed');
    expect(consumption.release).not.toHaveBeenCalled();
    task.status = 'FAILED';
    await service.finalFailure('task-1', row.consumptionIntentId);
    await vi.waitFor(() =>
      expect(patches.at(-1)).toMatchObject({
        status: 'FAILED',
        failure: { code: 'UPSTREAM_FAILED', retryable: true },
      }),
    );
    expect(consumption.release).toHaveBeenCalledWith('consumption-1', 'consumption-1:RELEASE');
    expect(consumption.commit).not.toHaveBeenCalled();
  });

  it('maps frozen card codes to Aqua card numbers and rejects invalid codes', () => {
    expect(cardNumbersFromCodes(['01-jiazi', '60-guihai'])).toEqual([1, 60]);
    expect(() => cardNumbersFromCodes(['not-a-card'])).toThrow('Frozen card code is invalid');
  });
});
