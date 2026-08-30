import type { Database } from '@satori/infrastructure';
import { offeringVersions, seedPromotionRules, serviceOfferings } from '@satori/infrastructure';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { R11_CATALOG_SEED } from '../domain/seed-data.js';

export async function seedR11CommerceCatalog(database: Database) {
  await database.transaction(async (tx) => {
    for (const definition of R11_CATALOG_SEED) {
      const catalogVersion = definition.version ?? 1;
      let [offering] = await tx
        .select()
        .from(serviceOfferings)
        .where(and(eq(serviceOfferings.businessSpace, 'SATORI'), eq(serviceOfferings.code, definition.code)))
        .limit(1);
      if (!offering) {
        [offering] = await tx
          .insert(serviceOfferings)
          .values({
            id: randomUUID(),
            code: definition.code,
            businessSpace: 'SATORI',
            serviceType: definition.serviceType,
            offeringKind: definition.offeringKind,
            status: 'ACTIVE',
          })
          .returning();
      }
      if (!offering) throw new Error(`Failed to create ${definition.code}`);

      let [version] = await tx
        .select()
        .from(offeringVersions)
        .where(and(eq(offeringVersions.offeringId, offering.id), eq(offeringVersions.version, catalogVersion)))
        .limit(1);
      if (!version) {
        [version] = await tx
          .insert(offeringVersions)
          .values({
            id: randomUUID(),
            offeringId: offering.id,
            version: catalogVersion,
            status: 'PUBLISHED',
            displayName: definition.displayName,
            description: definition.description,
            amountMinor: definition.amountMinor,
            entitlementSpec: definition.entitlementSpec,
            validityDays: definition.validityDays,
            purchaseLimit: definition.purchaseLimit,
            refundPolicyVersion: definition.refundPolicyVersion,
            refundPolicy: definition.refundPolicy,
            termsVersion: definition.termsVersion,
            effectiveFrom: new Date('2026-08-28T00:00:00.000Z'),
            publishedAt: new Date('2026-08-28T00:00:00.000Z'),
          })
          .returning();
      }
      if (!version || version.amountMinor !== definition.amountMinor) {
        throw new Error(`Immutable version mismatch for ${definition.code}`);
      }
      await tx
        .update(serviceOfferings)
        .set({ currentVersionId: version.id, status: 'ACTIVE', updatedAt: new Date() })
        .where(eq(serviceOfferings.id, offering.id));

      if (definition.promotion) {
        await tx
          .insert(seedPromotionRules)
          .values({
            id: randomUUID(),
            businessSpace: 'SATORI',
            offeringVersionId: version.id,
            ruleVersion: 'r11-seed-activity-v1',
            status: 'ACTIVE',
            identityConstraint: { audience: 'ALL_AUTHENTICATED' },
            minimumSeedBalance: definition.promotion.minimumSeedBalance,
            reservedSeedQuantity: definition.promotion.reservedSeedQuantity,
            activityAmountMinor: definition.promotion.activityAmountMinor,
            purchaseLimit: { perUserPerPeriod: 1, periodDays: 30 },
            restorationPolicy: {
              orderCancelled: 'RESTORE',
              orderExpired: 'RESTORE',
              paymentFailed: 'RESTORE',
              paymentSucceeded: 'CONSUME',
            },
            startsAt: new Date('2026-08-28T00:00:00.000Z'),
            endsAt: new Date('2099-12-31T15:59:59.999Z'),
          })
          .onConflictDoNothing();
      }
    }
  });
}
