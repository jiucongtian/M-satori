import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CursorCodec, IdempotencyService, normalizePageLimit } from '@satori/application';
import type { ApiListEnvelope } from '@satori/contracts';
import {
  dailyInsights,
  FieldCipher,
  generationTasks,
  groups,
  lifeProfiles,
  newId,
  outbox,
  PostgresIdempotencyStore,
  revisions,
  RuntimeInfrastructure,
  subjects,
} from '@satori/infrastructure';
import { and, asc, count, desc, eq, inArray, isNull, lt, or } from 'drizzle-orm';

type RelationshipType = 'FAMILY' | 'FRIEND' | 'COLLEAGUE' | 'OTHER';

@Injectable()
export class ProfileLibraryService {
  private readonly cursors: CursorCodec;
  private readonly idempotency: IdempotencyService;

  constructor(
    private readonly infrastructure: RuntimeInfrastructure,
    private readonly cipher: FieldCipher,
  ) {
    this.cursors = new CursorCodec(infrastructure.environment.CURSOR_SIGNING_SECRET);
    this.idempotency = new IdempotencyService(
      new PostgresIdempotencyStore(infrastructure.database, cipher),
      infrastructure.environment.IDEMPOTENCY_TTL_SECONDS * 1000,
    );
  }

  async list(
    userId: string,
    input: { cursor?: string; limit?: number },
  ): Promise<ApiListEnvelope<Awaited<ReturnType<ProfileLibraryService['get']>>>> {
    const limit = normalizePageLimit(input.limit);
    const cursor = input.cursor ? this.cursors.decode(input.cursor) : null;
    const rows = await this.infrastructure.database
      .select({ profile: lifeProfiles, subject: subjects })
      .from(lifeProfiles)
      .innerJoin(subjects, eq(subjects.id, lifeProfiles.subjectId))
      .where(
        and(
          eq(lifeProfiles.ownerUserId, userId),
          isNull(lifeProfiles.deletedAt),
          isNull(subjects.deletedAt),
          cursor
            ? or(
                lt(lifeProfiles.createdAt, new Date(cursor.createdAt)),
                and(eq(lifeProfiles.createdAt, new Date(cursor.createdAt)), lt(lifeProfiles.id, cursor.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(lifeProfiles.createdAt), desc(lifeProfiles.id))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const data = await Promise.all(page.map((row) => this.toDto(row.profile, row.subject)));
    const last = page.at(-1)?.profile;
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

  async create(input: {
    userId: string;
    displayName: string;
    relationshipType: RelationshipType;
    groupId?: string | null;
    idempotencyKey: string;
  }) {
    const result = await this.idempotency.execute(
      { actorKey: `user:${input.userId}`, operation: 'createOtherLifeProfile', key: input.idempotencyKey },
      {
        displayName: input.displayName,
        relationshipType: input.relationshipType,
        groupId: input.groupId ?? null,
      },
      async () => {
        const profile = await this.infrastructure.database.transaction(async (tx) => {
          if (input.groupId) await this.requireGroup(input.userId, input.groupId, tx);
          const [subject] = await tx
            .insert(subjects)
            .values({
              id: newId(),
              ownerUserId: input.userId,
              type: 'OTHER',
              displayNameCiphertext: this.cipher.encrypt(input.displayName),
            })
            .returning();
          if (!subject) throw new Error('Subject creation failed');
          const [created] = await tx
            .insert(lifeProfiles)
            .values({
              id: newId(),
              subjectId: subject.id,
              ownerUserId: input.userId,
              groupId: input.groupId ?? null,
              relationshipType: input.relationshipType,
            })
            .returning();
          if (!created) throw new Error('Profile creation failed');
          return this.toDto(created, subject);
        });
        return { status: 201, body: profile };
      },
    );
    return result.body;
  }

  async get(userId: string, profileId: string) {
    const [row] = await this.infrastructure.database
      .select({ profile: lifeProfiles, subject: subjects })
      .from(lifeProfiles)
      .innerJoin(subjects, eq(subjects.id, lifeProfiles.subjectId))
      .where(
        and(
          eq(lifeProfiles.id, profileId),
          eq(lifeProfiles.ownerUserId, userId),
          isNull(lifeProfiles.deletedAt),
          isNull(subjects.deletedAt),
        ),
      )
      .limit(1);
    if (!row) this.notFound();
    return this.toDto(row.profile, row.subject);
  }

  async patch(
    userId: string,
    profileId: string,
    patch: { displayName?: string; relationshipType?: RelationshipType; groupId?: string | null },
  ) {
    await this.infrastructure.database.transaction(async (tx) => {
      const [row] = await tx
        .select({ profile: lifeProfiles, subject: subjects })
        .from(lifeProfiles)
        .innerJoin(subjects, eq(subjects.id, lifeProfiles.subjectId))
        .where(
          and(
            eq(lifeProfiles.id, profileId),
            eq(lifeProfiles.ownerUserId, userId),
            isNull(lifeProfiles.deletedAt),
            isNull(subjects.deletedAt),
          ),
        )
        .for('update')
        .limit(1);
      if (!row) this.notFound();
      if (row.subject.type === 'SELF' && patch.relationshipType) {
        throw new ConflictException({
          code: 'SELF_PROFILE_RELATIONSHIP_IMMUTABLE',
          message: 'SELF profile relationship type cannot be changed',
        });
      }
      if (patch.groupId) await this.requireGroup(userId, patch.groupId, tx);
      if (patch.displayName !== undefined) {
        await tx
          .update(subjects)
          .set({ displayNameCiphertext: this.cipher.encrypt(patch.displayName) })
          .where(eq(subjects.id, row.subject.id));
      }
      await tx
        .update(lifeProfiles)
        .set({
          ...(patch.relationshipType ? { relationshipType: patch.relationshipType } : {}),
          ...(patch.groupId !== undefined ? { groupId: patch.groupId } : {}),
          updatedAt: new Date(),
        })
        .where(eq(lifeProfiles.id, profileId));
    });
    return this.get(userId, profileId);
  }

  async delete(userId: string, profileId: string, idempotencyKey: string) {
    const result = await this.idempotency.execute(
      { actorKey: `user:${userId}`, operation: `deleteLifeProfile:${profileId}`, key: idempotencyKey },
      {},
      async () => {
        const accepted = await this.infrastructure.database.transaction(async (tx) => {
          const [profile] = await tx
            .select()
            .from(lifeProfiles)
            .where(
              and(
                eq(lifeProfiles.id, profileId),
                eq(lifeProfiles.ownerUserId, userId),
                isNull(lifeProfiles.deletedAt),
              ),
            )
            .for('update')
            .limit(1);
          if (!profile) this.notFound();
          if (profile.relationshipType === 'SELF') {
            throw new ConflictException({
              code: 'SELF_PROFILE_DELETE_NOT_ALLOWED',
              message: 'SELF profile cannot be deleted',
            });
          }
          const [activeTask] = await tx
            .select({ id: generationTasks.id })
            .from(generationTasks)
            .innerJoin(dailyInsights, eq(dailyInsights.id, generationTasks.targetId))
            .where(
              and(
                eq(dailyInsights.subjectId, profile.subjectId),
                inArray(generationTasks.status, ['QUEUED', 'RUNNING']),
              ),
            )
            .limit(1);
          if (activeTask) {
            throw new ConflictException({
              code: 'PROFILE_DELETION_BLOCKED',
              message: 'Profile has an active generation task',
            });
          }
          const deletedAt = new Date();
          await tx
            .update(lifeProfiles)
            .set({ deletedAt, updatedAt: deletedAt })
            .where(eq(lifeProfiles.id, profile.id));
          await tx.update(subjects).set({ deletedAt }).where(eq(subjects.id, profile.subjectId));
          const requestId = newId();
          await tx.insert(outbox).values({
            id: requestId,
            aggregateType: 'LIFE_PROFILE',
            aggregateId: profile.id,
            eventType: 'profile.cleanup.requested',
            payload: { ownerUserId: userId, profileId: profile.id, subjectId: profile.subjectId },
          });
          return { requestId, status: 'PENDING' as const };
        });
        return { status: 202, body: accepted };
      },
    );
    return result.body;
  }

  async listGroups(userId: string) {
    const rows = await this.infrastructure.database
      .select({ group: groups, profileCount: count(lifeProfiles.id) })
      .from(groups)
      .leftJoin(lifeProfiles, and(eq(lifeProfiles.groupId, groups.id), isNull(lifeProfiles.deletedAt)))
      .where(eq(groups.ownerUserId, userId))
      .groupBy(groups.id)
      .orderBy(asc(groups.sortOrder), asc(groups.createdAt), asc(groups.id));
    return rows.map(({ group, profileCount }) => this.groupDto(group, profileCount));
  }

  async createGroup(input: { userId: string; name: string; sortOrder: number; idempotencyKey: string }) {
    const result = await this.idempotency.execute(
      { actorKey: `user:${input.userId}`, operation: 'createLifeProfileGroup', key: input.idempotencyKey },
      { name: input.name, sortOrder: input.sortOrder },
      async () => {
        const [group] = await this.infrastructure.database
          .insert(groups)
          .values({ id: newId(), ownerUserId: input.userId, name: input.name, sortOrder: input.sortOrder })
          .returning();
        if (!group) throw new Error('Group creation failed');
        return { status: 201, body: this.groupDto(group, 0) };
      },
    );
    return result.body;
  }

  async patchGroup(userId: string, groupId: string, patch: { name: string; sortOrder: number }) {
    const [group] = await this.infrastructure.database
      .update(groups)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(groups.id, groupId), eq(groups.ownerUserId, userId)))
      .returning();
    if (!group) this.groupNotFound();
    const [{ value = 0 } = {}] = await this.infrastructure.database
      .select({ value: count(lifeProfiles.id) })
      .from(lifeProfiles)
      .where(and(eq(lifeProfiles.groupId, groupId), isNull(lifeProfiles.deletedAt)));
    return this.groupDto(group, value);
  }

  async deleteGroup(userId: string, groupId: string): Promise<void> {
    await this.infrastructure.database.transaction(async (tx) => {
      const [group] = await tx
        .select({ id: groups.id })
        .from(groups)
        .where(and(eq(groups.id, groupId), eq(groups.ownerUserId, userId)))
        .for('update')
        .limit(1);
      if (!group) this.groupNotFound();
      await tx
        .update(lifeProfiles)
        .set({ groupId: null, updatedAt: new Date() })
        .where(eq(lifeProfiles.groupId, groupId));
      await tx.delete(groups).where(eq(groups.id, groupId));
    });
  }

  private async toDto(profile: typeof lifeProfiles.$inferSelect, subject: typeof subjects.$inferSelect) {
    const [pending] = await this.infrastructure.database
      .select({ id: revisions.id })
      .from(revisions)
      .where(and(eq(revisions.profileId, profile.id), eq(revisions.status, 'CALCULATED')))
      .orderBy(desc(revisions.createdAt))
      .limit(1);
    return {
      profileId: profile.id,
      subjectId: profile.subjectId,
      subjectType: subject.type,
      displayName: this.cipher.decrypt(subject.displayNameCiphertext),
      relationshipType: profile.relationshipType,
      groupId: profile.groupId,
      currentRevisionId: profile.activeRevisionId,
      pendingRevisionId: pending?.id ?? null,
      state: profile.activeRevisionId
        ? ('ACTIVE' as const)
        : pending
          ? ('CALCULATED' as const)
          : ('NOT_CREATED' as const),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }

  private groupDto(group: typeof groups.$inferSelect, profileCount: number) {
    return {
      groupId: group.id,
      name: group.name,
      sortOrder: group.sortOrder,
      profileCount,
      updatedAt: group.updatedAt.toISOString(),
    };
  }

  private async requireGroup(
    userId: string,
    groupId: string,
    database: Pick<RuntimeInfrastructure['database'], 'select'>,
  ) {
    const [group] = await database
      .select({ id: groups.id })
      .from(groups)
      .where(and(eq(groups.id, groupId), eq(groups.ownerUserId, userId)))
      .limit(1);
    if (!group) this.groupNotFound();
  }

  private notFound(): never {
    throw new NotFoundException({ code: 'LIFE_PROFILE_NOT_FOUND', message: 'Life profile not found' });
  }

  private groupNotFound(): never {
    throw new NotFoundException({ code: 'PROFILE_GROUP_NOT_FOUND', message: 'Profile group not found' });
  }
}
