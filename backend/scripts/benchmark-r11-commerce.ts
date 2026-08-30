import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const pool = new Pool({ connectionString: databaseUrl, max: 24 });
const fixture = {
  userId: randomUUID(),
  offeringId: randomUUID(),
  offeringVersionId: randomUUID(),
  quoteId: randomUUID(),
  orderId: randomUUID(),
  paymentAttemptId: randomUUID(),
  fulfillmentId: randomUUID(),
  grantId: randomUUID(),
};

const thresholds = {
  catalogQueryP95Ms: 100,
  quoteQueryP95Ms: 100,
  orderQueryP95Ms: 100,
  entitlementQueryP95Ms: 100,
  concurrentReservationP95Ms: 250,
  paymentCallbackP95Ms: 150,
  workerBacklogDrainMs: 2_000,
} as const;

try {
  await seedFixture();
  const result = {
    catalogQueryP95Ms: await queryP95(
      `select o.id,v.id version_id,v.display_name,v.amount_minor
       from service_offerings o join offering_versions v on v.id=o.current_version_id
       where o.business_space='SATORI' and o.status='ACTIVE' and v.status='PUBLISHED'
       order by o.created_at,o.id limit 50`,
    ),
    quoteQueryP95Ms: await queryP95(
      `select id,status,amount_minor,currency,expires_at from checkout_quotes
       where owner_user_id=$1 order by created_at desc,id desc limit 20`,
      [fixture.userId],
    ),
    orderQueryP95Ms: await queryP95(
      `select o.id,o.order_number,o.status,o.amount_minor,o.paid_at,f.status fulfillment_status
       from money_orders o left join fulfillment_jobs f on f.order_id=o.id
       where o.owner_user_id=$1 order by o.created_at desc,o.id desc limit 50`,
      [fixture.userId],
    ),
    entitlementQueryP95Ms: await queryP95(
      `select id,service_type,unit,source_type,available_quantity,reserved_quantity,expires_at
       from entitlement_grants where owner_user_id=$1
       order by expires_at,granted_at,id limit 50`,
      [fixture.userId],
    ),
    concurrentReservationP95Ms: await reservationLoad(),
    paymentCallbackP95Ms: await paymentCallbackLoad(),
    workerBacklogDrainMs: await workerBacklogLoad(),
  };
  const failures = Object.entries(result).filter(
    ([name, value]) => value > thresholds[name as keyof typeof thresholds],
  );
  console.info(JSON.stringify({ samples: { query: 200, reservation: 100, paymentCallback: 100, backlog: 1_000 }, thresholds, result, passed: failures.length === 0 }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await pool.end();
}

async function seedFixture() {
  const requestId = randomUUID();
  await pool.query('insert into users(id) values($1)', [fixture.userId]);
  await pool.query(
    `insert into service_offerings(id,code,business_space,service_type,offering_kind,status)
     values($1,$2,'SATORI','CARD_READING','PACKAGE','ACTIVE')`,
    [fixture.offeringId, `perf-card-pack-${fixture.offeringId}`],
  );
  await pool.query(
    `insert into offering_versions
     (id,offering_id,version,status,display_name,description,amount_minor,entitlement_spec,validity_days,
      purchase_limit,refund_policy_version,refund_policy,terms_version,effective_from,published_at)
     values($1,$2,1,'PUBLISHED','性能基线权益包','performance fixture',5990,
       $3,90,'{}','perf-refund-v1',$4,'perf-terms-v1',now(),now())`,
    [
      fixture.offeringVersionId,
      fixture.offeringId,
      { benefits: [{ serviceType: 'CARD_READING', unit: 'READING_CREDIT', quantity: 200 }] },
      { eligibility: 'UNUSED_ONLY', refundableBasisPoints: 10_000 },
    ],
  );
  await pool.query('update service_offerings set current_version_id=$2 where id=$1', [
    fixture.offeringId,
    fixture.offeringVersionId,
  ]);
  await pool.query(
    `insert into checkout_quotes
     (id,owner_user_id,business_space,offering_version_id,status,pricing_mode,amount_minor,currency,
      qualification_snapshot,pricing_snapshot,idempotency_key,request_hash,request_id,expires_at)
     values($1,$2,'SATORI',$3,'CONSUMED','STANDARD',5990,'CNY','{}',$4,$5,$6,$7,now()+interval '15 minutes')`,
    [fixture.quoteId, fixture.userId, fixture.offeringVersionId, { amountMinor: 5990 }, randomUUID(), randomUUID(), requestId],
  );
  await pool.query(
    `insert into money_orders
     (id,order_number,owner_user_id,business_space,checkout_quote_id,offering_version_id,status,
      amount_minor,currency,idempotency_key,request_hash,request_id,expires_at,paid_at)
     values($1,$2,$3,'SATORI',$4,$5,'FULFILLING',5990,'CNY',$6,$7,$8,now()+interval '30 minutes',now())`,
    [fixture.orderId, `PERF-${Date.now()}`, fixture.userId, fixture.quoteId, fixture.offeringVersionId, randomUUID(), randomUUID(), requestId],
  );
  await pool.query(
    `insert into payment_attempts
     (id,order_id,owner_user_id,provider,provider_attempt_id,status,amount_minor,currency,
      idempotency_key,request_hash,request_id,expires_at,succeeded_at)
     values($1,$2,$3,'FAKE',$4,'SUCCEEDED',5990,'CNY',$5,$6,$7,now()+interval '30 minutes',now())`,
    [fixture.paymentAttemptId, fixture.orderId, fixture.userId, `perf-${fixture.paymentAttemptId}`, randomUUID(), randomUUID(), requestId],
  );
  await pool.query(
    `insert into fulfillment_jobs
     (id,order_id,owner_user_id,business_space,business_key,fulfillment_type,status,attempt,max_attempts,request_id)
     values($1,$2,$3,'SATORI',$4,'ENTITLEMENT_GRANT','PENDING',0,8,$5)`,
    [fixture.fulfillmentId, fixture.orderId, fixture.userId, `perf:${fixture.orderId}`, requestId],
  );
  await pool.query(
    `insert into entitlement_grants
     (id,owner_user_id,business_space,service_type,unit,source_type,source_id,total_quantity,
      available_quantity,reserved_quantity,status,effective_at,expires_at,granted_at,expiry_timezone,rule_version,request_id)
     values($1,$2,'SATORI','CARD_READING','READING_CREDIT','PURCHASE',$3,200,200,0,'ACTIVE',now(),now()+interval '90 days',now(),'Asia/Shanghai','perf-v1',$4)`,
    [fixture.grantId, fixture.userId, fixture.orderId, requestId],
  );
}

async function queryP95(sql: string, parameters: readonly unknown[] = []) {
  const samples: number[] = [];
  for (let index = 0; index < 200; index += 1) {
    const startedAt = performance.now();
    await pool.query(sql, [...parameters]);
    samples.push(performance.now() - startedAt);
  }
  return round(p95(samples));
}

async function reservationLoad() {
  const samples = await Promise.all(
    Array.from({ length: 100 }, async () => {
      const startedAt = performance.now();
      const result = await pool.query(
        `update entitlement_grants
         set available_quantity=available_quantity-1,reserved_quantity=reserved_quantity+1,
             version=version+1,updated_at=now()
         where id=$1 and status='ACTIVE' and available_quantity>=1 returning id`,
        [fixture.grantId],
      );
      if (result.rowCount !== 1) throw new Error('Concurrent reservation lost an available unit');
      return performance.now() - startedAt;
    }),
  );
  const balance = await pool.query<{ available_quantity: number; reserved_quantity: number }>(
    'select available_quantity,reserved_quantity from entitlement_grants where id=$1',
    [fixture.grantId],
  );
  if (balance.rows[0]?.available_quantity !== 100 || balance.rows[0]?.reserved_quantity !== 100) {
    throw new Error('Concurrent reservation invariant failed');
  }
  return round(p95(samples));
}

async function paymentCallbackLoad() {
  const samples = await Promise.all(
    Array.from({ length: 100 }, (_, index) => paymentCallback(index)),
  );
  return round(p95(samples));
}

async function paymentCallback(index: number) {
  const startedAt = performance.now();
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `insert into payment_events
       (id,provider,provider_event_id,payment_attempt_id,order_id,event_type,signature_verified,verification_snapshot,provider_occurred_at)
       values(gen_random_uuid(),'FAKE',$1,$2,$3,'PAYMENT.SUCCESS',true,$4,now())`,
      [`perf-event-${fixture.paymentAttemptId}-${index}`, fixture.paymentAttemptId, fixture.orderId, { amountMinor: 5990, currency: 'CNY' }],
    );
    await client.query(
      `update payment_attempts set status='SUCCEEDED',succeeded_at=coalesce(succeeded_at,now()),updated_at=now()
       where id=$1 and amount_minor=5990 and currency='CNY'`,
      [fixture.paymentAttemptId],
    );
    await client.query('commit');
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }
  return performance.now() - startedAt;
}

async function workerBacklogLoad() {
  await pool.query(
    `insert into outbox(id,aggregate_type,aggregate_id,event_type,envelope_version,producer,request_id,payload,available_at)
     select gen_random_uuid(),'MoneyOrder',gen_random_uuid(),'FulfillmentRequested',1,'performance',gen_random_uuid(),'{}',now()
     from generate_series(1,1000)`,
  );
  const startedAt = performance.now();
  const result = await pool.query(
    `with claimed as (
       select id from outbox where producer='performance' and published_at is null
       order by available_at,id limit 1000 for update skip locked
     )
     update outbox o set published_at=now(),attempts=attempts+1
     from claimed where o.id=claimed.id returning o.id`,
  );
  if (result.rowCount !== 1_000) throw new Error(`Expected 1000 backlog events, drained ${result.rowCount}`);
  return round(performance.now() - startedAt);
}

async function rollback(client: PoolClient) {
  await client.query('rollback').catch(() => undefined);
}

function p95(samples: readonly number[]) {
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * 0.95) - 1] ?? 0;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
