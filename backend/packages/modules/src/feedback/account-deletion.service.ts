import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { IdempotencyService } from '@satori/application';
import {
  auditLogs,
  dailyInsights,
  deletionRequests,
  feedback,
  FieldCipher,
  identities,
  lifeProfiles,
  newId,
  outbox,
  PostgresIdempotencyStore,
  RuntimeInfrastructure,
  seedAccounts,
  sessions,
  subjects,
  users,
} from '@satori/infrastructure';
import { and, count, eq, inArray, isNull, ne } from 'drizzle-orm';
import { SmsChallengeService } from '../identity/auth/sms-challenge.service.js';

@Injectable()
export class AccountDeletionService {
  private readonly idempotency: IdempotencyService;

  constructor(
    private readonly infrastructure: RuntimeInfrastructure,
    cipher: FieldCipher,
    private readonly sms: SmsChallengeService,
  ) {
    this.idempotency = new IdempotencyService(
      new PostgresIdempotencyStore(infrastructure.database, cipher),
      infrastructure.policy.idempotency.ttlSeconds * 1000,
    );
  }

  async create(input: {
    userId: string;
    currentSessionId: string;
    smsChallengeId: string;
    verificationCode: string;
    reason: string;
    idempotencyKey: string;
  }) {
    const result = await this.idempotency.execute(
      {
        actorKey: `user:${input.userId}`,
        operation: 'createAccountDeletionRequest',
        key: input.idempotencyKey,
      },
      {
        smsChallengeId: input.smsChallengeId,
        verificationCode: input.verificationCode,
        reason: input.reason,
      },
      async () => {
        await this.sms.consumeForAccountDeletion(input.userId, input.smsChallengeId, input.verificationCode);
        const request = await this.infrastructure.database.transaction(async (tx) => {
          const [existing] = await tx
            .select()
            .from(deletionRequests)
            .where(
              and(
                eq(deletionRequests.userId, input.userId),
                inArray(deletionRequests.status, ['PENDING', 'PROCESSING']),
              ),
            )
            .limit(1);
          if (existing) return existing;
          const profileRows = await tx
            .select({ profileCount: count(lifeProfiles.id) })
            .from(lifeProfiles)
            .where(and(eq(lifeProfiles.ownerUserId, input.userId), isNull(lifeProfiles.deletedAt)));
          const insightRows = await tx
            .select({ insightCount: count(dailyInsights.id) })
            .from(dailyInsights)
            .where(eq(dailyInsights.ownerUserId, input.userId));
          const [account] = await tx
            .select()
            .from(seedAccounts)
            .where(eq(seedAccounts.userId, input.userId))
            .limit(1);
          const profileCount = profileRows[0]?.profileCount ?? 0;
          const insightCount = insightRows[0]?.insightCount ?? 0;
          const requestedAt = new Date();
          const [created] = await tx
            .insert(deletionRequests)
            .values({
              id: newId(),
              userId: input.userId,
              status: 'PENDING',
              requestedAt,
              cancellableUntil: new Date(
                requestedAt.getTime() +
                  this.infrastructure.policy.accountDeletion.cancellationHours * 60 * 60 * 1000,
              ),
              impactSnapshot: {
                reason: input.reason,
                profileCount,
                insightCount,
                ledgerRetained: true,
                auditRetained: true,
                seedAccount: account
                  ? { totalEarned: account.totalEarned, totalSpent: account.totalSpent }
                  : null,
              },
            })
            .returning();
          if (!created) throw new Error('Deletion request creation failed');
          await tx
            .update(users)
            .set({ status: 'DELETION_PENDING', updatedAt: requestedAt })
            .where(eq(users.id, input.userId));
          await tx
            .update(sessions)
            .set({ revokedAt: requestedAt })
            .where(
              and(
                eq(sessions.userId, input.userId),
                ne(sessions.id, input.currentSessionId),
                isNull(sessions.revokedAt),
              ),
            );
          await tx.insert(auditLogs).values({
            id: newId(),
            actorUserId: input.userId,
            action: 'ACCOUNT_DELETION_REQUESTED',
            resourceType: 'ACCOUNT_DELETION_REQUEST',
            resourceId: created.id,
            metadata: { reason: input.reason },
          });
          await tx.insert(outbox).values({
            id: newId(),
            aggregateType: 'ACCOUNT_DELETION_REQUEST',
            aggregateId: created.id,
            eventType: 'account.deletion.scheduled',
            payload: {
              userId: input.userId,
              requestId: created.id,
              executeAfter: created.cancellableUntil.toISOString(),
            },
            availableAt: created.cancellableUntil,
          });
          return created;
        });
        return { status: 202, body: this.toDto(request) };
      },
    );
    return result.body;
  }

