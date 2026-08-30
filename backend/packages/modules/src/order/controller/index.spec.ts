import { describe, expect, it } from 'vitest';
import { toPublicOfferingSnapshot } from './index.js';

describe('order offering snapshot response', () => {
  it('converts stored internal snapshots to the public ServiceOffering contract', () => {
    expect(
      toPublicOfferingSnapshot({
        offeringId: 'offering-1',
        offeringVersionId: 'version-1',
        offeringVersion: 3,
        offeringCode: 'reading-pack-10',
        displayName: '抽卡问事 · 10次包',
        offeringKind: 'PACKAGE',
        serviceType: 'CARD_READING',
        amountMinor: 9900,
        currency: 'CNY',
        entitlementSpec: { benefits: [{ serviceType: 'CARD_READING', quantity: 10 }] },
        purchaseLimit: { lifetime: 2 },
        validityDays: 180,
        refundPolicyVersion: 'refund-v1',
        termsVersion: 'terms-v1',
      }),
    ).toMatchObject({
      offeringId: 'offering-1',
      code: 'reading-pack-10',
      name: '抽卡问事 · 10次包',
      kind: 'SERVICE_PACK',
      price: { amount: 9900, currency: 'CNY' },
      benefits: [{ serviceType: 'CARD_READING', unit: 'COUNT', quantity: 10 }],
      purchaseLimit: 2,
      agreementVersion: 'terms-v1',
    });
  });

  it('returns safe public defaults for incomplete historical snapshots', () => {
    expect(toPublicOfferingSnapshot({})).toMatchObject({
      name: '服务订单',
      kind: 'SINGLE_SERVICE',
      price: { amount: 0, currency: 'CNY' },
      benefits: [],
    });
  });
});
