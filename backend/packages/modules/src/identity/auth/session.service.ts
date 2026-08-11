import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { IdempotencyService } from '@satori/application';
import {
  auditLogs,
  consentRecords,
  identities,
  legalDocuments,
  lifeProfiles,
  newId,
  PostgresIdempotencyStore,
  preferences,
  registrationRewards,
  RuntimeInfrastructure,
  seedAccounts,
  sessions,
  smsChallenges,
  users,
  FieldCipher,
} from '@satori/infrastructure';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { timingSafeEqual } from 'node:crypto';
import { AccessTokenService } from './access-token.service.js';
import { AuthCrypto } from './auth.crypto.js';

export interface ConsentAcceptanceInput {
  documentId: string;
  version: string;
}

export interface CreateSessionCommand {
  challengeId: string;
  verificationCode: string;
  consentAcceptances: ConsentAcceptanceInput[];
  deviceId: string;
  timezone: string;
  locale?: string;
  idempotencyKey: string;
}

export interface SessionResponse {
  accessToken: string;
  accessTokenExpiresAt: string;
  sessionId: string;
  isNewUser: boolean;
  user: {
    userId: string;
    status: 'ACTIVE' | 'DELETION_PENDING';
    phoneMasked: string;
    requiresConsent: boolean;
    createdAt: string;
  };
  nextAction:
    | 'ACCEPT_CONSENTS'
    | 'CREATE_PROFILE'
    | 'CONFIRM_PROFILE'
    | 'CLAIM_REGISTRATION_REWARD'
    | 'CREATE_TODAY_DAILY_INSIGHT'
    | 'VIEW_HOME';
}

export interface SessionWithRefresh {
  data: SessionResponse;
  refreshToken: string;
}

type LoginTransactionResult =
  | {
      error:
        'SMS_CHALLENGE_NOT_FOUND' | 'SMS_CODE_EXPIRED' | 'SMS_CODE_ATTEMPTS_EXCEEDED' | 'SMS_CODE_INVALID';
    }
  | {
      sessionId: string;
      userId: string;
      userCreatedAt: Date;
      phoneMasked: string;
      isNewUser: boolean;
      requiresConsent: boolean;
    };

type ChallengeError = Extract<LoginTransactionResult, { error: string }>['error'];

@Injectable()
export class SessionService {
  private readonly idempotency: IdempotencyService;

  constructor(
    private readonly infrastructure: RuntimeInfrastructure,
    private readonly crypto: AuthCrypto,
    private readonly accessTokens: AccessTokenService,
    cipher: FieldCipher,
  ) {
    this.idempotency = new IdempotencyService(
      new PostgresIdempotencyStore(infrastructure.database, cipher),
      infrastructure.environment.IDEMPOTENCY_TTL_SECONDS * 1000,
    );
  }

  async create(command: CreateSessionCommand): Promise<SessionWithRefresh> {
    const result = await this.idempotency.execute(
      {
        actorKey: `challenge:${command.challengeId}`,
        operation: 'createSession',
        key: command.idempotencyKey,
      },
      command,
      async () => {
        const transactionResult = await this.createInTransaction(command);
        if ('error' in transactionResult) this.throwChallengeError(transactionResult.error);
        const access = await this.accessTokens.issue({
          userId: transactionResult.userId,
          sessionId: transactionResult.sessionId,
        });
        const nextAction = await this.resolveNextAction(
          transactionResult.userId,
          transactionResult.requiresConsent,
        );
        const body: SessionResponse = {
          accessToken: access.token,
          accessTokenExpiresAt: access.expiresAt.toISOString(),
          sessionId: transactionResult.sessionId,
          isNewUser: transactionResult.isNewUser,
          user: {
            userId: transactionResult.userId,
            status: 'ACTIVE',
            phoneMasked: transactionResult.phoneMasked,
            requiresConsent: transactionResult.requiresConsent,
            createdAt: transactionResult.userCreatedAt.toISOString(),
          },
          nextAction,
        };
        return { status: 201, body };
      },
    );
    return { data: result.body, refreshToken: this.crypto.deriveRefreshToken(result.body.sessionId) };
  }

