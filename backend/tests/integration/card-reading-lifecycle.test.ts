import { randomUUID } from 'node:crypto';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { SystemClock } from '@satori/application';
import { FieldCipher, R1_RUNTIME_POLICY, type RuntimeInfrastructure } from '@satori/infrastructure';
import { validateEnvironment } from '../../packages/infrastructure/src/config/environment.js';
import { createDatabase } from '../../packages/infrastructure/src/database/client.js';
import { createQueueInfrastructure, closeQueueInfrastructure } from '../../packages/infrastructure/src/queue/client.js';
import { GenerationTaskWorker } from '../../packages/modules/src/generation-task/generation-task.worker.js';
import { CardReadingService } from '../../packages/modules/src/card-reading/card-reading.service.js';
import { GenerationTaskService } from '../../packages/modules/src/generation-task/generation-task.service.js';
import { GenerationTaskRunner } from '../../packages/modules/src/generation-task/generation-task.runner.js';
import { ConsumptionApplicationService } from '../../packages/modules/src/consumption/application/index.js';
import { PostgresConsumptionRepository } from '../../packages/modules/src/consumption/repository-adapter/index.js';
import { PostgresBusinessOutcomeQuery } from '../../packages/modules/src/consumption/repository-adapter/business-outcome.js';
import { EntitlementApplicationService } from '../../packages/modules/src/entitlement/application/index.js';
import { PostgresEntitlementRepository } from '../../packages/modules/src/entitlement/repository-adapter/index.js';
import { ComplimentarySeedApplicationService } from '../../packages/modules/src/complimentary-seed/application/index.js';
import { PostgresComplimentarySeedRepository } from '../../packages/modules/src/complimentary-seed/repository-adapter/index.js';
import type { CardReadingWorkflowService } from '../../packages/modules/src/integrations/card-reading/card-reading-workflow.service.js';

