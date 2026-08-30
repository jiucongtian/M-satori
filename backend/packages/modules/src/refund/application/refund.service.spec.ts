import { SystemClock, type EntitlementGrantPort, type PaymentProvider } from '@satori/application';
import { describe, expect, it, vi } from 'vitest';
import {
  RefundApplicationService,
  type RefundOrderFacts,
  type RefundRecord,
  type RefundRepository,
} from './index.js';

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

  it('keeps entitlements frozen while provider refund is processing and reverses only after query success', async () => {
    const facts: RefundOrderFacts = {
      orderId: '00000000-0000-4000-8000-000000000011',
      ownerUserId: '00000000-0000-4000-8000-000000000012',
      orderStatus: 'FULFILLED',
      amountMinor: 1290,
      offeringKind: 'SERVICE_PACK',
      refundPolicyVersion: 'unused-v1',
      refundPolicy: { eligibility: 'UNUSED_ONLY', refundableBasisPoints: 10_000 },
      paymentAttemptId: '00000000-0000-4000-8000-000000000013',
      providerAttemptId: '00000000000040008000000000000014',
      isUpgradePreviousOrder: false,
    };
    let record: RefundRecord = {
      refundId: '00000000-0000-4000-8000-000000000015',
      orderId: facts.orderId,
      ownerUserId: facts.ownerUserId,
      paymentAttemptId: facts.paymentAttemptId,
      status: 'REQUESTED',
      reasonCode: 'CUSTOMER_REQUEST_UNUSED',
      amountMinor: 1290,
      refundPolicyVersion: facts.refundPolicyVersion,
      providerRefundId: null,
      requestId: '00000000-0000-4000-8000-000000000016',
      createdAt: new Date('2026-08-29T00:00:00.000Z'),
      completedAt: null,
    };
    const refund = vi.fn().mockResolvedValue({
      providerRefundId: '00000000000040008000000000000015',
      state: 'PROCESSING',
    });
    const queryRefund = vi.fn().mockResolvedValue({
      providerRefundId: '00000000000040008000000000000015',
      state: 'SUCCEEDED',
    });
    const reverse = vi.fn().mockResolvedValue(1);
    const repository: RefundRepository = {
      facts: () => Promise.resolve(facts),
      factsByAttempt: () => Promise.resolve(facts),
      create: () => Promise.reject(new Error('not expected')),
      get: () => Promise.resolve(record),
      findByOrder: () => Promise.resolve(null),
      markProcessing: () => {
        record = { ...record, status: 'PROCESSING' };
        return Promise.resolve(record);
      },
      recordProvider: (_refundId, providerRefundId) => {
        record = { ...record, providerRefundId };
        return Promise.resolve();
      },
      succeed: () => {
        record = { ...record, status: 'SUCCEEDED', completedAt: new Date() };
        return Promise.resolve();
      },
      fail: () => Promise.resolve(),
      listRecoverable: () => Promise.resolve([]),
      listOwned: () => Promise.resolve([]),
    };
    const service = new RefundApplicationService(
      repository,
      {
        createPayment: vi.fn(),
        queryPayment: vi.fn(),
        refund,
        queryRefund,
      },
      { ...entitlementMock(), reverseAvailableBySource: reverse },
      new SystemClock(),
    );

    await expect(service.process(record.refundId)).resolves.toMatchObject({ status: 'PROCESSING' });
    expect(refund).toHaveBeenCalledWith(expect.objectContaining({ originalAmountMinor: 1290 }));
    expect(queryRefund).not.toHaveBeenCalled();
    expect(reverse).not.toHaveBeenCalled();

    await expect(service.process(record.refundId)).resolves.toMatchObject({ status: 'SUCCEEDED' });
    expect(refund).toHaveBeenCalledTimes(1);
    expect(queryRefund).toHaveBeenCalledWith(record.providerRefundId);
    expect(reverse).toHaveBeenCalledTimes(1);
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
