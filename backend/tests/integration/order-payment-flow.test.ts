import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SeedPromotionLifecyclePort } from '../../packages/application/src/index.js';
import { validateEnvironment } from '../../packages/infrastructure/src/config/environment.js';
import { createDatabase } from '../../packages/infrastructure/src/database/client.js';
import { FieldCipher } from '../../packages/infrastructure/src/security/field-cipher.js';
import { OrderApplicationService } from '../../packages/modules/src/order/application/index.js';
import { DrizzleOrderRepository } from '../../packages/modules/src/order/repository-adapter/index.js';
import { PaymentApplicationService } from '../../packages/modules/src/payment/application/index.js';
import {
  DeterministicFakePaymentProvider,
  DrizzlePaymentRepository,
} from '../../packages/modules/src/payment/repository-adapter/index.js';

const runDatabaseTests = process.env.RUN_DATABASE_TESTS === 'true';

describe.skipIf(!runDatabaseTests)('money order and payment flow', () => {
  let pool: Pool;
  let database: ReturnType<typeof createDatabase>['database'];
  let orders: OrderApplicationService;
  let payments: PaymentApplicationService;
  let provider: DeterministicFakePaymentProvider;
  let seeds: FakeSeedPromotionLifecycle;
  const userId = randomUUID();
  const offeringId = randomUUID();
  const versionId = randomUUID();
  const now = new Date('2026-08-29T00:00:00.000Z');

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
    payments = new PaymentApplicationService(
      new DrizzlePaymentRepository(
        runtime,
        new FieldCipher('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'),
      ),
      provider,
      seeds,
    );
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
  });

  async function insertQuote(seedQuantity: number) {
    const id = randomUUID();
    const offering = {
      offeringId,
      offeringVersionId: versionId,
      serviceType: 'CARD_READING',
      displayName: '问事单次',
      purchaseLimit: {},
      refundPolicy: {},
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
