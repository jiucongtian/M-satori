import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { Environment } from '../config/environment.js';

export const GENERATION_QUEUE = 'generation';

export interface QueueExecutionPolicy {
  concurrency: number;
  jobTimeoutMs: number;
}

export function queueExecutionPolicy(environment: Environment): QueueExecutionPolicy {
  return { concurrency: environment.QUEUE_CONCURRENCY, jobTimeoutMs: environment.QUEUE_JOB_TIMEOUT_MS };
}

export function createQueueInfrastructure(environment: Environment): {
  redis: Redis;
  generationQueue: Queue;
} {
  const redis = new Redis(environment.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true });
  const generationQueue = new Queue(GENERATION_QUEUE, {
    connection: redis,
    prefix: environment.QUEUE_PREFIX,
    defaultJobOptions: {
      attempts: environment.QUEUE_MAX_ATTEMPTS,
      backoff: { type: 'exponential', delay: environment.QUEUE_BACKOFF_MS },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  });
  return { redis, generationQueue };
}

export async function closeQueueInfrastructure(redis: Redis, queue: Queue): Promise<void> {
  await queue.close();
  await redis.quit();
}
