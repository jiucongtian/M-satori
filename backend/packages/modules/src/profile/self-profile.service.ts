import {
  BadRequestException,
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BIRTH_CHART_CALCULATOR,
  CursorCodec,
  hashPayload,
  IdempotencyService,
  LOCATION_PROVIDER,
  normalizePageLimit,
  type BirthChartCalculator,
  type BirthChartResult,
  type BirthInput,
  type LocationProvider,
} from '@satori/application';
import type { ApiListEnvelope } from '@satori/contracts';
import {
  astrologySnapshots,
  cardBindings,
  FieldCipher,
  lifeProfiles,
  locationSnapshots,
  newId,
  PostgresIdempotencyStore,
  revisions,
  RuntimeInfrastructure,
  subjects,
} from '@satori/infrastructure';
import { and, desc, eq, isNull, lt, max, or, sql } from 'drizzle-orm';

export interface RelationshipCardDto {
  dimension: 'SPACETIME' | 'CAREER' | 'FAMILY' | 'SELF';
  title: string;
  order: number;
  cardCode: string;
  summary: string;
  uncertainty: string | null;
  mappingVersion: string;
  knowledgeVersion: string;
}

export interface ProfileRevisionDto {
  revisionId: string;
  revisionNumber: number;
  status: 'CALCULATED' | 'ACTIVE' | 'SUPERSEDED' | 'EXPIRED';
  inputFingerprint: string;
  originalInput: BirthInput;
  normalizedBirthData: BirthChartResult['normalizedBirthData'];
  calculationPreview: BirthChartResult['calculationPreview'];
  cards: RelationshipCardDto[];
  requiresEnhancedConfirmation: boolean;
  warnings: string[];
  expiresAt: string | null;
  confirmedAt: string | null;
  createdAt: string;
}

type RevisionRow = typeof revisions.$inferSelect;

@Injectable()
export class SelfProfileService {
  private readonly idempotency: IdempotencyService;
  private readonly cursors: CursorCodec;

  constructor(
    private readonly infrastructure: RuntimeInfrastructure,
    private readonly cipher: FieldCipher,
    @Inject(LOCATION_PROVIDER) private readonly locations: LocationProvider,
    @Inject(BIRTH_CHART_CALCULATOR) private readonly calculator: BirthChartCalculator,
  ) {
    this.idempotency = new IdempotencyService(
      new PostgresIdempotencyStore(infrastructure.database, cipher),
      infrastructure.environment.IDEMPOTENCY_TTL_SECONDS * 1000,
    );
    this.cursors = new CursorCodec(infrastructure.environment.CURSOR_SIGNING_SECRET);
  }

