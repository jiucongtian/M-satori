import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SystemClock } from '../../packages/application/src/index.js';
import { validateEnvironment } from '../../packages/infrastructure/src/config/environment.js';
import { createDatabase } from '../../packages/infrastructure/src/database/client.js';
import { ComplimentarySeedApplicationService } from '../../packages/modules/src/complimentary-seed/application/index.js';
import { PostgresComplimentarySeedRepository } from '../../packages/modules/src/complimentary-seed/repository-adapter/index.js';
import { ConsumptionApplicationService } from '../../packages/modules/src/consumption/application/index.js';
import { PostgresConsumptionRepository } from '../../packages/modules/src/consumption/repository-adapter/index.js';
import { EntitlementApplicationService } from '../../packages/modules/src/entitlement/application/index.js';
import { PostgresEntitlementRepository } from '../../packages/modules/src/entitlement/repository-adapter/index.js';

const runDatabaseTests = process.env.RUN_DATABASE_TESTS === 'true';

describe.skipIf(!runDatabaseTests)('consumption orchestration', () => {
  let pool: Pool;
  let consumption: ConsumptionApplicationService;
  let consumptionRepository: PostgresConsumptionRepository;
  let seeds: ComplimentarySeedApplicationService;
  let entitlements: EntitlementApplicationService;
  const userId = randomUUID();
  const membershipSourceId = randomUUID();
  const purchaseSourceId = randomUUID();

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
    await pool.query(`insert into users(id) values($1)`, [userId]);

    const entitlementRepository = new PostgresEntitlementRepository({ pool } as never);
    const seedRepository = new PostgresComplimentarySeedRepository({ pool } as never);
    const clock = new SystemClock();
    entitlements = new EntitlementApplicationService(
      entitlementRepository,
      'integration-cursor-secret',
      clock,
    );
    seeds = new ComplimentarySeedApplicationService(seedRepository);
    consumptionRepository = new PostgresConsumptionRepository({ pool } as never);
    consumption = new ConsumptionApplicationService(entitlements, seeds, consumptionRepository, clock);

    for (const source of [
      { sourceType: 'MEMBERSHIP' as const, sourceId: membershipSourceId },
      { sourceType: 'PURCHASE' as const, sourceId: purchaseSourceId },
    ]) {
      await entitlementRepository.grant(
        {
          ownerUserId: userId,
          businessSpace: 'SATORI',
          serviceType: 'CARD_READING',
          unit: 'READING_CREDIT',
          quantity: 1,
          ...source,
          effectiveAt: new Date(Date.now() - 60_000),
          expiresAt: new Date('2027-01-01T00:00:00.000Z'),
          ruleVersion: 'integration-v1',
          requestId: randomUUID(),
        },
        `grant:${source.sourceId}`,
      );
    }
    await seedRepository.grant(
      {
        ownerUserId: userId,
        businessSpace: 'SATORI',
        sourceType: 'ACTIVITY',
        sourceId: 'consumption-seeds',
        applicableServices: ['CARD_READING'],
        quantity: 20,
        effectiveAt: new Date(Date.now() - 60_000),
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
        ruleVersion: 'seed-integration-v1',
        requestId: randomUUID(),
      },
      'grant:consumption-seeds',
    );
  });

  afterAll(async () => {
    await pool.query(
      `delete from reservation_allocations where consumption_intent_id in
       (select id from consumption_intents where owner_user_id=$1)`,
      [userId],
    );
    await pool.query(`delete from consumption_intents where owner_user_id=$1`, [userId]);
    await pool.query(
      `delete from resolution_candidates where resolution_id in
       (select id from entitlement_resolutions where owner_user_id=$1)`,
      [userId],
    );
    await pool.query(`delete from entitlement_resolutions where owner_user_id=$1`, [userId]);
    await pool.query(`delete from entitlement_usage_entries where owner_user_id=$1`, [userId]);
    await pool.query(`delete from entitlement_grants where owner_user_id=$1`, [userId]);
    await pool.query(`delete from complimentary_seed_entries where owner_user_id=$1`, [userId]);
    await pool.query(`delete from complimentary_seed_allocations where owner_user_id=$1`, [userId]);
    await pool.query(`delete from complimentary_seed_grants where owner_user_id=$1`, [userId]);
    await pool.query(`delete from complimentary_seed_account_projections where owner_user_id=$1`, [userId]);
    await pool.query(`delete from users where id=$1`, [userId]);
    await pool.end();
  });

  it('uses membership, then purchased benefit, then seeds with idempotent settlement', async () => {
    const membership = await consumption.reserve(requirement('membership-reading'), 'membership-reserve-key');
    expect(membership.resolution.selectedCandidate).toMatchObject({
      sourceType: 'MEMBERSHIP_ENTITLEMENT',
    });
    expect((await consumption.reserve(requirement('membership-reading'), 'retry-key')).intentId).toBe(
      membership.intentId,
    );
    await consumption.start(membership.intentId, 'membership-start-key');
    await consumption.commit(membership.intentId, 'membership-commit-key');
    await consumption.commit(membership.intentId, 'membership-commit-retry');

    const purchased = await consumption.reserve(requirement('purchased-reading'), 'purchase-reserve-key');
    expect(purchased.resolution.selectedCandidate).toMatchObject({
      sourceType: 'PURCHASED_ENTITLEMENT',
    });
    expect(typeof purchased.resolution.selectedCandidate?.sourceId).toBe('string');
    await consumption.start(purchased.intentId, 'purchase-start-key');
    await consumption.commit(purchased.intentId, 'purchase-commit-key');

    const seeds = await consumption.reserve(requirement('seed-reading'), 'seed-reserve-key');
    expect(seeds.resolution.selectedCandidate).toMatchObject({
      sourceType: 'COMPLIMENTARY_SEED',
      requiredQuantity: 5,
    });
    await consumption.release(seeds.intentId, 'seed-release-key');
    await consumption.release(seeds.intentId, 'seed-release-retry');
  });

  it('releases abandoned pre-draw reservations but leaves RUNNING intents alone', async () => {
    const abandoned = await consumption.reserve(requirement('abandoned-reading'), 'abandoned-reserve-key');
    await pool.query(
      `update consumption_intents set reservation_deadline=now()-interval '1 second' where id=$1`,
      [abandoned.intentId],
    );
    expect(await consumption.expireDue()).toBe(1);
    expect(await consumption.getIntent(abandoned.intentId)).toMatchObject({ status: 'EXPIRED' });

    const running = await consumption.reserve(requirement('running-reading'), 'running-reserve-key');
    await consumption.start(running.intentId, 'running-start-key');
    await pool.query(
      `update consumption_intents set reservation_deadline=now()-interval '1 second' where id=$1`,
      [running.intentId],
    );
    expect(await consumption.expireDue()).toBe(0);
    expect(await consumption.getIntent(running.intentId)).toMatchObject({
      status: 'RUNNING',
      reservationExpiresAt: null,
    });
    await consumption.release(running.intentId, 'running-release-key');
  });

  it('recovers when the ledger reserved successfully before the intent recorded its allocation', async () => {
    const resolution = await consumption.createResolution(
      requirement('crash-gap-reading'),
      'crash-resolution-key',
    );
    const draft = await consumptionRepository.createIntentDraft(
      resolution,
      resolution.expiresAt,
      randomUUID(),
    );
    await seeds.reserve(resolution.selectedSource!, draft.intentId);

    const recovered = await consumption.createIntent(userId, resolution.resolutionId, 'crash-intent-key');

    expect(recovered).toMatchObject({ intentId: draft.intentId, status: 'RESERVED' });
    const reserveEntries = await pool.query<{ count: string }>(
      `select count(*)::text count from complimentary_seed_entries
       where consumption_intent_id=$1 and entry_type='RESERVE'`,
      [draft.intentId],
    );
    expect(Number(reserveEntries.rows[0]!.count)).toBeGreaterThan(0);
    const distinctKeys = await pool.query<{ count: string }>(
      `select count(distinct business_key)::text count from complimentary_seed_entries
       where consumption_intent_id=$1 and entry_type='RESERVE'`,
      [draft.intentId],
    );
    expect(distinctKeys.rows[0]!.count).toBe('1');
    await consumption.release(draft.intentId, 'crash-release-key');
  });

  it('reconciles a RUNNING intent from an authoritative business outcome', async () => {
    const running = await consumption.reserve(requirement('reconciliation-reading'), 'reconcile-reserve-key');
    await consumption.start(running.intentId, 'reconcile-start-key');
    const reconciler = new ConsumptionApplicationService(
      entitlements,
      seeds,
      consumptionRepository,
      new SystemClock(),
      { getOutcome: () => Promise.resolve('SUCCEEDED') },
    );

    await expect(reconciler.reconcile()).resolves.toMatchObject({ committed: 1 });
    expect(await consumption.getIntent(running.intentId)).toMatchObject({ status: 'COMMITTED' });
  });

  it('allows only one winner when two intents compete for the remaining seed balance', async () => {
    const replayed = await Promise.all([
      consumption.reserve(requirement('same-context-concurrency', 1), 'same-context-key-a'),
      consumption.reserve(requirement('same-context-concurrency', 1), 'same-context-key-b'),
    ]);
    expect(new Set(replayed.map((intent) => intent.intentId))).toHaveLength(1);
    await consumption.release(replayed[0].intentId, 'same-context-release-key');

    const attempts = await Promise.allSettled([
      consumption.reserve(requirement('concurrent-reading-a', 15), 'concurrent-reserve-key-a'),
      consumption.reserve(requirement('concurrent-reading-b', 15), 'concurrent-reserve-key-b'),
    ]);
    const fulfilled = attempts.filter(
      (attempt): attempt is PromiseFulfilledResult<Awaited<ReturnType<typeof consumption.reserve>>> =>
        attempt.status === 'fulfilled',
    );
    expect(fulfilled).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);
    await consumption.release(fulfilled[0]!.value.intentId, 'concurrent-release-key');
  });

  function requirement(contextId: string, seedQuantity = 5) {
    return {
      userId,
      businessSpace: 'SATORI' as const,
      serviceType: 'CARD_READING' as const,
      quantity: 1,
      unit: 'READING_CREDIT' as const,
      businessContext: { type: 'READING_INTENT', id: contextId },
      attributes: { seedQuantity, cardCount: 3 },
    };
  }
});
