import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient } from 'pg';
import type { Environment } from '../config/environment.js';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

export function createDatabase(environment: Environment): { pool: Pool; database: Database } {
  const pool = new Pool({ connectionString: environment.DATABASE_URL, max: environment.DATABASE_POOL_MAX });
  return { pool, database: drizzle(pool, { schema }) };
}

export async function inTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
