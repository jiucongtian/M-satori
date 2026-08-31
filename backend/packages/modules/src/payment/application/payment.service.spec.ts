/* eslint-disable @typescript-eslint/unbound-method */
import type {
  PaymentOrderLifecyclePort,
  PaymentProvider,
  ProviderPaymentResult,
  SeedPromotionLifecyclePort,
} from '@satori/application';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaymentApplicationService, type PaymentAttemptView, type PaymentRepository } from './index.js';

describe('PaymentApplicationService maintenance', () => {
  afterEach(() => vi.useRealTimers());

  it('queries and closes an expired provider payment before closing its order', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-31T08:00:00.000Z'));
    const fixture = maintenanceFixture({
      orderExpiresAt: new Date('2026-08-31T07:59:00.000Z'),
    });
    const closePayment = vi.fn(() => {
      fixture.providerState.value = 'CANCELLED';
      return Promise.resolve();
    });
    fixture.provider.closePayment = closePayment;

    await expect(fixture.service.maintain()).resolves.toEqual({
      checked: 1,
      succeeded: 0,
      closed: 1,
      pending: 0,
      failed: 0,
    });
    expect(fixture.provider.queryPayment).toHaveBeenCalledTimes(2);
    expect(closePayment).toHaveBeenCalledWith('provider-attempt-1');
    expect(fixture.orders.closeAfterPaymentFailure).toHaveBeenCalledWith(
      'order-1',
      'attempt-1',
      expect.any(String),
    );
  });

  it('accepts a late success discovered by recovery and never closes the order', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-31T08:00:00.000Z'));
    const fixture = maintenanceFixture({
      orderExpiresAt: new Date('2026-08-31T07:59:00.000Z'),
      providerState: 'SUCCEEDED',
      promotionSeedReservationId: 'reservation-1',
    });
    fixture.provider.closePayment = vi.fn();

    await expect(fixture.service.maintain()).resolves.toEqual({
      checked: 1,
      succeeded: 1,
      closed: 0,
      pending: 0,
      failed: 0,
    });
    expect(fixture.provider.closePayment).not.toHaveBeenCalled();
    expect(fixture.orders.closeAfterPaymentFailure).not.toHaveBeenCalled();
    expect(fixture.seeds.consumeAfterPaymentSuccess).toHaveBeenCalledWith(
      'reservation-1',
      'attempt-1',
      expect.any(String),
    );
  });

  it('retries an interrupted provider creation and keeps an unexpired payment open', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-31T08:00:00.000Z'));
    const fixture = maintenanceFixture({
      providerAttemptId: null,
      status: 'CREATED',
      orderExpiresAt: new Date('2026-08-31T08:10:00.000Z'),
    });

    await expect(fixture.service.maintain()).resolves.toEqual({
      checked: 1,
      succeeded: 0,
      closed: 0,
      pending: 1,
      failed: 0,
    });
    expect(fixture.provider.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({ attemptId: 'attempt-1', orderId: 'order-1', amountMinor: 9900 }),
    );
    expect(fixture.provider.queryPayment).not.toHaveBeenCalled();
    expect(fixture.orders.closeAfterPaymentFailure).not.toHaveBeenCalled();
  });

  it('defers a failed provider query so the record can be retried later', async () => {
    const fixture = maintenanceFixture();
    vi.mocked(fixture.provider.queryPayment).mockRejectedValueOnce(new Error('provider unavailable'));

    await expect(fixture.service.maintain()).resolves.toEqual({
      checked: 1,
      succeeded: 0,
      closed: 0,
      pending: 0,
      failed: 1,
    });
    expect(fixture.repository.deferRecovery).toHaveBeenCalledWith(
      'attempt-1',
      expect.objectContaining({ message: 'provider unavailable' }),
    );
  });

  it('repairs a terminal payment whose order close was interrupted by a process exit', async () => {
    const fixture = maintenanceFixture({ status: 'CANCELLED' });

    await expect(fixture.service.maintain()).resolves.toEqual({
      checked: 1,
      succeeded: 0,
      closed: 1,
      pending: 0,
      failed: 0,
    });
    expect(fixture.provider.queryPayment).not.toHaveBeenCalled();
    expect(fixture.orders.closeAfterPaymentFailure).toHaveBeenCalledWith(
      'order-1',
      'attempt-1',
      expect.any(String),
    );
  });
});

function maintenanceFixture(
  overrides: Partial<PaymentAttemptView> & { providerState?: ProviderPaymentResult['state'] } = {},
) {
  const { providerState = 'PENDING', ...viewOverrides } = overrides;
  let current: PaymentAttemptView = {
    paymentAttemptId: 'attempt-1',
    orderId: 'order-1',
    ownerUserId: 'user-1',
    provider: 'FAKE',
    providerAttemptId: 'provider-attempt-1',
    status: 'PENDING',
    amountMinor: 9900,
    currency: 'CNY',
    clientParameters: null,
    createdAt: new Date('2026-08-31T07:50:00.000Z'),
    succeededAt: null,
    orderExpiresAt: new Date('2026-08-31T08:10:00.000Z'),
    promotionSeedReservationId: null,
    ...viewOverrides,
  };
  const providerStateValue = { value: providerState };
  const providerResult = (): ProviderPaymentResult => ({
    providerAttemptId: current.providerAttemptId ?? 'provider-attempt-1',
    state: providerStateValue.value,
    orderId: current.orderId,
    amountMinor: current.amountMinor,
    currency: 'CNY',
    ...(providerStateValue.value === 'SUCCEEDED' ? { providerOccurredAt: new Date() } : {}),
  });
  const repository = {
    listRecoverable: vi.fn(() => Promise.resolve([current])),
    attachProvider: vi.fn((_attemptId: string, result: ProviderPaymentResult) => {
      current = {
        ...current,
        providerAttemptId: result.providerAttemptId,
        status: result.state === 'CREATED' ? 'PENDING' : result.state,
      };
      return Promise.resolve(current);
    }),
    applyResult: vi.fn((_attemptId: string, result: ProviderPaymentResult) => {
      current = {
        ...current,
        status: result.state === 'CREATED' ? 'PENDING' : result.state,
        succeededAt: result.state === 'SUCCEEDED' ? (result.providerOccurredAt ?? new Date()) : null,
      };
      return Promise.resolve(current);
    }),
    deferRecovery: vi.fn(() => Promise.resolve()),
  } as unknown as PaymentRepository;
  const provider = {
    createPayment: vi.fn(() => Promise.resolve(providerResult())),
    queryPayment: vi.fn(() => Promise.resolve(providerResult())),
    refund: vi.fn(),
  } as unknown as PaymentProvider;
  const seeds = {
    consumeAfterPaymentSuccess: vi.fn(() => Promise.resolve()),
  } as unknown as SeedPromotionLifecyclePort;
  const orders = {
    closeAfterPaymentFailure: vi.fn(() => Promise.resolve(true)),
  } as PaymentOrderLifecyclePort;
  return {
    repository,
    provider,
    seeds,
    orders,
    providerState: providerStateValue,
    service: new PaymentApplicationService(repository, provider, seeds, orders),
  };
}
