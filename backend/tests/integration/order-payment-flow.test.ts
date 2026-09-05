import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SystemClock,
  type EntitlementGrantPort,
  type MembershipGrantPort,
  type SeedPromotionLifecyclePort,
} from '../../packages/application/src/index.js';
import { validateEnvironment } from '../../packages/infrastructure/src/config/environment.js';
import { createDatabase } from '../../packages/infrastructure/src/database/client.js';
import { FieldCipher } from '../../packages/infrastructure/src/security/field-cipher.js';
import { OrderApplicationService } from '../../packages/modules/src/order/application/index.js';
import { DrizzleOrderRepository } from '../../packages/modules/src/order/repository-adapter/index.js';
import { CommerceOperationsService } from '../../packages/modules/src/operations/commerce/commerce-operations.service.js';
import { EntitlementApplicationService } from '../../packages/modules/src/entitlement/application/index.js';
import { PostgresEntitlementRepository } from '../../packages/modules/src/entitlement/repository-adapter/index.js';
import { FulfillmentApplicationService } from '../../packages/modules/src/fulfillment/application/index.js';
import { DrizzleFulfillmentRepository } from '../../packages/modules/src/fulfillment/repository-adapter/index.js';
import { PaymentApplicationService } from '../../packages/modules/src/payment/application/index.js';
import {
  DeterministicFakePaymentProvider,
  DrizzlePaymentRepository,
} from '../../packages/modules/src/payment/repository-adapter/index.js';
import { RefundApplicationService } from '../../packages/modules/src/refund/application/index.js';
import { PostgresRefundRepository } from '../../packages/modules/src/refund/repository-adapter/index.js';

const runDatabaseTests = process.env.RUN_DATABASE_TESTS === 'true';

