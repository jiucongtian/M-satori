import {
  ConflictException,
  Injectable,
  Logger,
  type OnModuleInit,
  type OnApplicationShutdown,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  auditLogs,
  identities,
  lifeProfiles,
  subjects,
  users,
  FieldCipher,
  RuntimeInfrastructure,
  type Database,
} from '@satori/infrastructure';
import { and, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { v5 as uuidv5 } from 'uuid';
import { AuthCrypto } from '../identity/auth/auth.crypto.js';
import { executePlanInTransaction } from './importer.js';
import { buildPlan, type Mapping } from './plan.js';
import { digest, object } from './source.js';
import { MiniappImportSource, type MiniappSourceMatch } from './miniapp-import.source.js';

const decisionNamespace = 'd52db59f-cc22-4ba0-ac69-cf515d57e301';
const action = 'MINIAPP_IMPORT_DECIDED';
const branches = ['ZI', 'CHOU', 'YIN', 'MAO', 'CHEN', 'SI', 'WU', 'WEI', 'SHEN', 'YOU', 'XU', 'HAI'] as const;
export type MiniappImportStatus =
  | { status: 'NONE' }
  | { status: 'OFFERED'; offerId: string; profileCount: number }
  | { status: 'ACCEPTED'; importedCount: number }
  | { status: 'DECLINED'; importedCount: number }
  | { status: 'COMPLETED'; importedCount: number };

@Injectable()
export class MiniappImportService implements OnModuleInit, OnApplicationShutdown {
  private timer: ReturnType<typeof setInterval> | undefined;
  private recoveryRunning = false;
  private recoveryAfter: { createdAt: Date; id: string } | undefined;
  private readonly logger = new Logger(MiniappImportService.name);

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.recoverPendingImports().catch(() => this.logger.warn('MINIAPP_IMPORT_RECOVERY_UNAVAILABLE'));
    }, 30_000);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  constructor(
    private readonly infrastructure: RuntimeInfrastructure,
    private readonly cipher: FieldCipher,
    private readonly crypto: AuthCrypto,
    private readonly source: MiniappImportSource,
  ) {}

  async status(userId: string): Promise<MiniappImportStatus> {
    const db = this.infrastructure.database;
    const phoneHash = await this.phoneHash(db, userId);
    const prior = await this.priorDecision(db, userId, phoneHash);
    if (prior) return prior;
    const match = phoneHash ? this.source.match(phoneHash) : null;
    if (!match) return { status: 'NONE' };
    const candidates = await this.unclaimed(db, userId, match);
    if (!candidates.length) return { status: 'NONE' };
    return {
      status: 'OFFERED',
      offerId: this.offerId(userId, phoneHash!, match),
      profileCount: candidates.length,
    };
  }

  async decide(
    userId: string,
    input: { offerId: string; decision: 'ACCEPT' | 'DECLINE'; idempotencyKey: string },
  ): Promise<MiniappImportStatus> {
    const chosen = await this.infrastructure.database.transaction(async (tx) => {
      const db = tx;
      const phoneHash = await this.phoneHash(db, userId);
      const match = phoneHash ? this.source.match(phoneHash) : null;
      // Same lock order as the offline CLI, so the two paths cannot import the same source concurrently.
      if (match)
        await db.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`miniapp-import:${match.source.namespace}`}, 0))`,
        );
      const [user] = await db.select().from(users).where(eq(users.id, userId)).for('update');
      if (!user || user.status !== 'ACTIVE' || user.deletedAt) this.notFound();
      if (phoneHash)
        await db.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`miniapp-decision:${phoneHash}`}, 0))`,
        );
      const prior = await this.priorDecision(db, userId, phoneHash);
      // The first committed choice wins across devices and across idempotency-key expiry.
      if (prior) return prior;
      if (!phoneHash || !match || input.offerId !== this.offerId(userId, phoneHash, match))
        this.offerUnavailable();
      if (phoneHash !== (await this.phoneHash(db, userId))) this.offerUnavailable();
      const candidates = await this.unclaimed(db, userId, match);
      if (!candidates.length) this.offerUnavailable();
      const response: MiniappImportStatus = {
        status: input.decision === 'ACCEPT' ? 'ACCEPTED' : 'DECLINED',
        importedCount: 0,
      };
      await db.insert(auditLogs).values({
        id: this.decisionId(phoneHash),
        actorUserId: userId,
        action,
        resourceType: 'USER',
        resourceId: userId,
        metadata: {
          version: 1,
          decision: input.decision,
          status: response.status,
          importedCount: 0,
          profileMarkerIds: candidates.map((candidate) => candidate.markerId),
          offerId: input.offerId,
          sourceUserHash: digest([match.source.namespace, match.sourceUserId]),
          archiveHash: match.sourceHash,
          idempotencyKeyHash: digest(input.idempotencyKey),
          noticeVersion: 'miniapp-once-beijing-v1',
        },
      });
      return response;
    });
    if (chosen.status !== 'ACCEPTED') return chosen;
    // Consent has committed before any calculation. A failed import can never undo the user's choice.
    try {
      return await this.completeAccepted(userId);
    } catch {
      this.logger.warn('MINIAPP_IMPORT_PENDING_RETRY');
      return chosen;
    }
  }

  async recoverPendingImports() {
    if (this.recoveryRunning) return;
    this.recoveryRunning = true;
    try {
      const after = this.recoveryAfter;
      const rows = await this.infrastructure.database
        .select({ userId: auditLogs.actorUserId, id: auditLogs.id, createdAt: auditLogs.createdAt })
        .from(auditLogs)
        .innerJoin(users, eq(users.id, auditLogs.actorUserId))
        .where(
          and(
            eq(auditLogs.action, action),
            eq(users.status, 'ACTIVE'),
            isNull(users.deletedAt),
            sql`${auditLogs.metadata}->>'decision' = 'ACCEPT'`,
            sql`not exists (select 1 from audit_logs completed where completed.action = 'MINIAPP_IMPORT_COMPLETED' and completed.resource_id = ${auditLogs.resourceId})`,
            after
              ? or(
                  gt(auditLogs.createdAt, after.createdAt),
                  and(eq(auditLogs.createdAt, after.createdAt), gt(auditLogs.id, after.id)),
                )
              : undefined,
          ),
        )
        .orderBy(auditLogs.createdAt, auditLogs.id)
        .limit(20);
      const last = rows.at(-1);
      // Rotate past failed receipts too, so an unavailable old batch cannot starve later users.
      this.recoveryAfter =
        rows.length === 20 && last ? { createdAt: last.createdAt, id: last.id } : undefined;
      for (const row of rows) {
        if (!row.userId) continue;
        try {
          await this.completeAccepted(row.userId);
        } catch {
          this.logger.warn('MINIAPP_IMPORT_PENDING_RETRY');
        }
      }
    } finally {
      this.recoveryRunning = false;
    }
  }

  private async completeAccepted(userId: string): Promise<MiniappImportStatus> {
    const [decision] = await this.infrastructure.database
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.action, action),
          eq(auditLogs.actorUserId, userId),
          eq(auditLogs.resourceId, userId),
        ),
      )
      .limit(1);
    if (!decision || object(decision.metadata).decision !== 'ACCEPT') this.offerUnavailable();
    const metadata = object(decision.metadata);
    const match = await this.source.acceptedMatch(
      String(metadata.sourceUserHash),
      String(metadata.archiveHash),
    );
    if (!match) throw new Error('MINIAPP_ACCEPTED_SOURCE_UNAVAILABLE');
    const markerIds = metadata.profileMarkerIds;
    if (!Array.isArray(markerIds) || !markerIds.length) throw new Error('MINIAPP_ACCEPTED_SELECTION_INVALID');
    const selected = match.profiles.filter((profile) => markerIds.includes(profile.markerId));
    if (selected.length !== markerIds.length) throw new Error('MINIAPP_ACCEPTED_SELECTION_CHANGED');
    return this.infrastructure.database.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`miniapp-import:${match.source.namespace}`}, 0))`,
      );
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
      if (!user || user.status !== 'ACTIVE' || user.deletedAt) this.notFound();
      const completionId = uuidv5(`completed:${decision.id}`, decisionNamespace);
      const [completed] = await tx.select().from(auditLogs).where(eq(auditLogs.id, completionId)).limit(1);
      if (completed)
        return { status: 'COMPLETED', importedCount: Number(object(completed.metadata).importedCount) };
      const mapping: Mapping = {
        version: 1,
        namespace: match.source.namespace,
        users: [
          {
            sourceUserId: match.sourceUserId,
            targetUserId: userId,
            verification: { method: 'MINIAPP_CLAIM', reference: `phone-consent:${String(metadata.offerId)}` },
          },
        ],
        profiles: selected.map(({ original, assessment }) => {
          // The miniapp picker stores representative minutes for two-hour branches, not exact minutes.
          const unknownTime = original.isUncertainTime !== false;
          const hour = Number(object(original.birthDate).hour);
          return {
            sourceProfileId: assessment.sourceProfileId,
            subjectType: 'OTHER',
            relationshipType: 'FRIEND',
            locationId: 'loc_cn_110000',
            timePrecision: unknownTime ? 'DATE_ONLY' : 'HOUR_RANGE',
            ...(unknownTime ? {} : { hourBranchCode: branches[Math.floor((hour + 1) / 2) % 12]! }),
            confirmed: true,
            acceptRecalculatedCards: true,
          };
        }),
      };

      const plan = await buildPlan(match.source, mapping);
      const results = await executePlanInTransaction(tx, plan, {
        encryptionKey: this.infrastructure.environment.DATA_ENCRYPTION_KEY,
        cursorSecret: this.infrastructure.environment.CURSOR_SIGNING_SECRET,
        cipher: this.cipher,
        authorizationDecisionId: decision.id,
      });
      await tx
        .insert(auditLogs)
        .values({
          id: completionId,
          actorUserId: userId,
          action: 'MINIAPP_IMPORT_COMPLETED',
          resourceType: 'USER',
          resourceId: userId,
          metadata: { decisionId: decision.id, importedCount: results.length },
        });
      return { status: 'COMPLETED', importedCount: results.length };
    });
  }

  async profileSource(userId: string, profileId: string) {
    const db = this.infrastructure.database;
    const [profile] = await db
      .select({ id: lifeProfiles.id })
      .from(lifeProfiles)
      .innerJoin(subjects, eq(subjects.id, lifeProfiles.subjectId))
      .where(
        and(
          eq(lifeProfiles.id, profileId),
          eq(lifeProfiles.ownerUserId, userId),
          eq(subjects.ownerUserId, userId),
          isNull(lifeProfiles.deletedAt),
          isNull(subjects.deletedAt),
        ),
      )
      .limit(1);
    if (!profile) this.notFound();
    const [marker] = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.resourceType, 'LIFE_PROFILE'),
          eq(auditLogs.resourceId, profileId),
          eq(auditLogs.actorUserId, userId),
          eq(auditLogs.action, 'MINIAPP_PROFILE_IMPORTED'),
        ),
      )
      .limit(1);
    if (!marker) return null;
    const original = await this.source.original(
      marker.id,
      String(object(marker.metadata).archiveHash),
      String(object(marker.metadata).sourceHash),
    );
    if (!original)
      throw new ServiceUnavailableException({
        code: 'MINIAPP_SOURCE_UNAVAILABLE',
        message: '原小程序资料暂时无法读取，请稍后重试',
      });
    return original;
  }

  private async phoneHash(db: Database, userId: string): Promise<string | null> {
    const phones = await db
      .select({ hash: identities.providerSubjectHash })
      .from(identities)
      .where(and(eq(identities.userId, userId), eq(identities.provider, 'PHONE')));
    return phones.length === 1 ? phones[0]!.hash : null;
  }

  private decisionId(phoneHash: string) {
    return uuidv5(`miniapp-once:${phoneHash}`, decisionNamespace);
  }

  private async priorDecision(
    db: Database,
    userId: string,
    phoneHash: string | null,
  ): Promise<MiniappImportStatus | null> {
    const [record] = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.action, action),
          or(
            and(eq(auditLogs.resourceType, 'USER'), eq(auditLogs.resourceId, userId)),
            phoneHash ? eq(auditLogs.id, this.decisionId(phoneHash)) : undefined,
          ),
        ),
      )
      .limit(1);
    if (!record) return null;
    const metadata = object(record.metadata);
    if (metadata.decision === 'DECLINE') return { status: 'DECLINED', importedCount: 0 };
    const [completed] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.id, uuidv5(`completed:${record.id}`, decisionNamespace)))
      .limit(1);
    return completed
      ? {
          status: 'COMPLETED',
          importedCount: record.actorUserId === userId ? Number(object(completed.metadata).importedCount) : 0,
        }
      : { status: 'ACCEPTED', importedCount: 0 };
  }

  private async unclaimed(db: Database, userId: string, match: MiniappSourceMatch) {
    const sourceUserHash = digest([match.source.namespace, match.sourceUserId]);
    const ownerRecords = await db
      .select({ owner: auditLogs.actorUserId, action: auditLogs.action })
      .from(auditLogs)
      .where(
        and(
          inArray(auditLogs.action, ['MINIAPP_PROFILE_IMPORTED', action]),
          sql`${auditLogs.metadata}->>'sourceUserHash' = ${sourceUserHash}`,
        ),
      );
    if (ownerRecords.some((record) => record.owner !== userId || record.action === action)) return [];
    const imported = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(
        inArray(
          auditLogs.id,
          match.profiles.map((profile) => profile.markerId),
        ),
      );
    const ids = new Set(imported.map((record) => record.id));
    return match.profiles.filter((profile) => !ids.has(profile.markerId));
  }

  private offerId(userId: string, phoneHash: string, match: MiniappSourceMatch) {
    return this.crypto.hash(`miniapp-offer:v1:${userId}:${phoneHash}:${match.sourceHash}`);
  }
  private notFound(): never {
    throw new NotFoundException({ code: 'LIFE_PROFILE_NOT_FOUND', message: '档案不存在' });
  }
  private offerUnavailable(): never {
    throw new ConflictException({
      code: 'MINIAPP_OFFER_UNAVAILABLE',
      message: '导入信息已更新，请刷新后重试',
    });
  }
}
