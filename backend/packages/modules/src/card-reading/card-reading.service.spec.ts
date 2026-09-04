import type { RuntimeInfrastructure } from '@satori/infrastructure';
import { describe, expect, it, vi } from 'vitest';
import type { CardReadingWorkflowService } from '../integrations/card-reading/card-reading-workflow.service.js';
import {
  CARD_DECK,
  CardReadingService,
  cardNumbersFromCodes,
  drawUniqueCardCodes,
} from './card-reading.service.js';

describe('server card draw', () => {
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
    const returning = vi.fn().mockImplementation(() => {
      const patch = patches.at(-1) ?? {};
      return Promise.resolve([{ ...row, ...patch }]);
    });
    const database = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([row]) })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn((patch: Record<string, unknown>) => {
          patches.push(patch);
          return { where: vi.fn(() => ({ returning })) };
        }),
      })),
    };
    const service = new CardReadingService(
      { database } as unknown as RuntimeInfrastructure,
      { execute } as unknown as CardReadingWorkflowService,
    );
    return { service, patches };
  }

  it('uses frozen cards, persists the real Aqua report and returns it', async () => {
    const execute = vi.fn().mockResolvedValue({
      result,
      requestId: 'aqua-request-1',
      manifest: { workflowVersion: 'ai-card-reading/1.0.0' },
    });
    const { service, patches } = fixture(execute);

    const response = await service.complete(row.ownerUserId, row.id);

    expect(response).toMatchObject({ status: 'GENERATING', report: null });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    expect(execute).toHaveBeenCalledWith(
      {
        audience: 'C',
        question: row.question,
        cards: [1, 60],
        context: { category: row.category, position_labels: row.positionLabels },
      },
      row.id,
      expect.stringMatching(/^[a-z0-9]+$/),
    );
    await vi.waitFor(() =>
      expect(patches.at(-1)).toEqual(
        expect.objectContaining({
          status: 'READY',
          content: result,
          providerRequestId: 'aqua-request-1',
          failure: null,
        }),
      ),
    );
  });

  it('persists FAILED when Aqua generation fails', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('upstream failed'));
    const { service, patches } = fixture(execute);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(service.complete(row.ownerUserId, row.id)).resolves.toMatchObject({ status: 'GENERATING' });
    await vi.waitFor(() =>
      expect(patches.at(-1)).toMatchObject({
        status: 'FAILED',
        failure: { code: 'CARD_READING_GENERATION_FAILED', retryable: false },
      }),
    );
  });

  it('maps frozen card codes to Aqua card numbers and rejects invalid codes', () => {
    expect(cardNumbersFromCodes(['01-jiazi', '60-guihai'])).toEqual([1, 60]);
    expect(() => cardNumbersFromCodes(['not-a-card'])).toThrow('Frozen card code is invalid');
  });
});
