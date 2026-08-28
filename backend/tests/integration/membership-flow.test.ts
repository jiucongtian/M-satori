import { SystemClock, type BusinessClock, type EntitlementGrantPort } from '@satori/application';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateEnvironment } from '../../packages/infrastructure/src/config/environment.js';
import { createDatabase } from '../../packages/infrastructure/src/database/client.js';
import { EntitlementApplicationService } from '../../packages/modules/src/entitlement/application/index.js';
import { PostgresEntitlementRepository } from '../../packages/modules/src/entitlement/repository-adapter/index.js';
import { MembershipApplicationService } from '../../packages/modules/src/membership/application/index.js';
import { PostgresMembershipRepository } from '../../packages/modules/src/membership/repository-adapter/index.js';

const runDatabaseTests = process.env.RUN_DATABASE_TESTS === 'true';

describe.skipIf(!runDatabaseTests)('membership periods and replacement upgrades', () => {
  let pool: Pool;
  let repository: PostgresMembershipRepository;
  let entitlements: EntitlementApplicationService;
  let memberships: MembershipApplicationService;
  let clock: MutableClock;
  const userId = randomUUID();
  const plans = {
    glow: { offeringId: randomUUID(), versionId: randomUUID(), code: 'membership-glow-r11' },
    serenity: { offeringId: randomUUID(), versionId: randomUUID(), code: 'membership-serenity-r11' },
    freedom: { offeringId: randomUUID(), versionId: randomUUID(), code: 'membership-freedom-r11' },
  };
  const initialStart = new Date('2026-08-29T01:00:00.000Z');
  let currentSubscriptionId: string;

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
    await migrate(infrastructure.database, { migrationsFolder: './drizzle' });
    await pool.query('insert into users(id) values($1)', [userId]);
    await seedPlan(plans.glow, 1_290, 7, 3);
    await seedPlan(plans.serenity, 2_490, 15, 5);
    await seedPlan(plans.freedom, 3_990, 30, 8);
    repository = new PostgresMembershipRepository(infrastructure as never);
    entitlements = new EntitlementApplicationService(
      new PostgresEntitlementRepository(infrastructure as never),
      'membership-integration-cursor-secret',
      new SystemClock(),
    );
    clock = new MutableClock(initialStart);
    memberships = new MembershipApplicationService(repository, entitlements, clock);
  });

  afterAll(async () => {
    const grants = await pool.query<{ id: string }>(
      'select id from entitlement_grants where owner_user_id=$1',
      [userId],
    );
    const grantIds = grants.rows.map((row) => row.id);
    if (grantIds.length) {
      await pool.query('delete from entitlement_usage_entries where grant_id=any($1::uuid[])', [grantIds]);
      await pool.query('delete from entitlement_grants where id=any($1::uuid[])', [grantIds]);
    }
    await pool.query('delete from upgrade_assessments where owner_user_id=$1', [userId]);
    await pool.query('delete from membership_upgrades where owner_user_id=$1', [userId]);
    await pool.query('delete from membership_periods where owner_user_id=$1', [userId]);
    await pool.query('delete from membership_subscriptions where owner_user_id=$1', [userId]);
    await pool.query('delete from payment_attempts where owner_user_id=$1', [userId]);
    await pool.query(
      'delete from order_snapshots where order_id in (select id from money_orders where owner_user_id=$1)',
      [userId],
    );
    await pool.query('delete from money_orders where owner_user_id=$1', [userId]);
    await pool.query('delete from checkout_quotes where owner_user_id=$1', [userId]);
    for (const plan of Object.values(plans)) {
      await pool.query('delete from offering_versions where id=$1', [plan.versionId]);
      await pool.query('delete from service_offerings where id=$1', [plan.offeringId]);
    }
    await pool.query('delete from users where id=$1', [userId]);
    await pool.end();
  });

  it('starts one 30-day period and grants the snapshotted plan benefits exactly once', async () => {
    const orderId = await insertOrder(plans.glow.versionId, 'PAID', 1_290);
    const first = await memberships.activate(
      command(orderId, plans.glow.versionId, initialStart),
      'activate-1',
    );
    const replay = await memberships.activate(
      command(orderId, plans.glow.versionId, initialStart),
      'activate-1',
    );
    expect(replay).toEqual(first);
    currentSubscriptionId = first.subscriptionId;
    const current = await memberships.getCurrent(userId);
    expect(current).toMatchObject({ subscriptionId: first.subscriptionId, status: 'ACTIVE' });
    const periods = await memberships.listPeriods(userId);
    expect(periods).toHaveLength(1);
    expect(periods[0]).toMatchObject({ status: 'ACTIVE', sequence: 1 });
    const grants = await pool.query<{ service_type: string; total_quantity: number; status: string }>(
      'select service_type,total_quantity,status from entitlement_grants where owner_user_id=$1 order by service_type',
      [userId],
    );
    expect(grants.rows).toEqual([
      { service_type: 'CARD_READING', total_quantity: 3, status: 'ACTIVE' },
      { service_type: 'DAILY_INSIGHT', total_quantity: 7, status: 'ACTIVE' },
    ]);
  });

  it('serializes concurrent renewals and grants each queued period only when it starts', async () => {
    const firstOrder = await insertOrder(plans.glow.versionId, 'PAID', 1_290);
    const secondOrder = await insertOrder(plans.glow.versionId, 'PAID', 1_290);
    await Promise.all([
      memberships.activate(command(firstOrder, plans.glow.versionId, initialStart), 'renew-1'),
      memberships.activate(command(secondOrder, plans.glow.versionId, initialStart), 'renew-2'),
    ]);
    let periods = await memberships.listPeriods(userId);
    expect(periods.map((period) => period.status)).toEqual(['ACTIVE', 'QUEUED', 'QUEUED']);
    expect(new Date(String(periods[1]!.startsAt)).getTime()).toBe(
      new Date(String(periods[0]!.endsAt)).getTime(),
    );
    expect(new Date(String(periods[2]!.startsAt)).getTime()).toBe(
      new Date(String(periods[1]!.endsAt)).getTime(),
    );
    expect(await countGrants()).toBe(2);

    clock.set(new Date(String(periods[0]!.endsAt)));
    await memberships.maintain();
    await memberships.maintain();
    periods = await memberships.listPeriods(userId);
    expect(periods.map((period) => period.status)).toEqual(['EXPIRED', 'ACTIVE', 'QUEUED']);
    expect(await countGrants()).toBe(4);
    const oldStatuses = await pool.query<{ status: string }>(
      `select status from entitlement_grants where source_id=$1 order by service_type`,
      [String(periods[0]!.periodId)],
    );
    expect(oldStatuses.rows).toEqual([{ status: 'EXPIRED' }, { status: 'EXPIRED' }]);
  });

  it('stores an internal assessment and safely replaces the old plan without a refund fact', async () => {
    const active = (await memberships.listPeriods(userId)).find((period) => period.status === 'ACTIVE')!;
    const orderId = await insertOrder(plans.serenity.versionId, 'PENDING_PAYMENT', 2_490);
    const preview = await memberships.previewUpgrade(userId, currentSubscriptionId, plans.serenity.versionId);
    expect(preview.payableAmount).toEqual({ amount: 2_490, currency: 'CNY' });
    expect(preview.confirmation).toContain('原会员方案将在新方案生效后结束');
    expect(JSON.stringify(preview)).not.toMatch(/refund|退款|residual/i);
    const registered = await memberships.registerUpgrade({
      ownerUserId: userId,
      previousSubscriptionId: currentSubscriptionId,
      targetPlanVersionId: plans.serenity.versionId,
      newOrderId: orderId,
      requestId: randomUUID(),
    });
    await pool.query("update money_orders set status='PAID',paid_at=$2 where id=$1", [orderId, clock.now()]);
    const upgraded = await memberships.activate(
      command(orderId, plans.serenity.versionId, clock.now()),
      'upgrade-serenity',
    );
    expect(upgraded.subscriptionId).not.toBe(currentSubscriptionId);
    expect((await memberships.listUpgrades(userId))[0]).toMatchObject({
      upgradeId: registered.upgradeId,
      status: 'COMPLETED',
    });
    const subscriptions = await pool.query<{ id: string; status: string }>(
      'select id,status from membership_subscriptions where owner_user_id=$1 order by created_at',
      [userId],
    );
    expect(subscriptions.rows).toContainEqual({ id: currentSubscriptionId, status: 'TERMINATED' });
    expect(subscriptions.rows).toContainEqual({ id: upgraded.subscriptionId, status: 'ACTIVE' });
    const oldGrants = await pool.query<{ status: string }>(
      'select status from entitlement_grants where source_id=$1 order by service_type',
      [String(active.periodId)],
    );
    expect(oldGrants.rows).toEqual([{ status: 'FORFEITED' }, { status: 'FORFEITED' }]);
    expect(
      Number(
        (await pool.query<{ count: string }>('select count(*)::text count from refunds')).rows[0]!.count,
      ),
    ).toBe(0);
    const assessment = (
      await pool.query<{
        internal_only: boolean;
        residual_value_estimate_minor: number;
        assessment_rule_version: string;
      }>(
        'select internal_only,residual_value_estimate_minor,assessment_rule_version from upgrade_assessments',
      )
    ).rows[0]!;
    expect(assessment.internal_only).toBe(true);
    expect(assessment.residual_value_estimate_minor).toBeGreaterThanOrEqual(0);
    expect(assessment.assessment_rule_version).toBe('membership-residual-min-v1');
    currentSubscriptionId = upgraded.subscriptionId;
  });

  it('keeps the current membership when a higher plan cannot be fulfilled', async () => {
    const orderId = await insertOrder(plans.freedom.versionId, 'PENDING_PAYMENT', 3_990);
    await memberships.registerUpgrade({
      ownerUserId: userId,
      previousSubscriptionId: currentSubscriptionId,
      targetPlanVersionId: plans.freedom.versionId,
      newOrderId: orderId,
      requestId: randomUUID(),
    });
    await pool.query("update money_orders set status='PAID',paid_at=$2 where id=$1", [orderId, clock.now()]);
    const failing = new MembershipApplicationService(
      repository,
      new FailingEntitlementPort(entitlements),
      clock,
    );
    await expect(
      failing.activate(command(orderId, plans.freedom.versionId, clock.now()), 'upgrade-failure'),
    ).rejects.toThrow('simulated grant outage');
    expect(await memberships.getCurrent(userId)).toMatchObject({
      subscriptionId: currentSubscriptionId,
      status: 'ACTIVE',
    });
    await pool.query("update money_orders set status='EXCEPTION' where id=$1", [orderId]);
    await memberships.reconcile();
    expect(await memberships.getCurrent(userId)).toMatchObject({
      subscriptionId: currentSubscriptionId,
      status: 'ACTIVE',
    });
    expect((await memberships.listUpgrades(userId))[0]).toMatchObject({ status: 'FAILED' });
  });

  function command(sourceOrderId: string, planVersionId: string, startsAt: Date) {
    return {
      ownerUserId: userId,
      businessSpace: 'SATORI' as const,
      planVersionId,
      sourceOrderId,
      startsAt,
    };
  }

  async function countGrants() {
    return Number(
      (
        await pool.query<{ count: string }>(
          'select count(*)::text count from entitlement_grants where owner_user_id=$1',
          [userId],
        )
      ).rows[0]!.count,
    );
  }

  async function seedPlan(
    plan: { offeringId: string; versionId: string; code: string },
    amountMinor: number,
    daily: number,
    reading: number,
  ) {
    await pool.query(
      `insert into service_offerings(id,code,business_space,service_type,offering_kind,status)
       values($1,$2,'SATORI','CARD_READING','MEMBERSHIP','ACTIVE')`,
      [plan.offeringId, plan.code],
    );
    await pool.query(
      `insert into offering_versions
       (id,offering_id,version,status,display_name,description,amount_minor,entitlement_spec,validity_days,
        purchase_limit,refund_policy_version,refund_policy,terms_version,published_at)
       values($1,$2,1,'PUBLISHED',$3,'test',$4,$5,30,'{}','none','{}','terms-v1',now())`,
      [
        plan.versionId,
        plan.offeringId,
        plan.code,
        amountMinor,
        JSON.stringify({
          periodDays: 30,
          benefits: [
            { serviceType: 'DAILY_INSIGHT', unit: 'DAILY_INSIGHT_CREDIT', quantity: daily },
            { serviceType: 'CARD_READING', unit: 'READING_CREDIT', quantity: reading },
          ],
        }),
      ],
    );
    await pool.query('update service_offerings set current_version_id=$1 where id=$2', [
      plan.versionId,
      plan.offeringId,
    ]);
  }

  async function insertOrder(versionId: string, status: string, amountMinor: number) {
    const quoteId = randomUUID();
    const orderId = randomUUID();
    await pool.query(
      `insert into checkout_quotes
       (id,owner_user_id,business_space,offering_version_id,status,pricing_mode,amount_minor,
        reserved_seed_quantity,qualification_snapshot,pricing_snapshot,idempotency_key,request_hash,request_id,
        expires_at,created_at)
       values($1,$2,'SATORI',$3,'CONSUMED','STANDARD',$4,0,'{}','{}',$5,$6,$7,$8,$9)`,
      [
        quoteId,
        userId,
        versionId,
        amountMinor,
        `quote-${quoteId}`,
        randomUUID(),
        randomUUID(),
        new Date(clock.now().getTime() + 900_000),
        clock.now(),
      ],
    );
    await pool.query(
      `insert into money_orders
       (id,order_number,owner_user_id,business_space,checkout_quote_id,offering_version_id,status,
        amount_minor,idempotency_key,request_hash,request_id,expires_at,paid_at,created_at,updated_at)
       values($1,$2,$3,'SATORI',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)`,
      [
        orderId,
        `TEST-${orderId}`,
        userId,
        quoteId,
        versionId,
        status,
        amountMinor,
        `order-${orderId}`,
        randomUUID(),
        randomUUID(),
        new Date(clock.now().getTime() + 1_800_000),
        status === 'PAID' ? clock.now() : null,
        clock.now(),
      ],
    );
    return orderId;
  }
});

class MutableClock implements BusinessClock {
  constructor(private value: Date) {}
  now() {
    return new Date(this.value);
  }
  set(value: Date) {
    this.value = new Date(value);
  }
}

class FailingEntitlementPort implements EntitlementGrantPort {
  constructor(private readonly delegate: EntitlementGrantPort) {}
  grant(): Promise<{ grantId: string }> {
    return Promise.reject(Object.assign(new Error('simulated grant outage'), { retryable: true }));
  }
  freezeBySource(sourceId: string, reasonCode: string) {
    return this.delegate.freezeBySource(sourceId, reasonCode);
  }
  unfreezeBySource(sourceId: string, reasonCode: string) {
    return this.delegate.unfreezeBySource(sourceId, reasonCode);
  }
  forfeitBySource(sourceId: string, reasonCode: string) {
    return this.delegate.forfeitBySource(sourceId, reasonCode);
  }
  expireDue(now: Date) {
    return this.delegate.expireDue(now);
  }
  summarizeBySource(sourceId: string) {
    return this.delegate.summarizeBySource(sourceId);
  }
}