  async get(userId: string) {
    const [request] = await this.infrastructure.database
      .select()
      .from(deletionRequests)
      .where(
        and(
          eq(deletionRequests.userId, userId),
          inArray(deletionRequests.status, ['PENDING', 'PROCESSING', 'COMPLETED', 'PARTIAL_FAILURE']),
        ),
      )
      .orderBy(deletionRequests.createdAt)
      .limit(1);
    if (!request) this.notFound();
    return this.toDto(request);
  }

  async cancel(userId: string): Promise<void> {
    await this.infrastructure.database.transaction(async (tx) => {
      const [request] = await tx
        .select()
        .from(deletionRequests)
        .where(and(eq(deletionRequests.userId, userId), eq(deletionRequests.status, 'PENDING')))
        .for('update')
        .limit(1);
      if (!request) {
        const [existing] = await tx
          .select()
          .from(deletionRequests)
          .where(eq(deletionRequests.userId, userId))
          .limit(1);
        if (existing)
          throw new ConflictException({
            code: 'ACCOUNT_DELETION_NOT_CANCELLABLE',
            message: 'Deletion request cannot be cancelled',
          });
        this.notFound();
      }
      if (request.cancellableUntil <= new Date())
        throw new ConflictException({
          code: 'ACCOUNT_DELETION_NOT_CANCELLABLE',
          message: 'Deletion request cannot be cancelled',
        });
      const cancelledAt = new Date();
      await tx
        .update(deletionRequests)
        .set({ status: 'CANCELLED', cancelledAt })
        .where(eq(deletionRequests.id, request.id));
      await tx.update(users).set({ status: 'ACTIVE', updatedAt: cancelledAt }).where(eq(users.id, userId));
      await tx.insert(auditLogs).values({
        id: newId(),
        actorUserId: userId,
        action: 'ACCOUNT_DELETION_CANCELLED',
        resourceType: 'ACCOUNT_DELETION_REQUEST',
        resourceId: request.id,
      });
    });
  }

  async process(requestId: string): Promise<void> {
    await this.infrastructure.database.transaction(async (tx) => {
      const [request] = await tx
        .select()
        .from(deletionRequests)
        .where(eq(deletionRequests.id, requestId))
        .for('update')
        .limit(1);
      if (!request || request.status !== 'PENDING' || request.cancellableUntil > new Date()) return;
      const now = new Date();
      await tx
        .update(deletionRequests)
        .set({ status: 'PROCESSING' })
        .where(eq(deletionRequests.id, request.id));
      await tx.update(users).set({ status: 'DELETING', updatedAt: now }).where(eq(users.id, request.userId));
      await tx
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.userId, request.userId), isNull(sessions.revokedAt)));
      await tx
        .update(subjects)
        .set({ deletedAt: now })
        .where(and(eq(subjects.ownerUserId, request.userId), isNull(subjects.deletedAt)));
      await tx
        .update(lifeProfiles)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(lifeProfiles.ownerUserId, request.userId), isNull(lifeProfiles.deletedAt)));
      await tx
        .update(identities)
        .set({ phoneCiphertext: null, phoneMasked: null })
        .where(eq(identities.userId, request.userId));
      await tx.update(feedback).set({ commentCiphertext: null }).where(eq(feedback.userId, request.userId));
      await tx
        .update(users)
        .set({ status: 'DISABLED', deletedAt: now, updatedAt: now })
        .where(eq(users.id, request.userId));
      await tx
        .update(deletionRequests)
        .set({ status: 'COMPLETED', completedAt: now })
        .where(eq(deletionRequests.id, request.id));
      await tx.insert(auditLogs).values({
        id: newId(),
        actorUserId: request.userId,
        action: 'ACCOUNT_DELETION_COMPLETED',
        resourceType: 'ACCOUNT_DELETION_REQUEST',
        resourceId: request.id,
      });
      await tx.insert(outbox).values({
        id: newId(),
        aggregateType: 'USER',
        aggregateId: request.userId,
        eventType: 'account.deletion.completed',
        payload: { userId: request.userId, requestId: request.id },
      });
    });
  }

  private toDto(request: typeof deletionRequests.$inferSelect) {
    return {
      requestId: request.id,
      status: request.status === 'PROCESSING' ? 'DELETING' : request.status,
      requestedAt: request.requestedAt.toISOString(),
      scheduledExecutionAt: request.cancellableUntil.toISOString(),
      canCancel: request.status === 'PENDING' && request.cancellableUntil > new Date(),
    };
  }

  private notFound(): never {
    throw new NotFoundException({
      code: 'ACCOUNT_DELETION_REQUEST_NOT_FOUND',
      message: 'Account deletion request not found',
    });
  }
}
