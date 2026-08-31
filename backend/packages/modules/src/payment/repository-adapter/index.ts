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
import { and, asc, eq, inArray, lte, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { PaymentAttemptView, PaymentRepository } from '../application/index.js';
import { PaymentError } from '../domain/index.js';
import {
  closeWechatPayment,
  parseWechatWebhook,
  queryWechatPayment,
  queryWechatRefund,
  requestWechatRefund,
  type WechatPayConfig,
} from './wechat-pay.js';

export {
  buildWechatAuthorization,
  closeWechatPayment,
  decryptWechatResource,
  merchantReference,
  parseWechatWebhook,
  verifyWechatSignature,
} from './wechat-pay.js';

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
        failure: null,
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

  async listRecoverable(dueBefore: Date, limit: number) {
    const rows = await this.infrastructure.database
      .select({ attempt: paymentAttempts })
      .from(paymentAttempts)
      .innerJoin(moneyOrders, eq(paymentAttempts.orderId, moneyOrders.id))
      .where(
        and(
          inArray(moneyOrders.status, ['PENDING_PAYMENT', 'PAYMENT_PROCESSING']),
          or(
            and(
              inArray(paymentAttempts.status, ['CREATED', 'PENDING']),
              lte(paymentAttempts.updatedAt, dueBefore),
            ),
            inArray(paymentAttempts.status, ['FAILED', 'CANCELLED']),
          ),
        ),
      )
      .orderBy(asc(paymentAttempts.updatedAt), asc(paymentAttempts.id))
      .limit(limit);
    return Promise.all(rows.map((row) => this.toView(row.attempt)));
  }

  async deferRecovery(attemptId: string, failure: Error) {
    const failureCode = (failure as Error & { code?: unknown }).code;
    await this.infrastructure.database
      .update(paymentAttempts)
      .set({
        failure: {
          code: typeof failureCode === 'string' ? failureCode : 'PAYMENT_RECOVERY_FAILED',
          message: failure.message,
          recoverable: true,
        },
        updatedAt: new Date(),
      })
      .where(eq(paymentAttempts.id, attemptId));
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
  closePayment(providerAttemptId: string) {
    const result = this.results.get(providerAttemptId);
    if (!result) throw new PaymentError('PROVIDER_PAYMENT_NOT_FOUND', 'Fake payment was not found');
    if (result.state !== 'SUCCEEDED') this.results.set(providerAttemptId, { ...result, state: 'CANCELLED' });
    return Promise.resolve();
  }
  refund(request: Parameters<PaymentProvider['refund']>[0]) {
    return Promise.resolve({
      providerRefundId: `fake-refund-${request.refundId}`,
      state: 'SUCCEEDED' as const,
    });
  }
  queryRefund(providerRefundId: string) {
    return Promise.resolve({ providerRefundId, state: 'SUCCEEDED' as const });
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

@Injectable()
export class PaymentRuntimeAdapter {
  constructor(@Inject(RuntimeInfrastructure) private readonly infrastructure: RuntimeInfrastructure) {}

  provider(): PaymentProvider {
    const environment = this.infrastructure.environment;
    if ((environment.PAYMENT_PROVIDER_MODE ?? 'FAKE') === 'FAKE')
      return new DeterministicFakePaymentProvider(environment.FAKE_PAYMENT_RESULT ?? 'PENDING');
    return new WechatPayAdapter({
      merchantId: environment.WECHAT_MERCHANT_ID!,
      appId: environment.WECHAT_APP_ID!,
      apiV3Key: environment.WECHAT_API_V3_KEY!,
      merchantPrivateKey: Buffer.from(environment.WECHAT_MERCHANT_PRIVATE_KEY_BASE64!, 'base64').toString(
        'utf8',
      ),
      merchantSerialNo: environment.WECHAT_MERCHANT_SERIAL_NO!,
      publicKey: Buffer.from(environment.WECHAT_PLATFORM_PUBLIC_KEY_BASE64!, 'base64').toString('utf8'),
      publicKeyId: environment.WECHAT_PUBLIC_KEY_ID!,
      notifyUrl: environment.WECHAT_NOTIFY_URL!,
    });
  }

  webhookAllowedIps() {
    return new Set(
      (this.infrastructure.environment.WECHAT_WEBHOOK_ALLOWED_IPS ?? '127.0.0.1,::1')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    );
  }
}

export class WechatPayAdapter implements PaymentProvider {
  constructor(private readonly config: WechatPayConfig) {}
  createPayment(): never {
    throw new PaymentError(
      'WECHAT_PAYMENT_SCENE_NOT_CONFIGURED',
      'WeChat JSAPI or H5 payment scene is not configured',
    );
  }
  queryPayment(providerAttemptId: string) {
    return queryWechatPayment(this.config, providerAttemptId);
  }
  closePayment(providerAttemptId: string) {
    return closeWechatPayment(this.config, providerAttemptId);
  }
  refund(request: Parameters<PaymentProvider['refund']>[0]) {
    return requestWechatRefund(this.config, request);
  }
  queryRefund(providerRefundId: string) {
    return queryWechatRefund(this.config, providerRefundId);
  }
  verifyWebhook(headers: Readonly<Record<string, string>>, body: string): Promise<ProviderWebhookEvent> {
    return parseWechatWebhook(this.config, headers, body);
  }
}

function asStringRecord(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}
