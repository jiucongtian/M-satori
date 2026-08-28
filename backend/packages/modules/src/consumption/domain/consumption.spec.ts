import type { BenefitCandidate } from '@satori/application';
import { describe, expect, it } from 'vitest';
import { rankCandidates, sourceReason } from './index.js';

describe('fixed benefit-source priority', () => {
  it('selects membership, purchased batches by expiry, then seed batches', () => {
    const ranked = rankCandidates(
      [
        candidate('purchase-later', 'PURCHASED_ENTITLEMENT', '2026-12-01T00:00:00.000Z'),
        candidate('membership', 'MEMBERSHIP_ENTITLEMENT', '2026-12-20T00:00:00.000Z'),
        candidate('purchase-first', 'PURCHASED_ENTITLEMENT', '2026-11-01T00:00:00.000Z'),
      ],
      [candidate('seed', 'COMPLIMENTARY_SEED', '2026-10-01T00:00:00.000Z')],
    );

    expect(ranked.map((value) => value.sourceId)).toEqual([
      'membership',
      'purchase-first',
      'purchase-later',
      'seed',
    ]);
    expect(ranked.map((value) => value.rank)).toEqual([1, 2, 3, 4]);
    expect(sourceReason(ranked[0]!.sourceType)).toBe('CURRENT_MEMBERSHIP_SELECTED');
  });

  it('excludes an insufficient candidate and returns a purchase-required reason when empty', () => {
    const insufficient = { ...candidate('empty', 'PURCHASED_ENTITLEMENT', null), availableQuantity: 0 };
    expect(rankCandidates([insufficient], [])).toEqual([]);
    expect(sourceReason(null)).toBe('PURCHASE_REQUIRED');
  });
});

function candidate(
  sourceId: string,
  sourceType: BenefitCandidate['sourceType'],
  expiresAt: string | null,
): BenefitCandidate {
  return {
    sourceId,
    sourceType,
    serviceType: 'CARD_READING',
    availableQuantity: 10,
    requiredQuantity: 1,
    expiresAt: expiresAt ? new Date(expiresAt) : null,
    grantedAt: new Date('2026-08-01T00:00:00.000Z'),
    ruleVersion: 'test-v1',
  };
}
