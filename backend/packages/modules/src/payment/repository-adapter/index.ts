import type { PaymentProvider, ProviderPaymentResult, ProviderWebhookEvent } from '@satori/application';
import { Inject, Injectable } from '@nestjs/common';
import {
  FieldCipher,
  moneyOrders,
  newId,
  outbox,
  paymentAttempts,
  paymentEvents,
  RuntimeInfrastructure,
} from '@satori/infrastructure';
import { and, eq } from 'drizzle-orm';
import { randomUUID, verify, type KeyObject } from 'node:crypto';
import type { PaymentAttemptView, PaymentRepository } from '../application/index.js';
import { PaymentError } from '../domain/index.js';

@Injectable()
export class DrizzlePaymentRepository implements PaymentRepository {
  constructor(
    @Inject(RuntimeInfrastructure) private readonly infrastructure: RuntimeInfrastructure,
    private readonly cipher: FieldCipher,
  ) {}

  async createAttempt(command: Parameters<PaymentRepository['createAttempt']>[0]) {
    return this.infrastructure.database.transaction(async (tx) => {
      const [replay] = await tx
        .select()
        .from(paymentAttempts)
        .where(
          and(
            eq(paymentAttempts.ownerUserId, command.ownerUserId),
            eq(paymentAttempts.idempotencyKey, command.idempotencyKey),
          ),
        )
        .limit(1);
      if (replay) {
        if (replay.requestHash !== command.requestHash)
          throw new PaymentError('IDEMPOTENCY_KEY_REUSED', 'Idempotency key was reused');
        return { view: await this.toView(replay), created: false };
      }
      const [order] = await tx
        .select()
        .from(moneyOrders)
        .where(and(eq(moneyOrders.id, command.orderId), eq(moneyOrders.ownerUserId, command.ownerUserId)))
        .for('update')
        .limit(1);
      if (!order) throw new PaymentError('MONEY_ORDER_NOT_FOUND', 'Money order was not found');
      if (order.status === 'CLOSED' || order.expiresAt <= new Date())
        throw new PaymentError('MONEY_ORDER_CLOSED', 'Money order is closed');
      if (!['PENDING_PAYMENT', 'PAYMENT_PROCESSING'].includes(order.status))
        throw new PaymentError('MONEY_ORDER_NOT_PAYABLE', 'Money order is not payable');
      const [created] = await tx
        .insert(paymentAttempts)
        .values({
          id: randomUUID(),
          orderId: order.id,
          ownerUserId: order.ownerUserId,
          provider: command.provider,
          amountMinor: order.amountMinor,
          idempotencyKey: command.idempotencyKey,
          requestHash: command.requestHash,
          requestId: command.requestId,
          expiresAt: order.expiresAt,
        })
        .returning();
      await tx
        .update(moneyOrders)
        .set({ status: 'PAYMENT_PROCESSING', version: order.version + 1, updatedAt: new Date() })
        .where(eq(moneyOrders.id, order.id));
      return { view: await this.toView(created!, order), created: true };
    });
  }

  async attachProvider(attemptId: string, result: ProviderPaymentResult) {
    const [updated] = await this.infrastructure.database
      .update(paymentAttempts)
      .set({
        providerAttemptId: result.providerAttemptId,
        status: result.state === 'CREATED' || result.state === 'SUCCEEDED' ? 'PENDING' : result.state,
        clientParameters: result.clientParameters ?? null,
        updatedAt: new Date(),
      })
      .where(eq(paymentAttempts.id, attemptId))
      .returning();
    if (!updated) throw new PaymentError('PAYMENT_ATTEMPT_NOT_FOUND', 'Payment attempt was not found');
    return this.toView(updated);
  }

