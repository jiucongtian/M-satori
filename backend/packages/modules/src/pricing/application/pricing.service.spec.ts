import type { OfferingQuoteSnapshot } from '@satori/application';
import { IdempotencyKeyReusedError } from '@satori/application';
import { describe, expect, it } from 'vitest';
import {
  CHECKOUT_QUOTE_TTL_MS,
  PricingApplicationService,
  type CheckoutQuoteView,
  type PricingRepository,
} from './index.js';
import { QuoteRejectedError } from '../domain/index.js';

const offering: OfferingQuoteSnapshot = {
  offeringId: 'offering-1',
  offeringCode: 'membership-serenity-r11',
  offeringVersionId: 'version-1',
  offeringVersion: 1,
  businessSpace: 'SATORI',
  serviceType: 'CARD_READING',
  offeringKind: 'MEMBERSHIP',
  status: 'PUBLISHED',
  displayName: '清和计划',
  description: '30天',
  amountMinor: 2_490,
  currency: 'CNY',
  entitlementSpec: {},
  validityDays: 30,
  purchaseLimit: { lifetime: 1 },
  refundPolicyVersion: 'v1',
  refundPolicy: {},
  termsVersion: 'v1',
};

describe('PricingApplicationService', () => {
  it('issues a 15-minute authoritative seed-activity quote without exchange-rate wording', async () => {
    const repository = memoryRepository();
    const now = new Date('2026-08-28T08:00:00.000Z');
    const service = pricing(repository, { purchases: 0, seeds: 100, now });
    const quote = await service.createQuote(command());
    expect(quote.price.amountMinor).toBe(2_190);
    expect(quote.promotion.seedReservationRequired).toBe(80);
    expect(quote.expiresAt.getTime() - quote.issuedAt.getTime()).toBe(CHECKOUT_QUOTE_TTL_MS);
    expect(quote.promotion.message).not.toMatch(/抵扣|每颗|组合支付/);
  });

  it('replays the same command but rejects the same key with a different payload', async () => {
    const repository = memoryRepository();
    const service = pricing(repository, { purchases: 0, seeds: 0, now: new Date() });
    const first = await service.createQuote(command());
    expect(await service.createQuote(command())).toEqual(first);
    await expect(service.createQuote({ ...command(), offeringVersion: 2 })).rejects.toBeInstanceOf(
      IdempotencyKeyReusedError,
    );
  });

  it('rejects a removed version and an exhausted newcomer purchase limit', async () => {
    const unavailable = pricing(memoryRepository(), {
      purchases: 0,
      seeds: 0,
      now: new Date(),
      available: false,
    });
    await expect(unavailable.createQuote(command())).rejects.toMatchObject({ code: 'OFFERING_UNAVAILABLE' });
    const limited = pricing(memoryRepository(), { purchases: 1, seeds: 0, now: new Date() });
    await expect(limited.createQuote(command())).rejects.toBeInstanceOf(QuoteRejectedError);
  });
});

function pricing(
  repository: PricingRepository,
  options: { purchases: number; seeds: number; now: Date; available?: boolean },
) {
  return new PricingApplicationService(
    { findPublished: () => Promise.resolve(options.available === false ? null : offering) },
    { countFulfilledPurchases: () => Promise.resolve(options.purchases) },
    { getAvailableSeedQuantity: () => Promise.resolve(options.seeds) },
    repository,
    { now: () => options.now },
  );
}

function command() {
  return {
    ownerUserId: 'user-1',
    offeringId: offering.offeringId,
    idempotencyKey: '0123456789abcdef',
    requestId: 'request-1',
  } as const;
}

function memoryRepository(): PricingRepository {
  const records = new Map<string, { requestHash: string; view: CheckoutQuoteView }>();
  return {
    listActivePromotionRules: () =>
      Promise.resolve([
        {
          id: 'promotion-1',
          ruleVersion: 'r11-v1',
          minimumSeedBalance: 80,
          reservedSeedQuantity: 80,
          activityAmountMinor: 2_190,
          identityConstraint: {},
          purchaseLimit: {},
          restorationPolicy: {},
        },
      ]),
    findQuoteByIdempotency: (userId, key) => Promise.resolve(records.get(`${userId}:${key}`) ?? null),
    createQuote: (record, view) => {
      records.set(`${record.ownerUserId}:${record.idempotencyKey}`, {
        requestHash: record.requestHash,
        view,
      });
      return Promise.resolve(view);
    },
  };
}
