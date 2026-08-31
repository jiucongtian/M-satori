import {
  hashPayload,
  type PaymentOrderLifecyclePort,
  type PaymentProvider,
  type ProviderPaymentResult,
  type ProviderWebhookEvent,
  type SeedPromotionLifecyclePort,
} from '@satori/application';
import { randomUUID } from 'node:crypto';
import { PAYMENT_RECOVERY_STALE_AFTER_MS, PaymentError } from '../domain/index.js';

export const PAYMENT_REPOSITORY = Symbol('PAYMENT_REPOSITORY');
export const WECHAT_WEBHOOK_ALLOWED_IPS = Symbol('WECHAT_WEBHOOK_ALLOWED_IPS');

export interface PaymentAttemptView {
  paymentAttemptId: string;
  orderId: string;
  ownerUserId: string;
  provider: 'WECHAT_PAY' | 'FAKE';
  providerAttemptId: string | null;
  status: string;
  amountMinor: number;
  currency: 'CNY';
  clientParameters: Readonly<Record<string, string>> | null;
  createdAt: Date;
  succeededAt: Date | null;
  orderExpiresAt: Date;
  promotionSeedReservationId: string | null;
}
export interface PaymentRepository {
  createAttempt(command: {
    ownerUserId: string;
    orderId: string;
    provider: 'WECHAT_PAY' | 'FAKE';
    idempotencyKey: string;
    requestHash: string;
    requestId: string;
  }): Promise<{ view: PaymentAttemptView; created: boolean }>;
  attachProvider(attemptId: string, result: ProviderPaymentResult): Promise<PaymentAttemptView>;
  getOwned(ownerUserId: string, attemptId: string): Promise<PaymentAttemptView | null>;
  findByProviderAttempt(providerAttemptId: string): Promise<PaymentAttemptView | null>;
  recordEvent(event: ProviderWebhookEvent, attemptId: string): Promise<boolean>;
  applyResult(attemptId: string, result: ProviderPaymentResult): Promise<PaymentAttemptView>;
  listRecoverable(dueBefore: Date, limit: number): Promise<readonly PaymentAttemptView[]>;
  deferRecovery(attemptId: string, failure: Error): Promise<void>;
}

export class PaymentApplicationService {
  constructor(
    private readonly repository: PaymentRepository,
    private readonly provider: PaymentProvider,
    private readonly seeds: SeedPromotionLifecyclePort,
    private readonly orders: PaymentOrderLifecyclePort,
  ) {}

  async create(command: {
    ownerUserId: string;
    orderId: string;
    provider: 'WECHAT_PAY' | 'FAKE';
    idempotencyKey: string;
    requestId: string;
  }) {
    const prepared = await this.repository.createAttempt({
      ...command,
      requestHash: hashPayload({ orderId: command.orderId, provider: command.provider }),
    });
    if (!prepared.created) return prepared.view;
    const result = await this.provider.createPayment({
      attemptId: prepared.view.paymentAttemptId,
      orderId: prepared.view.orderId,
      amountMinor: prepared.view.amountMinor,
      currency: 'CNY',
      description: `Satori ${prepared.view.orderId}`,
      expiresAt: prepared.view.orderExpiresAt,
    });
    return this.finalizeResult(prepared.view, result);
  }

  async query(ownerUserId: string, attemptId: string) {
    const attempt = await this.repository.getOwned(ownerUserId, attemptId);
    if (!attempt) throw new PaymentError('PAYMENT_ATTEMPT_NOT_FOUND', 'Payment attempt was not found');
    if (!attempt.providerAttemptId || ['SUCCEEDED', 'FAILED', 'CANCELLED', 'CLOSED'].includes(attempt.status))
      return attempt;
    return this.finalizeResult(attempt, await this.provider.queryPayment(attempt.providerAttemptId));
  }