  async getOwned(ownerUserId: string, attemptId: string) {
    const [row] = await this.infrastructure.database
      .select()
      .from(paymentAttempts)
      .where(and(eq(paymentAttempts.id, attemptId), eq(paymentAttempts.ownerUserId, ownerUserId)))
      .limit(1);
    return row ? this.toView(row) : null;
  }
  async findByProviderAttempt(providerAttemptId: string) {
    const [row] = await this.infrastructure.database
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.providerAttemptId, providerAttemptId))
      .limit(1);
    return row ? this.toView(row) : null;
  }
  async recordEvent(event: ProviderWebhookEvent, attemptId: string) {
    const attempt = await this.getAttempt(attemptId);
    const inserted = await this.infrastructure.database
      .insert(paymentEvents)
      .values({
        id: randomUUID(),
        provider: attempt.provider,
        providerEventId: event.providerEventId,
        paymentAttemptId: attempt.id,
        orderId: attempt.orderId,
        eventType: `PAYMENT_${event.state}`,
        signatureVerified: true,
        verificationSnapshot: event.verificationSnapshot,
        payloadCiphertext: event.minimalPayload ? this.cipher.encrypt(event.minimalPayload) : null,
        providerOccurredAt: event.occurredAt,
      })
      .onConflictDoNothing()
      .returning({ id: paymentEvents.id });
    return inserted.length === 1;
  }

  async applyResult(attemptId: string, result: ProviderPaymentResult) {
    return this.infrastructure.database.transaction(async (tx) => {
      const [attempt] = await tx
        .select()
        .from(paymentAttempts)
        .where(eq(paymentAttempts.id, attemptId))
        .for('update')
        .limit(1);
      if (!attempt) throw new PaymentError('PAYMENT_ATTEMPT_NOT_FOUND', 'Payment attempt was not found');
      if (attempt.status === 'SUCCEEDED') return this.toView(attempt);
      const [order] = await tx
        .select()
        .from(moneyOrders)
        .where(eq(moneyOrders.id, attempt.orderId))
        .for('update')
        .limit(1);
      if (!order) throw new PaymentError('MONEY_ORDER_NOT_FOUND', 'Money order was not found');
      if (result.state === 'SUCCEEDED') {
        if (
          order.status === 'CLOSED' &&
          (!result.providerOccurredAt || result.providerOccurredAt > order.expiresAt)
        )
          throw new PaymentError('PAYMENT_AFTER_ORDER_CLOSED', 'Payment occurred after order closure');
        const [other] = await tx
          .select()
          .from(paymentAttempts)
          .where(and(eq(paymentAttempts.orderId, order.id), eq(paymentAttempts.status, 'SUCCEEDED')))
          .limit(1);
        if (other && other.id !== attempt.id) {
          const [duplicate] = await tx
            .update(paymentAttempts)
            .set({
              status: 'FAILED',
              failure: { code: 'DUPLICATE_CHARGE', authoritativePaymentAttemptId: other.id },
              updatedAt: new Date(),
            })
            .where(eq(paymentAttempts.id, attempt.id))
            .returning();
          await tx.insert(outbox).values({
            id: newId(),
            aggregateType: 'PAYMENT_ATTEMPT',
            aggregateId: attempt.id,
            eventType: 'commerce.payment.duplicate.detected',
            producer: 'payment',
            requestId: attempt.requestId,
            correlationId: order.id,
            causationId: attempt.id,
            payload: { orderId: order.id, paymentAttemptId: attempt.id },
          });
          return this.toView(duplicate!, order);
        }
        const now = result.providerOccurredAt ?? new Date();
        const [updated] = await tx
          .update(paymentAttempts)
          .set({ status: 'SUCCEEDED', succeededAt: now, updatedAt: new Date() })
          .where(eq(paymentAttempts.id, attempt.id))
          .returning();
        await tx
          .update(moneyOrders)
          .set({ status: 'PAID', paidAt: now, version: order.version + 1, updatedAt: new Date() })
          .where(eq(moneyOrders.id, order.id));
        await tx.insert(outbox).values({
          id: newId(),
          aggregateType: 'MONEY_ORDER',
          aggregateId: order.id,
          eventType: 'commerce.fulfillment.requested',
          producer: 'payment',
          requestId: attempt.requestId,
          correlationId: order.id,
          causationId: attempt.id,
          payload: { orderId: order.id, paymentAttemptId: attempt.id },
        });
        return this.toView(updated!, { ...order, status: 'PAID', paidAt: now });
      }
      const status =
        result.state === 'CANCELLED' ? 'CANCELLED' : result.state === 'FAILED' ? 'FAILED' : 'PENDING';
      const [updated] = await tx
        .update(paymentAttempts)
        .set({ status, updatedAt: new Date() })
        .where(eq(paymentAttempts.id, attempt.id))
        .returning();
      return this.toView(updated!, order);
    });
  }

  private async getAttempt(id: string) {
    const [row] = await this.infrastructure.database
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.id, id))
      .limit(1);
    if (!row) throw new PaymentError('PAYMENT_ATTEMPT_NOT_FOUND', 'Payment attempt was not found');
    return row;
  }
  private async toView(
    attempt: typeof paymentAttempts.$inferSelect,
    suppliedOrder?: typeof moneyOrders.$inferSelect,
  ): Promise<PaymentAttemptView> {
    const [order] = suppliedOrder
      ? [suppliedOrder]
      : await this.infrastructure.database
          .select()
          .from(moneyOrders)
          .where(eq(moneyOrders.id, attempt.orderId))
          .limit(1);
    if (!order) throw new PaymentError('MONEY_ORDER_NOT_FOUND', 'Money order was not found');
    return {
      paymentAttemptId: attempt.id,
      orderId: attempt.orderId,
      ownerUserId: attempt.ownerUserId,
      provider: attempt.provider as 'WECHAT_PAY' | 'FAKE',
      providerAttemptId: attempt.providerAttemptId,
      status: attempt.status,
      amountMinor: attempt.amountMinor,
      currency: 'CNY',
      clientParameters: asStringRecord(attempt.clientParameters),
      createdAt: attempt.createdAt,
      succeededAt: attempt.succeededAt,
      orderExpiresAt: order.expiresAt,
      promotionSeedReservationId: order.promotionSeedReservationId,
    };
  }
}

