import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';

export async function checkDependencies(pool: Pool, redis: Redis, queue: Queue): Promise<void> {
  await pool.query('select 1');
  await redis.ping();
  await queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
}
