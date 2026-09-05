import { SystemClock, type BenefitCandidate } from '@satori/application';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateEnvironment } from '../../packages/infrastructure/src/config/environment.js';
import { createDatabase } from '../../packages/infrastructure/src/database/client.js';
import { EntitlementApplicationService } from '../../packages/modules/src/entitlement/application/index.js';
import { PostgresEntitlementRepository } from '../../packages/modules/src/entitlement/repository-adapter/index.js';

const runDatabaseTests = process.env.RUN_DATABASE_TESTS === 'true';

describe.skipIf(!runDatabaseTests)('service entitlement ledger', () => {
  let pool: Pool;
  let repository: PostgresEntitlementRepository;
  let service: EntitlementApplicationService;
  const userId = randomUUID();

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
    await pool.query(`insert into users (id) values ($1)`, [userId]);
    repository = new PostgresEntitlementRepository({ pool } as never);
    service = new EntitlementApplicationService(
      repository,
      'entitlement-integration-cursor-secret',
      new SystemClock(),
    );
  });

  afterAll(async () => {
    const grants = await pool.query<{ id: string }>(
      `select id from entitlement_grants where owner_user_id=$1`,
      [userId],
    );
    const grantIds = grants.rows.map((row) => row.id);
    if (grantIds.length > 0) {
      await pool.query(`delete from reconciliation_cases where resource_id=any($1::text[])`, [grantIds]);
      await pool.query(`delete from operator_adjustments where grant_id=any($1::uuid[])`, [grantIds]);
      await pool.query(`delete from entitlement_usage_entries where grant_id=any($1::uuid[])`, [grantIds]);
      await pool.query(`delete from entitlement_grants where id=any($1::uuid[])`, [grantIds]);
    }
    await pool.query(`delete from users where id=$1`, [userId]);
    await pool.end();
  });

  it('keeps identical packs independent and returns stable earliest-expiry candidates', async () => {
    const later = await grant('pack-later', 3, '2026-12-31T15:59:59.999Z');
    const earlier = await grant('pack-earlier', 2, '2026-11-30T15:59:59.999Z');
    const candidates = await repository.listCandidates(requirement(1));
    const selected = candidates.filter((candidate) =>
      [earlier.grantId, later.grantId].includes(candidate.sourceId),
    );
    expect(selected.map((candidate) => candidate.sourceId)).toEqual([earlier.grantId, later.grantId]);
    expect(await repository.get(userId, earlier.grantId)).toMatchObject({ totalQuantity: 2 });
    expect(await repository.get(userId, later.grantId)).toMatchObject({ totalQuantity: 3 });
  });

  it('allows exactly one concurrent reservation of the final unit and settles once', async () => {
    const { grantId } = await grant('final-unit', 1, '2026-12-31T15:59:59.999Z');
    const candidate = candidateFor(grantId);
    const intentIds = [randomUUID(), randomUUID()];
    const attempts = await Promise.allSettled([
      repository.reserve(candidate, intentIds[0]!),
      repository.reserve(candidate, intentIds[1]!),
    ]);
    const fulfilled = attempts.filter(
      (attempt): attempt is PromiseFulfilledResult<Awaited<ReturnType<typeof repository.reserve>>> =>
        attempt.status === 'fulfilled',
    );
    const rejected = attempts.filter((attempt) => attempt.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ reason: { code: 'ENTITLEMENT_INSUFFICIENT' } });

    const reservation = fulfilled[0]!.value;
    const winnerIndex = attempts.findIndex((attempt) => attempt.status === 'fulfilled');
    await expect(repository.reserve(candidate, intentIds[winnerIndex]!)).resolves.toEqual(reservation);
    await repository.settle(reservation.reservationId, 'COMMIT', { type: 'READING', id: randomUUID() });
    await repository.settle(reservation.reservationId, 'COMMIT', { type: 'READING', id: randomUUID() });
    await expect(
      repository.settle(reservation.reservationId, 'RELEASE', { type: 'READING', id: randomUUID() }),
    ).rejects.toMatchObject({ code: 'CONSUMPTION_ALREADY_SETTLED' });
    expect(await repository.get(userId, grantId)).toMatchObject({
      availableQuantity: 0,
      reservedQuantity: 0,
      status: 'EXHAUSTED',
    });
    const publicUsage = await service.listUsage(userId, { limit: 20 });
    expect(publicUsage.data.filter((record) => record.entitlementId === grantId)).toEqual([
      expect.objectContaining({ type: 'COMMIT', quantity: 1, createdAt: expect.any(Date) }),
    ]);
  });

  it('does not restore a released reservation after its grant expires', async () => {
    const expiring = await grant(
      'expires-while-reserved',
      2,
      '2026-12-31T15:59:59.999Z',
      new Date(Date.now() - 120_000),
    );
    const reservation = await repository.reserve(candidateFor(expiring.grantId), randomUUID());
    await pool.query(`update entitlement_grants set expires_at=now()-interval '1 second' where id=$1`, [
      expiring.grantId,
    ]);
    await repository.settle(reservation.reservationId, 'RELEASE', {
      type: 'READING',
      id: randomUUID(),
    });
    expect(await repository.get(userId, expiring.grantId)).toMatchObject({
      availableQuantity: 0,
      reservedQuantity: 0,
      status: 'EXPIRED',
    });
    const usage = await repository.listUsage(userId, expiring.grantId, null, 20);
    expect(usage.rows.slice(0, 2).map((entry) => entry.entryType)).toEqual(['EXPIRE', 'RELEASE']);
  });

  it('appends freeze, unfreeze, forfeit, reverse and audited adjustment entries', async () => {
    const stateGrant = await grant('state-actions', 2, '2026-12-31T15:59:59.999Z');
    await repository.changeSourceState('state-actions', 'FREEZE', 'REFUND_REVIEW', randomUUID());
    await repository.changeSourceState('state-actions', 'UNFREEZE', 'REFUND_CANCELLED', randomUUID());
    await repository.adjust({
      grantId: stateGrant.grantId,
      quantity: 1,
      direction: 'INCREASE',
      reasonCode: 'SERVICE_RECOVERY',
      note: 'integration test adjustment',
      operatorUserId: userId,
      requestId: randomUUID(),
    });
    const usage = await repository.listUsage(userId, stateGrant.grantId, null, 20);
    const grantEntry = usage.rows.find((entry) => entry.entryType === 'GRANT')!;
    await repository.reverse({
      grantId: stateGrant.grantId,
      originalEntryId: grantEntry.id,
      quantity: 1,
      businessKey: `reverse:${randomUUID()}`,
      requestId: randomUUID(),
      reasonCode: 'CORRECTION',
    });
    await repository.changeSourceState('state-actions', 'FORFEIT', 'MEMBERSHIP_UPGRADE', randomUUID());
    const entries = await repository.listUsage(userId, stateGrant.grantId, null, 20);
    expect(entries.rows.map((entry) => entry.entryType)).toEqual(
      expect.arrayContaining(['GRANT', 'FREEZE', 'UNFREEZE', 'ADJUSTMENT', 'REVERSE', 'FORFEIT']),
    );
    expect(await repository.get(userId, stateGrant.grantId)).toMatchObject({
      totalQuantity: 2,
      availableQuantity: 0,
      status: 'FORFEITED',
    });
  });

  it('expires due batches with an append-only record and supports opaque cursor paging', async () => {
    const expired = await grant(
      'already-expired',
      2,
      new Date(Date.now() - 60_000).toISOString(),
      new Date(Date.now() - 120_000),
    );
    expect(await repository.expireDue(new Date(), randomUUID())).toBeGreaterThanOrEqual(1);
    const batch = await repository.get(userId, expired.grantId);
    expect(batch).toMatchObject({ status: 'EXPIRED', availableQuantity: 0 });
    const entries = await repository.listUsage(userId, expired.grantId, null, 20);
    expect(entries.rows[0]).toMatchObject({ entryType: 'EXPIRE', quantity: 2 });

    const first = await service.list(userId, { limit: 1 });
    expect(first.meta).toMatchObject({ hasMore: true });
    expect(first.meta.nextCursor).toEqual(expect.any(String));
    expect(typeof first.data[0]?.entitlementId).toBe('string');
    expect(['AVAILABLE', 'RESERVED', 'EXHAUSTED', 'EXPIRED', 'FORFEITED', 'FROZEN']).toContain(
      first.data[0]?.status,
    );
    expect(first.data[0]?.unit).toBe('READING_CREDIT');
    const second = await service.list(userId, { limit: 1, cursor: first.meta.nextCursor! });
    expect(second.data[0]?.entitlementId).not.toBe(first.data[0]?.entitlementId);
  });

  it('replays the ledger projection and leaves healthy grants without mismatch cases', async () => {
    const report = await repository.reconcile(new Date(), randomUUID());
    expect(report.checkedGrants).toBeGreaterThan(0);
    const mismatch = await pool.query<{ count: string }>(
      `select count(*)::text as count from reconciliation_cases
       where resource_id in (select id::text from entitlement_grants where owner_user_id=$1)
         and case_type in ('ENTITLEMENT_LEDGER_CHAIN_MISMATCH','ENTITLEMENT_PROJECTION_MISMATCH')
         and status='OPEN'`,
      [userId],
    );
    expect(Number(mismatch.rows[0]?.count ?? 0)).toBe(0);
  });

  async function grant(sourceId: string, quantity: number, expiresAt: string, effectiveAt = new Date()) {
    return repository.grant(
      {
        ownerUserId: userId,
        businessSpace: 'SATORI',
        serviceType: 'CARD_READING',
        unit: 'READING_CREDIT',
        quantity,
        sourceType: 'PURCHASE',
        sourceId,
        effectiveAt,
        expiresAt: new Date(expiresAt),
        ruleVersion: 'integration-v1',
        requestId: randomUUID(),
      },
      `grant:${sourceId}`,
    );
  }

  function requirement(quantity: number) {
    return {
      userId,
      businessSpace: 'SATORI' as const,
      serviceType: 'CARD_READING' as const,
      unit: 'READING_CREDIT' as const,
      quantity,
      businessContext: { type: 'READING', id: randomUUID() },
    };
  }

  function candidateFor(sourceId: string): BenefitCandidate {
    return {
      sourceId,
      sourceType: 'PURCHASED_ENTITLEMENT',
      serviceType: 'CARD_READING',
      availableQuantity: 1,
      requiredQuantity: 1,
      expiresAt: new Date('2026-12-31T15:59:59.999Z'),
      grantedAt: new Date(),
      ruleVersion: 'integration-v1',
    };
  }
});