describe.skipIf(!runDatabaseTests)('money order and payment flow', () => {
  let pool: Pool;
  let database: ReturnType<typeof createDatabase>['database'];
  let orders: OrderApplicationService;
  let payments: PaymentApplicationService;
  let provider: DeterministicFakePaymentProvider;
  let seeds: FakeSeedPromotionLifecycle;
  let fulfillment: FulfillmentApplicationService;
  let entitlements: EntitlementApplicationService;
  let refunds: RefundApplicationService;
  let operations: CommerceOperationsService;
  let paymentRepository: DrizzlePaymentRepository;
  const userId = randomUUID();
  const offeringId = randomUUID();
  const versionId = randomUUID();
  // Quotes are validated against the database clock. Keep the fixture relative
  // to the execution time so an otherwise-valid quote cannot become stale as
  // the test suite ages.
  const now = new Date();

  beforeAll(async () => {
    const infrastructure = createDatabase(
      validateEnvironment({
        ...process.env,
        SMS_DELIVERY_MODE: process.env.SMS_DELIVERY_MODE ?? 'FIXED_CODE',
        AQUA_BASE_URL: process.env.AQUA_BASE_URL ?? 'https://aqua.example.com',
        AQUA_SERVICE_KEY: process.env.AQUA_SERVICE_KEY ?? 'integration-service-key',
      }),
    );
    pool = infrastructure.pool;
    database = infrastructure.database;
    await migrate(database, { migrationsFolder: './drizzle' });
    await pool.query('insert into users(id) values($1)', [userId]);
    await pool.query(
      `insert into service_offerings(id,code,business_space,service_type,offering_kind,status)
      values($1,'reading-single','SATORI','CARD_READING','SINGLE','ACTIVE')`,
      [offeringId],
    );
    await pool.query(
      `insert into offering_versions(id,offering_id,version,status,display_name,description,amount_minor,entitlement_spec,purchase_limit,refund_policy_version,refund_policy,terms_version,published_at)
      values($1,$2,1,'PUBLISHED','问事单次','测试',9900,'{}','{}','refund-v1','{}','terms-v1',now())`,
      [versionId, offeringId],
    );
    await pool.query('update service_offerings set current_version_id=$1 where id=$2', [
      versionId,
      offeringId,
    ]);
    seeds = new FakeSeedPromotionLifecycle();
    const runtime = { database, pool } as never;
    orders = new OrderApplicationService(new DrizzleOrderRepository(runtime), seeds, { now: () => now });
    provider = new DeterministicFakePaymentProvider('PENDING');
    paymentRepository = new DrizzlePaymentRepository(
      runtime,
      new FieldCipher('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'),
    );
    payments = new PaymentApplicationService(paymentRepository, provider, seeds, orders);
    entitlements = new EntitlementApplicationService(
      new PostgresEntitlementRepository(runtime),
      'fulfillment-integration-cursor-secret',
      new SystemClock(),
    );
    fulfillment = new FulfillmentApplicationService(
      new DrizzleFulfillmentRepository(runtime),
      entitlements,
      new FakeMembershipGrant(),
    );
    refunds = new RefundApplicationService(
      new PostgresRefundRepository(runtime),
      provider,
      entitlements,
      new SystemClock(),
    );
    operations = new CommerceOperationsService(runtime, entitlements, {} as never, {} as never, {} as never);
  });

  afterAll(async () => {
    await pool.query(
      'delete from outbox where aggregate_id in (select id from money_orders where owner_user_id=$1)',
      [userId],
    );
    await pool.query(
      'delete from payment_events where order_id in (select id from money_orders where owner_user_id=$1)',
      [userId],
    );
    await pool.query(
      'delete from fulfillment_jobs where order_id in (select id from money_orders where owner_user_id=$1)',
      [userId],
    );
    await pool.query('delete from refunds where owner_user_id=$1', [userId]);
    await pool.query(
      'delete from reconciliation_cases where resource_id in (select id::text from money_orders where owner_user_id=$1)',
      [userId],
    );
    const grants = await pool.query<{ id: string }>(
      'select id from entitlement_grants where owner_user_id=$1',
      [userId],
    );
    const grantIds = grants.rows.map((row) => row.id);
    if (grantIds.length) {
      await pool.query('delete from entitlement_usage_entries where grant_id=any($1::uuid[])', [grantIds]);
      await pool.query('delete from entitlement_grants where id=any($1::uuid[])', [grantIds]);
    }
    await pool.query('delete from payment_attempts where owner_user_id=$1', [userId]);
    await pool.query(
      'delete from order_snapshots where order_id in (select id from money_orders where owner_user_id=$1)',
      [userId],
    );
    await pool.query('delete from money_orders where owner_user_id=$1', [userId]);
    await pool.query('delete from checkout_quotes where owner_user_id=$1', [userId]);
    await pool.query('delete from offering_versions where id=$1', [versionId]);
    await pool.query('delete from service_offerings where id=$1', [offeringId]);
    await pool.query('delete from users where id=$1', [userId]);
    await pool.end();
  });

  it('creates once from an immutable quote and rejects changed idempotent payload', async () => {
    const quoteId = await insertQuote(80);
    const command = {
      ownerUserId: userId,
      quoteId,
      idempotencyKey: 'order-idempotency-key-01',
      requestId: randomUUID(),
    };
    const first = await orders.create(command);
    const replay = await orders.create(command);
    expect(replay.orderId).toBe(first.orderId);
    expect(first).toMatchObject({
      status: 'AWAITING_PAYMENT',
      amount: { amount: 2190 },
      businessContext: { type: 'READING_INTENT', id: 'opaque-1' },
    });
    expect(seeds.reserved).toHaveLength(1);
    const [snapshot] = (
      await pool.query<{ offering_snapshot: { displayName: string } }>(
        'select offering_snapshot from order_snapshots where order_id=$1',
        [first.orderId],
      )
    ).rows;
    expect(snapshot!.offering_snapshot.displayName).toBe('问事单次');
    await expect(orders.create({ ...command, quoteId: await insertQuote(0) })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
  });

  it('queries authoritative payment, records one success and emits fulfillment once', async () => {
    const order = (await orders.list(userId))[0]!;
    const attempt = await payments.create({
      ownerUserId: userId,
      orderId: order.orderId,
      provider: 'FAKE',
      idempotencyKey: 'payment-idempotency-01',
      requestId: randomUUID(),
    });
    expect(attempt.status).toBe('PENDING');
    provider.setResult(attempt.providerAttemptId!, 'SUCCEEDED');
    const paid = await payments.query(userId, attempt.paymentAttemptId);
    await payments.query(userId, attempt.paymentAttemptId);
    expect(paid.status).toBe('SUCCEEDED');
    expect(seeds.consumed).toEqual([attempt.paymentAttemptId]);
    expect(
      Number(
        (
          await pool.query<{ count: string }>(
            "select count(*)::text count from outbox where aggregate_id=$1 and event_type='commerce.fulfillment.requested'",
            [order.orderId],
          )
        ).rows[0]!.count,
      ),
    ).toBe(1);
    expect(await orders.get(userId, order.orderId)).toMatchObject({
      status: 'PAID',
      fulfillmentStatus: 'NOT_STARTED',
      businessContext: { type: 'READING_INTENT', id: 'opaque-1' },
    });
    const result = await fulfillment.process(order.orderId, attempt.paymentAttemptId);
    expect(result).toMatchObject({ grantIds: [expect.any(String)] });
    expect(await orders.get(userId, order.orderId)).toMatchObject({
      status: 'FULFILLED',
      fulfillmentStatus: 'SUCCEEDED',
      businessContext: { type: 'READING_INTENT', id: 'opaque-1' },
    });
    expect(await fulfillment.process(order.orderId, attempt.paymentAttemptId)).toBeNull();
    const grant = await pool.query<{ total_quantity: number; source_id: string }>(
      "select total_quantity,source_id from entitlement_grants where owner_user_id=$1 and source_type='PURCHASE'",
      [userId],
    );
    expect(grant.rows).toEqual([{ total_quantity: 10, source_id: order.orderId }]);
    expect(
      Number(
        (
          await pool.query<{ count: string }>(
            "select count(*)::text count from outbox where aggregate_id=$1 and event_type='commerce.fulfillment.succeeded'",
            [order.orderId],
          )
        ).rows[0]!.count,
      ),
    ).toBe(1);
  });

  it('completes order, automatic fake payment, fulfillment and business-context recovery', async () => {
    const order = await orders.create({
      ownerUserId: userId,
      quoteId: await insertQuote(0),
      idempotencyKey: `order-auto-success-${randomUUID()}`,
      requestId: randomUUID(),
    });
    const automaticPayments = new PaymentApplicationService(
      paymentRepository,
      new DeterministicFakePaymentProvider('SUCCEEDED'),
      seeds,
      orders,
    );
    const attempt = await automaticPayments.create({
      ownerUserId: userId,
      orderId: order.orderId,
      provider: 'FAKE',
      idempotencyKey: `payment-auto-success-${randomUUID()}`,
      requestId: randomUUID(),
    });
    expect(attempt).toMatchObject({ provider: 'FAKE', status: 'SUCCEEDED' });
    expect(await orders.get(userId, order.orderId)).toMatchObject({
      status: 'PAID',
      businessContext: { type: 'READING_INTENT', id: 'opaque-1' },
    });
    expect(await fulfillment.process(order.orderId, attempt.paymentAttemptId)).toMatchObject({
      grantIds: [expect.any(String)],
    });
    expect(await orders.get(userId, order.orderId)).toMatchObject({
      status: 'FULFILLED',
      fulfillmentStatus: 'SUCCEEDED',
      businessContext: { type: 'READING_INTENT', id: 'opaque-1' },
    });
  });

  it('recovers a retryable fulfillment after the worker stops without duplicating grants', async () => {
    const { orderId, paymentAttemptId } = await createPaidOrder('retry');
    const flaky = new FlakyEntitlementGrant();
    const service = new FulfillmentApplicationService(
      new DrizzleFulfillmentRepository({ database, pool } as never),
      flaky,
      new FakeMembershipGrant(),
    );
    await expect(service.process(orderId, paymentAttemptId)).rejects.toThrow('temporary outage');
    expect(await orders.get(userId, orderId)).toMatchObject({
      status: 'FULFILLING',
      fulfillmentStatus: 'RETRY_WAIT',
    });
    await pool.query(
      "update fulfillment_jobs set next_attempt_at=now()-interval '1 second' where order_id=$1",
      [orderId],
    );
    expect(await service.reconcile()).toBeGreaterThanOrEqual(1);
    expect(flaky.calls).toBe(2);
    expect(await orders.get(userId, orderId)).toMatchObject({ status: 'FULFILLED' });
  });

  it('detects and reverses a duplicate provider charge without revoking delivered entitlements', async () => {
    const source = (
      await pool.query<{ source_id: string }>(
        "select source_id from entitlement_grants where owner_user_id=$1 and source_type='PURCHASE' limit 1",
        [userId],
      )
    ).rows[0]!;
    const attemptId = randomUUID();
    await pool.query(
      `insert into payment_attempts
       (id,order_id,owner_user_id,provider,provider_attempt_id,status,amount_minor,idempotency_key,
        request_hash,request_id,expires_at)
       select $1,id,owner_user_id,'FAKE',$2,'PENDING',amount_minor,$3,$4,$5,expires_at
       from money_orders where id=$6`,
      [
        attemptId,
        `duplicate-${attemptId}`,
        `duplicate-${attemptId}`,
        randomUUID(),
        randomUUID(),
        source.source_id,
      ],
    );
    const duplicate = await paymentRepository.applyResult(attemptId, {
      providerAttemptId: `duplicate-${attemptId}`,
      state: 'SUCCEEDED',
      orderId: source.source_id,
      amountMinor: 2190,
      currency: 'CNY',
      providerOccurredAt: new Date(),
    });
    expect(duplicate.status).toBe('FAILED');
    expect(
      Number(
        (
          await pool.query<{ count: string }>(
            "select count(*)::text count from outbox where aggregate_id=$1 and event_type='commerce.payment.duplicate.detected'",
            [attemptId],
          )
        ).rows[0]!.count,
      ),
    ).toBe(1);
    await refunds.reverseDuplicate(source.source_id, attemptId);
    expect(await orders.get(userId, source.source_id)).toMatchObject({ status: 'FULFILLED' });
    expect(await entitlements.summarizeBySource(source.source_id)).toMatchObject({ totalQuantity: 10 });
  });

  it('quotes and processes an unused ordinary refund exactly once with reverse entries', async () => {
    const source = (
      await pool.query<{ source_id: string }>(
        "select source_id from entitlement_grants where owner_user_id=$1 and source_type='PURCHASE' limit 1",
        [userId],
      )
    ).rows[0]!;
    const fulfilled = await orders.get(userId, source.source_id);
    const candidate = (
      await entitlements.listCandidates({
        userId,
        businessSpace: 'SATORI',
        serviceType: 'CARD_READING',
        unit: 'READING_CREDIT',
        quantity: 1,
        businessContext: { type: 'READING', id: randomUUID() },
      })
    )[0]!;
    const reservation = await entitlements.reserve(candidate, randomUUID());
    await expect(refunds.quote(userId, fulfilled.orderId)).rejects.toMatchObject({
      code: 'REFUND_ENTITLEMENT_ALREADY_USED',
    });
    await entitlements.release(reservation.reservationId, { type: 'READING', id: randomUUID() });
    expect(await refunds.quote(userId, fulfilled.orderId)).toMatchObject({
      eligible: true,
      amount: { amount: 2190, currency: 'CNY' },
      policyVersion: 'refund-v1',
    });
    const first = await refunds.request(userId, fulfilled.orderId, randomUUID());
    const replay = await refunds.request(userId, fulfilled.orderId, randomUUID());
    expect(replay?.refundId).toBe(first?.refundId);
    expect(await orders.get(userId, fulfilled.orderId)).toMatchObject({ status: 'REFUNDED' });
    expect(
      Number(
        (
          await pool.query<{ count: string }>(
            `select count(*)::text count from entitlement_usage_entries e
             join entitlement_grants g on g.id=e.grant_id
             where g.source_id=$1 and e.entry_type='REVERSE'`,
            [fulfilled.orderId],
          )
        ).rows[0]!.count,
      ),
    ).toBe(1);
  });

  it('delivers a membership order only once when the outbox event is redelivered', async () => {
    const { orderId, paymentAttemptId } = await createPaidOrder('membership');
    await pool.query(
      `update order_snapshots
       set offering_snapshot=offering_snapshot || '{"offeringKind":"MEMBERSHIP"}'::jsonb
       where order_id=$1`,
      [orderId],
    );
    const memberships = new CountingMembershipGrant();
    const service = new FulfillmentApplicationService(
      new DrizzleFulfillmentRepository({ database, pool } as never),
      new TerminalEntitlementGrant(),
      memberships,
    );
    const result = await service.process(orderId, paymentAttemptId);
    expect(result !== null && 'subscriptionId' in result && typeof result.subscriptionId === 'string').toBe(
      true,
    );
    expect(await service.process(orderId, paymentAttemptId)).toBeNull();
    expect(memberships.activations).toBe(1);
    await expect(refunds.quote(userId, orderId)).rejects.toMatchObject({
      code: 'MEMBERSHIP_REFUND_NOT_SUPPORTED',
    });
  });

  it('requests one reversal and keeps a terminally failed paid purchase committed', async () => {
    const { orderId, paymentAttemptId } = await createPaidOrder('terminal');
    const failing = new TerminalEntitlementGrant();
    const repository = new DrizzleOrderRepository({ database, pool } as never);
    const service = new FulfillmentApplicationService(
      new DrizzleFulfillmentRepository({ database, pool } as never),
      failing,
      new FakeMembershipGrant(),
    );
    await expect(service.process(orderId, paymentAttemptId)).rejects.toThrow('invalid snapshot target');
    expect(await orders.get(userId, orderId)).toMatchObject({
      status: 'EXCEPTION',
      fulfillmentStatus: 'FAILED',
    });
    expect(await repository.countFulfilledPurchases(userId, offeringId)).toBeGreaterThanOrEqual(1);
    expect(
      Number(
        (
          await pool.query<{ count: string }>(
            "select count(*)::text count from outbox where aggregate_id=$1 and event_type='commerce.payment.reversal.requested'",
            [orderId],
          )
        ).rows[0]!.count,
      ),
    ).toBe(1);
    expect(await operations.orderView(orderId)).toMatchObject({
      order_id: orderId,
      order_status: 'EXCEPTION',
    });
    expect((await operations.reconcile()).detected).toBeGreaterThanOrEqual(1);
    const reversal = await refunds.reverseExceptional(orderId, 'FULFILLMENT_FAILED');
    expect(typeof reversal?.refundId).toBe('string');
    expect(await orders.get(userId, orderId)).toMatchObject({ status: 'REFUNDED' });
  });

  it('closes expired unpaid orders and releases promotion reservations once', async () => {
    const order = await orders.create({
      ownerUserId: userId,
      quoteId: await insertQuote(20),
      idempotencyKey: 'order-expire-key-01',
      requestId: randomUUID(),
    });
    await pool.query("update money_orders set expires_at=now()-interval '1 minute' where id=$1", [
      order.orderId,
    ]);
    const expiringOrders = new OrderApplicationService(
      new DrizzleOrderRepository({ database, pool } as never),
      seeds,
      { now: () => new Date() },
    );
    expect(await expiringOrders.closeExpired()).toBe(1);
    expect(await expiringOrders.closeExpired()).toBe(0);
    expect(seeds.released.filter((id) => id === order.orderId)).toHaveLength(1);
    expect(
      Number(
        (
          await pool.query<{ count: string }>(
            "select count(*)::text count from outbox where aggregate_id=$1 and event_type='commerce.order.seed-release.requested'",
            [order.orderId],
          )
        ).rows[0]!.count,
      ),
    ).toBe(1);
  });

  it('repairs a terminal payment left behind before its order could be closed', async () => {
    const order = await orders.create({
      ownerUserId: userId,
      quoteId: await insertQuote(20),
      idempotencyKey: `order-terminal-recovery-${randomUUID()}`,
      requestId: randomUUID(),
    });
    const attempt = await payments.create({
      ownerUserId: userId,
      orderId: order.orderId,
      provider: 'FAKE',
      idempotencyKey: `payment-terminal-recovery-${randomUUID()}`,
      requestId: randomUUID(),
    });
    await pool.query("update payment_attempts set status='CANCELLED' where id=$1", [
      attempt.paymentAttemptId,
    ]);

    expect((await payments.maintain()).closed).toBeGreaterThanOrEqual(1);
    expect(await orders.get(userId, order.orderId)).toMatchObject({
      status: 'CLOSED',
      paymentStatus: 'CANCELLED',
    });
  });

  async function insertQuote(seedQuantity: number) {
    const id = randomUUID();
    const offering = {
      offeringId,
      offeringVersionId: versionId,
      serviceType: 'CARD_READING',
      offeringKind: 'PACKAGE',
      displayName: '问事单次',
      entitlementSpec: {
        benefits: [{ serviceType: 'CARD_READING', unit: 'READING_CREDIT', quantity: 10 }],
      },
      validityDays: 30,
      purchaseLimit: {},
      refundPolicyVersion: 'refund-v1',
      refundPolicy: { eligibility: 'UNUSED_ONLY', refundableBasisPoints: 10_000 },
      termsVersion: 'terms-v1',
    };
    await pool.query(
      `insert into checkout_quotes(id,owner_user_id,business_space,offering_version_id,status,pricing_mode,amount_minor,reserved_seed_quantity,qualification_snapshot,pricing_snapshot,business_context_type,business_context_id,idempotency_key,request_hash,request_id,expires_at,created_at)
      values($1,$2,'SATORI',$3,'ACTIVE',$4,2190,$5,'{}',$6,'READING_INTENT','opaque-1',$7,$8,$9,$10,$11)`,
      [
        id,
        userId,
        versionId,
        seedQuantity ? 'SEED_PROMOTION' : 'STANDARD',
        seedQuantity,
        JSON.stringify({ quoteView: { offering } }),
        `quote-${id}`,
        randomUUID(),
        randomUUID(),
        new Date(now.getTime() + 900000),
        now,
      ],
    );
    return id;
  }

  async function createPaidOrder(suffix: string) {
    const order = await orders.create({
      ownerUserId: userId,
      quoteId: await insertQuote(0),
      idempotencyKey: `order-${suffix}-${randomUUID()}`,
      requestId: randomUUID(),
    });
    const attempt = await payments.create({
      ownerUserId: userId,
      orderId: order.orderId,
      provider: 'FAKE',
      idempotencyKey: `payment-${suffix}-${randomUUID()}`,
      requestId: randomUUID(),
    });
    provider.setResult(attempt.providerAttemptId!, 'SUCCEEDED');
    await payments.query(userId, attempt.paymentAttemptId);
    return { orderId: order.orderId, paymentAttemptId: attempt.paymentAttemptId };
  }
});

class FakeSeedPromotionLifecycle implements SeedPromotionLifecyclePort {
  reserved: string[] = [];
  consumed: string[] = [];
  released: string[] = [];
  reserveForOrderCreation(command: Parameters<SeedPromotionLifecyclePort['reserveForOrderCreation']>[0]) {
    this.reserved.push(command.orderId);
    return Promise.resolve({ reservationId: `seed-${command.orderId}`, quantity: command.quantity });
  }
  consumeAfterPaymentSuccess(_reservationId: string, paymentAttemptId: string) {
    if (!this.consumed.includes(paymentAttemptId)) this.consumed.push(paymentAttemptId);
    return Promise.resolve();
  }
  releaseAfterOrderClosure(_reservationId: string, orderId: string) {
    if (!this.released.includes(orderId)) this.released.push(orderId);
    return Promise.resolve();
  }
}

class FakeMembershipGrant implements MembershipGrantPort {
  activate() {
    return Promise.resolve({ subscriptionId: randomUUID() });
  }
  queueRenewal() {
    return Promise.resolve({ periodId: randomUUID() });
  }
  replaceForUpgrade() {
    return Promise.resolve({ subscriptionId: randomUUID() });
  }
}

class CountingMembershipGrant extends FakeMembershipGrant {
  activations = 0;
  override activate() {
    this.activations += 1;
    return super.activate();
  }
}

class FlakyEntitlementGrant implements EntitlementGrantPort {
  calls = 0;
  grant() {
    this.calls += 1;
    if (this.calls === 1)
      return Promise.reject(Object.assign(new Error('temporary outage'), { retryable: true }));
    return Promise.resolve({ grantId: randomUUID() });
  }
  freezeBySource() {
    return Promise.resolve();
  }
  unfreezeBySource() {
    return Promise.resolve();
  }
  forfeitBySource() {
    return Promise.resolve();
  }
  expireDue() {
    return Promise.resolve(0);
  }
  summarizeBySource() {
    return Promise.resolve({ totalQuantity: 0, availableQuantity: 0, reservedQuantity: 0 });
  }
  reverseAvailableBySource() {
    return Promise.resolve(0);
  }
}

class TerminalEntitlementGrant implements EntitlementGrantPort {
  grant(): Promise<{ grantId: string }> {
    return Promise.reject(new Error('invalid snapshot target'));
  }
  freezeBySource() {
    return Promise.resolve();
  }
  unfreezeBySource() {
    return Promise.resolve();
  }
  forfeitBySource() {
    return Promise.resolve();
  }
  expireDue() {
    return Promise.resolve(0);
  }
  summarizeBySource() {
    return Promise.resolve({ totalQuantity: 0, availableQuantity: 0, reservedQuantity: 0 });
  }
  reverseAvailableBySource() {
    return Promise.resolve(0);
  }
}