describe.skipIf(process.env.RUN_DATABASE_TESTS !== 'true')('persistent reading lifecycle', () => {
  let infrastructure: RuntimeInfrastructure;
  let consumption: ConsumptionApplicationService;
  let readings: CardReadingService;
  let tasks: GenerationTaskService;
  let runner: GenerationTaskRunner;
  let grants: PostgresEntitlementRepository;
  const execute = vi.fn(() => Promise.resolve({ result: { audience: 'C', cards: [1], missing_fields: [], mode: 'single', notice: '参考', question_type: 'career', report: '数据库生命周期测试报告', status: 'complete', title: '新的方向' }, requestId: 'test', manifest: {} }));

  beforeAll(async () => {
    const environment = validateEnvironment({ ...process.env, QUEUE_PREFIX: `r11-test-${randomUUID()}`, SMS_DELIVERY_MODE: 'FIXED_CODE', AQUA_BASE_URL: 'https://aqua.example.com', AQUA_SERVICE_KEY: 'isolated-integration-key-0001' });
    const db = createDatabase(environment);
    await migrate(db.database, { migrationsFolder: './drizzle' });
    infrastructure = { ...db, ...createQueueInfrastructure(environment, R1_RUNTIME_POLICY), environment, policy: R1_RUNTIME_POLICY } as RuntimeInfrastructure;
    const clock = new SystemClock();
    grants = new PostgresEntitlementRepository(infrastructure);
    const entitlements = new EntitlementApplicationService(grants, 'integration-cursor-secret', clock);
    const seeds = new ComplimentarySeedApplicationService(new PostgresComplimentarySeedRepository(infrastructure));
    consumption = new ConsumptionApplicationService(entitlements, seeds, new PostgresConsumptionRepository(infrastructure), clock, new PostgresBusinessOutcomeQuery(infrastructure));
    tasks = new GenerationTaskService(infrastructure, new FieldCipher(environment.DATA_ENCRYPTION_KEY));
    runner = new GenerationTaskRunner();
    readings = new CardReadingService(infrastructure, { execute } as unknown as CardReadingWorkflowService, consumption, tasks, runner);
    readings.onModuleInit();
  });
  afterAll(async () => { if (infrastructure) { await closeQueueInfrastructure(infrastructure.redis, infrastructure.generationQueue); await infrastructure.pool.end(); } });

  async function user(quantity = 5) {
    const ownerUserId = randomUUID();
    await infrastructure.pool.query('insert into users(id) values($1)', [ownerUserId]);
    if (quantity) await grants.grant({ ownerUserId, businessSpace: 'SATORI', serviceType: 'CARD_READING', unit: 'READING_CREDIT', quantity, sourceType: 'PURCHASE', sourceId: randomUUID(), effectiveAt: new Date(Date.now() - 1000), expiresAt: new Date(Date.now() + 86400000), ruleVersion: 'test', requestId: randomUUID() }, randomUUID());
    return { ownerUserId, question: '如何面对新的工作变化？', category: '事业', cardCount: 1, positionLabels: ['自己'] };
  }
  async function taskFor(readingId: string, attempt = 1) {
    const result = await infrastructure.pool.query<{ id: string }>('select t.id from generation_tasks t join consumption_intents c on c.id=t.target_id where t.target_type=$1 and c.business_context_id=$2', ['CARD_READING', `${readingId}:${attempt}`]);
    return result.rows[0]!.id;
  }
  async function intentStatus(readingId: string) {
    const result = await infrastructure.pool.query<{ status: string }>('select c.status from consumption_intents c join card_readings r on r.consumption_intent_id=c.id where r.id=$1', [readingId]);
    return result.rows[0]!.status;
  }

  it('blocks a real zero-benefit user without inserting a draw', async () => {
    const command = await user(0);
    await expect(readings.createDraw(command, randomUUID())).rejects.toThrow();
    const result = await infrastructure.pool.query('select id from card_readings where owner_user_id=$1', [command.ownerUserId]);
    expect(result.rowCount).toBe(0);
  });

  it('serializes duplicate draw and completion requests into one reservation and one durable job', async () => {
    const command = await user();
    const key = randomUUID();
    const [a, b] = await Promise.all([readings.createDraw(command, key), readings.createDraw(command, key)]);
    expect(a.readingId).toBe(b.readingId);
    expect(a.cards).toEqual(b.cards);
    expect(await intentStatus(a.readingId)).toBe('RESERVED');
    const calls = execute.mock.calls.length;
    await Promise.all([readings.complete(command.ownerUserId, a.readingId), readings.complete(command.ownerUserId, a.readingId)]);
    expect(execute.mock.calls.length).toBe(calls);
    const taskId = await taskFor(a.readingId);
    const events = await infrastructure.pool.query('select id from outbox where aggregate_id=$1', [taskId]);
    expect(events.rowCount).toBe(1);
    const claimed = await tasks.claim(taskId);
    expect(claimed).not.toBeNull();
    await runner.run(claimed!);
    await tasks.succeed(taskId, claimed!.currentAttempt);
    expect((await readings.get(command.ownerUserId, a.readingId)).status).toBe('READY');
    const [feedbackA, feedbackB] = await Promise.all([readings.saveFeedback(command.ownerUserId, a.readingId, 'CLEARER'), readings.saveFeedback(command.ownerUserId, a.readingId, 'CLEARER')]);
    expect(feedbackA.feedbackId).toBe(feedbackB.feedbackId);
    await expect(readings.saveFeedback(randomUUID(), a.readingId, 'NOT_HELPFUL')).rejects.toThrow();
    expect(await intentStatus(a.readingId)).toBe('COMMITTED');
    await runner.run(claimed!);
    expect(execute.mock.calls.length).toBe(calls + 1);
    await expect(readings.get(randomUUID(), a.readingId)).rejects.toThrow();
  });

  it('releases final failure and retries with the frozen cards and a new reservation', async () => {
    const command = await user();
    const draw = await readings.createDraw(command, randomUUID());
    await expect(readings.saveFeedback(command.ownerUserId, draw.readingId, 'CLEARER')).rejects.toThrow();
    await readings.complete(command.ownerUserId, draw.readingId);
    const taskId = await taskFor(draw.readingId);
    const claimed = await tasks.claim(taskId);
    await tasks.failAttempt(taskId, { code: 'TEST_FAILURE', message: 'failed', retryable: true }, true, claimed!.currentAttempt);
    await readings.finalFailure(taskId, claimed!.targetId);
    expect(await intentStatus(draw.readingId)).toBe('RELEASED');
    const [retry] = await Promise.all([readings.retry(command.ownerUserId, draw.readingId), readings.retry(command.ownerUserId, draw.readingId)]);
    expect(retry.cards).toEqual(draw.cards);
    expect(await intentStatus(draw.readingId)).toBe('RUNNING');
    const newTask = await tasks.claim(await taskFor(draw.readingId, 2));
    await runner.run(newTask!);
    expect(await intentStatus(draw.readingId)).toBe('COMMITTED');
  });

  it('requeues a stale job and rejects the old attempt completion', async () => {
    const command = await user();
    const draw = await readings.createDraw(command, randomUUID());
    await readings.complete(command.ownerUserId, draw.readingId);
    const taskId = await taskFor(draw.readingId);
    const old = await tasks.claim(taskId);
    await infrastructure.pool.query("update generation_tasks set heartbeat_at=now()-interval '1 hour' where id=$1", [taskId]);
    await tasks.recoverStaleTasks();
    const events = await infrastructure.pool.query('select id from outbox where aggregate_id=$1', [taskId]);
    expect(events.rowCount).toBe(2);
    const next = await tasks.claim(taskId);
    expect(next!.currentAttempt).toBe(old!.currentAttempt + 1);
    expect(await tasks.succeed(taskId, old!.currentAttempt)).toBeNull();
    await runner.run(next!);
    expect((await readings.get(command.ownerUserId, draw.readingId)).status).toBe('READY');
  });

  it('uses saved content after a settlement crash without calling the provider again', async () => {
    const command = await user();
    const draw = await readings.createDraw(command, randomUUID());
    await readings.complete(command.ownerUserId, draw.readingId);
    const taskId = await taskFor(draw.readingId);
    const task = await tasks.claim(taskId);
    const spy = vi.spyOn(consumption, 'commit').mockRejectedValueOnce(new Error('temporary settlement failure'));
    await expect(runner.run(task!)).rejects.toThrow('temporary settlement failure');
    spy.mockRestore();
    const calls = execute.mock.calls.length;
    await consumption.reconcile();
    const restarted = new CardReadingService(infrastructure, { execute } as unknown as CardReadingWorkflowService, consumption, tasks, new GenerationTaskRunner());
    await restarted.generate(taskId, task!.targetId);
    expect(execute.mock.calls.length).toBe(calls);
    expect(await intentStatus(draw.readingId)).toBe('COMMITTED');
    expect((await readings.get(command.ownerUserId, draw.readingId)).status).toBe('READY');
  });

  it('executes a persisted reading through real Redis and the actual generation worker', async () => {
    const command = await user();
    const draw = await readings.createDraw(command, randomUUID());
    await readings.complete(command.ownerUserId, draw.readingId);
    const taskId = await taskFor(draw.readingId);
    const worker = new GenerationTaskWorker(infrastructure, tasks, runner, {} as never, {} as never, {} as never, {} as never);
    worker.onModuleInit();
    try {
      await infrastructure.generationQueue.add('generation.task.requested', { taskId });
      await vi.waitFor(async () => {
        expect((await tasks.getOwned(command.ownerUserId, taskId)).status).toBe('READY');
      }, { timeout: 10000, interval: 100 });
      expect(await intentStatus(draw.readingId)).toBe('COMMITTED');
    } finally { await worker.onApplicationShutdown(); }
  });
});
