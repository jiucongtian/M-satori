import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { PROFILE_FIRST_LOOK_GENERATOR } from '@satori/application';
import {
  dailyInsights,
  deletionRequests,
  generationTasks,
  newId,
  outbox,
  RuntimeInfrastructure,
  revisions,
  seedEntries,
  sessions,
  subjects,
  users,
} from '@satori/infrastructure';
import { and, eq } from 'drizzle-orm';
import { randomInt } from 'node:crypto';
import { firstValueFrom } from 'rxjs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiModule } from '../../apps/api/src/api.module.js';
import { configureApi, createFastifyAdapter } from '../../apps/api/src/configure-api.js';
import { validateEnvironment } from '../../packages/infrastructure/src/config/environment.js';
import { SeedLedgerService } from '../../packages/modules/src/seed-ledger/seed-ledger.service.js';
import { GenerationTaskService } from '../../packages/modules/src/generation-task/generation-task.service.js';
import { GenerationTaskController } from '../../packages/modules/src/generation-task/generation-task.controller.js';
import { OutboxPublisher } from '../../packages/modules/src/generation-task/outbox.publisher.js';
import { DailyInsightService } from '../../packages/modules/src/daily-insight/daily-insight.service.js';
import { AccountDeletionService } from '../../packages/modules/src/feedback/account-deletion.service.js';

const runDatabaseTests = process.env.RUN_DATABASE_TESTS === 'true';
const generateProfileFirstLook = vi.fn((input: {
  cards: Record<'year' | 'month' | 'day' | 'hour', string>;
}) => ({
  content: {
    schemaVersion: '1.0.0' as const,
    status: 'complete' as const,
    profileSummary: {
      title: '真实初识测试标题',
      description: '基于四张卡牌生成并持久化的初识测试摘要。',
      keywords: ['真实接口', '四卡初识'],
      outerTrait: '外在测试特质',
      innerTrait: '内在测试特质',
    },
    cards: [
      firstLookCard('hour', '思想', input.cards.hour),
      firstLookCard('day', '行为', input.cards.day),
      firstLookCard('month', '事业', input.cards.month),
      firstLookCard('year', '梦想目标', input.cards.year),
    ],
    knowledgeRelease: 'e2e',
    notice: '这是一份基础认识，不是对你人生的定论。' as const,
  },
  manifest: {
    workflowVersion: 'profile-four-card-first-look/1.0.7' as const,
    skillVersion: '1.0.0-aqua.3' as const,
    model: 'e2e-generator',
    promptVersion: 'e2e-prompt',
    outputSchemaVersion: 'e2e-schema',
    contentPolicyVersion: 'e2e-policy',
  },
  providerRequestId: 'e2e-aqua-request',
  providerExecutionId: null,
  durationMs: 42,
}));

