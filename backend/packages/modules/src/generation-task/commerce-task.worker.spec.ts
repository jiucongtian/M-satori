import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import type * as BullMQ from 'bullmq';
import type { RuntimeInfrastructure } from '@satori/infrastructure';
import { validateEnvironment } from '@satori/infrastructure';
import { CommerceTaskWorker } from './commerce-task.worker.js';
import { GenerationTaskWorker } from './generation-task.worker.js';

const workers = vi.hoisted(() => new Map<string, { process: (job: Job) => Promise<unknown>; options: { concurrency: number } }>());
vi.mock('bullmq', async (original) => {
  const module = await original<typeof BullMQ>();
  return {
    ...module,
    Worker: class {
      constructor(name: string, process: (job: Job) => Promise<unknown>, options: { concurrency: number }) {
        workers.set(name, { process, options });
      }
      close() { return Promise.resolve(); }
    },
  };
});

function setup() {
  const environment = validateEnvironment({ SMS_DELIVERY_MODE: 'FIXED_CODE', AQUA_BASE_URL: 'https://aqua.example.com', AQUA_SERVICE_KEY: 'isolated-worker-test-key-0001', QUEUE_CONCURRENCY: '1', COMMERCE_QUEUE_CONCURRENCY: '3' });
  const add = vi.fn().mockResolvedValue({});
  const infrastructure = { environment, commerceQueue: { add }, redis: {} } as unknown as RuntimeInfrastructure;
  const fulfillment = { process: vi.fn().mockResolvedValue(undefined) };
  const refunds = { reverseExceptional: vi.fn().mockResolvedValue(undefined), reverseDuplicate: vi.fn().mockResolvedValue(undefined) };
  const seeds = { releaseAfterOrderClosure: vi.fn().mockResolvedValue(undefined) };
  const commerce = new CommerceTaskWorker(infrastructure, fulfillment, refunds, seeds as never);
  const generation = new GenerationTaskWorker(infrastructure, { recoverStaleTasks: vi.fn().mockResolvedValue(0) } as never, {} as never, {} as never);
  commerce.onModuleInit(); generation.onModuleInit();
  return { add, fulfillment, refunds, seeds, commerce, generation };
}

afterEach(() => { vi.useRealTimers(); workers.clear(); });

describe('independent commerce worker', () => {
  it('has independent concurrency and forwards legacy jobs with the original identity and retry budget', async () => {
    vi.useFakeTimers();
    const { add, commerce, generation } = setup();
    expect(workers.get('generation')?.options.concurrency).toBe(1);
    expect(workers.get('commerce')?.options.concurrency).toBe(3);
    const legacy = { name: 'commerce.fulfillment.requested', id: 'event-id', data: { orderId: 'order', paymentAttemptId: 'payment' }, opts: { attempts: 5, backoff: { type: 'exponential', delay: 2000 } }, attemptsMade: 2 } as Job;
    add.mockRejectedValueOnce(new Error('Redis unavailable'));
    await expect(workers.get('generation')!.process(legacy)).rejects.toThrow('Redis unavailable');
    await workers.get('generation')!.process(legacy);
    expect(add).toHaveBeenLastCalledWith(legacy.name, legacy.data, { jobId: 'event-id', attempts: 3, backoff: legacy.opts.backoff });
    await commerce.onApplicationShutdown(); await generation.onApplicationShutdown();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates payment failures for BullMQ retry and rejects unsupported commands', async () => {
    vi.useFakeTimers();
    const { refunds, commerce, generation } = setup();
    const process = workers.get('commerce')!.process;
    refunds.reverseExceptional.mockRejectedValueOnce(new Error('provider timeout'));
    await expect(process({ name: 'commerce.payment.reversal.requested', data: { orderId: 'order' } } as Job)).rejects.toThrow('provider timeout');
    await process({ name: 'commerce.payment.reversal.requested', data: { orderId: 'order' } } as Job);
    expect(refunds.reverseExceptional).toHaveBeenCalledTimes(2);
    await expect(process({ name: 'commerce.fulfillment.requested', data: {} } as Job)).rejects.toThrow('payload is incomplete');
    await expect(process({ name: 'commerce.unknown', data: {} } as Job)).rejects.toThrow('Unsupported');
    await expect(process({ name: 'commerce.fulfillment.succeeded', data: {} } as Job)).resolves.toBeUndefined();
    await commerce.onApplicationShutdown(); await generation.onApplicationShutdown();
  });
});