export class DeterministicFakePaymentProvider implements PaymentProvider {
  private readonly results = new Map<string, ProviderPaymentResult>();
  constructor(private readonly initialState: ProviderPaymentResult['state'] = 'PENDING') {}
  createPayment(request: Parameters<PaymentProvider['createPayment']>[0]) {
    const providerAttemptId = `fake-${request.attemptId}`;
    const result: ProviderPaymentResult = {
      providerAttemptId,
      state: this.initialState,
      orderId: request.orderId,
      amountMinor: request.amountMinor,
      currency: request.currency,
      clientParameters: { token: `fake-token-${request.attemptId}` },
      ...(this.initialState === 'SUCCEEDED' ? { providerOccurredAt: new Date() } : {}),
    };
    this.results.set(providerAttemptId, result);
    return Promise.resolve(result);
  }
  queryPayment(providerAttemptId: string) {
    const result = this.results.get(providerAttemptId);
    if (!result) throw new PaymentError('PROVIDER_PAYMENT_NOT_FOUND', 'Fake payment was not found');
    return Promise.resolve(result);
  }
  refund(request: Parameters<PaymentProvider['refund']>[0]) {
    return Promise.resolve({ providerRefundId: `fake-refund-${request.refundId}` });
  }
  setResult(providerAttemptId: string, state: ProviderPaymentResult['state']) {
    const current = this.results.get(providerAttemptId);
    if (!current) throw new Error('Fake payment not found');
    this.results.set(providerAttemptId, {
      ...current,
      state,
      ...(state === 'SUCCEEDED' ? { providerOccurredAt: new Date() } : {}),
    });
  }
}

export class WechatPayAdapter implements PaymentProvider {
  constructor(private readonly config: { merchantId: string; publicKey: string | KeyObject }) {}
  createPayment(): never {
    throw new PaymentError('WECHAT_PAY_CLIENT_NOT_CONFIGURED', 'WeChat client is not configured');
  }
  queryPayment(): never {
    throw new PaymentError('WECHAT_PAY_CLIENT_NOT_CONFIGURED', 'WeChat client is not configured');
  }
  refund(): never {
    throw new PaymentError('WECHAT_PAY_CLIENT_NOT_CONFIGURED', 'WeChat client is not configured');
  }
  verifyWebhook(headers: Readonly<Record<string, string>>, body: string): Promise<ProviderWebhookEvent> {
    return parseWechatWebhook(this.config, headers, body);
  }
}

export function parseWechatWebhook(
  config: { merchantId: string; publicKey: string | KeyObject },
  headers: Readonly<Record<string, string>>,
  body: string,
): Promise<ProviderWebhookEvent> {
  const timestamp = headers['wechatpay-timestamp'];
  const nonce = headers['wechatpay-nonce'];
  const signature = headers['wechatpay-signature'];
  if (!timestamp || !nonce || !signature)
    throw new PaymentError('WECHAT_SIGNATURE_INVALID', 'WeChat signature headers are missing');
  if (!verifyWechatSignature(config.publicKey, timestamp, nonce, body, signature))
    throw new PaymentError('WECHAT_SIGNATURE_INVALID', 'WeChat signature is invalid');
  const value = JSON.parse(body) as Record<string, unknown>;
  if (value.merchantId !== config.merchantId)
    throw new PaymentError('WECHAT_MERCHANT_MISMATCH', 'WeChat merchant does not match');
  return Promise.resolve({
    providerEventId: String(value.eventId),
    providerAttemptId: String(value.providerAttemptId),
    orderId: String(value.orderId),
    state: String(value.state) as ProviderWebhookEvent['state'],
    amountMinor: Number(value.amountMinor),
    currency: 'CNY',
    occurredAt: new Date(String(value.occurredAt)),
    verificationSnapshot: { algorithm: 'RSA-SHA256', merchantId: config.merchantId },
    minimalPayload: JSON.stringify({
      eventId: value.eventId,
      providerAttemptId: value.providerAttemptId,
      state: value.state,
    }),
  });
}

export function verifyWechatSignature(
  publicKey: string | KeyObject,
  timestamp: string,
  nonce: string,
  body: string,
  signature: string,
) {
  return verify(
    'RSA-SHA256',
    Buffer.from(`${timestamp}\n${nonce}\n${body}\n`),
    publicKey,
    Buffer.from(signature, 'base64'),
  );
}

function asStringRecord(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}
