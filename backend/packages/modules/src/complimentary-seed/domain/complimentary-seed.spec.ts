import { describe, expect, it } from 'vitest';
import { calculateReadingSeedCost } from './index.js';

describe('card-count seed cost', () => {
  const rule = {
    version: 'reading-seed-cost-test-v1',
    costByCardCount: { 1: 10, 2: 18, 3: 25, 4: 31, 5: 36 },
  } as const;

  it('calculates from the confirmed card count and snapshots the rule version', () => {
    expect(calculateReadingSeedCost(1, rule)).toEqual({
      cardCount: 1,
      quantity: 10,
      unit: 'SEED',
      ruleVersion: rule.version,
    });
    expect(calculateReadingSeedCost(5, rule)).toEqual({
      cardCount: 5,
      quantity: 36,
      unit: 'SEED',
      ruleVersion: rule.version,
    });
  });

  it('rejects unsupported card counts and incomplete rules', () => {
    expect(() => calculateReadingSeedCost(0, rule)).toThrowError(
      expect.objectContaining({ code: 'INVALID_CARD_COUNT' }),
    );
    expect(() =>
      calculateReadingSeedCost(2, { version: 'broken', costByCardCount: { ...rule.costByCardCount, 2: 0 } }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_SEED_COST_RULE' }));
  });
});
