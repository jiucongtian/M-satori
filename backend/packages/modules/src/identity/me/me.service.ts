import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { IdempotencyService } from '@satori/application';
import {
  consentRecords,
  FieldCipher,
  identities,
  legalDocuments,
  lifeProfiles,
  newId,
  PostgresIdempotencyStore,
  preferences,
  registrationRewards,
  revisions,
  RuntimeInfrastructure,
  subjects,
  users,
} from '@satori/infrastructure';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { ConsentAcceptanceInput } from '../auth/session.service.js';

export type NextAction =
  | 'ACCEPT_CONSENTS'
  | 'CREATE_PROFILE'
  | 'CONFIRM_PROFILE'
  | 'CLAIM_REGISTRATION_REWARD'
  | 'CREATE_TODAY_DAILY_INSIGHT'
  | 'VIEW_HOME';

export interface MeProjection {
  userId: string;
  status: string;
  phoneMasked: string;
  requiresConsent: boolean;
  createdAt: string;
  preferences: {
    timezone: string;
    timezoneSource: 'DEVICE_INITIALIZED' | 'USER_SELECTED';
    locale: string;
    updatedAt: string;
  };
  pendingConsents: {
    documentId: string;
    type: string;
    version: string;
    title: string;
    required: boolean;
    publishedAt: string;
  }[];
  profileState: 'NOT_CREATED' | 'CALCULATED' | 'ACTIVE';
  nextAction: NextAction;
}

@Injectable()
export class MeService {
  private readonly idempotency: IdempotencyService;

  constructor(
    private readonly infrastructure: RuntimeInfrastructure,
    cipher: FieldCipher,
  ) {
    this.idempotency = new IdempotencyService(
      new PostgresIdempotencyStore(infrastructure.database, cipher),
      infrastructure.policy.idempotency.ttlSeconds * 1000,
    );
  }

  async get(userId: string): Promise<MeProjection> {
    const [row] = await this.infrastructure.database
      .select({ user: users, identity: identities, preference: preferences })
      .from(users)
      .innerJoin(identities, eq(identities.userId, users.id))
      .innerJoin(preferences, eq(preferences.userId, users.id))
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
    const consent = await this.consentState(userId);
    const profileState = await this.profileState(userId);
    const nextAction = await this.resolveNextAction(userId, consent.requiresConsent, profileState);
    return {
      userId: row.user.id,
      status: row.user.status,
      phoneMasked: row.identity.phoneMasked ?? '',
      requiresConsent: consent.requiresConsent,
      createdAt: row.user.createdAt.toISOString(),
      preferences: {
        timezone: row.preference.timezone,
        timezoneSource: 'DEVICE_INITIALIZED',
        locale: row.preference.locale,
        updatedAt: row.preference.updatedAt.toISOString(),
      },
      pendingConsents: consent.pending,
      profileState,
      nextAction,
    };
  }

