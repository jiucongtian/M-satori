import { describe, expect, it } from 'vitest';
import { buildReadingRequirement } from './index.js';

const seedCostPolicy = { version: 'reading-test-v1', costByCardCount: { 1: 2, 2: 3, 3: 5, 4: 7, 5: 9 } } as const;
const command = { ownerUserId: 'user', readingIntentId: 'opaque-id', cardCount: 1, seedCostPolicy };

describe('reading consumption requirement used by the real service', () => {
  it.each([1, 2, 3, 4, 5] as const)('uses one credit and policy seed fallback for %i cards', cardCount => {
    expect(buildReadingRequirement({ ...command, cardCount }, 2)).toEqual({
      userId: 'user', businessSpace: 'SATORI', serviceType: 'CARD_READING', quantity: 1, unit: 'READING_CREDIT',
      businessContext: { type: 'READING_INTENT_ATTEMPT', id: 'opaque-id:2' },
      attributes: { cardCount, seedQuantity: seedCostPolicy.costByCardCount[cardCount], seedCostRuleVersion: seedCostPolicy.version },
    });
  });
  it.each([0, 6, 1.5, NaN])('rejects invalid count %s', cardCount => {
    expect(() => buildReadingRequirement({ ...command, cardCount })).toThrow('Card count');
  });
  it('rejects invalid cost and never passes the question to consumption', () => {
    expect(() => buildReadingRequirement({ ...command, seedCostPolicy: { ...seedCostPolicy, costByCardCount: { ...seedCostPolicy.costByCardCount, 1: 0 } } })).toThrow('seed cost');
    expect(buildReadingRequirement(command).attributes).not.toHaveProperty('question');
  });
});