  async refresh(refreshToken: string): Promise<SessionWithRefresh> {
    const tokenHash = this.crypto.hashRefreshToken(refreshToken);
    const outcome = await this.infrastructure.database.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(sessions)
        .where(eq(sessions.refreshTokenHash, tokenHash))
        .for('update')
        .limit(1);
      if (!current) return { error: 'REFRESH_TOKEN_INVALID' as const };
      if (current.revokedAt) {
        if (current.replacedBySessionId) {
          await tx
            .update(sessions)
            .set({ revokedAt: new Date() })
            .where(and(eq(sessions.familyId, current.familyId), isNull(sessions.revokedAt)));
          await tx.insert(auditLogs).values({
            id: newId(),
            actorUserId: current.userId,
            action: 'REFRESH_TOKEN_REUSE_DETECTED',
            resourceType: 'SESSION_FAMILY',
            resourceId: current.familyId,
          });
          return { error: 'REFRESH_TOKEN_REUSE_DETECTED' as const };
        }
        return { error: 'SESSION_REVOKED' as const };
      }
      if (current.expiresAt <= new Date()) return { error: 'REFRESH_TOKEN_INVALID' as const };
      const [user] = await tx.select().from(users).where(eq(users.id, current.userId)).limit(1);
      if (!user || !['ACTIVE', 'DELETION_PENDING'].includes(user.status)) {
        return { error: 'SESSION_REVOKED' as const };
      }
      const nextSessionId = newId();
      const nextRefreshToken = this.crypto.deriveRefreshToken(nextSessionId);
      await tx.insert(sessions).values({
        id: nextSessionId,
        userId: current.userId,
        familyId: current.familyId,
        refreshTokenHash: this.crypto.hashRefreshToken(nextRefreshToken),
        deviceHash: current.deviceHash,
        expiresAt: new Date(Date.now() + this.infrastructure.environment.REFRESH_TOKEN_TTL_SECONDS * 1000),
      });
      await tx
        .update(sessions)
        .set({ revokedAt: new Date(), replacedBySessionId: nextSessionId })
        .where(eq(sessions.id, current.id));
      return {
        sessionId: nextSessionId,
        userId: current.userId,
        userCreatedAt: user.createdAt,
        userStatus: user.status as 'ACTIVE' | 'DELETION_PENDING',
      };
    });
    if ('error' in outcome) {
      throw new UnauthorizedException({ code: outcome.error, message: 'Refresh session failed' });
    }
    const access = await this.accessTokens.issue({ userId: outcome.userId, sessionId: outcome.sessionId });
    return {
      refreshToken: this.crypto.deriveRefreshToken(outcome.sessionId),
      data: {
        accessToken: access.token,
        accessTokenExpiresAt: access.expiresAt.toISOString(),
        sessionId: outcome.sessionId,
        isNewUser: false,
        user: {
          userId: outcome.userId,
          status: outcome.userStatus,
          phoneMasked: '',
          requiresConsent: false,
          createdAt: outcome.userCreatedAt.toISOString(),
        },
        nextAction: 'CREATE_PROFILE',
      },
    };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.infrastructure.database
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
  }

  private async resolveNextAction(
    userId: string,
    requiresConsent: boolean,
  ): Promise<SessionResponse['nextAction']> {
    if (requiresConsent) return 'ACCEPT_CONSENTS';

    const [profile] = await this.infrastructure.database
      .select({ activeRevisionId: lifeProfiles.activeRevisionId })
      .from(lifeProfiles)
      .where(
        and(
          eq(lifeProfiles.ownerUserId, userId),
          eq(lifeProfiles.relationshipType, 'SELF'),
          isNull(lifeProfiles.deletedAt),
        ),
      )
      .limit(1);
    if (!profile) return 'CREATE_PROFILE';
    if (!profile.activeRevisionId) return 'CONFIRM_PROFILE';

    const [reward] = await this.infrastructure.database
      .select({ status: registrationRewards.status })
      .from(registrationRewards)
      .where(eq(registrationRewards.userId, userId))
      .limit(1);
    return reward?.status === 'AVAILABLE' ? 'CLAIM_REGISTRATION_REWARD' : 'VIEW_HOME';
  }

  private async createInTransaction(command: CreateSessionCommand): Promise<LoginTransactionResult> {
    return this.infrastructure.database.transaction(async (tx) => {
      const [challenge] = await tx
        .select()
        .from(smsChallenges)
        .where(eq(smsChallenges.id, command.challengeId))
        .for('update')
        .limit(1);
      if (!challenge || challenge.consumedAt || challenge.purpose !== 'LOGIN') {
        return { error: 'SMS_CHALLENGE_NOT_FOUND' as const };
      }
      if (challenge.expiresAt <= new Date()) return { error: 'SMS_CODE_EXPIRED' as const };
      if (challenge.attempts >= challenge.maxAttempts) {
        return { error: 'SMS_CODE_ATTEMPTS_EXCEEDED' as const };
      }
      const suppliedHash = this.crypto.hashVerificationCode(challenge.id, command.verificationCode);
      if (!timingSafeEqual(Buffer.from(suppliedHash, 'hex'), Buffer.from(challenge.codeHash, 'hex'))) {
        await tx
          .update(smsChallenges)
          .set({ attempts: challenge.attempts + 1 })
          .where(eq(smsChallenges.id, challenge.id));
        return {
          error:
            challenge.attempts + 1 >= challenge.maxAttempts
              ? ('SMS_CODE_ATTEMPTS_EXCEEDED' as const)
              : ('SMS_CODE_INVALID' as const),
        };
      }

      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${challenge.phoneHash}, 0))`);
      const [identity] = await tx
        .select()
        .from(identities)
        .where(and(eq(identities.provider, 'PHONE'), eq(identities.providerSubjectHash, challenge.phoneHash)))
        .limit(1);
      const isNewUser = !identity;
      const userId = identity?.userId ?? newId();
      if (isNewUser) {
        await tx.insert(users).values({ id: userId });
        await tx.insert(identities).values({
          id: newId(),
          userId,
          provider: 'PHONE',
          providerSubjectHash: challenge.phoneHash,
          phoneCiphertext: challenge.phoneCiphertext,
          phoneMasked: challenge.phoneMasked,
        });
        await tx.insert(preferences).values({
          userId,
          timezone: command.timezone,
          locale: command.locale ?? 'zh-CN',
        });
        const seedAccountId = newId();
        await tx.insert(seedAccounts).values({ id: seedAccountId, userId });
        await tx.insert(registrationRewards).values({
          id: newId(),
          userId,
          rewardType: 'NEW_USER_ONBOARDING',
          amount: this.infrastructure.environment.REGISTRATION_REWARD_AMOUNT,
        });
      }

      const requiredDocuments = await tx
        .select()
        .from(legalDocuments)
        .where(eq(legalDocuments.required, true));
      for (const acceptance of command.consentAcceptances) {
        const document = requiredDocuments.find(
          (candidate) =>
            candidate.documentId === acceptance.documentId && candidate.version === acceptance.version,
        );
        if (!document) {
          throw new BadRequestException({
            code: 'LEGAL_DOCUMENT_VERSION_INVALID',
            message: 'Legal document version is not current',
          });
        }
        await tx
          .insert(consentRecords)
          .values({
            id: newId(),
            userId,
            documentId: acceptance.documentId,
            documentVersion: acceptance.version,
            acceptedAt: new Date(),
            evidence: { source: 'SESSION_CREATE', deviceHash: challenge.deviceHash },
          })
          .onConflictDoNothing();
      }
      const accepted =
        requiredDocuments.length === 0
          ? []
          : await tx
              .select()
              .from(consentRecords)
              .where(
                and(
                  eq(consentRecords.userId, userId),
                  inArray(
                    consentRecords.documentId,
                    requiredDocuments.map((document) => document.documentId),
                  ),
                ),
              );
      const requiresConsent = requiredDocuments.some(
        (document) =>
          !accepted.some(
            (record) =>
              record.documentId === document.documentId && record.documentVersion === document.version,
          ),
      );
      const sessionId = newId();
      const refreshToken = this.crypto.deriveRefreshToken(sessionId);
      await tx.insert(sessions).values({
        id: sessionId,
        userId,
        familyId: newId(),
        refreshTokenHash: this.crypto.hashRefreshToken(refreshToken),
        deviceHash: challenge.deviceHash,
        expiresAt: new Date(Date.now() + this.infrastructure.environment.REFRESH_TOKEN_TTL_SECONDS * 1000),
      });
      await tx
        .update(smsChallenges)
        .set({ consumedAt: new Date() })
        .where(eq(smsChallenges.id, challenge.id));
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user || user.status !== 'ACTIVE') {
        throw new ConflictException({ code: 'ACCOUNT_DISABLED', message: 'Account is not active' });
      }
      return {
        sessionId,
        userId,
        userCreatedAt: user.createdAt,
        phoneMasked: challenge.phoneMasked,
        isNewUser,
        requiresConsent,
      };
    });
  }

  private throwChallengeError(code: ChallengeError): never {
    throw new BadRequestException({ code, message: 'SMS challenge could not be accepted' });
  }
}
