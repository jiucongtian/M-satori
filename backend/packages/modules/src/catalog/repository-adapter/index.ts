import type { OfferingQueryPort, OfferingQuoteSnapshot } from '@satori/application';
import { Inject, Injectable } from '@nestjs/common';
import { offeringVersions, RuntimeInfrastructure, serviceOfferings } from '@satori/infrastructure';
import { and, asc, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { CatalogRepository, PublishOfferingVersionCommand } from '../application/index.js';
import { assertR11Sellable, type CatalogOffering } from '../domain/index.js';

@Injectable()
export class DrizzleCatalogRepository implements CatalogRepository, OfferingQueryPort {
  constructor(@Inject(RuntimeInfrastructure) private readonly infrastructure: RuntimeInfrastructure) {}

  async listPublished(): Promise<readonly CatalogOffering[]> {
    const rows = await this.infrastructure.database
      .select()
      .from(serviceOfferings)
      .innerJoin(offeringVersions, eq(serviceOfferings.currentVersionId, offeringVersions.id))
      .where(and(eq(serviceOfferings.status, 'ACTIVE'), eq(offeringVersions.status, 'PUBLISHED')))
      .orderBy(asc(serviceOfferings.createdAt), asc(serviceOfferings.id));
    return rows.map(toCatalogOffering);
  }

  async findPublished(offeringId: string, version?: number): Promise<CatalogOffering | null> {
    const condition = and(
      eq(serviceOfferings.id, offeringId),
      eq(serviceOfferings.status, 'ACTIVE'),
      eq(offeringVersions.status, 'PUBLISHED'),
      version === undefined
        ? eq(serviceOfferings.currentVersionId, offeringVersions.id)
        : eq(offeringVersions.version, version),
    );
    const [row] = await this.infrastructure.database
      .select()
      .from(serviceOfferings)
      .innerJoin(offeringVersions, eq(serviceOfferings.id, offeringVersions.offeringId))
      .where(condition)
      .limit(1);
    return row ? toCatalogOffering(row) : null;
  }

  async publishVersion(command: PublishOfferingVersionCommand): Promise<OfferingQuoteSnapshot> {
    return this.infrastructure.database.transaction(async (tx) => {
      const [offering] = await tx
        .select()
        .from(serviceOfferings)
        .where(eq(serviceOfferings.id, command.offeringId))
        .for('update')
        .limit(1);
      if (!offering) throw new Error('OFFERING_NOT_FOUND');
      assertR11Sellable(offering.code);
      const versionId = randomUUID();
      const [version] = await tx
        .insert(offeringVersions)
        .values({
          id: versionId,
          offeringId: offering.id,
          version: command.version,
          status: 'PUBLISHED',
          displayName: command.displayName,
          description: command.description,
          amountMinor: command.amountMinor,
          entitlementSpec: command.entitlementSpec,
          validityDays: command.validityDays,
          purchaseLimit: command.purchaseLimit,
          refundPolicyVersion: command.refundPolicyVersion,
          refundPolicy: command.refundPolicy,
          termsVersion: command.termsVersion,
          effectiveFrom: command.effectiveFrom,
          publishedAt: new Date(),
        })
        .returning();
      await tx
        .update(serviceOfferings)
        .set({ currentVersionId: versionId, status: 'ACTIVE', updatedAt: new Date() })
        .where(eq(serviceOfferings.id, offering.id));
      if (!version) throw new Error('OFFERING_VERSION_INSERT_FAILED');
      return toOfferingSnapshot({ service_offerings: offering, offering_versions: version });
    });
  }

  async listVersionHistory(offeringId: string): Promise<readonly OfferingQuoteSnapshot[]> {
    const rows = await this.infrastructure.database
      .select()
      .from(serviceOfferings)
      .innerJoin(offeringVersions, eq(serviceOfferings.id, offeringVersions.offeringId))
      .where(eq(serviceOfferings.id, offeringId))
      .orderBy(desc(offeringVersions.version));
    return rows.map(toOfferingSnapshot);
  }
}

function toCatalogOffering(row: JoinedOffering): CatalogOffering {
  const snapshot = toOfferingSnapshot(row);
  const purchaseLimit = asRecord(row.offering_versions.purchaseLimit);
  const displayChannels: ('STORE' | 'SHORTAGE')[] = Array.isArray(purchaseLimit.displayChannels)
    ? purchaseLimit.displayChannels.filter(
        (value): value is 'STORE' | 'SHORTAGE' => value === 'STORE' || value === 'SHORTAGE',
      )
    : ['STORE'];
  return {
    ...snapshot,
    recommended: purchaseLimit.recommended === true,
    displayChannels,
  };
}

type JoinedOffering = {
  service_offerings: typeof serviceOfferings.$inferSelect;
  offering_versions: typeof offeringVersions.$inferSelect;
};

function toOfferingSnapshot(row: JoinedOffering): OfferingQuoteSnapshot {
  const offering = row.service_offerings;
  const version = row.offering_versions;
  assertR11Sellable(offering.code);
  return {
    offeringId: offering.id,
    offeringCode: offering.code,
    offeringVersionId: version.id,
    offeringVersion: version.version,
    businessSpace: offering.businessSpace as 'SATORI',
    serviceType: offering.serviceType as 'DAILY_INSIGHT' | 'CARD_READING',
    offeringKind: offering.offeringKind as 'SINGLE' | 'PACKAGE' | 'MEMBERSHIP',
    status: version.status as 'PUBLISHED' | 'RETIRED',
    displayName: version.displayName,
    description: version.description,
    amountMinor: version.amountMinor,
    currency: 'CNY',
    entitlementSpec: asRecord(version.entitlementSpec),
    validityDays: version.validityDays,
    purchaseLimit: asRecord(version.purchaseLimit),
    refundPolicyVersion: version.refundPolicyVersion,
    refundPolicy: asRecord(version.refundPolicy),
    termsVersion: version.termsVersion,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
