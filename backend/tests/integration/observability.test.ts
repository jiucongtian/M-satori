import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  correlation,
  createDatabase,
  inTransaction,
  metrics,
  validateEnvironment,
} from '@satori/infrastructure';
import { createDatabaseDiagnostics } from '../../packages/infrastructure/src/observability/database-diagnostics.js';

function database(max = 1) {
  return createDatabase(
    validateEnvironment({
      ...process.env,
      DATABASE_POOL_MAX: String(max),
      SMS_DELIVERY_MODE: 'FIXED_CODE',
      AQUA_BASE_URL: 'https://aqua.example.com',
      AQUA_SERVICE_KEY: 'isolated-observability-key',
    }),
  );
}
describe.skipIf(process.env.RUN_DATABASE_TESTS !== 'true')('PostgreSQL observability', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    metrics.drain();
  });
  it('separates real connection contention and SQL duration, keeps Drizzle and rollback semantics', async () => {
    const { pool, database: db } = database();
    const logs = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const held = await pool.connect();
      metrics.drain();
      const requestId = randomUUID();
      const query = correlation.run({ requestId }, () =>
        pool.query<{ value: string }>('select pg_sleep(0.3), $1::text as value', ['secret-value']),
      );
      expect(pool.waitingCount).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 150));
      held.release();
      expect((await query).rows[0]!.value).toBe('secret-value');
      const measurements = metrics.drain().series;
      expect(measurements.find((row) => row.metric === 'db_acquire_ms')!.max).toBeGreaterThanOrEqual(100);
      expect(measurements.find((row) => row.metric === 'db_query_ms')!.max).toBeGreaterThanOrEqual(250);
      const records = logs.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
      expect(records.find((row) => row.event === 'db_query_ms_slow')).toMatchObject({ requestId });
      expect(JSON.stringify(records)).not.toContain('secret-value');
      await pool.query('create temp table telemetry_rollback (value int)');
      const failure = new Error('rollback');
      await expect(
        inTransaction(pool, async (client) => {
          await client.query('insert into telemetry_rollback values (1)');
          throw failure;
        }),
      ).rejects.toBe(failure);
      expect(
        (await db.execute(sql`select count(*)::int as count from telemetry_rollback`)).rows[0]!.count,
      ).toBe(0);
      await new Promise<void>((resolve, reject) =>
        pool.connect((error, client, release) => {
          if (error || !client) return reject(error ?? new Error('No client'));
          client.query('select 1', (queryError) => {
            release();
            if (queryError) reject(queryError);
            else resolve();
          });
        }),
      );
    } finally {
      await pool.end();
    }
  });
  it('observes real lock waits through a separate bounded diagnostic connection', async () => {
    const { pool } = database(2);
    const diagnostics = createDatabaseDiagnostics(pool);
    const logs = vi.spyOn(console, 'info').mockImplementation(() => {});
    const first = await pool.connect();
    const second = await pool.connect();
    let blocked: Promise<unknown> | undefined;
    try {
      await first.query('begin');
      await second.query('begin');
      await first.query('select pg_advisory_xact_lock(9090911)');
      blocked = second.query('select pg_advisory_xact_lock(9090911)');
      await vi.waitFor(async () => {
        await diagnostics.sample();
        const snapshots = logs.mock.calls
          .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
          .filter((row) => row.event === 'db_activity_snapshot');
        expect(snapshots.at(-1)!.lock_waiting).toBeGreaterThanOrEqual(1);
      });
    } finally {
      await first.query('rollback');
      await blocked;
      await second.query('rollback');
      first.release();
      second.release();
      await diagnostics.close();
      await pool.end();
    }
  });
});
