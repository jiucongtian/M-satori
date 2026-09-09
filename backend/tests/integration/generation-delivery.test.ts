import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  closeQueueInfrastructure, createDatabase, createQueueInfrastructure, FieldCipher,
  outbox, R1_RUNTIME_POLICY, RuntimeInfrastructure, validateEnvironment,
} from '@satori/infrastructure';
import { GenerationTaskService } from '../../packages/modules/src/generation-task/generation-task.service.js';
import { GenerationTaskRunner } from '../../packages/modules/src/generation-task/generation-task.runner.js';
import { GenerationTaskWorker } from '../../packages/modules/src/generation-task/generation-task.worker.js';
import { CommerceTaskWorker } from '../../packages/modules/src/generation-task/commerce-task.worker.js';
import { GenerationTaskNotifications } from '../../packages/modules/src/generation-task/generation-task.notifications.js';
import { GenerationTaskStream } from '../../packages/modules/src/generation-task/generation-task.stream.js';
import { OutboxPublisher } from '../../packages/modules/src/generation-task/outbox.publisher.js';
import { WorkerModule } from '../../apps/worker/src/worker.module.js';

describe.skipIf(process.env.RUN_DATABASE_TESTS !== 'true')('Redis generation delivery and queue isolation', () => {
  let infrastructure: RuntimeInfrastructure;
  let tasks: GenerationTaskService;
  let notifications: GenerationTaskNotifications;
  let stream: GenerationTaskStream;

  beforeAll(async () => {
    const environment = validateEnvironment({
      ...process.env, QUEUE_PREFIX: `delivery-${randomUUID()}`, QUEUE_CONCURRENCY: '5',
      COMMERCE_QUEUE_CONCURRENCY: '1', SMS_DELIVERY_MODE: 'FIXED_CODE',
      AQUA_BASE_URL: 'https://aqua.example.com', AQUA_SERVICE_KEY: 'isolated-delivery-key-0001',
    });
    const db = createDatabase(environment);
    await migrate(db.database, { migrationsFolder: './drizzle' });
    infrastructure = { ...db, ...createQueueInfrastructure(environment, R1_RUNTIME_POLICY), environment, policy: R1_RUNTIME_POLICY } as RuntimeInfrastructure;
    tasks = new GenerationTaskService(infrastructure, new FieldCipher(environment.DATA_ENCRYPTION_KEY));
    notifications = new GenerationTaskNotifications(infrastructure);
    stream = new GenerationTaskStream(tasks, notifications);
  });

  afterAll(async () => {
    notifications?.onModuleDestroy();
    if (infrastructure) {
      await closeQueueInfrastructure(infrastructure.redis, infrastructure.generationQueue, infrastructure.commerceQueue);
      await infrastructure.pool.end();
    }
  });

  it('registers both consumers through the production Worker module', async () => {
    const module = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(RuntimeInfrastructure).useValue(infrastructure).compile();
    try {
      expect(module.get(CommerceTaskWorker)).toBeInstanceOf(CommerceTaskWorker);
      expect(module.get(GenerationTaskWorker)).toBeInstanceOf(GenerationTaskWorker);
    } finally { await module.close(); }
  });

  it('delivers committed progress through real Redis and closes after the terminal event', async () => {
    const userId = randomUUID();
    await infrastructure.pool.query('insert into users(id) values($1)', [userId]);
    const task = await tasks.create({ ownerUserId: userId, targetType: 'DAILY_INSIGHT', targetId: randomUUID() });
    const messages: { type?: string | undefined; id?: string | undefined }[] = [];
    const subscription = stream.events(userId, task.taskId).subscribe((message) => messages.push(message));
    try {
      await vi.waitFor(() => expect(messages[0]?.type).toBe('generation.snapshot'));
      await tasks.claim(task.taskId);
      await vi.waitFor(() => expect(messages.some((message) => message.type === 'generation.stage_changed')).toBe(true), { timeout: 3000 });
      await tasks.succeed(task.taskId);
      await vi.waitFor(() => expect(subscription.closed).toBe(true), { timeout: 3000 });
      expect(messages.at(-1)?.type).toBe('generation.ready');
    } finally { subscription.unsubscribe(); }
  });

  it('resubscribes after a real Redis subscriber disconnect and recovers committed progress', async () => {
    const userId = randomUUID();
    await infrastructure.pool.query('insert into users(id) values($1)', [userId]);
    const task = await tasks.create({ ownerUserId: userId, targetType: 'DAILY_INSIGHT', targetId: randomUUID() });
    const ids: string[] = [];
    const subscription = stream.events(userId, task.taskId).subscribe((message) => { if (message.id) ids.push(message.id); });
    try {
      await vi.waitFor(async () => {
        const clients = String(await infrastructure.redis.client('LIST'));
        expect(clients).toMatch(/flags=P/);
      });
      // This Redis container is created solely for this test run.
      await infrastructure.redis.client('KILL', 'TYPE', 'PUBSUB');
      await tasks.claim(task.taskId);
      const events = await tasks.listEvents(userId, task.taskId);
      await vi.waitFor(() => expect(ids).toContain(events.at(-1)!.id), { timeout: 3000 });
    } finally { subscription.unsubscribe(); }
  });

  it('routes Outbox commerce commands separately and keeps event identity on replay', async () => {
    const publisher = new OutboxPublisher(infrastructure);
    const commerceId = randomUUID(); const generationId = randomUUID();
    await infrastructure.database.insert(outbox).values([
      { id: commerceId, aggregateType: 'ORDER', aggregateId: randomUUID(), eventType: 'commerce.fulfillment.requested', payload: { orderId: randomUUID(), paymentAttemptId: randomUUID() } },
      { id: generationId, aggregateType: 'GENERATION_TASK', aggregateId: randomUUID(), eventType: 'generation.task.requested', payload: { taskId: randomUUID() } },
    ]);
    // PostgreSQL's default available_at has microsecond precision while the
    // publisher cutoff is milliseconds; a just-inserted row may need the next tick.
    await vi.waitFor(async () => {
      await publisher.publishBatch(1000);
      expect(await infrastructure.commerceQueue.getJob(commerceId)).toBeTruthy();
    });
    expect(await infrastructure.generationQueue.getJob(commerceId)).toBeUndefined();
    expect(await infrastructure.generationQueue.getJob(generationId)).toBeTruthy();
    expect(await infrastructure.commerceQueue.getJob(generationId)).toBeUndefined();
    await infrastructure.pool.query('update outbox set published_at=null where id=$1', [commerceId]);
    await publisher.publishBatch(1000);
    expect((await infrastructure.commerceQueue.getJobs(['waiting'])).filter((job) => job.id === commerceId)).toHaveLength(1);
    // Isolated test queues only; remove jobs before the scheduling experiment.
    await infrastructure.generationQueue.drain();
    await infrastructure.commerceQueue.drain();
  });

  it('finishes payment work while all five AI slots are blocked, then forwards a legacy payment job', async () => {
    let unblock!: () => void;
    const blocked = new Promise<void>((resolve) => { unblock = resolve; });
    const runner = new GenerationTaskRunner();
    let started = 0;
    runner.register('BLOCKED', async () => { started += 1; await blocked; });
    const taskPort = {
      claim: vi.fn((id: string) => Promise.resolve({ id, targetType: 'BLOCKED', targetId: id, currentAttempt: 1 })),
      recoverStaleTasks: vi.fn().mockResolvedValue(0), heartbeat: vi.fn().mockResolvedValue(undefined),
      succeed: vi.fn().mockResolvedValue(undefined), failAttempt: vi.fn().mockResolvedValue(undefined),
    };
    const process = vi.fn().mockResolvedValue(undefined);
    const reverseExceptional = vi.fn().mockResolvedValue(undefined);
    const reverseDuplicate = vi.fn().mockResolvedValue(undefined);
    const releaseAfterOrderClosure = vi.fn().mockResolvedValue(undefined);
    const generation = new GenerationTaskWorker(infrastructure, taskPort as unknown as GenerationTaskService, runner, {} as never);
    const commerce = new CommerceTaskWorker(infrastructure, { process }, { reverseExceptional, reverseDuplicate }, { releaseAfterOrderClosure } as never);
    generation.onModuleInit(); commerce.onModuleInit();
    try {
      for (let i = 0; i < 5; i++) await infrastructure.generationQueue.add('generation.task.requested', { taskId: randomUUID() });
      await vi.waitFor(() => expect(started).toBe(5), { timeout: 5000 });
      await infrastructure.commerceQueue.add('commerce.fulfillment.requested', { orderId: 'paid', paymentAttemptId: 'payment' });
      await infrastructure.commerceQueue.add('commerce.payment.reversal.requested', { orderId: 'refund' });
      await infrastructure.commerceQueue.add('commerce.payment.duplicate.detected', { orderId: 'duplicate', paymentAttemptId: 'extra' });
      await infrastructure.commerceQueue.add('commerce.order.seed-release.requested', { orderId: 'closed', reservationId: 'reservation', reason: 'ORDER_EXPIRED', requestId: 'request' });
      await vi.waitFor(() => {
        expect(process).toHaveBeenCalledWith('paid', 'payment');
        expect(reverseExceptional).toHaveBeenCalledWith('refund', 'FULFILLMENT_FAILED');
        expect(reverseDuplicate).toHaveBeenCalledWith('duplicate', 'extra');
        expect(releaseAfterOrderClosure).toHaveBeenCalledWith('reservation', 'closed', 'ORDER_EXPIRED', 'request');
      }, { timeout: 3000 });
      expect(await infrastructure.generationQueue.getActiveCount()).toBe(5);
      expect(taskPort.succeed).not.toHaveBeenCalled();
      const legacyId = randomUUID();
      await infrastructure.generationQueue.add('commerce.fulfillment.requested', { orderId: 'legacy', paymentAttemptId: 'old-payment' }, { jobId: legacyId, attempts: 3 });
      unblock();
      await vi.waitFor(() => expect(process).toHaveBeenCalledWith('legacy', 'old-payment'), { timeout: 5000 });
      expect((await infrastructure.commerceQueue.getJob(legacyId))?.opts.attempts).toBe(3);
    } finally {
      unblock();
      await Promise.all([generation.onApplicationShutdown(), commerce.onApplicationShutdown()]);
    }
  });
});
