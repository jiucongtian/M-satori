import {
  BadGatewayException,
  ConflictException,
  GatewayTimeoutException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  IdempotencyService,
  PROFILE_FIRST_LOOK_GENERATOR,
  type ProfileFirstLookContent,
  type ProfileFirstLookGenerator,
  type ProfileFirstLookManifest,
} from '@satori/application';
import {
  cardBindings,
  FieldCipher,
  lifeProfiles,
  newId,
  PostgresIdempotencyStore,
  profileFirstLookReports,
  revisions,
  RuntimeInfrastructure,
  subjects,
} from '@satori/infrastructure';
import { and, eq, inArray, isNull } from 'drizzle-orm';

type FirstLookReportRow = typeof profileFirstLookReports.$inferSelect;

interface StoredFailure {
  code: string;
  retryable: boolean;
  providerRequestId?: string;
  providerExecutionId?: string;
  upstreamStatus?: number;
  retryAfter?: string;
  elapsedMs?: number;
}

@Injectable()
export class ProfileFirstLookService {
  private readonly idempotency: IdempotencyService;

  constructor(
    private readonly infrastructure: RuntimeInfrastructure,
    private readonly cipher: FieldCipher,
    @Inject(PROFILE_FIRST_LOOK_GENERATOR)
    private readonly generator: ProfileFirstLookGenerator,
  ) {
    this.idempotency = new IdempotencyService(
      new PostgresIdempotencyStore(infrastructure.database, cipher),
      infrastructure.policy.idempotency.ttlSeconds * 1000,
    );
  }

  async get(userId: string, revisionId: string) {
    await this.requireConfirmedOwnedRevision(userId, revisionId);
    const report = await this.findReport(userId, revisionId);
    if (!report) {
      throw new NotFoundException({
        code: 'PROFILE_FIRST_LOOK_NOT_FOUND',
        message: 'Profile first-look report not found',
      });
    }
    return this.toDto(report);
  }

  async generate(input: { userId: string; revisionId: string; idempotencyKey: string }) {
    const result = await this.idempotency.execute(
      {
        actorKey: `user:${input.userId}`,
        operation: `profileFirstLook:${input.revisionId}`,
        key: input.idempotencyKey,
      },
      { revisionId: input.revisionId },
      async () => ({
        status: 200,
        body: await this.generateOnce(input.userId, input.revisionId),
      }),
    );
    return result.body;
  }

  private async generateOnce(userId: string, revisionId: string) {
    const context = await this.requireConfirmedOwnedRevision(userId, revisionId);
    const cards = await this.loadCards(revisionId);
    const displayName = this.cipher.decrypt(context.displayNameCiphertext);
    let report = await this.findReport(userId, revisionId);
    if (report?.status === 'READY') return this.toDto(report);
    if (report?.status === 'GENERATING' && !this.isStale(report)) return this.toDto(report);

    if (!report) {
      const reportId = newId();
      const [inserted] = await this.infrastructure.database
        .insert(profileFirstLookReports)
        .values({
          id: reportId,
          ownerUserId: userId,
          profileRevisionId: revisionId,
          status: 'GENERATING',
          idempotencyKey: reportId,
          runReference: `profile-11-${reportId}`,
        })
        .onConflictDoNothing()
        .returning();
      report = inserted ?? (await this.findReport(userId, revisionId));
      if (!report) throw new Error('Profile first-look report creation failed');
      if (!inserted) return this.toDto(report);
    } else {
      const [reset] = await this.infrastructure.database
        .update(profileFirstLookReports)
        .set({ status: 'GENERATING', failure: null, updatedAt: new Date() })
        .where(
          and(
            eq(profileFirstLookReports.id, report.id),
            eq(profileFirstLookReports.ownerUserId, userId),
            inArray(profileFirstLookReports.status, ['FAILED', 'GENERATING']),
          ),
        )
        .returning();
      report = reset ?? report;
    }

    try {
      const generated = await this.generator.generate({
        idempotencyKey: report.idempotencyKey,
        runReference: report.runReference,
        name: displayName,
        pronoun: '你',
        cards,
      });
      const completedAt = new Date();
      const [updated] = await this.infrastructure.database
        .update(profileFirstLookReports)
        .set({
          status: 'READY',
          content: generated.content,
          generationManifest: generated.manifest,
          providerRequestId: generated.providerRequestId,
          providerExecutionId: generated.providerExecutionId,
          durationMs: generated.durationMs,
          failure: null,
          completedAt,
          updatedAt: completedAt,
        })
        .where(
          and(eq(profileFirstLookReports.id, report.id), eq(profileFirstLookReports.ownerUserId, userId)),
        )
        .returning();
      if (!updated) throw new Error('Profile first-look report completion failed');
      return this.toDto(updated);
    } catch (error) {
      const failure = normalizeFailure(error);
      await this.infrastructure.database
        .update(profileFirstLookReports)
        .set({
          status: 'FAILED',
          providerRequestId: failure.providerRequestId,
          providerExecutionId: failure.providerExecutionId,
          durationMs: failure.elapsedMs,
          failure,
          updatedAt: new Date(),
        })
        .where(
          and(eq(profileFirstLookReports.id, report.id), eq(profileFirstLookReports.ownerUserId, userId)),
        );
      throw toHttpException(failure);
    }
  }

