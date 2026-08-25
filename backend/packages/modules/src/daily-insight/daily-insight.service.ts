import { ConflictException, Inject, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import {
  CursorCodec,
  DAILY_INSIGHT_GENERATOR,
  type DailyInsightGenerator,
  normalizePageLimit,
  validateDailyInsightResult,
} from '@satori/application';
import {
  astrologySnapshots,
  cardBindings,
  dailyInsights,
  FieldCipher,
  generationTasks,
  newId,
  preferences,
  lifeProfiles,
  revisions,
  RuntimeInfrastructure,
  seedEntries,
  subjects,
} from '@satori/infrastructure';
import { and, desc, eq, gte, isNull, lt, or, sql } from 'drizzle-orm';
import { GenerationTaskRunner } from '../generation-task/generation-task.runner.js';
import { GenerationTaskService } from '../generation-task/generation-task.service.js';
import { SeedLedgerService } from '../seed-ledger/seed-ledger.service.js';

@Injectable()
export class DailyInsightService implements OnModuleInit {
  private readonly cursors: CursorCodec;
  constructor(
    private readonly infrastructure: RuntimeInfrastructure,
    private readonly cipher: FieldCipher,
    private readonly ledger: SeedLedgerService,
    private readonly tasks: GenerationTaskService,
    private readonly runner: GenerationTaskRunner,
    @Inject(DAILY_INSIGHT_GENERATOR) private readonly generator: DailyInsightGenerator,
  ) {
    this.cursors = new CursorCodec(infrastructure.environment.CURSOR_SIGNING_SECRET);
  }
  onModuleInit() {
    this.runner.register(
      'DAILY_INSIGHT',
      (task) => this.generate(task.id, task.targetId),
      (taskId, targetId) => this.compensateFailure(taskId, targetId),
    );
  }

  async createToday(userId: string) {
    return this.infrastructure.database.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 8))`);
      const [preference] = await tx.select().from(preferences).where(eq(preferences.userId, userId)).limit(1);
      if (!preference?.timezone)
        throw new ConflictException({
          code: 'TIMEZONE_REQUIRED',
          message: 'A valid life timezone is required',
        });
      const localDate = localDateInTimezone(new Date(), preference.timezone);
      const [profile] = await tx
        .select()
        .from(lifeProfiles)
        .innerJoin(subjects, eq(subjects.id, lifeProfiles.subjectId))
        .where(
          and(
            eq(lifeProfiles.ownerUserId, userId),
            eq(subjects.type, 'SELF'),
            isNull(lifeProfiles.deletedAt),
          ),
        )
        .limit(1);
      const selfProfile = profile?.life_profiles;
      if (!selfProfile?.activeRevisionId)
        throw new ConflictException({
          code: 'PROFILE_NOT_CONFIRMED',
          message: 'An active profile is required',
        });
      const cards = await tx
        .select({ id: cardBindings.id })
        .from(cardBindings)
        .where(eq(cardBindings.revisionId, selfProfile.activeRevisionId));
      if (cards.length !== 4)
        throw new ConflictException({
          code: 'PROFILE_CARDS_INCOMPLETE',
          message: 'Four relationship cards are required',
        });
      const [existing] = await tx
        .select()
        .from(dailyInsights)
        .where(
          and(
            eq(dailyInsights.subjectId, selfProfile.subjectId),
            eq(dailyInsights.localDate, localDate),
            eq(dailyInsights.timezone, preference.timezone),
            eq(dailyInsights.contentPolicyVersion, 'r1.0'),
          ),
        )
        .limit(1);
      if (existing)
        return {
          status: existing.status === 'READY' ? 200 : 202,
          body: {
            dailyInsight: await this.toDto(existing),
            task: existing.status === 'READY' ? null : await this.taskFor(existing.id),
          },
        };
      const insightId = newId();
      await tx.insert(dailyInsights).values({
        id: insightId,
        ownerUserId: userId,
        subjectId: selfProfile.subjectId,
        profileRevisionId: selfProfile.activeRevisionId,
        localDate,
        timezone: preference.timezone,
        contentPolicyVersion: 'r1.0',
        status: 'PENDING',
      });
      const reserved = await this.ledger.reserveInTransaction(tx, {
        userId,
        amount: this.infrastructure.policy.dailyInsight.price,
        businessKey: `daily:${insightId}:reserve`,
        businessType: 'DAILY_INSIGHT',
        resourceId: insightId,
        title: '每日指引预留',
      });
      const [generating] = await tx
        .update(dailyInsights)
        .set({
          status: 'GENERATING',
          seedReservationEntryId: reserved.transaction.transactionId,
          updatedAt: new Date(),
        })
        .where(eq(dailyInsights.id, insightId))
        .returning();
      const task = await this.tasks.createInTransaction(tx, {
        ownerUserId: userId,
        targetType: 'DAILY_INSIGHT',
        targetId: insightId,
      });
      return { status: 202, body: { dailyInsight: await this.toDto(generating!), task } };
    });
  }

  async getByDate(userId: string, localDate: string) {
    const [row] = await this.infrastructure.database
      .select()
      .from(dailyInsights)
      .where(and(eq(dailyInsights.ownerUserId, userId), eq(dailyInsights.localDate, localDate)))
      .orderBy(desc(dailyInsights.createdAt))
      .limit(1);
    if (!row)
      throw new NotFoundException({ code: 'DAILY_INSIGHT_NOT_FOUND', message: 'Daily insight not found' });
    return this.toDto(row);
  }
  async list(userId: string, input: { cursor?: string; limit?: number }) {
    const limit = normalizePageLimit(input.limit);
    const cursor = input.cursor ? this.cursors.decode(input.cursor) : null;
    const cutoff = new Date(Date.now() - this.infrastructure.policy.dailyInsight.historyDays * 86_400_000);
    const rows = await this.infrastructure.database
      .select()
      .from(dailyInsights)
      .where(
        and(
          eq(dailyInsights.ownerUserId, userId),
          gte(dailyInsights.createdAt, cutoff),
          cursor
            ? or(
                lt(dailyInsights.createdAt, new Date(cursor.createdAt)),
                and(eq(dailyInsights.createdAt, new Date(cursor.createdAt)), lt(dailyInsights.id, cursor.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(dailyInsights.createdAt), desc(dailyInsights.id))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      data: await Promise.all(page.map((row) => this.toDto(row))),
      meta: {
        hasMore,
        nextCursor:
          hasMore && last
            ? this.cursors.encode({ createdAt: last.createdAt.toISOString(), id: last.id })
            : null,
      },
    };
  }

  async homeOverview(userId: string) {
    const [preference] = await this.infrastructure.database
      .select()
      .from(preferences)
      .where(eq(preferences.userId, userId))
      .limit(1);
    const [profileRow] = await this.infrastructure.database
      .select({ profile: lifeProfiles, subject: subjects })
      .from(lifeProfiles)
      .innerJoin(subjects, eq(subjects.id, lifeProfiles.subjectId))
      .where(
        and(eq(lifeProfiles.ownerUserId, userId), eq(subjects.type, 'SELF'), isNull(lifeProfiles.deletedAt)),
      )
      .limit(1);
    const account = await this.ledger.getAccount(userId);
    const registrationReward = await this.ledger.getRegistrationReward(userId);
    const cards = profileRow?.profile.activeRevisionId
      ? await this.infrastructure.database
          .select({ snapshot: cardBindings.snapshot })
          .from(cardBindings)
          .where(eq(cardBindings.revisionId, profileRow.profile.activeRevisionId))
      : [];
    const today = preference ? localDateInTimezone(new Date(), preference.timezone) : null;
    const [insight] = today
      ? await this.infrastructure.database
          .select()
          .from(dailyInsights)
          .where(and(eq(dailyInsights.ownerUserId, userId), eq(dailyInsights.localDate, today)))
          .limit(1)
      : [undefined];
    const [pendingRevision] = profileRow
      ? await this.infrastructure.database
          .select({ id: revisions.id })
          .from(revisions)
          .where(and(eq(revisions.profileId, profileRow.profile.id), eq(revisions.status, 'CALCULATED')))
          .orderBy(desc(revisions.createdAt))
          .limit(1)
      : [undefined];
    const profile = profileRow
      ? {
          profileId: profileRow.profile.id,
          subjectId: profileRow.profile.subjectId,
          subjectType: 'SELF',
          displayName: this.cipher.decrypt(profileRow.subject.displayNameCiphertext),
          relationshipType: 'SELF',
          groupId: profileRow.profile.groupId,
          currentRevisionId: profileRow.profile.activeRevisionId,
          pendingRevisionId: pendingRevision?.id ?? null,
          state: profileRow.profile.activeRevisionId ? 'ACTIVE' : 'CALCULATED',
          updatedAt: profileRow.profile.updatedAt.toISOString(),
        }
      : { profileId: '', subjectType: 'SELF', displayName: '我的生命智慧档案', state: 'NOT_CREATED' };
    const nextAction = !profileRow
      ? 'CREATE_PROFILE'
      : !profileRow.profile.activeRevisionId
        ? 'CONFIRM_PROFILE'
        : registrationReward.status === 'AVAILABLE'
          ? 'CLAIM_REGISTRATION_REWARD'
          : !insight
            ? 'CREATE_TODAY_DAILY_INSIGHT'
            : 'VIEW_HOME';
    return {
      user: { userId, timezone: preference?.timezone ?? 'Asia/Shanghai' },
      profile,
      cards: cards.map((card) => card.snapshot),
      registrationReward,
      wisdomSeedAccount: account,
      dailyInsight: {
        localDate: today,
        state: insight?.status ?? 'NOT_CREATED',
        dailyInsightId: insight?.id ?? null,
        taskId: insight ? ((await this.taskFor(insight.id))?.taskId ?? null) : null,
      },
      nextAction,
    };
  }

  async generate(taskId: string, insightId: string) {
    await this.tasks.heartbeat(taskId, 'PREPARING_CONTEXT');
    const [insight] = await this.infrastructure.database
      .select()
      .from(dailyInsights)
      .where(eq(dailyInsights.id, insightId))
      .limit(1);
    if (!insight || insight.status === 'READY') return;
    if (insight.status === 'FAILED' && insight.seedSettlementEntryId) {
      await this.infrastructure.database.transaction(async (tx) => {
        const [task] = await tx
          .select({ attempt: generationTasks.currentAttempt })
          .from(generationTasks)
          .where(eq(generationTasks.id, taskId))
          .limit(1);
        const reserved = await this.ledger.reserveInTransaction(tx, {
          userId: insight.ownerUserId,
          amount: this.infrastructure.policy.dailyInsight.price,
          businessKey: `daily:${insight.id}:reserve:retry:${task?.attempt ?? 0}`,
          businessType: 'DAILY_INSIGHT',
          resourceId: insight.id,
          title: '每日指引重试预留',
        });
        await tx
          .update(dailyInsights)
          .set({
            status: 'GENERATING',
            seedReservationEntryId: reserved.transaction.transactionId,
            seedSettlementEntryId: null,
            updatedAt: new Date(),
          })
          .where(eq(dailyInsights.id, insight.id));
      });
    }
    const [revision] = await this.infrastructure.database
      .select({ astrologySnapshotId: revisions.astrologySnapshotId })
      .from(revisions)
      .where(eq(revisions.id, insight.profileRevisionId))
      .limit(1);
    const [snapshot] = await this.infrastructure.database
      .select()
      .from(astrologySnapshots)
      .where(eq(astrologySnapshots.id, revision!.astrologySnapshotId))
      .limit(1);
    const cards = await this.infrastructure.database
      .select()
      .from(cardBindings)
      .where(eq(cardBindings.revisionId, insight.profileRevisionId));
    await this.tasks.heartbeat(taskId, 'GENERATING_CONTENT');
    const result = validateDailyInsightResult(
      await this.generator.generate({
        dailyInsightId: insight.id,
        localDate: insight.localDate,
        timezone: insight.timezone,
        profileRevisionId: insight.profileRevisionId,
        astrologySnapshot: snapshot?.result,
        cards: cards.map((card) => card.snapshot),
      }),
    );
    await this.tasks.heartbeat(taskId, 'VALIDATING_CONTENT');
    await this.infrastructure.database.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(dailyInsights)
        .where(eq(dailyInsights.id, insightId))
        .for('update')
        .limit(1);
      if (!locked || locked.status === 'READY') return;
      if (!locked.seedReservationEntryId) throw new Error('Daily insight reservation missing');
      const consumed = await this.ledger.consumeInTransaction(tx, {
        userId: locked.ownerUserId,
        amount: this.infrastructure.policy.dailyInsight.price,
        businessKey: `daily:${locked.id}:consume:${locked.seedReservationEntryId}`,
        businessType: 'DAILY_INSIGHT',
        resourceId: locked.id,
        originalEntryId: locked.seedReservationEntryId,
        title: '每日指引核销',
      });
      await tx
        .update(dailyInsights)
        .set({
          status: 'READY',
          content: result.content,
          generationManifest: result.manifest,
          seedSettlementEntryId: consumed.transaction.transactionId,
          publishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(dailyInsights.id, locked.id));
    });
    await this.tasks.heartbeat(taskId, 'FINALIZING');
  }

  async compensateFailure(_taskId: string, insightId: string) {
    await this.infrastructure.database.transaction(async (tx) => {
      const [insight] = await tx
        .select()
        .from(dailyInsights)
        .where(eq(dailyInsights.id, insightId))
        .for('update')
        .limit(1);
      if (!insight) return;
      if (insight.seedSettlementEntryId) {
        const [entry] = await tx
          .select()
          .from(seedEntries)
          .where(eq(seedEntries.id, insight.seedSettlementEntryId))
          .limit(1);
        if (entry?.type === 'CONSUME') {
          const refund = await this.ledger.refundInTransaction(tx, {
            userId: insight.ownerUserId,
            amount: this.infrastructure.policy.dailyInsight.price,
            businessKey: `daily:${insight.id}:refund`,
            businessType: 'DAILY_INSIGHT',
            resourceId: insight.id,
            originalEntryId: entry.id,
            title: '每日指引退款',
          });
          await tx
            .update(dailyInsights)
            .set({
              status: 'FAILED',
              seedSettlementEntryId: refund.transaction.transactionId,
              updatedAt: new Date(),
            })
            .where(eq(dailyInsights.id, insight.id));
        }
      } else if (insight.seedReservationEntryId) {
        const release = await this.ledger.releaseInTransaction(tx, {
          userId: insight.ownerUserId,
          amount: this.infrastructure.policy.dailyInsight.price,
          businessKey: `daily:${insight.id}:release`,
          businessType: 'DAILY_INSIGHT',
          resourceId: insight.id,
          originalEntryId: insight.seedReservationEntryId,
          title: '每日指引释放',
        });
        await tx
          .update(dailyInsights)
          .set({
            status: 'FAILED',
            seedSettlementEntryId: release.transaction.transactionId,
            updatedAt: new Date(),
          })
          .where(eq(dailyInsights.id, insight.id));
      }
    });
  }

  private async taskFor(insightId: string) {
    const [task] = await this.infrastructure.database
      .select()
      .from(generationTasks)
      .where(and(eq(generationTasks.targetType, 'DAILY_INSIGHT'), eq(generationTasks.targetId, insightId)))
      .limit(1);
    return task ? this.tasks.taskDto(task) : null;
  }
  private async toDto(row: typeof dailyInsights.$inferSelect) {
    const entryId = row.seedSettlementEntryId ?? row.seedReservationEntryId;
    const [entry] = entryId
      ? await this.infrastructure.database
          .select()
          .from(seedEntries)
          .where(eq(seedEntries.id, entryId))
          .limit(1)
      : [undefined];
    const settlementStatus =
      entry?.type === 'CONSUME'
        ? 'CONSUMED'
        : entry?.type === 'RELEASE'
          ? 'RELEASED'
          : entry?.type === 'REFUND'
            ? 'REFUNDED'
            : 'RESERVED';
    return {
      dailyInsightId: row.id,
      localDate: row.localDate,
      timezone: row.timezone,
      status: row.status === 'PENDING' ? 'GENERATING' : row.status,
      profileRevisionId: row.profileRevisionId,
      content: row.status === 'READY' ? row.content : null,
      fallback:
        row.status === 'READY'
          ? null
          : { title: '今日片刻', message: '你的今日内容正在准备中，可以稍后回来看看。' },
      taskId: (await this.taskFor(row.id))?.taskId ?? null,
      settlement: {
        currency: 'WISDOM_SEED',
        amount: this.infrastructure.policy.dailyInsight.price,
        status: settlementStatus,
        transactionId: entry?.id ?? '',
      },
      publishedAt: row.publishedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
function localDateInTimezone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