  async getCurrent(userId: string) {
    const profile = await this.findSelfProfile(userId);
    if (!profile) {
      throw new NotFoundException({ code: 'LIFE_PROFILE_NOT_FOUND', message: 'Life profile not found' });
    }
    const [subject] = await this.infrastructure.database
      .select()
      .from(subjects)
      .where(and(eq(subjects.id, profile.subjectId), eq(subjects.ownerUserId, userId)))
      .limit(1);
    if (!subject) {
      throw new NotFoundException({ code: 'LIFE_PROFILE_SUBJECT_NOT_FOUND', message: 'Profile subject not found' });
    }
    const currentRevision = profile.activeRevisionId
      ? await this.getRevision(userId, profile.activeRevisionId)
      : null;
    return {
      profileId: profile.id,
      subjectId: profile.subjectId,
      subjectType: 'SELF' as const,
      displayName: this.cipher.decrypt(subject.displayNameCiphertext),
      relationshipType: 'SELF' as const,
      groupId: null,
      currentRevisionId: profile.activeRevisionId,
      pendingRevisionId: await this.findPendingRevisionId(profile.id),
      state: profile.activeRevisionId ? ('ACTIVE' as const) : ('CALCULATED' as const),
      currentRevision,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }

  async updateDisplayName(userId: string, rawDisplayName: string) {
    const displayName = rawDisplayName.trim();
    if (!displayName || displayName.length > 16) {
      throw new BadRequestException({
        code: 'INVALID_DISPLAY_NAME',
        message: 'Display name must contain 1-16 characters',
      });
    }
    await this.infrastructure.database.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(lifeProfiles)
        .where(
          and(
            eq(lifeProfiles.ownerUserId, userId),
            eq(lifeProfiles.relationshipType, 'SELF'),
            isNull(lifeProfiles.deletedAt),
          ),
        )
        .for('update')
        .limit(1);
      if (!profile) {
        throw new NotFoundException({ code: 'LIFE_PROFILE_NOT_FOUND', message: 'Life profile not found' });
      }
      await tx
        .update(subjects)
        .set({ displayNameCiphertext: this.cipher.encrypt(displayName) })
        .where(and(eq(subjects.id, profile.subjectId), eq(subjects.ownerUserId, userId)));
      await tx.update(lifeProfiles).set({ updatedAt: new Date() }).where(eq(lifeProfiles.id, profile.id));
    });
    return this.getCurrent(userId);
  }

  async listRevisions(
    userId: string,
    input: { cursor?: string; limit?: number },
    profileId?: string,
  ): Promise<ApiListEnvelope<ProfileRevisionDto>> {
    const profile = profileId
      ? await this.findOwnedProfile(userId, profileId)
      : await this.findSelfProfile(userId);
    if (!profile) return { data: [], meta: { nextCursor: null, hasMore: false } };
    const limit = normalizePageLimit(input.limit);
    const cursor = input.cursor ? this.cursors.decode(input.cursor) : null;
    const rows = await this.infrastructure.database
      .select()
      .from(revisions)
      .where(
        and(
          eq(revisions.profileId, profile.id),
          eq(revisions.ownerUserId, userId),
          cursor
            ? or(
                lt(revisions.createdAt, new Date(cursor.createdAt)),
                and(eq(revisions.createdAt, new Date(cursor.createdAt)), lt(revisions.id, cursor.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(revisions.createdAt), desc(revisions.id))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const data = await Promise.all(page.map((row) => this.toRevisionDto(row)));
    const last = page.at(-1);
    return {
      data,
      meta: {
        hasMore,
        nextCursor:
          hasMore && last
            ? this.cursors.encode({ createdAt: last.createdAt.toISOString(), id: last.id })
            : null,
      },
    };
  }

  async getRevision(userId: string, revisionId: string, profileId?: string): Promise<ProfileRevisionDto> {
    const [row] = await this.infrastructure.database
      .select()
      .from(revisions)
      .where(
        and(
          eq(revisions.id, revisionId),
          eq(revisions.ownerUserId, userId),
          profileId ? eq(revisions.profileId, profileId) : undefined,
        ),
      )
      .limit(1);
    if (!row) {
      throw new NotFoundException({
        code: 'PROFILE_REVISION_NOT_FOUND',
        message: 'Profile revision not found',
      });
    }
    return this.toRevisionDto(row);
  }

  async preview(input: {
    userId: string;
    birthInput: BirthInput;
    idempotencyKey: string;
    profileId?: string;
  }): Promise<ProfileRevisionDto> {
    validateBirthInput(input.birthInput);
    const location = await this.locations.get(input.birthInput.locationId);
    if (!location) {
      throw new NotFoundException({ code: 'LOCATION_NOT_FOUND', message: 'Location not found' });
    }
    const chart = this.calculator.calculate(input.birthInput, location);
    const fingerprint = `sha256:${hashPayload({ birthInput: input.birthInput, location, algorithmVersion: chart.algorithmVersion })}`;
    const result = await this.idempotency.execute(
      {
        actorKey: `user:${input.userId}`,
        operation: input.profileId ? `previewProfile:${input.profileId}` : 'previewSelfProfile',
        key: input.idempotencyKey,
      },
      input.birthInput,
      async () => {
        const dto = await this.infrastructure.database.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.userId}, 1))`);
          let [profile] = input.profileId
            ? await tx
                .select()
                .from(lifeProfiles)
                .where(
                  and(
                    eq(lifeProfiles.id, input.profileId),
                    eq(lifeProfiles.ownerUserId, input.userId),
                    isNull(lifeProfiles.deletedAt),
                  ),
                )
                .for('update')
                .limit(1)
            : await tx
                .select()
                .from(lifeProfiles)
                .where(
                  and(
                    eq(lifeProfiles.ownerUserId, input.userId),
                    eq(lifeProfiles.relationshipType, 'SELF'),
                    isNull(lifeProfiles.deletedAt),
                  ),
                )
                .limit(1);
          if (!profile && input.profileId) {
            throw new NotFoundException({
              code: 'LIFE_PROFILE_NOT_FOUND',
              message: 'Life profile not found',
            });
          }
          if (!profile) {
            const subjectId = newId();
            await tx.insert(subjects).values({
              id: subjectId,
              ownerUserId: input.userId,
              type: 'SELF',
              displayNameCiphertext: this.cipher.encrypt('我的生命智慧档案'),
            });
            const profileId = newId();
            [profile] = await tx
              .insert(lifeProfiles)
              .values({
                id: profileId,
                subjectId,
                ownerUserId: input.userId,
                relationshipType: 'SELF',
              })
              .returning();
          }
          if (!profile) throw new Error('Profile creation failed');
          const [sequenceRow] = await tx
            .select({ value: max(revisions.sequence) })
            .from(revisions)
            .where(eq(revisions.profileId, profile.id));
          const revisionNumber = (sequenceRow?.value ?? 0) + 1;
          const locationSnapshotId = newId();
          await tx.insert(locationSnapshots).values({
            id: locationSnapshotId,
            provider: 'LOCAL_REFERENCE',
            providerLocationId: location.locationId,
            displayName: location.displayName,
            latitudeMicrodegrees: Math.round(location.coordinates.latitude * 1_000_000),
            longitudeMicrodegrees: Math.round(location.coordinates.longitude * 1_000_000),
            timezone: location.timezone,
            payload: location,
          });
          const astrologySnapshotId = newId();
          await tx.insert(astrologySnapshots).values({
            id: astrologySnapshotId,
            algorithmVersion: chart.algorithmVersion,
            inputFingerprint: fingerprint,
            result: chart,
          });
          const revisionId = newId();
          const expiresAt = new Date(
            Date.now() + this.infrastructure.environment.PROFILE_PREVIEW_TTL_SECONDS * 1000,
          );
          const [revision] = await tx
            .insert(revisions)
            .values({
              id: revisionId,
              profileId: profile.id,
              ownerUserId: input.userId,
              sequence: revisionNumber,
              status: 'CALCULATED',
              inputFingerprint: fingerprint,
              birthDataCiphertext: this.cipher.encrypt(JSON.stringify(input.birthInput)),
              locationSnapshotId,
              astrologySnapshotId,
              expiresAt,
            })
            .returning();
          if (!revision) throw new Error('Revision creation failed');
          const cards = createCards(chart);
          await tx.insert(cardBindings).values(
            cards.map((card) => ({
              id: newId(),
              revisionId,
              position: card.dimension,
              pillar: card.snapshotPillar,
              cardId: card.cardCode,
              cardVersion: 'relationship-card/1.0',
              knowledgeVersion: card.knowledgeVersion,
              rulesVersion: card.mappingVersion,
              snapshot: card,
            })),
          );
          return this.toRevisionDto(revision, chart, cards);
        });
        return { status: 201, body: dto };
      },
    );
    return result.body;
  }

  async confirm(input: {
    userId: string;
    revisionId: string;
    fingerprint: string;
    enhancedConfirmationAccepted: boolean;
    idempotencyKey: string;
    profileId?: string;
  }) {
    const result = await this.idempotency.execute(
      {
        actorKey: `user:${input.userId}`,
        operation: `confirmProfile:${input.revisionId}`,
        key: input.idempotencyKey,
      },
      { fingerprint: input.fingerprint, enhancedConfirmationAccepted: input.enhancedConfirmationAccepted },
      async () => {
        const response = await this.infrastructure.database.transaction(async (tx) => {
          const [revision] = await tx
            .select()
            .from(revisions)
            .where(
              and(
                eq(revisions.id, input.revisionId),
                eq(revisions.ownerUserId, input.userId),
                input.profileId ? eq(revisions.profileId, input.profileId) : undefined,
              ),
            )
            .for('update')
            .limit(1);
          if (!revision) {
            throw new NotFoundException({
              code: 'PROFILE_REVISION_NOT_FOUND',
              message: 'Profile revision not found',
            });
          }
          if (revision.status !== 'CALCULATED') {
            throw new ConflictException({
              code: 'PROFILE_REVISION_ALREADY_CONFIRMED',
              message: 'Profile revision is no longer confirmable',
            });
          }
          if (!revision.expiresAt || revision.expiresAt <= new Date()) {
            await tx.update(revisions).set({ status: 'EXPIRED' }).where(eq(revisions.id, revision.id));
            throw new GoneException({
              code: 'PROFILE_REVISION_EXPIRED',
              message: 'Profile revision has expired',
            });
          }
          if (revision.inputFingerprint !== input.fingerprint) {
            throw new ConflictException({
              code: 'PROFILE_FINGERPRINT_MISMATCH',
              message: 'Profile fingerprint does not match preview',
            });
          }
          const [snapshot] = await tx
            .select()
            .from(astrologySnapshots)
            .where(eq(astrologySnapshots.id, revision.astrologySnapshotId))
            .limit(1);
          const chart = snapshot?.result as BirthChartResult | undefined;
          if (chart?.requiresEnhancedConfirmation && !input.enhancedConfirmationAccepted) {
            throw new ConflictException({
              code: 'ENHANCED_CONFIRMATION_REQUIRED',
              message: 'Enhanced confirmation is required for boundary changes',
            });
          }
          const [profile] = await tx
            .select()
            .from(lifeProfiles)
            .where(and(eq(lifeProfiles.id, revision.profileId), eq(lifeProfiles.ownerUserId, input.userId)))
            .for('update')
            .limit(1);
          if (!profile)
            throw new NotFoundException({
              code: 'LIFE_PROFILE_NOT_FOUND',
              message: 'Life profile not found',
            });
          const confirmedAt = new Date();
          if (profile.activeRevisionId) {
            await tx
              .update(revisions)
              .set({ status: 'SUPERSEDED' })
              .where(
                and(eq(revisions.id, profile.activeRevisionId), eq(revisions.ownerUserId, input.userId)),
              );
          }
          await tx
            .update(revisions)
            .set({ status: 'ACTIVE', activatedAt: confirmedAt })
            .where(eq(revisions.id, revision.id));
          await tx
            .update(lifeProfiles)
            .set({ activeRevisionId: revision.id, updatedAt: confirmedAt })
            .where(eq(lifeProfiles.id, profile.id));
          return {
            profileId: profile.id,
            revisionId: revision.id,
            revisionNumber: revision.sequence,
            status: 'ACTIVE' as const,
            previousActiveRevisionId: profile.activeRevisionId,
            astrologySnapshotId: revision.astrologySnapshotId,
            confirmedAt: confirmedAt.toISOString(),
            reportImpact: {
              currentLifeReportStillAvailable: false,
              currentLifeReportBasedOnPreviousRevision: false,
              newLifeReportCanBeGenerated: false,
            },
          };
        });
        return { status: 200, body: response };
      },
    );
    return result.body;
  }

  private async findSelfProfile(userId: string) {
    const [profile] = await this.infrastructure.database
      .select()
      .from(lifeProfiles)
      .where(
        and(
          eq(lifeProfiles.ownerUserId, userId),
          eq(lifeProfiles.relationshipType, 'SELF'),
          isNull(lifeProfiles.deletedAt),
        ),
      )
      .limit(1);
    return profile;
  }

  private async findOwnedProfile(userId: string, profileId: string) {
    const [profile] = await this.infrastructure.database
      .select()
      .from(lifeProfiles)
      .where(
        and(
          eq(lifeProfiles.id, profileId),
          eq(lifeProfiles.ownerUserId, userId),
          isNull(lifeProfiles.deletedAt),
        ),
      )
      .limit(1);
    return profile;
  }

  private async findPendingRevisionId(profileId: string): Promise<string | null> {
    const [pending] = await this.infrastructure.database
      .select({ id: revisions.id })
      .from(revisions)
      .where(and(eq(revisions.profileId, profileId), eq(revisions.status, 'CALCULATED')))
      .orderBy(desc(revisions.createdAt))
      .limit(1);
    return pending?.id ?? null;
  }

  private async toRevisionDto(
    revision: RevisionRow,
    suppliedChart?: BirthChartResult,
    suppliedCards?: ReturnType<typeof createCards>,
  ): Promise<ProfileRevisionDto> {
    const chart =
      suppliedChart ??
      ((
        await this.infrastructure.database
          .select({ result: astrologySnapshots.result })
          .from(astrologySnapshots)
          .where(eq(astrologySnapshots.id, revision.astrologySnapshotId))
          .limit(1)
      )[0]?.result as BirthChartResult | undefined);
    if (!chart) throw new Error('Astrology snapshot is missing');
    const cards =
      suppliedCards ??
      (
        await this.infrastructure.database
          .select({ snapshot: cardBindings.snapshot })
          .from(cardBindings)
          .where(eq(cardBindings.revisionId, revision.id))
      ).map((row) => row.snapshot as ReturnType<typeof createCards>[number]);
    return {
      revisionId: revision.id,
      revisionNumber: revision.sequence,
      status: revision.status,
      inputFingerprint: revision.inputFingerprint,
      originalInput: JSON.parse(this.cipher.decrypt(revision.birthDataCiphertext)) as BirthInput,
      normalizedBirthData: chart.normalizedBirthData,
      calculationPreview: chart.calculationPreview,
      cards: cards
        .sort((left, right) => left.order - right.order)
        .map((card) => ({
          dimension: card.dimension,
          title: card.title,
          order: card.order,
          cardCode: card.cardCode,
          summary: card.summary,
          uncertainty: card.uncertainty,
          mappingVersion: card.mappingVersion,
          knowledgeVersion: card.knowledgeVersion,
        })),
      requiresEnhancedConfirmation: chart.requiresEnhancedConfirmation,
      warnings: chart.warnings,
      expiresAt: revision.expiresAt?.toISOString() ?? null,
      confirmedAt: revision.activatedAt?.toISOString() ?? null,
      createdAt: revision.createdAt.toISOString(),
    };
  }
}

function createCards(chart: BirthChartResult) {
  const definitions = [
    {
      dimension: 'SPACETIME' as const,
      title: '时空关系',
      order: 1,
      pillar: chart.calculationPreview.pillars.year,
    },
    {
      dimension: 'CAREER' as const,
      title: '事业关系',
      order: 2,
      pillar: chart.calculationPreview.pillars.month,
    },
    {
      dimension: 'FAMILY' as const,
      title: '家庭关系',
      order: 3,
      pillar: chart.calculationPreview.pillars.day,
    },
    {
      dimension: 'SELF' as const,
      title: '自我关系',
      order: 4,
      pillar: chart.calculationPreview.pillars.hour,
    },
  ];
  return definitions.map((definition) => ({
    dimension: definition.dimension,
    title: definition.title,
    order: definition.order,
    cardCode: definition.pillar
      ? `PILLAR_${Buffer.from(definition.pillar).toString('base64url')}`
      : 'PILLAR_UNKNOWN',
    summary: `${definition.title}采用 R1.0 固定柱位映射生成`,
    uncertainty: definition.pillar ? null : '出生时间未知，无法确定时柱',
    mappingVersion: 'pillar-card-map/1.0',
    knowledgeVersion: 'relationship-card-knowledge/1.0',
    snapshotPillar: definition.pillar ?? 'UNKNOWN',
  }));
}

function validateBirthInput(input: BirthInput): void {
  if (input.date.year < 1900 || input.date.year > 2100) invalidBirthDate();
  if (input.date.month < 1 || input.date.month > 12 || input.date.day < 1 || input.date.day > 31) {
    invalidBirthDate();
  }
  if (input.calendarType === 'SOLAR') {
    if (input.date.isLeapMonth) invalidBirthDate();
    const date = new Date(Date.UTC(input.date.year, input.date.month - 1, input.date.day));
    if (
      date.getUTCFullYear() !== input.date.year ||
      date.getUTCMonth() + 1 !== input.date.month ||
      date.getUTCDate() !== input.date.day
    ) {
      invalidBirthDate();
    }
  }
  if (input.timePrecision === 'DATE_ONLY' && (input.time.localTime || input.time.hourBranchCode)) {
    throw new BadRequestException({
      code: 'TIME_PRECISION_FIELDS_INVALID',
      message: 'DATE_ONLY cannot include time fields',
    });
  }
}

function invalidBirthDate(): never {
  throw new BadRequestException({ code: 'BIRTH_DATE_INVALID', message: 'Birth date is invalid' });
}
