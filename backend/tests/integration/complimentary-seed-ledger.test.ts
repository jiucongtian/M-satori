import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateEnvironment } from '../../packages/infrastructure/src/config/environment.js';
import { createDatabase } from '../../packages/infrastructure/src/database/client.js';
import { PostgresComplimentarySeedRepository } from '../../packages/modules/src/complimentary-seed/repository-adapter/index.js';

const runDatabaseTests = process.env.RUN_DATABASE_TESTS === 'true';

describe.skipIf(!runDatabaseTests)('complimentary seed batch ledger', () => {
  let pool: Pool;
  let repository: PostgresComplimentarySeedRepository;
  const userId = randomUUID();
  const migrationUserId = randomUUID();
  const concurrencyUserId = randomUUID();

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
    await pool.query(`insert into users(id) values($1),($2),($3)`, [
      userId,
      migrationUserId,
      concurrencyUserId,
    ]);
    repository = new PostgresComplimentarySeedRepository({ pool } as never);
  });

  afterAll(async () => {
    await pool.query(`alter table seed_entries disable trigger seed_entries_append_only`);
    try {
      for (const owner of [userId, migrationUserId, concurrencyUserId]) {
        await pool.query(`delete from complimentary_seed_entries where owner_user_id=$1`, [owner]);
        await pool.query(`delete from complimentary_seed_allocations where owner_user_id=$1`, [owner]);
        await pool.query(`delete from complimentary_seed_grants where owner_user_id=$1`, [owner]);
        await pool.query(`delete from complimentary_seed_account_projections where owner_user_id=$1`, [owner]);
        await pool.query(
          `delete from seed_entries where account_id in (select id from seed_accounts where user_id=$1)`,
          [owner],
        );
        await pool.query(`delete from seed_accounts where user_id=$1`, [owner]);
        await pool.query(`delete from users where id=$1`, [owner]);
      }
    } finally {
      await pool.query(`alter table seed_entries enable trigger seed_entries_append_only`);
    }
    await pool.end();
  });

  it('enforces service scope and returns earliest-expiry batches first', async () => {
    const first = await grant('reading-first', ['CARD_READING'], 3, '2026-10-01T00:00:00.000Z');
    const second = await grant('reading-second', ['CARD_READING'], 5, '2026-11-01T00:00:00.000Z');
    expect(await repository.listCandidates(requirement('DAILY_INSIGHT', 1))).toHaveLength(0);
    const reading = await repository.listCandidates(requirement('CARD_READING', 6));
    expect(reading.slice(0, 2).map((candidate) => candidate.sourceId)).toEqual([
      first.grantId,
      second.grantId,
    ]);
  });

  it('allocates across batches atomically and consumes exactly once', async () => {
    const context = { type: 'READING', id: randomUUID() };
    const reservation = await repository.reserve({
      ownerUserId: userId,
      businessSpace: 'SATORI',
      serviceType: 'CARD_READING',
      quantity: 6,
      businessKey: 'reading-intent:reserve',
      consumptionIntentId: randomUUID(),
      businessContext: context,
      requestId: randomUUID(),
    });
    expect(reservation.allocations.map((allocation) => allocation.quantity)).toEqual([3, 3]);
    const replay = await repository.reserve({
      ownerUserId: userId,
      businessSpace: 'SATORI',
      serviceType: 'CARD_READING',
      quantity: 6,
      businessKey: 'reading-intent:reserve',
      businessContext: context,
      requestId: randomUUID(),
    });
    expect(replay.reservationId).toBe(reservation.reservationId);
    await expect(
      repository.reserve({
        ownerUserId: userId,
        businessSpace: 'SATORI',
        serviceType: 'CARD_READING',
        quantity: 1,
        businessKey: 'reading-intent:reserve',
        businessContext: context,
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    await repository.settle(
      reservation.reservationId,
      'CONSUME',
      { type: 'READING', id: randomUUID() },
      randomUUID(),
    );
    await repository.settle(
      reservation.reservationId,
      'CONSUME',
      { type: 'READING', id: randomUUID() },
      randomUUID(),
    );
    await expect(
      repository.settle(
        reservation.reservationId,
        'RELEASE',
        { type: 'READING', id: randomUUID() },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'SEED_RESERVATION_ALREADY_SETTLED' });
    expect(await repository.getAccount(userId)).toMatchObject({ available: 2, reserved: 0, totalSpent: 6 });
    await repository.restore(reservation.reservationId, 'reading-intent:restore', randomUUID());
    await repository.restore(reservation.reservationId, 'reading-intent:restore-retry', randomUUID());
    expect(await repository.getAccount(userId)).toMatchObject({ available: 8, reserved: 0, totalSpent: 0 });
  });

  it('reserves promotion seeds idempotently and releases the exact allocation', async () => {
    await grant('daily-promotion', ['DAILY_INSIGHT'], 10, '2026-12-01T00:00:00.000Z');
    const command = {
      ownerUserId: userId,
      businessSpace: 'SATORI' as const,
      serviceType: 'DAILY_INSIGHT' as const,
      quantity: 4,
      businessKey: 'order-promotion:reserve',
      businessContext: { type: 'MONEY_ORDER', id: randomUUID() },
      requestId: randomUUID(),
    };
    const reserved = await repository.reserve(command);
    expect((await repository.reserve({ ...command, requestId: randomUUID() })).reservationId).toBe(
      reserved.reservationId,
    );
    await repository.settle(reserved.reservationId, 'RELEASE', command.businessContext, randomUUID());
    expect(await repository.getAccount(userId)).toMatchObject({ available: 18, reserved: 0 });
  });

  it('migrates legacy totals idempotently and blocks cutover while legacy reservations remain', async () => {
    const legacyAccountId = randomUUID();
    await pool.query(
      `insert into seed_accounts(id,user_id,available,reserved,total_earned,total_spent) values($1,$2,7,2,20,11)`,
      [legacyAccountId, migrationUserId],
    );
    const legacyEntryId = randomUUID();
    await pool.query(
      `insert into seed_entries
       (id,account_id,type,amount,available_after,reserved_after,business_key,business_type,metadata)
       values($1,$2,'GRANT',20,20,0,'legacy-registration','REGISTRATION_REWARD',$3)`,
      [legacyEntryId, legacyAccountId, JSON.stringify({ title: '新用户注册赠送' })],
    );
    const first = await repository.migrateLegacyAccount(migrationUserId, randomUUID());
    const replay = await repository.migrateLegacyAccount(migrationUserId, randomUUID());
    expect(first).toMatchObject({
      state: 'BLOCKED',
      consistent: true,
      legacy: { available: 7, reserved: 2 },
      batch: { available: 7, reserved: 2 },
    });
    expect(replay.grantId).toBe(first.grantId);
    expect(await repository.getAccount(migrationUserId)).toMatchObject({
      available: 7,
      reserved: 2,
      totalEarned: 20,
      totalSpent: 11,
    });
    const transactions = await repository.listTransactions(migrationUserId, null, 20);
    expect(transactions.rows).toEqual([
      expect.objectContaining({
        transactionId: legacyEntryId,
        type: 'GRANT',
        amount: 20,
        title: '新用户注册赠送',
      }),
    ]);
    expect(await repository.reconcile(migrationUserId)).toMatchObject({ consistent: true });
  });

  it('replays an identical adjustment but rejects a changed payload', async () => {
    const grants = await repository.listGrants(userId);
    const grantId = grants.find((grant) => grant.sourceId === 'daily-promotion')!.id;
    const requestId = randomUUID();
    await repository.adjust(grantId, 2, 'INCREASE', 'TEST_COMPENSATION', requestId);
    await repository.adjust(grantId, 2, 'INCREASE', 'TEST_COMPENSATION', requestId);
    await expect(
      repository.adjust(grantId, 1, 'INCREASE', 'TEST_COMPENSATION', requestId),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('protects the final seed under concurrency and appends expiry records', async () => {
    const final = await repository.grant(
      {
        ownerUserId: concurrencyUserId,
        businessSpace: 'SATORI',
        sourceType: 'COMPENSATION',
        sourceId: 'final-seed',
        applicableServices: ['CARD_READING'],
        quantity: 1,
        effectiveAt: new Date(),
        expiresAt: new Date('2026-12-01T00:00:00.000Z'),
        ruleVersion: 'seed-test-v1',
        requestId: randomUUID(),
      },
      'grant:final-seed',
    );
    const attempts = await Promise.allSettled(
      [0, 1].map((index) =>
        repository.reserve({
          ownerUserId: concurrencyUserId,
          businessSpace: 'SATORI',
          serviceType: 'CARD_READING',
          quantity: 1,
          businessKey: `final-seed:${index}`,
          businessContext: { type: 'TEST', id: randomUUID() },
          requestId: randomUUID(),
        }),
      ),
    );
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);

    const expiring = await repository.grant(
      {
        ownerUserId: concurrencyUserId,
        businessSpace: 'SATORI',
        sourceType: 'ACTIVITY',
        sourceId: 'expiring-seed',
        applicableServices: ['DAILY_INSIGHT'],
        quantity: 2,
        effectiveAt: new Date(Date.now() - 120_000),
        expiresAt: new Date('2026-12-01T00:00:00.000Z'),
        ruleVersion: 'seed-test-v1',
        requestId: randomUUID(),
      },
      'grant:expiring-seed',
    );
    await pool.query(
      `update complimentary_seed_grants set expires_at=now()-interval '1 second' where id=$1`,
      [expiring.grantId],
    );
    expect(await repository.expireDue(new Date(), randomUUID())).toBeGreaterThanOrEqual(1);
    const entries = await pool.query<{ entry_type: string }>(
      `select entry_type from complimentary_seed_entries where grant_id=$1 order by created_at desc,id desc`,
      [expiring.grantId],
    );
    expect(entries.rows[0]?.entry_type).toBe('EXPIRE');
    expect(await repository.reconcile(concurrencyUserId)).toMatchObject({ consistent: true });
    expect(typeof final.grantId).toBe('string');
  });

  function grant(
    sourceId: string,
    applicableServices: ('DAILY_INSIGHT' | 'CARD_READING')[],
    quantity: number,
    expiresAt: string,
  ) {
    return repository.grant(
      {
        ownerUserId: userId,
        businessSpace: 'SATORI',
        sourceType: 'ACTIVITY',
        sourceId,
        applicableServices,
        quantity,
        effectiveAt: new Date(),
        expiresAt: new Date(expiresAt),
        ruleVersion: 'seed-test-v1',
        requestId: randomUUID(),
      },
      `grant:${sourceId}`,
    );
  }

  function requirement(serviceType: 'DAILY_INSIGHT' | 'CARD_READING', quantity: number) {
    return {
      userId,
      businessSpace: 'SATORI' as const,
      serviceType,
      quantity,
      unit: 'SEED' as const,
      businessContext: { type: 'TEST', id: randomUUID() },
    };
  }
});