  async updatePreferences(
    userId: string,
    input: { timezone?: string; locale?: string },
  ): Promise<MeProjection['preferences']> {
    if (!input.timezone && !input.locale) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'No preference was supplied' });
    }
    if (input.timezone && !isTimeZone(input.timezone)) {
      throw new BadRequestException({
        code: 'TIMEZONE_INVALID',
        message: 'Timezone must be a valid IANA zone',
      });
    }
    const [updated] = await this.infrastructure.database
      .update(preferences)
      .set({
        ...(input.timezone ? { timezone: input.timezone } : {}),
        ...(input.locale ? { locale: input.locale } : {}),
        updatedAt: new Date(),
      })
      .where(eq(preferences.userId, userId))
      .returning();
    if (!updated) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
    return {
      timezone: updated.timezone,
      timezoneSource: 'USER_SELECTED',
      locale: updated.locale,
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  async acceptConsents(input: {
    userId: string;
    sessionId: string;
    requestId: string;
    idempotencyKey: string;
    acceptances: ConsentAcceptanceInput[];
  }): Promise<{
    records: (ConsentAcceptanceInput & { acceptedAt: string })[];
    requiresConsent: boolean;
    nextAction: NextAction;
  }> {
    const result = await this.idempotency.execute(
      { actorKey: `user:${input.userId}`, operation: 'acceptConsents', key: input.idempotencyKey },
      input.acceptances,
      async () => {
        const required = await this.infrastructure.database
          .select()
          .from(legalDocuments)
          .where(eq(legalDocuments.required, true));
        const acceptedAt = new Date();
        const records: (ConsentAcceptanceInput & { acceptedAt: string })[] = [];
        for (const acceptance of input.acceptances) {
          if (
            !required.some(
              (document) =>
                document.documentId === acceptance.documentId && document.version === acceptance.version,
            )
          ) {
            throw new BadRequestException({
              code: 'LEGAL_DOCUMENT_VERSION_INVALID',
              message: 'Legal document version is not current',
            });
          }
          await this.infrastructure.database
            .insert(consentRecords)
            .values({
              id: newId(),
              userId: input.userId,
              documentId: acceptance.documentId,
              documentVersion: acceptance.version,
              acceptedAt,
              evidence: { requestId: input.requestId, sessionId: input.sessionId, source: 'ME_CONSENTS' },
            })
            .onConflictDoNothing();
          records.push({ ...acceptance, acceptedAt: acceptedAt.toISOString() });
        }
        const state = await this.consentState(input.userId);
        const profileState = await this.profileState(input.userId);
        return {
          status: 201,
          body: {
            records,
            requiresConsent: state.requiresConsent,
            nextAction: await this.resolveNextAction(input.userId, state.requiresConsent, profileState),
          },
        };
      },
    );
    return result.body;
  }

  private async resolveNextAction(
    userId: string,
    requiresConsent: boolean,
    profileState: MeProjection['profileState'],
  ): Promise<NextAction> {
    if (requiresConsent) return 'ACCEPT_CONSENTS';
    if (profileState === 'NOT_CREATED') return 'CREATE_PROFILE';
    if (profileState === 'CALCULATED') return 'CONFIRM_PROFILE';
    const [reward] = await this.infrastructure.database
      .select({ status: registrationRewards.status })
      .from(registrationRewards)
      .where(eq(registrationRewards.userId, userId))
      .limit(1);
    return reward?.status === 'AVAILABLE' ? 'CLAIM_REGISTRATION_REWARD' : 'VIEW_HOME';
  }

  private async consentState(userId: string): Promise<{
    requiresConsent: boolean;
    pending: MeProjection['pendingConsents'];
  }> {
    const required = await this.infrastructure.database
      .select()
      .from(legalDocuments)
      .where(eq(legalDocuments.required, true));
    const accepted =
      required.length === 0
        ? []
        : await this.infrastructure.database
            .select()
            .from(consentRecords)
            .where(
              and(
                eq(consentRecords.userId, userId),
                inArray(
                  consentRecords.documentId,
                  required.map((document) => document.documentId),
                ),
              ),
            );
    const pendingRows = required.filter(
      (document) =>
        !accepted.some(
          (record) =>
            record.documentId === document.documentId && record.documentVersion === document.version,
        ),
    );
    return {
      requiresConsent: pendingRows.length > 0,
      pending: pendingRows.map((document) => ({
        documentId: document.documentId,
        type: document.type,
        version: document.version,
        title: document.title,
        required: document.required,
        publishedAt: document.publishedAt.toISOString(),
      })),
    };
  }

  private async profileState(userId: string): Promise<MeProjection['profileState']> {
    const [profile] = await this.infrastructure.database
      .select({ activeRevisionId: lifeProfiles.activeRevisionId, revisionStatus: revisions.status })
      .from(lifeProfiles)
      .innerJoin(subjects, eq(subjects.id, lifeProfiles.subjectId))
      .leftJoin(revisions, and(eq(revisions.profileId, lifeProfiles.id), eq(revisions.status, 'CALCULATED')))
      .where(
        and(eq(lifeProfiles.ownerUserId, userId), eq(subjects.type, 'SELF'), isNull(lifeProfiles.deletedAt)),
      )
      .limit(1);
    if (!profile) return 'NOT_CREATED';
    if (profile.revisionStatus === 'CALCULATED') return 'CALCULATED';
    return profile.activeRevisionId ? 'ACTIVE' : 'NOT_CREATED';
  }
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