  private async requireConfirmedOwnedRevision(userId: string, revisionId: string) {
    const [row] = await this.infrastructure.database
      .select({
        revisionStatus: revisions.status,
        displayNameCiphertext: subjects.displayNameCiphertext,
      })
      .from(revisions)
      .innerJoin(lifeProfiles, eq(lifeProfiles.id, revisions.profileId))
      .innerJoin(subjects, eq(subjects.id, lifeProfiles.subjectId))
      .where(
        and(
          eq(revisions.id, revisionId),
          eq(revisions.ownerUserId, userId),
          eq(lifeProfiles.ownerUserId, userId),
          isNull(lifeProfiles.deletedAt),
          inArray(revisions.status, ['ACTIVE', 'SUPERSEDED']),
        ),
      )
      .limit(1);
    if (!row) {
      throw new NotFoundException({
        code: 'PROFILE_REVISION_NOT_FOUND',
        message: 'Confirmed profile revision not found',
      });
    }
    return row;
  }

  private async loadCards(revisionId: string) {
    const rows = await this.infrastructure.database
      .select({ position: cardBindings.position, pillar: cardBindings.pillar })
      .from(cardBindings)
      .where(eq(cardBindings.revisionId, revisionId));
    const byDimension = new Map(rows.map((row) => [row.position, row.pillar]));
    const cards = {
      year: byDimension.get('SPACETIME'),
      month: byDimension.get('CAREER'),
      day: byDimension.get('FAMILY'),
      hour: byDimension.get('SELF'),
    };
    if (Object.values(cards).some((card) => !card || card === 'UNKNOWN')) {
      throw new ConflictException({
        code: 'PROFILE_FIRST_LOOK_CARDS_INCOMPLETE',
        message: 'Four complete profile cards are required for the first-look report',
      });
    }
    return cards as Record<'year' | 'month' | 'day' | 'hour', string>;
  }

  private async findReport(userId: string, revisionId: string) {
    const [report] = await this.infrastructure.database
      .select()
      .from(profileFirstLookReports)
      .where(
        and(
          eq(profileFirstLookReports.ownerUserId, userId),
          eq(profileFirstLookReports.profileRevisionId, revisionId),
        ),
      )
      .limit(1);
    return report;
  }

  private isStale(report: FirstLookReportRow) {
    return Date.now() - report.updatedAt.getTime() > this.infrastructure.policy.profile.firstLookStaleAfterMs;
  }

  private toDto(report: FirstLookReportRow) {
    const failure = report.failure as StoredFailure | null;
    return {
      reportId: report.id,
      profileRevisionId: report.profileRevisionId,
      status: report.status as 'GENERATING' | 'READY' | 'FAILED',
      content: (report.content as ProfileFirstLookContent | null) ?? null,
      manifest: (report.generationManifest as ProfileFirstLookManifest | null) ?? null,
      failure: failure
        ? {
            code: failure.code,
            retryable: failure.retryable,
            message: '初识内容生成失败，可手动重试。',
          }
        : null,
      generatedAt: report.completedAt?.toISOString() ?? null,
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.updatedAt.toISOString(),
    };
  }
}

function normalizeFailure(error: unknown): StoredFailure {
  const candidate = error as Record<string, unknown> | null;
  return {
    code: typeof candidate?.code === 'string' ? candidate.code : 'PROFILE_FIRST_LOOK_GENERATION_FAILED',
    retryable: candidate?.retryable === true,
    ...(typeof candidate?.providerRequestId === 'string'
      ? { providerRequestId: candidate.providerRequestId }
      : {}),
    ...(typeof candidate?.providerExecutionId === 'string'
      ? { providerExecutionId: candidate.providerExecutionId }
      : {}),
    ...(typeof candidate?.upstreamStatus === 'number' ? { upstreamStatus: candidate.upstreamStatus } : {}),
    ...(typeof candidate?.retryAfter === 'string' ? { retryAfter: candidate.retryAfter } : {}),
    ...(typeof candidate?.elapsedMs === 'number' ? { elapsedMs: candidate.elapsedMs } : {}),
  };
}

function toHttpException(failure: StoredFailure) {
  const details = {
    retryable: failure.retryable,
    ...(failure.retryAfter ? { retryAfter: failure.retryAfter } : {}),
  };
  if (failure.upstreamStatus === 429) {
    return new HttpException(
      { code: 'PROFILE_FIRST_LOOK_RATE_LIMITED', message: '初识内容生成繁忙，请稍后手动重试', details },
      429,
    );
  }
  if (failure.upstreamStatus === 401 || failure.upstreamStatus === 403) {
    return new BadGatewayException({
      code: 'PROFILE_FIRST_LOOK_UPSTREAM_AUTH_FAILED',
      message: '初识内容服务授权失败',
      details,
    });
  }
  if (failure.code.includes('TIMEOUT') || failure.upstreamStatus === 504) {
    return new GatewayTimeoutException({
      code: 'PROFILE_FIRST_LOOK_UPSTREAM_TIMEOUT',
      message: '初识内容生成超时，请手动重试',
      details,
    });
  }
  if (failure.code === 'AQUA_PROFILE_FIRST_LOOK_RESPONSE_INVALID') {
    return new BadGatewayException({
      code: 'PROFILE_FIRST_LOOK_RESPONSE_INVALID',
      message: '初识内容未通过结构校验',
      details,
    });
  }
  return new ServiceUnavailableException({
    code: 'PROFILE_FIRST_LOOK_GENERATION_FAILED',
    message: '初识内容生成失败，请手动重试',
    details,
  });
}
