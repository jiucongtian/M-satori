import { checkoutQuotes, RuntimeInfrastructure, seedPromotionRules } from '@satori/infrastructure';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, lte } from 'drizzle-orm';
import type { CreateQuoteRecord, CheckoutQuoteView, PricingRepository } from '../application/index.js';
import type { SeedPromotionRuleView } from '../domain/index.js';

@Injectable()
export class DrizzlePricingRepository implements PricingRepository {
  constructor(@Inject(RuntimeInfrastructure) private readonly infrastructure: RuntimeInfrastructure) {}

  async listActivePromotionRules(
    offeringVersionId: string,
    now: Date,
  ): Promise<readonly SeedPromotionRuleView[]> {
    const rows = await this.infrastructure.database
      .select()
      .from(seedPromotionRules)
      .where(
        and(
          eq(seedPromotionRules.offeringVersionId, offeringVersionId),
          eq(seedPromotionRules.status, 'ACTIVE'),
          lte(seedPromotionRules.startsAt, now),
          gt(seedPromotionRules.endsAt, now),
        ),
      )
      .orderBy(asc(seedPromotionRules.activityAmountMinor), asc(seedPromotionRules.id));
    return rows.map((row) => ({
      id: row.id,
      ruleVersion: row.ruleVersion,
      minimumSeedBalance: row.minimumSeedBalance,
      reservedSeedQuantity: row.reservedSeedQuantity,
      activityAmountMinor: row.activityAmountMinor,
      identityConstraint: asRecord(row.identityConstraint),
      purchaseLimit: asRecord(row.purchaseLimit),
      restorationPolicy: asRecord(row.restorationPolicy),
    }));
  }

  async findQuoteByIdempotency(ownerUserId: string, key: string) {
    const [row] = await this.infrastructure.database
      .select({ requestHash: checkoutQuotes.requestHash, pricingSnapshot: checkoutQuotes.pricingSnapshot })
      .from(checkoutQuotes)
      .where(and(eq(checkoutQuotes.ownerUserId, ownerUserId), eq(checkoutQuotes.idempotencyKey, key)))
      .limit(1);
    if (!row) return null;
    const view = deserializeQuoteView(asRecord(row.pricingSnapshot).quoteView);
    return { requestHash: row.requestHash, view };
  }

  async createQuote(record: CreateQuoteRecord, view: CheckoutQuoteView): Promise<CheckoutQuoteView> {
    await this.infrastructure.database.insert(checkoutQuotes).values({
      id: record.quoteId,
      ownerUserId: record.ownerUserId,
      businessSpace: record.businessSpace,
      offeringVersionId: record.offeringVersionId,
      seedPromotionRuleId: record.seedPromotionRuleId,
      pricingMode: record.pricingMode,
      amountMinor: record.amountMinor,
      reservedSeedQuantity: record.reservedSeedQuantity,
      qualificationSnapshot: record.qualificationSnapshot,
      pricingSnapshot: { ...record.pricingSnapshot, quoteView: serializeQuoteView(view) },
      businessContextType: record.businessContext?.type,
      businessContextId: record.businessContext?.id,
      idempotencyKey: record.idempotencyKey,
      requestHash: record.requestHash,
      requestId: record.requestId,
      expiresAt: record.expiresAt,
      createdAt: record.issuedAt,
    });
    return view;
  }
}

function serializeQuoteView(view: CheckoutQuoteView) {
  return { ...view, issuedAt: view.issuedAt.toISOString(), expiresAt: view.expiresAt.toISOString() };
}

function deserializeQuoteView(value: unknown): CheckoutQuoteView {
  if (typeof value !== 'object' || value === null) throw new Error('QUOTE_REPLAY_VIEW_UNAVAILABLE');
  const stored = value as Omit<CheckoutQuoteView, 'issuedAt' | 'expiresAt'> & {
    issuedAt: string;
    expiresAt: string;
  };
  return { ...stored, issuedAt: new Date(stored.issuedAt), expiresAt: new Date(stored.expiresAt) };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
