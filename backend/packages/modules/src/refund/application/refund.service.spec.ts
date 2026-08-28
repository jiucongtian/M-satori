import { SystemClock, type EntitlementGrantPort, type PaymentProvider } from '@satori/application';
import { describe, expect, it, vi } from 'vitest';
import { RefundApplicationService, type RefundOrderFacts, type RefundRepository } from './index.js';

describe('refund application policy boundaries', () => {
  it('never sends a previous membership upgrade order to the payment refund provider', async () => {
    const { provider, refund } = providerMock();
    const service = new RefundApplicationService(
      repositoryMock({
        orderId: '00000000-0000-4000-8000-000000000001',
        ownerUserId: '00000000-0000-4000-8000-000000000002',
        orderStatus: 'EXCEPTION',
        amountMinor: 1290,
        offeringKind: 'MEMBERSHIP',
        refundPolicyVersion: 'none',
        refundPolicy: {},
        paymentAttemptId: '00000000-0000-4000-8000-000000000003',
        providerAttemptId: 'wechat-old-membership',
        isUpgradePreviousOrder: true,
      }),
      provider,
      entitlementMock(),
      new SystemClock(),
    );
    await expect(
      service.reverseExceptional('00000000-0000-4000-8000-000000000001', 'FULFILLMENT_FAILED'),
    ).rejects.toMatchObject({ code: 'MEMBERSHIP_UPGRADE_RESIDUAL_FORBIDDEN' });
    expect(refund).not.toHaveBeenCalled();
  });
});

function providerMock() {
  const refund = vi.fn();
  return {
    refund,
    provider: {
      createPayment: vi.fn(),
      queryPayment: vi.fn(),
      refund,
    } as unknown as PaymentProvider,
  };
}

function repositoryMock(facts: RefundOrderFacts): RefundRepository {
  return {
    facts: () => Promise.resolve(facts),
    factsByAttempt: () => Promise.resolve(facts),
    create: () => Promise.reject(new Error('not expected')),
    get: () => Promise.resolve(null),
    findByOrder: () => Promise.resolve(null),
    markProcessing: () => Promise.reject(new Error('not expected')),
    recordProvider: () => Promise.resolve(),
    succeed: () => Promise.resolve(),
    fail: () => Promise.resolve(),
    listRecoverable: () => Promise.resolve([]),
    listOwned: () => Promise.resolve([]),
  };
}

function entitlementMock(): EntitlementGrantPort {
  return {
    grant: () => Promise.reject(new Error('not expected')),
    freezeBySource: () => Promise.resolve(),
    unfreezeBySource: () => Promise.resolve(),
    forfeitBySource: () => Promise.resolve(),
    expireDue: () => Promise.resolve(0),
    summarizeBySource: () => Promise.resolve({ totalQuantity: 0, availableQuantity: 0, reservedQuantity: 0 }),
    reverseAvailableBySource: () => Promise.resolve(0),
  };
}
