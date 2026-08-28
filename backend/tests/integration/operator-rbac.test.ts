import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateEnvironment } from '../../packages/infrastructure/src/config/environment.js';
import { createDatabase } from '../../packages/infrastructure/src/database/client.js';
import { OperatorRoleGuard } from '../../packages/modules/src/operations/commerce/operator-role.guard.js';

const runDatabaseTests = process.env.RUN_DATABASE_TESTS === 'true';

describe.skipIf(!runDatabaseTests)('commerce operator RBAC', () => {
  let pool: Pool;
  let guard: OperatorRoleGuard;
  const operatorId = randomUUID();
  const ordinaryUserId = randomUUID();

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
    await pool.query('insert into users(id) values($1),($2)', [operatorId, ordinaryUserId]);
    await pool.query("insert into operator_roles(id,user_id,role) values($1,$2,'SUPPORT')", [
      randomUUID(),
      operatorId,
    ]);
    guard = new OperatorRoleGuard(infrastructure as never);
  });

  afterAll(async () => {
    await pool.query('delete from operator_roles where user_id in ($1,$2)', [operatorId, ordinaryUserId]);
    await pool.query('delete from users where id in ($1,$2)', [operatorId, ordinaryUserId]);
    await pool.end();
  });

  it('rejects ordinary users and allows an active operator role', async () => {
    await expect(guard.canActivate(context(ordinaryUserId))).rejects.toMatchObject({ status: 403 });
    await expect(guard.canActivate(context(operatorId))).resolves.toBe(true);
    await pool.query('update operator_roles set revoked_at=now() where user_id=$1', [operatorId]);
    await expect(guard.canActivate(context(operatorId))).rejects.toMatchObject({ status: 403 });
  });
});

function context(userId: string) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ auth: { userId, sessionId: randomUUID() } }) }),
  } as never;
}
