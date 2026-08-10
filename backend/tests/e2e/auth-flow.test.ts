import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import {
  generationTasks,
  newId,
  outbox,
  RuntimeInfrastructure,
  revisions,
  seedEntries,
} from '@satori/infrastructure';
import { eq } from 'drizzle-orm';
import { randomInt } from 'node:crypto';
import { firstValueFrom } from 'rxjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiModule } from '../../apps/api/src/api.module.js';
import { configureApi, createFastifyAdapter } from '../../apps/api/src/configure-api.js';
import { validateEnvironment } from '../../packages/infrastructure/src/config/environment.js';
import { SeedLedgerService } from '../../packages/modules/src/seed-ledger/seed-ledger.service.js';
import { GenerationTaskService } from '../../packages/modules/src/generation-task/generation-task.service.js';
import { GenerationTaskController } from '../../packages/modules/src/generation-task/generation-task.controller.js';
import { OutboxPublisher } from '../../packages/modules/src/generation-task/outbox.publisher.js';
import { DailyInsightService } from '../../packages/modules/src/daily-insight/daily-insight.service.js';

const runDatabaseTests = process.env.RUN_DATABASE_TESTS === 'true';

describe.skipIf(!runDatabaseTests)('authentication E2E', () => {
  let app: NestFastifyApplication;
  let accessToken: string;
  const suffix = String(randomInt(10_000_000, 99_999_999));
  const phone = `138${suffix}`;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [ApiModule] }).compile();
    app = module.createNestApplication<NestFastifyApplication>(createFastifyAdapter());
    await configureApi(app, validateEnvironment(process.env));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const infrastructure = app.get(RuntimeInfrastructure);
    const rateLimitKeys = await infrastructure.redis.keys(
      `${infrastructure.environment.QUEUE_PREFIX}:rate:sms:*`,
    );
    if (rateLimitKeys.length > 0) await infrastructure.redis.del(...rateLimitKeys);
  });

  afterAll(async () => app.close());

  it('prevents enumeration and creates one user under concurrent registration', async () => {
    const challengeIds = await Promise.all([
      createChallenge('concurrent-auth-key-01', 'concurrent-device-0001'),
      createChallenge('concurrent-auth-key-02', 'concurrent-device-0002'),
    ]);
    expect(challengeIds[0]).toBeTruthy();
    expect(challengeIds[1]).toBeTruthy();

    const wrong = await createSession(challengeIds[0], '000000', 'concurrent-login-wrong');
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json<{ error: { code: string } }>().error.code).toBe('SMS_CODE_INVALID');

    const [first, second] = await Promise.all([
      createSession(challengeIds[0], '123456', 'concurrent-login-key-01'),
      createSession(challengeIds[1], '123456', 'concurrent-login-key-02'),
    ]);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const firstBody = first.json<{
      data: { accessToken: string; user: { userId: string }; isNewUser: boolean };
    }>().data;
    const secondBody = second.json<{
      data: { accessToken: string; user: { userId: string }; isNewUser: boolean };
    }>().data;
    expect(firstBody.user.userId).toBe(secondBody.user.userId);
    expect([firstBody.isNewUser, secondBody.isNewUser].filter(Boolean)).toHaveLength(1);
    accessToken = secondBody.accessToken;

    const cookie = first.headers['set-cookie'];
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(first.body).not.toContain('refreshToken');
    const cookieHeader = Array.isArray(cookie) ? cookie[0] : cookie;
    const rawCookie = cookieHeader?.split(';')[0];
    const refreshed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sessions/refresh',
      headers: { cookie: rawCookie ?? '' },
    });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.body).not.toContain('refreshToken');
    const reused = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sessions/refresh',
      headers: { cookie: rawCookie ?? '' },
    });
    expect(reused.statusCode).toBe(401);
    expect(reused.json<{ error: { code: string } }>().error.code).toBe('REFRESH_TOKEN_REUSE_DETECTED');
  });

  it('previews, confirms and preserves immutable profile revisions', async () => {
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/me/life-profile/revisions/preview',
      headers: authHeaders('profile-preview-invalid'),
      payload: profilePayload({ year: 1990, month: 2, day: 30, isLeapMonth: false }),
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json<{ error: { code: string } }>().error.code).toBe('BIRTH_DATE_INVALID');

    const preview = await app.inject({
      method: 'POST',
      url: '/api/v1/me/life-profile/revisions/preview',
      headers: authHeaders('profile-preview-valid-01'),
      payload: profilePayload({ year: 1990, month: 5, day: 20, isLeapMonth: false }),
    });
    expect(preview.statusCode).toBe(201);
    const previewBody = preview.json<{
      data: {
        revisionId: string;
        inputFingerprint: string;
        cards: { dimension: string; title: string; order: number }[];
      };
    }>().data;
    expect(previewBody.cards.map((card) => card.dimension)).toEqual([
      'SPACETIME',
      'CAREER',
      'FAMILY',
      'SELF',
    ]);
    expect(previewBody.cards.map((card) => card.title)).toEqual([
      '时空关系',
      '事业关系',
      '家庭关系',
      '自我关系',
    ]);

    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/me/life-profile/revisions/preview',
      headers: authHeaders('profile-preview-valid-01'),
      payload: profilePayload({ year: 1990, month: 5, day: 20, isLeapMonth: false }),
    });
    expect(replay.json<{ data: { revisionId: string } }>().data.revisionId).toBe(previewBody.revisionId);

    const mismatch = await app.inject({
      method: 'POST',
      url: `/api/v1/me/life-profile/revisions/${previewBody.revisionId}/confirm`,
      headers: authHeaders('profile-confirm-wrong-01'),
      payload: { fingerprint: 'sha256:wrong', enhancedConfirmationAccepted: true },
    });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json<{ error: { code: string } }>().error.code).toBe('PROFILE_FINGERPRINT_MISMATCH');

    const confirmed = await app.inject({
      method: 'POST',
      url: `/api/v1/me/life-profile/revisions/${previewBody.revisionId}/confirm`,
      headers: authHeaders('profile-confirm-valid-01'),
      payload: {
        fingerprint: previewBody.inputFingerprint,
        enhancedConfirmationAccepted: true,
      },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json<{ data: { status: string } }>().data.status).toBe('ACTIVE');

    const confirmReplay = await app.inject({
      method: 'POST',
      url: `/api/v1/me/life-profile/revisions/${previewBody.revisionId}/confirm`,
      headers: authHeaders('profile-confirm-valid-01'),
      payload: {
        fingerprint: previewBody.inputFingerprint,
        enhancedConfirmationAccepted: true,
      },
    });
    expect(confirmReplay.statusCode).toBe(200);

    const alreadyConfirmed = await app.inject({
      method: 'POST',
      url: `/api/v1/me/life-profile/revisions/${previewBody.revisionId}/confirm`,
      headers: authHeaders('profile-confirm-valid-02'),
      payload: {
        fingerprint: previewBody.inputFingerprint,
        enhancedConfirmationAccepted: true,
      },
    });
    expect(alreadyConfirmed.statusCode).toBe(409);
    expect(alreadyConfirmed.json<{ error: { code: string } }>().error.code).toBe(
      'PROFILE_REVISION_ALREADY_CONFIRMED',
    );

    const expiringPreview = await app.inject({
      method: 'POST',
      url: '/api/v1/me/life-profile/revisions/preview',
      headers: authHeaders('profile-preview-expired-01'),
      payload: profilePayload({ year: 1991, month: 6, day: 1, isLeapMonth: false }),
    });
    const expiring = expiringPreview.json<{
      data: { revisionId: string; inputFingerprint: string };
    }>().data;
    const infrastructure = app.get(RuntimeInfrastructure);
    await infrastructure.database
      .update(revisions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(revisions.id, expiring.revisionId));
    const expired = await app.inject({
      method: 'POST',
      url: `/api/v1/me/life-profile/revisions/${expiring.revisionId}/confirm`,
      headers: authHeaders('profile-confirm-expired-01'),
      payload: { fingerprint: expiring.inputFingerprint, enhancedConfirmationAccepted: true },
    });
    expect(expired.statusCode).toBe(410);
    expect(expired.json<{ error: { code: string } }>().error.code).toBe('PROFILE_REVISION_EXPIRED');

    const current = await app.inject({
      method: 'GET',
      url: '/api/v1/me/life-profile',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(current.statusCode).toBe(200);
    expect(current.json<{ data: { currentRevisionId: string } }>().data.currentRevisionId).toBe(
      previewBody.revisionId,
    );
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/me/life-profile/revisions?limit=20',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(list.json<{ data: unknown[] }>().data).toHaveLength(2);
  });

  it('claims the registration reward exactly once and settles an immutable seed ledger', async () => {
    const available = await app.inject({
      method: 'GET',
      url: '/api/v1/me/registration-reward',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(available.statusCode).toBe(200);
    expect(available.json<{ data: { status: string; wisdomSeedAmount: number } }>().data).toMatchObject({
      status: 'AVAILABLE',
      wisdomSeedAmount: 3,
    });

    const [firstClaim, concurrentClaim] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/v1/me/registration-reward/claim',
        headers: authHeaders('registration-claim-01'),
        payload: {},
      }),
      app.inject({
        method: 'POST',
        url: '/api/v1/me/registration-reward/claim',
        headers: authHeaders('registration-claim-02'),
        payload: {},
      }),
    ]);
    expect(firstClaim.statusCode).toBe(200);
    expect(concurrentClaim.statusCode).toBe(200);
    const firstData = firstClaim.json<{
      data: { transaction: { transactionId: string }; account: { available: number } };
    }>().data;
    const concurrentData = concurrentClaim.json<{
      data: { transaction: { transactionId: string }; account: { available: number } };
    }>().data;
    expect(concurrentData.transaction.transactionId).toBe(firstData.transaction.transactionId);
    expect(firstData.account.available).toBe(3);

    const userId = decodeJwtSubject(accessToken);
    const ledger = app.get(SeedLedgerService);
    const reservation = await ledger.reserve({
      userId,
      amount: 1,
      businessKey: 'daily:reserve:01',
      businessType: 'DAILY_INSIGHT',
      resourceId: null,
    });
    const reserveReplay = await ledger.reserve({
      userId,
      amount: 1,
      businessKey: 'daily:reserve:01',
      businessType: 'DAILY_INSIGHT',
      resourceId: null,
    });
    expect(reserveReplay.transaction.transactionId).toBe(reservation.transaction.transactionId);
    const consumed = await ledger.consume({
      userId,
      amount: 1,
      businessKey: 'daily:consume:01',
      businessType: 'DAILY_INSIGHT',
      resourceId: null,
      originalEntryId: reservation.transaction.transactionId,
    });
    const consumeReplay = await ledger.consume({
      userId,
      amount: 1,
      businessKey: 'daily:consume:01',
      businessType: 'DAILY_INSIGHT',
      resourceId: null,
      originalEntryId: reservation.transaction.transactionId,
    });
    expect(consumeReplay.transaction.transactionId).toBe(consumed.transaction.transactionId);
    await expect(
      ledger.release({
        userId,
        amount: 1,
        businessKey: 'daily:release:invalid',
        businessType: 'DAILY_INSIGHT',
        resourceId: null,
        originalEntryId: reservation.transaction.transactionId,
      }),
    ).rejects.toMatchObject({ response: { code: 'SEED_RESERVATION_ALREADY_SETTLED' } });
    const refunded = await ledger.refund({
      userId,
      amount: 1,
      businessKey: 'daily:refund:01',
      businessType: 'DAILY_INSIGHT',
      resourceId: null,
      originalEntryId: consumed.transaction.transactionId,
    });
    const refundReplay = await ledger.refund({
      userId,
      amount: 1,
      businessKey: 'daily:refund:01',
      businessType: 'DAILY_INSIGHT',
      resourceId: null,
      originalEntryId: consumed.transaction.transactionId,
    });
    expect(refundReplay.transaction.transactionId).toBe(refunded.transaction.transactionId);

    const competing = await Promise.allSettled([
      ledger.reserve({
        userId,
        amount: 2,
        businessKey: 'daily:reserve:02',
        businessType: 'DAILY_INSIGHT',
        resourceId: null,
      }),
      ledger.reserve({
        userId,
        amount: 2,
        businessKey: 'daily:reserve:03',
        businessType: 'DAILY_INSIGHT',
        resourceId: null,
      }),
    ]);
    expect(competing.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(competing.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const successful = competing.find((result) => result.status === 'fulfilled');
    if (!successful || successful.status !== 'fulfilled') throw new Error('Expected one reservation');
    await ledger.release({
      userId,
      amount: 2,
      businessKey: 'daily:release:02',
      businessType: 'DAILY_INSIGHT',
      resourceId: null,
      originalEntryId: successful.value.transaction.transactionId,
    });
    expect((await ledger.reconcile(userId)).consistent).toBe(true);
    await expect(
      ledger.adjustment({
        userId,
        amount: -4,
        businessKey: 'admin:invalid-negative',
        businessType: 'DAILY_INSIGHT',
        resourceId: null,
      }),
    ).rejects.toMatchObject({ response: { code: 'INSUFFICIENT_WISDOM_SEEDS' } });
    const infrastructure = app.get(RuntimeInfrastructure);
    await expect(
      infrastructure.database
        .update(seedEntries)
        .set({ amount: 99 })
        .where(eq(seedEntries.id, firstData.transaction.transactionId)),
    ).rejects.toThrow('Failed query: update "seed_entries"');

    const account = await app.inject({
      method: 'GET',
      url: '/api/v1/me/wisdom-seed-account',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(
      account.json<{
        data: { available: number; reserved: number; totalEarned: number; totalSpent: number };
      }>().data,
    ).toEqual(expect.objectContaining({ available: 3, reserved: 0, totalEarned: 3, totalSpent: 0 }));
    const transactions = await app.inject({
      method: 'GET',
      url: '/api/v1/me/wisdom-seed-transactions?limit=2',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(transactions.statusCode).toBe(200);
    expect(
      transactions.json<{ data: unknown[]; meta: { hasMore: boolean; nextCursor: string } }>().data,
    ).toHaveLength(2);
    expect(
      transactions.json<{ data: unknown[]; meta: { hasMore: boolean; nextCursor: string } }>().meta.hasMore,
    ).toBe(true);
  });

  it('creates today once, publishes validated content and consumes one seed at most once', async () => {
    const [first, concurrent] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/v1/daily-insights/today',
        headers: authHeaders('daily-today-create-01'),
        payload: {},
      }),
      app.inject({
        method: 'POST',
        url: '/api/v1/daily-insights/today',
        headers: authHeaders('daily-today-create-02'),
        payload: {},
      }),
    ]);
    expect(first.statusCode).toBe(202);
    expect(concurrent.statusCode).toBe(202);
    const firstData = first.json<{
      data: {
        dailyInsight: { dailyInsightId: string; localDate: string; content: unknown };
        task: { taskId: string };
      };
    }>().data;
    const concurrentData = concurrent.json<{ data: { dailyInsight: { dailyInsightId: string } } }>().data;
    expect(concurrentData.dailyInsight.dailyInsightId).toBe(firstData.dailyInsight.dailyInsightId);
    expect(firstData.dailyInsight.content).toBeNull();

    const tasks = app.get(GenerationTaskService);
    const daily = app.get(DailyInsightService);
    await tasks.claim(firstData.task.taskId);
    await daily.generate(firstData.task.taskId, firstData.dailyInsight.dailyInsightId);
    await tasks.succeed(firstData.task.taskId);
    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/daily-insights/today',
      headers: authHeaders('daily-today-replay-01'),
      payload: {},
    });
    expect(replay.statusCode).toBe(200);
    expect(
      replay.json<{ data: { dailyInsight: { status: string; content: { notice: string } }; task: null } }>()
        .data,
    ).toMatchObject({
      dailyInsight: { status: 'READY', content: { notice: '内容用于自我观察与成长参考。' } },
      task: null,
    });
    const byDate = await app.inject({
      method: 'GET',
      url: `/api/v1/daily-insights/${firstData.dailyInsight.localDate}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(byDate.statusCode).toBe(200);
    const history = await app.inject({
      method: 'GET',
      url: '/api/v1/daily-insights?limit=20',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(history.statusCode).toBe(200);
    expect(history.json<{ data: unknown[] }>().data.length).toBeGreaterThanOrEqual(1);
    const home = await app.inject({
      method: 'GET',
      url: '/api/v1/me/home-overview',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(home.statusCode).toBe(200);
    expect(home.json<{ data: { dailyInsight: { state: string }; nextAction: string } }>().data).toMatchObject(
      { dailyInsight: { state: 'READY' }, nextAction: 'VIEW_HOME' },
    );
    const account = await app.get(SeedLedgerService).getAccount(decodeJwtSubject(accessToken));
    expect(account).toMatchObject({ available: 2, reserved: 0, totalSpent: 1 });
  });

  it('returns an existing user directly to the persisted home state', async () => {
    const challengeId = await createChallenge('returning-user-challenge', 'returning-user-device');
    const session = await createSession(challengeId, '123456', 'returning-user-session');
    expect(session.statusCode).toBe(201);
    const data = session.json<{ data: { isNewUser: boolean; accessToken: string } }>().data;
    expect(data.isNewUser).toBe(false);
    const home = await app.inject({
      method: 'GET',
      url: '/api/v1/me/home-overview',
      headers: { authorization: `Bearer ${data.accessToken}` },
    });
    expect(home.statusCode).toBe(200);
    expect(
      home.json<{
        data: { profile: { state: string }; dailyInsight: { state: string }; nextAction: string };
      }>().data,
    ).toMatchObject({
      profile: { state: 'ACTIVE' },
      dailyInsight: { state: 'READY' },
      nextAction: 'VIEW_HOME',
    });
  });

  it('persists generation tasks, publishes outbox once, replays events and enforces retry rules', async () => {
    const userId = decodeJwtSubject(accessToken);
    const tasks = app.get(GenerationTaskService);
    const publisher = app.get(OutboxPublisher);
    const infrastructure = app.get(RuntimeInfrastructure);
    const targetId = newId();
    const created = await tasks.create({
      ownerUserId: userId,
      targetType: 'DAILY_INSIGHT',
      targetId,
      maxAttempts: 3,
    });

    const taskResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/generation-tasks/${created.taskId}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(taskResponse.statusCode).toBe(200);
    expect(taskResponse.json<{ data: { status: string; target: { id: string } } }>().data).toMatchObject({
      status: 'PENDING',
      target: { id: targetId },
    });
    await expect(tasks.getOwned(newId(), created.taskId)).rejects.toMatchObject({
      response: { code: 'GENERATION_TASK_NOT_FOUND' },
    });

    await publisher.publishBatch();
    await publisher.publishBatch();
    const [publishedEvent] = await infrastructure.database
      .select()
      .from(outbox)
      .where(eq(outbox.aggregateId, created.taskId))
      .limit(1);
    expect(publishedEvent?.publishedAt).toBeInstanceOf(Date);
    expect(await infrastructure.generationQueue.getJob(publishedEvent!.id)).toBeTruthy();

    const unavailable = await tasks.create({
      ownerUserId: userId,
      targetType: 'DAILY_INSIGHT',
      targetId: newId(),
    });
    const isolatedPublisher = new OutboxPublisher(infrastructure);
    const queue = infrastructure.generationQueue as unknown as {
      add: RuntimeInfrastructure['generationQueue']['add'];
    };
    const originalAdd = queue.add;
    queue.add = (() => Promise.reject(new Error('Redis unavailable'))) as typeof queue.add;
    try {
      await isolatedPublisher.publishBatch();
    } finally {
      queue.add = originalAdd;
    }
    const [unpublished] = await infrastructure.database
      .select()
      .from(outbox)
      .where(eq(outbox.aggregateId, unavailable.taskId))
      .limit(1);
    expect(unpublished).toMatchObject({ publishedAt: null, attempts: 1 });
    await isolatedPublisher.republishUnconfirmed(unavailable.taskId);
    const [republished] = await infrastructure.database
      .select()
      .from(outbox)
      .where(eq(outbox.id, unpublished!.id))
      .limit(1);
    expect(republished?.publishedAt).toBeInstanceOf(Date);

    await tasks.claim(created.taskId);
    await tasks.heartbeat(created.taskId, 'GENERATING_CONTENT');
    const allEvents = await tasks.listEvents(userId, created.taskId);
    expect(allEvents.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(['generation.snapshot', 'generation.stage_changed']),
    );
    const replayed = await tasks.listEvents(userId, created.taskId, allEvents[0]!.id);
    expect(replayed.every((event) => event.sequence > allEvents[0]!.sequence)).toBe(true);

    await tasks.failAttempt(
      created.taskId,
      { code: 'AQUA_TEMPORARY', message: 'Temporary failure', retryable: true },
      true,
    );
    const retried = await app.inject({
      method: 'POST',
      url: `/api/v1/generation-tasks/${created.taskId}/retry`,
      headers: authHeaders('generation-retry-01'),
      payload: {},
    });
    expect(retried.statusCode).toBe(202);
    const retryReplay = await app.inject({
      method: 'POST',
      url: `/api/v1/generation-tasks/${created.taskId}/retry`,
      headers: authHeaders('generation-retry-01'),
      payload: {},
    });
    expect(retryReplay.statusCode).toBe(202);
    expect(retryReplay.json<{ data: { taskId: string } }>().data.taskId).toBe(created.taskId);

    const limited = await tasks.create({
      ownerUserId: userId,
      targetType: 'DAILY_INSIGHT',
      targetId: newId(),
      maxAttempts: 1,
    });
    await tasks.claim(limited.taskId);
    await tasks.failAttempt(
      limited.taskId,
      { code: 'AQUA_TEMPORARY', message: 'Temporary failure', retryable: true },
      true,
    );
    const limitResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/generation-tasks/${limited.taskId}/retry`,
      headers: authHeaders('generation-retry-limit'),
      payload: {},
    });
    expect(limitResponse.statusCode).toBe(409);
    expect(limitResponse.json<{ error: { code: string } }>().error.code).toBe(
      'GENERATION_RETRY_LIMIT_REACHED',
    );

    const stale = await tasks.create({ ownerUserId: userId, targetType: 'DAILY_INSIGHT', targetId: newId() });
    await tasks.claim(stale.taskId);
    await infrastructure.database
      .update(generationTasks)
      .set({ heartbeatAt: new Date(0) })
      .where(eq(generationTasks.id, stale.taskId));
    expect(await tasks.recoverStaleTasks()).toBeGreaterThanOrEqual(1);
    expect((await tasks.getOwned(userId, stale.taskId)).stage).toBe('RETRY_WAITING');

    const terminal = await tasks.create({
      ownerUserId: userId,
      targetType: 'DAILY_INSIGHT',
      targetId: newId(),
    });
    await tasks.claim(terminal.taskId);
    await tasks.succeed(terminal.taskId);
    // Fastify inject does not expose a real socket (Nest SSE calls setKeepAlive), so verify the
    // authenticated stream source directly while the route itself remains covered by compilation.
    const stream = app
      .get(GenerationTaskController)
      .events({ auth: { userId, sessionId: 'e2e' } } as never, terminal.taskId, undefined);
    const snapshot = await firstValueFrom(stream);
    expect(snapshot.type).toBe('generation.snapshot');
  });

  it('enforces credentialed CORS without a wildcard', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/me',
      headers: {
        origin: 'http://localhost:3001',
        'access-control-request-method': 'GET',
      },
    });
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3001');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  async function createChallenge(idempotencyKey: string, deviceId: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sms-challenges',
      headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      payload: {
        phone: { countryCode: '+86', nationalNumber: phone },
        purpose: 'LOGIN',
        device: { deviceId, timezone: 'Asia/Shanghai' },
      },
    });
    expect(response.statusCode).toBe(202);
    const body = response.json<{
      data: {
        challengeId: string;
        expiresAt: string;
        resendAvailableAt: string;
        phoneMasked: string;
      };
    }>().data;
    expect(Object.keys(body).sort()).toEqual(
      ['challengeId', 'expiresAt', 'phoneMasked', 'resendAvailableAt'].sort(),
    );
    return body.challengeId;
  }

  function createSession(challengeId: string, code: string, idempotencyKey: string) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/auth/sessions',
      headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      payload: {
        challengeId,
        verificationCode: code,
        consentAcceptances: [
          { documentId: 'legal_privacy_20260809', version: '1.0' },
          { documentId: 'legal_terms_20260809', version: '1.0' },
          { documentId: 'legal_ai_notice_20260809', version: '1.0' },
        ],
        device: { deviceId: 'concurrent-device-final', timezone: 'Asia/Shanghai' },
      },
    });
  }

  function authHeaders(idempotencyKey: string) {
    return {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    };
  }

  function decodeJwtSubject(token: string): string {
    const payload = token.split('.')[1];
    if (!payload) throw new Error('Invalid JWT');
    return (JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sub: string }).sub;
  }

  function profilePayload(date: { year: number; month: number; day: number; isLeapMonth: boolean }) {
    return {
      birthInput: {
        calendarType: 'SOLAR',
        date,
        timePrecision: 'EXACT_MINUTE',
        time: { localTime: '13:25', hourBranchCode: null },
        locationId: 'loc_cn_330100',
        calculationGender: 'MALE',
      },
    };
  }
});
