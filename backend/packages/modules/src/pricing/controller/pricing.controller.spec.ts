import { describe, expect, it, vi } from 'vitest';
import { PricingController } from './index.js';

describe('PricingController', () => {
  it('publishes both standard and activity prices with the public Money contract', async () => {
    const createQuote = vi.fn().mockResolvedValue({
      quoteId: 'quote-1',
      offering: {
        offeringId: 'offering-1', offeringVersionId: 'version-1', offeringVersion: 1,
        offeringCode: 'membership-serenity-r11', offeringKind: 'MEMBERSHIP', serviceType: 'CARD_READING',
        status: 'PUBLISHED', displayName: '清和计划', amountMinor: 2_490, currency: 'CNY',
        entitlementSpec: { benefits: [] }, validityDays: 30, purchaseLimit: {},
        refundPolicyVersion: 'v1', refundPolicy: {}, termsVersion: 'v1', businessSpace: 'SATORI', description: '',
      },
      price: { amountMinor: 2_190, currency: 'CNY' },
      promotion: {
        eligible: true, applied: true, ruleVersion: 'v1', availableSeedQuantity: 18,
        minimumSeedBalance: 18, seedReservationRequired: 18,
        activityPrice: { amountMinor: 2_190, currency: 'CNY' }, message: '已使用',
      },
      businessContext: null,
      issuedAt: new Date('2026-09-07T00:00:00.000Z'),
      expiresAt: new Date('2026-09-07T00:15:00.000Z'),
    });
    const controller = new PricingController({ createQuote } as never);

    const response = await controller.create(
      { auth: { userId: 'user-1' } } as never,
      '0123456789abcdef',
      '00000000-0000-4000-8000-000000000001',
      { offeringId: 'offering-1', useSeedPromotion: true },
    );

    expect(createQuote).toHaveBeenCalledWith(expect.objectContaining({ useSeedPromotion: true }));
    expect(response.data.price).toEqual({ amount: 2_190, currency: 'CNY' });
    expect(response.data.promotion.activityPrice).toEqual({ amount: 2_190, currency: 'CNY' });
    expect(response.data.promotion.activityPrice).not.toHaveProperty('amountMinor');
  });
});