  async acceptWebhook(headers: Readonly<Record<string, string>>, rawBody: string) {
    if (!this.provider.verifyWebhook)
      throw new PaymentError('PAYMENT_WEBHOOK_UNSUPPORTED', 'Provider webhook is unavailable');
    const event = await this.provider.verifyWebhook(headers, rawBody);
    const attempt = await this.repository.findByProviderAttempt(event.providerAttemptId);
    if (!attempt) throw new PaymentError('PAYMENT_ATTEMPT_NOT_FOUND', 'Payment attempt was not found');
    if (
      attempt.orderId !== event.orderId ||
      attempt.amountMinor !== event.amountMinor ||
      event.currency !== 'CNY'
    )
      throw new PaymentError('PAYMENT_FACT_MISMATCH', 'Provider payment fact does not match the order');
    if (!(await this.repository.recordEvent(event, attempt.paymentAttemptId))) return attempt;
    return this.finalizeResult(attempt, {
      providerAttemptId: event.providerAttemptId,
      state: event.state,
      orderId: event.orderId,
      amountMinor: event.amountMinor,
      currency: event.currency,
      providerOccurredAt: event.occurredAt,
    });
  }

  async maintain(limit = 100) {
    const dueBefore = new Date(Date.now() - PAYMENT_RECOVERY_STALE_AFTER_MS);
    const attempts = await this.repository.listRecoverable(dueBefore, limit);
    const report = { checked: attempts.length, succeeded: 0, closed: 0, pending: 0, failed: 0 };
    for (const attempt of attempts) {
      try {
        if (['FAILED', 'CANCELLED', 'CLOSED'].includes(attempt.status)) {
          const closed = await this.orders.closeAfterPaymentFailure(
            attempt.orderId,
            attempt.paymentAttemptId,
            randomUUID(),
          );
          if (closed) report.closed += 1;
          else report.pending += 1;
          continue;
        }
        let result = attempt.providerAttemptId
          ? await this.provider.queryPayment(attempt.providerAttemptId)
          : await this.provider.createPayment({
              attemptId: attempt.paymentAttemptId,
              orderId: attempt.orderId,
              amountMinor: attempt.amountMinor,
              currency: attempt.currency,
              description: `Satori ${attempt.orderId}`,
              expiresAt: attempt.orderExpiresAt,
            });
        let updated = await this.finalizeResult(attempt, result);
        if (updated.status === 'SUCCEEDED') {
          report.succeeded += 1;
          continue;
        }
        if (['FAILED', 'CANCELLED', 'CLOSED'].includes(updated.status)) {
          report.closed += 1;
          continue;
        }
        if (updated.orderExpiresAt > new Date()) {
          report.pending += 1;
          continue;
        }
        if (!this.provider.closePayment) {
          report.pending += 1;
          continue;
        }
        await this.provider.closePayment(updated.providerAttemptId!);
        result = await this.provider.queryPayment(updated.providerAttemptId!);
        updated = await this.finalizeResult(updated, result);
        if (updated.status === 'SUCCEEDED') report.succeeded += 1;
        else if (['FAILED', 'CANCELLED', 'CLOSED'].includes(updated.status)) report.closed += 1;
        else report.pending += 1;
      } catch (error) {
        const failure = error instanceof Error ? error : new Error('Unknown payment recovery failure');
        await this.repository.deferRecovery(attempt.paymentAttemptId, failure).catch(() => undefined);
        report.failed += 1;
      }
    }
    return report;
  }

  private async finalizeResult(attempt: PaymentAttemptView, result: ProviderPaymentResult) {
    const updated = await this.processResult(attempt, result);
    if (['FAILED', 'CANCELLED', 'CLOSED'].includes(updated.status)) {
      await this.orders.closeAfterPaymentFailure(updated.orderId, updated.paymentAttemptId, randomUUID());
    }
    return updated;
  }

  private async processResult(attempt: PaymentAttemptView, result: ProviderPaymentResult) {
    if (result.orderId && result.orderId !== attempt.orderId)
      throw new PaymentError('PAYMENT_FACT_MISMATCH', 'Provider order does not match');
    if (result.amountMinor !== undefined && result.amountMinor !== attempt.amountMinor)
      throw new PaymentError('PAYMENT_FACT_MISMATCH', 'Provider amount does not match');
    if (result.currency && result.currency !== 'CNY')
      throw new PaymentError('PAYMENT_FACT_MISMATCH', 'Provider currency does not match');
    const attached = await this.repository.attachProvider(attempt.paymentAttemptId, result);
    if (result.state === 'SUCCEEDED' && attached.promotionSeedReservationId) {
      await this.seeds.consumeAfterPaymentSuccess(
        attached.promotionSeedReservationId,
        attached.paymentAttemptId,
        randomUUID(),
      );
    }
    return this.repository.applyResult(attempt.paymentAttemptId, result);
  }
}
