import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateEnvironment } from '../../packages/infrastructure/src/config/environment.js';
import { createDatabase } from '../../packages/infrastructure/src/database/client.js';
import { seedR11CommerceCatalog } from '../../packages/modules/src/catalog/repository-adapter/catalog.seeder.js';

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
    await seedR11CommerceCatalog(infrastructure.database);
    await seedR11CommerceCatalog(infrastructure.database);
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

  it('seeds only the seven R1.1 sellable products and three seed promotions idempotently', async () => {
    const offerings = await pool.query<{ code: string; amount_minor: number }>(
      `select so.code, ov.amount_minor
       from service_offerings so
       join offering_versions ov on ov.id = so.current_version_id
       where so.business_space = 'SATORI' and so.status = 'ACTIVE'
       order by so.code`,
    );
    expect(offerings.rows).toHaveLength(7);
    expect(offerings.rows).toContainEqual({ code: 'daily-insight-newcomer-10', amount_minor: 990 });
    expect(offerings.rows).toContainEqual({ code: 'card-reading-10', amount_minor: 5_990 });
    expect(offerings.rows.map((row) => row.code)).not.toContain('life-light-report');
    const promotions = await pool.query<{ count: string }>(
      `select count(*)::text as count from seed_promotion_rules where status = 'ACTIVE'`,
    );
    expect(promotions.rows[0]?.count).toBe('3');
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
