import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateEnvironment } from '../../packages/infrastructure/src/config/environment.js';
import { createDatabase } from '../../packages/infrastructure/src/database/client.js';

const runDatabaseTests = process.env.RUN_DATABASE_TESTS === 'true';

describe.skipIf(!runDatabaseTests)('R1.1 commerce schema', () => {
  let pool: Pool;

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
    await migrate(infrastructure.database, { migrationsFolder: './drizzle' });
  });

  afterAll(async () => pool.end());

  it('starts from the complete migration chain and preserves R1.0 tables', async () => {
    const requiredTables = [
      'users',
      'seed_accounts',
      'generation_tasks',
      'service_offerings',
      'money_orders',
      'entitlement_grants',
      'complimentary_seed_grants',
      'consumption_intents',
      'membership_subscriptions',
      'inbox_consumptions',
    ];
    const result = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_name = any($1::text[])`,
      [requiredTables],
    );
    expect(new Set(result.rows.map((row) => row.table_name))).toEqual(new Set(requiredTables));
  });

  it('rejects a negative service-entitlement balance', async () => {
    await expectCheckViolation(pool, async (client, userId) => {
      await client.query(
        `insert into entitlement_grants
         (id, owner_user_id, business_space, service_type, unit, source_type, source_id,
          total_quantity, available_quantity, reserved_quantity, status, effective_at,
          expires_at, granted_at, expiry_timezone, rule_version, request_id)
         values ($1, $2, 'SATORI', 'CARD_READING', 'READING_CREDIT', 'MANUAL', $3,
                 1, -1, 0, 'ACTIVE', now(), now() + interval '1 day', now(),
                 'Asia/Shanghai', 'test-v1', $4)`,
        [randomUUID(), userId, randomUUID(), randomUUID()],
      );
    });
  });

  it('rejects a client-selected entitlement resolution', async () => {
    await expectCheckViolation(pool, async (client, userId) => {
      await client.query(
        `insert into entitlement_resolutions
         (id, owner_user_id, business_space, service_type, quantity, unit,
          business_context_type, business_context_id, status, reason_code,
          selection_mode, rule_version, requirement_snapshot, request_id)
         values ($1, $2, 'SATORI', 'CARD_READING', 1, 'READING_CREDIT',
                 'READING', $3, 'NO_BENEFIT', 'NO_BENEFIT',
                 'USER_SELECTION', 'test-v1', '{}'::jsonb, $4)`,
        [randomUUID(), userId, randomUUID(), randomUUID()],
      );
    });
  });
});

async function expectCheckViolation(pool: Pool, work: (client: PoolClient, userId: string) => Promise<void>) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const userId = randomUUID();
    await client.query(`insert into users (id) values ($1)`, [userId]);
    await expect(work(client, userId)).rejects.toMatchObject({ code: '23514' });
  } finally {
    await client.query('rollback');
    client.release();
  }
}
