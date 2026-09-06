import { and, eq, isNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { PoolClient } from 'pg';
import type { Database } from '../../../infrastructure/src/database/client.js';
import { v5 as uuidv5 } from 'uuid';
import * as schema from '../../../infrastructure/src/database/schema.js';
import { FieldCipher } from '../../../infrastructure/src/security/field-cipher.js';
import { R1_RUNTIME_POLICY } from '../../../infrastructure/src/config/runtime-policy.js';
import type { RuntimeInfrastructure } from '../../../infrastructure/src/runtime.module.js';
import { ProfileLibraryService } from '../profile-library/profile-library.service.js';
import { SelfProfileService } from '../profile/self-profile.service.js';
import { CardCatalogService } from '../profile/card-catalog.service.js';
import { ReferenceBirthChartCalculator } from '../astrology/reference-birth-chart.calculator.js';
import { LocalLocationProvider } from '../integrations/locations/location.provider.js';
import { digest, sourceDate } from './source.js';
import type { ImportPlan } from './plan.js';

const markerNamespace = '3fc9fe91-b90b-4bd2-8f1b-f19aefad60df';
export interface ImportResult {
  sourceProfileId: string;
  profileId: string;
  revisionId: string;
  state: 'IMPORTED' | 'REPLAYED';
}
class PreviewRollback extends Error {
  constructor(readonly results: ImportResult[]) {
    super('PREVIEW_ROLLBACK');
  }
}

/** A whole selected batch is atomic; no DDL, account creation, reward or AI service is invoked. */
export async function executePlan(
  client: PoolClient,
  plan: ImportPlan,
  options: {
    encryptionKey: string;
    cursorSecret: string;
    commit: boolean;
  },
): Promise<{ committed: boolean; results: ImportResult[] }> {
  if (!/^[a-f\d]{64}$/i.test(options.encryptionKey)) throw new Error('INVALID_TARGET_ENCRYPTION_KEY');
  if (options.cursorSecret.length < 16) throw new Error('INVALID_CURSOR_SECRET');
  if (!plan.profiles.length) throw new Error('EMPTY_IMPORT_SELECTION');
  try {
    return await drizzle(client, { schema }).transaction(async (transaction) => {
      const database = transaction as unknown as Database;
      await database.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`miniapp-import:${plan.namespace}`}, 0))`,
      );
      // Lock target users in fixed order, including across different import namespaces.
      for (const userId of [...new Set(plan.profiles.map((profile) => profile.targetUserId))].sort()) {
        const [user] = await database
          .select()
          .from(schema.users)
          .where(eq(schema.users.id, userId))
          .for('update');
        if (!user || user.status !== 'ACTIVE' || user.deletedAt) throw new Error('TARGET_USER_NOT_ACTIVE');
      }
      // Only the fields used by the existing profile services are supplied. Do not construct
      // RuntimeInfrastructure: that would connect Redis/queues and unrelated external systems.
      const runtime = {
        database,
        policy: R1_RUNTIME_POLICY,
        environment: { CURSOR_SIGNING_SECRET: options.cursorSecret },
      } as unknown as RuntimeInfrastructure;
      const cipher = new FieldCipher(options.encryptionKey);
      const [encryptedSample] = await database
        .select({ value: schema.subjects.displayNameCiphertext })
        .from(schema.subjects)
        .limit(1);
      if (encryptedSample) {
        try {
          cipher.decrypt(encryptedSample.value);
        } catch {
          throw new Error('TARGET_ENCRYPTION_KEY_MISMATCH');
        }
      }
      const library = new ProfileLibraryService(runtime, cipher);
      const catalog = new CardCatalogService(runtime);
      await catalog.resolveGanzhi('甲子');
      const profiles = new SelfProfileService(
        runtime,
        cipher,
        catalog,
        new LocalLocationProvider(),
        new ReferenceBirthChartCalculator(),
      );
      const results: ImportResult[] = [];
      for (const item of plan.profiles) {
        const markerId = uuidv5(`${plan.namespace}:profile:${item.sourceProfileId}`, markerNamespace);
        const sourceUserHash = digest([plan.namespace, item.sourceUserId]);
        const previousOwners = await database
          .select({ actorUserId: schema.auditLogs.actorUserId })
          .from(schema.auditLogs)
          .where(
            and(
              eq(schema.auditLogs.action, 'MINIAPP_PROFILE_IMPORTED'),
              sql`${schema.auditLogs.metadata}->>'sourceUserHash' = ${sourceUserHash}`,
            ),
          );
        if (previousOwners.some((row) => row.actorUserId !== item.targetUserId))
          throw new Error('SOURCE_USER_ALREADY_CLAIMED');
        const [existing] = await database
          .select()
          .from(schema.auditLogs)
          .where(eq(schema.auditLogs.id, markerId));
        if (existing) {
          const metadata = existing.metadata as { planHash?: string; revisionId?: string };
          if (
            existing.action !== 'MINIAPP_PROFILE_IMPORTED' ||
            existing.actorUserId !== item.targetUserId ||
            metadata.planHash !== item.planHash ||
            !existing.resourceId ||
            !metadata.revisionId
          ) {
            throw new Error('IMPORT_REPLAY_CONFLICT');
          }
          const [live] = await database
            .select()
            .from(schema.lifeProfiles)
            .where(eq(schema.lifeProfiles.id, existing.resourceId));
          const [subject] = live
            ? await database.select().from(schema.subjects).where(eq(schema.subjects.id, live.subjectId))
            : [];
          if (
            !live ||
            live.ownerUserId !== item.targetUserId ||
            live.deletedAt ||
            !subject ||
            subject.deletedAt
          ) {
            throw new Error('PREVIOUS_IMPORT_REMOVED');
          }
          results.push({
            sourceProfileId: item.sourceProfileId,
            profileId: existing.resourceId,
            revisionId: metadata.revisionId,
            state: 'REPLAYED',
          });
          continue;
        }
        if (item.subjectType === 'SELF') {
          const [self] = await database
            .select({ id: schema.subjects.id })
            .from(schema.subjects)
            .where(
              and(
                eq(schema.subjects.ownerUserId, item.targetUserId),
                eq(schema.subjects.type, 'SELF'),
                isNull(schema.subjects.deletedAt),
              ),
            );
          if (self) throw new Error('EXISTING_SELF_PROFILE_WOULD_BE_OVERWRITTEN');
        }
        const key = `miniapp:${markerId}`;
        const created =
          item.subjectType === 'OTHER'
            ? await library.create({
                userId: item.targetUserId,
                displayName: item.displayName,
                relationshipType: item.relationshipType,
                idempotencyKey: `${key}:create`,
              })
            : null;
        const revision = await profiles.preview({
          userId: item.targetUserId,
          birthInput: item.birthInput,
          idempotencyKey: `${key}:preview`,
          ...(created ? { profileId: created.profileId } : {}),
        });
        const confirmed = await profiles.confirm({
          userId: item.targetUserId,
          revisionId: revision.revisionId,
          fingerprint: revision.inputFingerprint,
          enhancedConfirmationAccepted: true,
          idempotencyKey: `${key}:confirm`,
          ...(created ? { profileId: created.profileId } : {}),
        });
        if (item.subjectType === 'SELF')
          await profiles.updateDisplayName(item.targetUserId, item.displayName);
        // Original timestamps belong to the imported profile; the new revision keeps its actual creation time.
        const createdAt = sourceDate(item.original.createTime)!;
        const [imported] = await database
          .update(schema.lifeProfiles)
          .set({ createdAt })
          .where(eq(schema.lifeProfiles.id, confirmed.profileId))
          .returning();
        await database
          .update(schema.subjects)
          .set({ createdAt })
          .where(eq(schema.subjects.id, imported!.subjectId));
        await database.insert(schema.auditLogs).values({
          id: markerId,
          actorUserId: item.targetUserId,
          action: 'MINIAPP_PROFILE_IMPORTED',
          resourceType: 'LIFE_PROFILE',
          resourceId: confirmed.profileId,
          metadata: {
            migrationVersion: 1,
            namespace: plan.namespace,
            sourceUserHash,
            sourceProfileHash: digest([plan.namespace, item.sourceProfileId]),
            sourceHash: item.sourceHash,
            archiveHash: plan.sourceHash,
            planHash: item.planHash,
            verificationHash: item.verificationHash,
            revisionId: revision.revisionId,
            changedPillars: item.changedPillars,
          },
        });
        results.push({
          sourceProfileId: item.sourceProfileId,
          profileId: confirmed.profileId,
          revisionId: revision.revisionId,
          state: 'IMPORTED',
        });
      }
      if (!options.commit) throw new PreviewRollback(results);
      return { committed: true, results };
    });
  } catch (error) {
    if (error instanceof PreviewRollback) return { committed: false, results: error.results };
    throw error;
  }
}
