import { describe, expect, it } from 'vitest';
import { CatalogApplicationService, type CatalogRepository } from './index.js';
import { assertR11Sellable, OfferingNotSellableError, type CatalogOffering } from '../domain/index.js';

const offering: CatalogOffering = {
  offeringId: 'offering-1',
  offeringCode: 'card-reading-10',
  offeringVersionId: 'version-1',
  offeringVersion: 1,
  businessSpace: 'SATORI',
  serviceType: 'CARD_READING',
  offeringKind: 'PACKAGE',
  status: 'PUBLISHED',
  displayName: '抽卡问事·10次包',
  description: '10份',
  amountMinor: 5_990,
  currency: 'CNY',
  entitlementSpec: {},
  validityDays: 90,
  purchaseLimit: {},
  refundPolicyVersion: 'v1',
  refundPolicy: {},
  termsVersion: 'v1',
  recommended: true,
  displayChannels: ['STORE', 'SHORTAGE'],
};

describe('CatalogApplicationService', () => {
  it('allows the dedicated JSAPI test offering without changing a formal product price', () => {
    expect(() => assertR11Sellable('jsapi-payment-test-001')).not.toThrow();
  });

  it('filters single fallback products out of the store channel', async () => {
    const fallback = { ...offering, offeringId: 'single', displayChannels: ['SHORTAGE'] as const };
    const service = new CatalogApplicationService(repository([offering, fallback]));
    expect(await service.list('STORE')).toEqual([offering]);
    expect(await service.list('SHORTAGE')).toEqual([offering, fallback]);
  });

  it('keeps membership products behind the dedicated rollout endpoint', async () => {
    const membership = { ...offering, offeringId: 'membership', offeringKind: 'MEMBERSHIP' as const };
    const service = new CatalogApplicationService(repository([offering, membership]));
    expect(await service.list('STORE')).toEqual([offering]);
    expect(await service.listMembershipPlans()).toEqual([membership]);
  });

  it('allows a valid operations-managed product code and rejects malformed codes', async () => {
    expect(() => assertR11Sellable('service-package')).not.toThrow();
    const forbidden = { ...offering, offeringCode: '非法 商品' };
    const service = new CatalogApplicationService(repository([forbidden]));
    await expect(
      service.publish({
        offeringId: forbidden.offeringId,
        version: 2,
        displayName: '生命之光',
        description: 'not sellable',
        amountMinor: 36_500,
        entitlementSpec: {},
        validityDays: 30,
        purchaseLimit: {},
        refundPolicyVersion: 'v1',
        refundPolicy: {},
        termsVersion: 'v1',
        effectiveFrom: new Date(),
      }),
    ).rejects.toBeInstanceOf(OfferingNotSellableError);
  });
});

function repository(offerings: readonly CatalogOffering[]): CatalogRepository {
  return {
    listPublished: () => Promise.resolve(offerings),
    findPublished: (id) => Promise.resolve(offerings.find((item) => item.offeringId === id) ?? null),
    publishVersion: () => Promise.reject(new Error('not expected')),
    listVersionHistory: () => Promise.resolve([]),
  };
}