describe.skipIf(!runDatabaseTests)('authentication E2E', () => {
  let app: NestFastifyApplication;
  let accessToken: string;
  let secondaryAccessToken: string;
  let refreshCookie: string;
  const suffix = String(randomInt(10_000_000, 99_999_999));
  const phone = `138${suffix}`;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [ApiModule] })
      .overrideProvider(PROFILE_FIRST_LOOK_GENERATOR)
      .useValue({ generate: generateProfileFirstLook })
      .compile();
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
    const secondCookie = second.headers['set-cookie'];
    refreshCookie = (Array.isArray(secondCookie) ? secondCookie[0] : secondCookie)?.split(';')[0] ?? '';

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
        cards: { dimension: string; title: string; order: number; cardId: number; cardCode: string; ganzhi: string; assetUrl: string; deckCode: string }[];
      };
    }>().data;
    expect(previewBody.cards.map((card) => card.dimension)).toEqual([
      'SPACETIME',
      'CAREER',
      'FAMILY',
      'SELF',
    ]);
    expect(previewBody.cards.map((card) => card.title)).toEqual([
      '时空关系卡牌',
      '事业关系卡牌',
      '家庭关系卡牌',
      '自我关系卡牌',
    ]);
    expect(previewBody.cards.map((card) => card.ganzhi)).toEqual(['庚午', '辛巳', '乙酉', '壬午']);
    expect(previewBody.cards.every((card) => card.cardId >= 1 && card.cardId <= 60)).toBe(true);
    expect(previewBody.cards.every((card) => card.deckCode === 'satori-default-v1')).toBe(true);
    expect(previewBody.cards.every((card) => card.assetUrl.startsWith('/cards/satori-default-v1/'))).toBe(true);

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

    const firstLook = await app.inject({
      method: 'POST',
      url: `/api/v1/me/life-profile/revisions/${previewBody.revisionId}/first-look`,
      headers: authHeaders('profile-first-look-generate-01'),
    });
    expect(firstLook.statusCode).toBe(200);
    const firstLookBody = firstLook.json<{
      data: {
        reportId: string;
        status: string;
        content: { schemaVersion: string; cards: { position: string; dimension: string }[]; notice: string };
        manifest: { workflowVersion: string; skillVersion: string };
      };
    }>().data;
    expect(firstLookBody.status).toBe('READY');
    expect(firstLookBody.content.schemaVersion).toBe('1.0.0');
    expect(firstLookBody.content.cards.map((card) => card.position)).toEqual([
      'hour',
      'day',
      'month',
      'year',
    ]);
    expect(firstLookBody.content.cards.map((card) => card.dimension)).toEqual([
      '思想',
      '行为',
      '事业',
      '梦想目标',
    ]);
    expect(firstLookBody.content.notice).toBe('这是一份基础认识，不是对你人生的定论。');
    expect(firstLookBody.manifest).toMatchObject({
      workflowVersion: 'profile-four-card-first-look/1.0.7',
      skillVersion: '1.0.0-aqua.3',
    });
    expect(generateProfileFirstLook).toHaveBeenCalledOnce();
    expect(generateProfileFirstLook).toHaveBeenCalledWith(
      expect.objectContaining({
        cards: { year: '庚午', month: '辛巳', day: '乙酉', hour: '壬午' },
      }),
    );

    const persistedFirstLook = await app.inject({
      method: 'GET',
      url: `/api/v1/me/life-profile/revisions/${previewBody.revisionId}/first-look`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(persistedFirstLook.statusCode).toBe(200);
    expect(persistedFirstLook.json<{ data: { reportId: string } }>().data.reportId).toBe(
      firstLookBody.reportId,
    );

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
    const renamed = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/life-profile',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { displayName: 'Fred' },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json<{ data: { displayName: string } }>().data.displayName).toBe('Fred');
    const home = await app.inject({
      method: 'GET',
      url: '/api/v1/me/home-overview',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(home.statusCode).toBe(200);
    expect(home.json<{ data: { profile: { displayName: string } } }>().data.profile.displayName).toBe(
      'Fred',
    );
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/me/life-profile/revisions?limit=20',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(list.json<{ data: unknown[] }>().data).toHaveLength(2);
  });

  it('isolates, groups, versions and safely deletes OTHER profiles', async () => {
    const groupResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/me/life-profile-groups',
      headers: authHeaders('profile-group-create-01'),
      payload: { name: '家人', sortOrder: 10 },
    });
    expect(groupResponse.statusCode).toBe(201);
    const groupId = groupResponse.json<{ data: { groupId: string } }>().data.groupId;

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/me/life-profiles',
      headers: authHeaders('other-profile-create-01'),
      payload: { displayName: '家人甲', relationshipType: 'FAMILY', groupId },
    });
    expect(created.statusCode).toBe(201);
    const profile = created.json<{
      data: { profileId: string; subjectId: string; subjectType: string; state: string };
    }>().data;
    expect(profile).toMatchObject({ subjectType: 'OTHER', state: 'NOT_CREATED' });

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/me/life-profiles?limit=20',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<{ data: { subjectType: string }[] }>().data.map((item) => item.subjectType)).toEqual(
      expect.arrayContaining(['SELF', 'OTHER']),
    );
    const firstPage = await app.inject({
      method: 'GET',
      url: '/api/v1/me/life-profiles?limit=1',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const firstPageData = firstPage.json<{
      data: unknown[];
      meta: { hasMore: boolean; nextCursor: string | null };
    }>();
    expect(firstPageData.data).toHaveLength(1);
    expect(firstPageData.meta).toMatchObject({ hasMore: true });
    expect(firstPageData.meta.nextCursor).toBeTruthy();

    const groupList = await app.inject({
      method: 'GET',
      url: '/api/v1/me/life-profile-groups',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(groupList.json<{ data: { groupId: string; profileCount: number }[] }>().data).toContainEqual(
      expect.objectContaining({ groupId, profileCount: 1 }),
    );
    const renamedGroup = await app.inject({
      method: 'PATCH',
      url: `/api/v1/me/life-profile-groups/${groupId}`,
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      payload: { name: '重要关系', sortOrder: 1 },
    });
    expect(renamedGroup.json<{ data: { name: string; sortOrder: number } }>().data).toMatchObject({
      name: '重要关系',
      sortOrder: 1,
    });

    const preview = await app.inject({
      method: 'POST',
      url: `/api/v1/me/life-profiles/${profile.profileId}/revisions/preview`,
      headers: authHeaders('other-profile-preview-01'),
      payload: profilePayload({ year: 1988, month: 8, day: 8, isLeapMonth: false }),
    });
    expect(preview.statusCode).toBe(201);
    const revision = preview.json<{
      data: { revisionId: string; inputFingerprint: string; cards: unknown[] };
    }>().data;
    expect(revision.cards).toHaveLength(4);
    const confirmed = await app.inject({
      method: 'POST',
      url: `/api/v1/me/life-profiles/${profile.profileId}/revisions/${revision.revisionId}/confirm`,
      headers: authHeaders('other-profile-confirm-01'),
      payload: { fingerprint: revision.inputFingerprint, enhancedConfirmationAccepted: true },
    });
    expect(confirmed.statusCode).toBe(200);
    const revisionList = await app.inject({
      method: 'GET',
      url: `/api/v1/me/life-profiles/${profile.profileId}/revisions`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(revisionList.json<{ data: { revisionId: string }[] }>().data).toContainEqual(
      expect.objectContaining({ revisionId: revision.revisionId }),
    );

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/me/life-profiles/${profile.profileId}`,
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      payload: { displayName: '家人乙', relationshipType: 'FRIEND', groupId: null },
    });
    expect(
      patched.json<{ data: { displayName: string; relationshipType: string; groupId: null } }>().data,
    ).toMatchObject({ displayName: '家人乙', relationshipType: 'FRIEND', groupId: null });
    const regrouped = await app.inject({
      method: 'PATCH',
      url: `/api/v1/me/life-profiles/${profile.profileId}`,
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      payload: { groupId },
    });
    expect(regrouped.json<{ data: { groupId: string } }>().data.groupId).toBe(groupId);

    const infrastructure = app.get(RuntimeInfrastructure);
    const userId = decodeJwtSubject(accessToken);
    const selfSubjects = await infrastructure.database
      .select({ id: subjects.id })
      .from(subjects)
      .where(and(eq(subjects.ownerUserId, userId), eq(subjects.type, 'SELF')));
    expect(selfSubjects).toHaveLength(1);
    await expect(
      infrastructure.database.insert(subjects).values({
        id: newId(),
        ownerUserId: userId,
        type: 'SELF',
        displayNameCiphertext: 'duplicate-self-must-fail',
      }),
    ).rejects.toThrow('Failed query');
    expect(
      await infrastructure.database
        .select({ id: subjects.id })
        .from(subjects)
        .where(and(eq(subjects.ownerUserId, userId), eq(subjects.type, 'SELF'))),
    ).toHaveLength(1);

    const otherPhone = `139${String(randomInt(10_000_000, 99_999_999))}`;
    const otherChallenge = await createChallenge(
      'cross-owner-challenge-01',
      'cross-owner-device-01',
      otherPhone,
    );
    const otherSession = await createSession(otherChallenge, '123456', 'cross-owner-session-01');
    const otherToken = otherSession.json<{ data: { accessToken: string } }>().data.accessToken;
    secondaryAccessToken = otherToken;
    const crossOwner = await app.inject({
      method: 'GET',
      url: `/api/v1/me/life-profiles/${profile.profileId}`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(crossOwner.statusCode).toBe(404);
    expect(crossOwner.json<{ error: { code: string } }>().error.code).toBe('LIFE_PROFILE_NOT_FOUND');

    const [historicalInsight] = await infrastructure.database
      .insert(dailyInsights)
      .values({
        id: newId(),
        ownerUserId: userId,
        subjectId: profile.subjectId,
        profileRevisionId: revision.revisionId,
        localDate: '2099-01-01',
        timezone: 'Asia/Shanghai',
        contentPolicyVersion: 'profile-delete-e2e',
        status: 'PENDING',
      })
      .returning();
    if (!historicalInsight) throw new Error('Historical insight setup failed');
    const [activeTask] = await infrastructure.database
      .insert(generationTasks)
      .values({
        id: newId(),
        ownerUserId: userId,
        targetType: 'DAILY_INSIGHT',
        targetId: historicalInsight.id,
        status: 'RUNNING',
        stage: 'GENERATING_CONTENT',
        maxAttempts: 3,
      })
      .returning();
    if (!activeTask) throw new Error('Generation task setup failed');
    const blocked = await app.inject({
      method: 'DELETE',
      url: `/api/v1/me/life-profiles/${profile.profileId}`,
      headers: idempotentAuthHeaders('other-profile-delete-blocked'),
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json<{ error: { code: string } }>().error.code).toBe('PROFILE_DELETION_BLOCKED');
    await infrastructure.database
      .update(generationTasks)
      .set({ status: 'FAILED', terminalAt: new Date() })
      .where(eq(generationTasks.id, activeTask.id));

    const deletedGroup = await app.inject({
      method: 'DELETE',
      url: `/api/v1/me/life-profile-groups/${groupId}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(deletedGroup.statusCode).toBe(204);
    const ungrouped = await app.inject({
      method: 'GET',
      url: `/api/v1/me/life-profiles/${profile.profileId}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(ungrouped.json<{ data: { groupId: null } }>().data.groupId).toBeNull();
    const accepted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/me/life-profiles/${profile.profileId}`,
      headers: idempotentAuthHeaders('other-profile-delete-accepted'),
    });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json<{ data: { requestId: string; status: string } }>().data).toMatchObject({
      status: 'PENDING',
    });
    expect(
      await infrastructure.database
        .select({ id: dailyInsights.id })
        .from(dailyInsights)
        .where(eq(dailyInsights.id, historicalInsight.id)),
    ).toHaveLength(1);
    const afterDelete = await app.inject({
      method: 'GET',
      url: `/api/v1/me/life-profiles/${profile.profileId}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(afterDelete.statusCode).toBe(404);

    const selfProfile = list
      .json<{ data: { profileId: string; subjectType: string }[] }>()
      .data.find((item) => item.subjectType === 'SELF');
    const selfDelete = await app.inject({
      method: 'DELETE',
      url: `/api/v1/me/life-profiles/${selfProfile!.profileId}`,
      headers: idempotentAuthHeaders('self-profile-delete-rejected'),
    });
    expect(selfDelete.statusCode).toBe(409);
    expect(selfDelete.json<{ error: { code: string } }>().error.code).toBe('SELF_PROFILE_DELETE_NOT_ALLOWED');
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
    const alternateChallenge = await createChallenge('daily-device-challenge', 'daily-device-secondary');
    const alternateSession = await createSession(alternateChallenge, '123456', 'daily-device-session');
    const alternateToken = alternateSession.json<{ data: { accessToken: string } }>().data.accessToken;
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
        headers: {
          authorization: `Bearer ${alternateToken}`,
          'content-type': 'application/json',
          'idempotency-key': 'daily-today-create-02',
        },
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
    const readyData = replay.json<{
      data: {
        dailyInsight: {
          status: string;
          profileRevisionId: string;
          content: { notice: string; theme: string };
        };
        task: null;
      };
    }>().data;
    expect(readyData).toMatchObject({
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

    const infrastructure = app.get(RuntimeInfrastructure);
    const firstHistoricalDate = shiftLocalDate(firstData.dailyInsight.localDate, -2);
    await infrastructure.database
      .update(dailyInsights)
      .set({ localDate: firstHistoricalDate })
      .where(eq(dailyInsights.id, firstData.dailyInsight.dailyInsightId));

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/daily-insights/today',
      headers: authHeaders('daily-today-second-day'),
      payload: {},
    });
    expect(second.statusCode).toBe(202);
    const secondData = second.json<{
      data: {
        dailyInsight: { dailyInsightId: string; localDate: string; content: null };
        task: { taskId: string };
      };
    }>().data;
    expect(secondData.dailyInsight.content).toBeNull();
    await tasks.claim(secondData.task.taskId);
    await daily.generate(secondData.task.taskId, secondData.dailyInsight.dailyInsightId);
    await tasks.succeed(secondData.task.taskId);
    await infrastructure.database
      .update(dailyInsights)
      .set({ localDate: shiftLocalDate(firstData.dailyInsight.localDate, -1) })
      .where(eq(dailyInsights.id, secondData.dailyInsight.dailyInsightId));

    const third = await app.inject({
      method: 'POST',
      url: '/api/v1/daily-insights/today',
      headers: authHeaders('daily-today-third-day'),
      payload: {},
    });
    expect(third.statusCode).toBe(202);
    const thirdData = third.json<{
      data: { dailyInsight: { dailyInsightId: string; localDate: string }; task: { taskId: string } };
    }>().data;
    await tasks.claim(thirdData.task.taskId);
    await daily.generate(thirdData.task.taskId, thirdData.dailyInsight.dailyInsightId);
    await tasks.succeed(thirdData.task.taskId);

    const entriesBeforeReplay = await infrastructure.database.select().from(seedEntries);
    const dailyConsumesBefore = entriesBeforeReplay.filter(
      (entry) => entry.type === 'CONSUME' && entry.resourceId !== null,
    ).length;
    await daily.generate(thirdData.task.taskId, thirdData.dailyInsight.dailyInsightId);
    await tasks.succeed(thirdData.task.taskId);
    const entriesAfterReplay = await infrastructure.database.select().from(seedEntries);
    expect(
      entriesAfterReplay.filter((entry) => entry.type === 'CONSUME' && entry.resourceId !== null),
    ).toHaveLength(dailyConsumesBefore);

    await infrastructure.database
      .update(dailyInsights)
      .set({ localDate: shiftLocalDate(firstData.dailyInsight.localDate, -3) })
      .where(eq(dailyInsights.id, thirdData.dailyInsight.dailyInsightId));
    const beforeInsufficient = {
      insights: (await infrastructure.database.select().from(dailyInsights)).length,
      tasks: (await infrastructure.database.select().from(generationTasks)).length,
      entries: (await infrastructure.database.select().from(seedEntries)).length,
    };
    const insufficient = await app.inject({
      method: 'POST',
      url: '/api/v1/daily-insights/today',
      headers: authHeaders('daily-today-insufficient'),
      payload: {},
    });
    expect(insufficient.statusCode).toBe(409);
    expect(insufficient.json<{ error: { code: string } }>().error.code).toBe('INSUFFICIENT_WISDOM_SEEDS');
    expect({
      insights: (await infrastructure.database.select().from(dailyInsights)).length,
      tasks: (await infrastructure.database.select().from(generationTasks)).length,
      entries: (await infrastructure.database.select().from(seedEntries)).length,
    }).toEqual(beforeInsufficient);
    await infrastructure.database
      .update(dailyInsights)
      .set({ localDate: firstData.dailyInsight.localDate })
      .where(eq(dailyInsights.id, thirdData.dailyInsight.dailyInsightId));

    const historical = await app.inject({
      method: 'GET',
      url: `/api/v1/daily-insights/${firstHistoricalDate}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(historical.statusCode).toBe(200);
    expect(
      historical.json<{
        data: { profileRevisionId: string; content: { theme: string } };
      }>().data,
    ).toMatchObject({
      profileRevisionId: readyData.dailyInsight.profileRevisionId,
      content: { theme: readyData.dailyInsight.content.theme },
    });
    expect(await app.get(SeedLedgerService).getAccount(decodeJwtSubject(accessToken))).toMatchObject({
      available: 0,
      reserved: 0,
      totalSpent: 3,
    });
  });

  it('returns an existing user directly to the persisted home state', async () => {
    const challengeId = await createChallenge('returning-user-challenge', 'returning-user-device');
    const session = await createSession(challengeId, '123456', 'returning-user-session');
    expect(session.statusCode).toBe(201);
    const data = session.json<{
      data: { isNewUser: boolean; accessToken: string; nextAction: string };
    }>().data;
    expect(data.isNewUser).toBe(false);
    expect(data.nextAction).toBe('VIEW_HOME');
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

  it('stores idempotent feedback and hides targets owned by another user', async () => {
    const history = await app.inject({
      method: 'GET',
      url: '/api/v1/daily-insights?limit=1',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const targetId = history.json<{ data: { dailyInsightId: string }[] }>().data[0]!.dailyInsightId;
    const payload = {
      target: { type: 'DAILY_INSIGHT', id: targetId, sectionCode: 'theme' },
      rating: 'HELPFUL',
      reasons: ['NOT_ACCURATE', 'TOO_GENERIC'],
      comment: '这段内容有帮助，但可以更具体。',
    };
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      headers: authHeaders('daily-feedback-create-01'),
      payload,
    });
    expect(created.statusCode).toBe(201);
    const feedbackId = created.json<{ data: { feedbackId: string } }>().data.feedbackId;
    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      headers: authHeaders('daily-feedback-create-01'),
      payload,
    });
    expect(replay.json<{ data: { feedbackId: string } }>().data.feedbackId).toBe(feedbackId);

    const crossOwner = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      headers: {
        authorization: `Bearer ${secondaryAccessToken}`,
        'content-type': 'application/json',
        'idempotency-key': 'cross-owner-feedback-01',
      },
      payload,
    });
    expect(crossOwner.statusCode).toBe(404);
    expect(crossOwner.json<{ error: { code: string } }>().error.code).toBe('FEEDBACK_TARGET_NOT_FOUND');
    const unsafe = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      headers: authHeaders('unsafe-feedback-create-01'),
      payload: { ...payload, comment: 'unsafe\u0000comment' },
    });
    expect(unsafe.statusCode).toBe(400);
    expect(unsafe.json<{ error: { code: string } }>().error.code).toBe('FEEDBACK_COMMENT_UNSAFE');
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

  it('reauthenticates, cancels and idempotently executes account deletion', async () => {
    const challengeId = await createChallenge(
      'account-delete-challenge-01',
      'account-delete-device-01',
      phone,
      'ACCOUNT_DELETION',
    );
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/me/account-deletion-requests',
      headers: authHeaders('account-delete-invalid-01'),
      payload: { smsChallengeId: challengeId, verificationCode: '000000', reason: 'PRIVACY_CONCERN' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json<{ error: { code: string } }>().error.code).toBe('SMS_CODE_INVALID');

    const request = await app.inject({
      method: 'POST',
      url: '/api/v1/me/account-deletion-requests',
      headers: authHeaders('account-delete-create-01'),
      payload: { smsChallengeId: challengeId, verificationCode: '123456', reason: 'PRIVACY_CONCERN' },
    });
    expect(request.statusCode).toBe(202);
    const requestData = request.json<{
      data: { requestId: string; status: string; canCancel: boolean };
    }>().data;
    expect(requestData).toMatchObject({ status: 'PENDING', canCancel: true });
    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/me/account-deletion-requests',
      headers: authHeaders('account-delete-create-01'),
      payload: { smsChallengeId: challengeId, verificationCode: '123456', reason: 'PRIVACY_CONCERN' },
    });
    expect(replay.json<{ data: { requestId: string } }>().data.requestId).toBe(requestData.requestId);
    const infrastructure = app.get(RuntimeInfrastructure);
    const duplicateRateLimitKeys = await infrastructure.redis.keys(
      `${infrastructure.environment.QUEUE_PREFIX}:rate:sms:*`,
    );
    if (duplicateRateLimitKeys.length > 0) await infrastructure.redis.del(...duplicateRateLimitKeys);
    const duplicateChallenge = await createChallenge(
      'account-delete-challenge-duplicate',
      'account-delete-device-duplicate',
      phone,
      'ACCOUNT_DELETION',
    );
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/me/account-deletion-requests',
      headers: authHeaders('account-delete-create-duplicate'),
      payload: { smsChallengeId: duplicateChallenge, verificationCode: '123456', reason: 'OTHER' },
    });
    expect(duplicate.json<{ data: { requestId: string } }>().data.requestId).toBe(requestData.requestId);
    const refreshedPending = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sessions/refresh',
      headers: { cookie: refreshCookie },
    });
    expect(refreshedPending.statusCode).toBe(200);
    accessToken = refreshedPending.json<{ data: { accessToken: string } }>().data.accessToken;
    const rotatedCookie = refreshedPending.headers['set-cookie'];
    refreshCookie = (Array.isArray(rotatedCookie) ? rotatedCookie[0] : rotatedCookie)?.split(';')[0] ?? '';
    const current = await app.inject({
      method: 'GET',
      url: '/api/v1/me/account-deletion-request',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(current.json<{ data: { requestId: string } }>().data.requestId).toBe(requestData.requestId);
    const cancelled = await app.inject({
      method: 'DELETE',
      url: '/api/v1/me/account-deletion-request',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(cancelled.statusCode).toBe(204);

    const deletionRateLimitKeys = await infrastructure.redis.keys(
      `${infrastructure.environment.QUEUE_PREFIX}:rate:sms:*`,
    );
    if (deletionRateLimitKeys.length > 0) await infrastructure.redis.del(...deletionRateLimitKeys);
    const secondChallenge = await createChallenge(
      'account-delete-challenge-02',
      'account-delete-device-02',
      phone,
      'ACCOUNT_DELETION',
    );
    const secondRequest = await app.inject({
      method: 'POST',
      url: '/api/v1/me/account-deletion-requests',
      headers: authHeaders('account-delete-create-02'),
      payload: { smsChallengeId: secondChallenge, verificationCode: '123456', reason: 'OTHER' },
    });
    const secondRequestId = secondRequest.json<{ data: { requestId: string } }>().data.requestId;
    await infrastructure.database
      .update(deletionRequests)
      .set({ cancellableUntil: new Date(Date.now() - 1_000) })
      .where(eq(deletionRequests.id, secondRequestId));
    const notCancellable = await app.inject({
      method: 'DELETE',
      url: '/api/v1/me/account-deletion-request',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(notCancellable.statusCode).toBe(409);
    expect(notCancellable.json<{ error: { code: string } }>().error.code).toBe(
      'ACCOUNT_DELETION_NOT_CANCELLABLE',
    );

    const ledgerCount = (await infrastructure.database.select().from(seedEntries)).length;
    const deletion = app.get(AccountDeletionService);
    await deletion.process(secondRequestId);
    await deletion.process(secondRequestId);
    expect((await infrastructure.database.select().from(seedEntries)).length).toBe(ledgerCount);
    const [deletedUser] = await infrastructure.database
      .select()
      .from(users)
      .where(eq(users.id, decodeJwtSubject(accessToken)))
      .limit(1);
    expect(deletedUser).toMatchObject({ status: 'DISABLED' });
    expect(deletedUser?.deletedAt).toBeInstanceOf(Date);
    expect(
      (await infrastructure.database.select().from(sessions)).filter(
        (session) => session.userId === deletedUser?.id && session.revokedAt === null,
      ),
    ).toHaveLength(0);
  });

  async function createChallenge(
    idempotencyKey: string,
    deviceId: string,
    nationalNumber = phone,
    purpose: 'LOGIN' | 'ACCOUNT_DELETION' | 'SECURITY_CONFIRMATION' = 'LOGIN',
  ): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sms-challenges',
      headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      payload: {
        phone: { countryCode: '+86', nationalNumber },
        purpose,
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

  function idempotentAuthHeaders(idempotencyKey: string) {
    return {
      authorization: `Bearer ${accessToken}`,
      'idempotency-key': idempotencyKey,
    };
  }

  function decodeJwtSubject(token: string): string {
    const payload = token.split('.')[1];
    if (!payload) throw new Error('Invalid JWT');
    return (JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sub: string }).sub;
  }

  function shiftLocalDate(localDate: string, days: number): string {
    const date = new Date(`${localDate}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
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

function firstLookCard(
  position: 'hour' | 'day' | 'month' | 'year',
  dimension: '思想' | '行为' | '事业' | '梦想目标',
  card: string,
) {
  return {
    position,
    dimension,
    card,
    title: `${dimension}测试画像`,
    summary: `${dimension}测试摘要`,
    innerTrait: '内在测试特质',
    outerTrait: '外在测试特质',
    status: 'complete' as const,
    evidence: { source: 'e2e' },
    missingFields: [],
  };
}
