import {
  hashPayload,
  IdempotencyKeyReusedError,
  type OfferingQueryPort,
  type PurchaseHistoryPort,
  type SeedEligibilityPort,
  type BusinessClock,
} from '@satori/application';
import type { BusinessContext, BusinessSpace } from '@satori/domain';
import { randomUUID } from 'node:crypto';
import { QuoteRejectedError, type SeedPromotionRuleView } from '../domain/index.js';

export const PRICING_REPOSITORY = Symbol('PRICING_REPOSITORY');
export const CHECKOUT_QUOTE_TTL_MS = 15 * 60 * 1_000;

export interface CheckoutQuoteView {
  readonly quoteId: string;
  readonly offering: NonNullable<Awaited<ReturnType<OfferingQueryPort['findPublished']>>>;
  readonly price: { readonly amountMinor: number; readonly currency: 'CNY' };
  readonly promotion: {
    readonly eligible: boolean;
    readonly ruleVersion: string | null;
    readonly seedReservationRequired: number;
    readonly message: string | null;
  };
  readonly businessContext: BusinessContext | null;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

export interface CreateQuoteRecord {
  readonly quoteId: string;
  readonly ownerUserId: string;
  readonly businessSpace: BusinessSpace;
  readonly offeringVersionId: string;
  readonly seedPromotionRuleId: string | null;
  readonly pricingMode: 'STANDARD' | 'SEED_PROMOTION';
  readonly amountMinor: number;
  readonly reservedSeedQuantity: number;
  readonly qualificationSnapshot: Readonly<Record<string, unknown>>;
  readonly pricingSnapshot: Readonly<Record<string, unknown>>;
  readonly businessContext: BusinessContext | null;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly requestId: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

export interface PricingRepository {
  listActivePromotionRules(offeringVersionId: string, now: Date): Promise<readonly SeedPromotionRuleView[]>;
  findQuoteByIdempotency(
    ownerUserId: string,
    key: string,
  ): Promise<{ requestHash: string; view: CheckoutQuoteView } | null>;
  createQuote(record: CreateQuoteRecord, view: CheckoutQuoteView): Promise<CheckoutQuoteView>;
}

export interface CreateCheckoutQuoteCommand {
  readonly ownerUserId: string;
  readonly offeringId: string;
  readonly offeringVersion?: number;
  readonly businessContext?: BusinessContext | null;
  readonly idempotencyKey: string;
  readonly requestId: string;
}

export class PricingApplicationService {
  constructor(
    private readonly offerings: OfferingQueryPort,
    private readonly purchases: PurchaseHistoryPort,
    private readonly seeds: SeedEligibilityPort,
    private readonly repository: PricingRepository,
    private readonly clock: BusinessClock,
  ) {}

  async createQuote(command: CreateCheckoutQuoteCommand): Promise<CheckoutQuoteView> {
    const requestHash = hashPayload({
      offeringId: command.offeringId,
      offeringVersion: command.offeringVersion ?? null,
      businessContext: command.businessContext ?? null,
    });
    const replay = await this.repository.findQuoteByIdempotency(command.ownerUserId, command.idempotencyKey);
    if (replay) {
      if (replay.requestHash !== requestHash) throw new IdempotencyKeyReusedError();
      return replay.view;
    }

    const offering = await this.offerings.findPublished(command.offeringId, command.offeringVersion);
    if (!offering || offering.status !== 'PUBLISHED') {
      throw new QuoteRejectedError('OFFERING_UNAVAILABLE', 'Offering is unavailable');
    }
    const purchaseCount = await this.purchases.countFulfilledPurchases(
      command.ownerUserId,
      offering.offeringId,
    );
    const lifetimeLimit = numberValue(offering.purchaseLimit.lifetime);
    if (lifetimeLimit !== null && purchaseCount >= lifetimeLimit) {
      throw new QuoteRejectedError('PURCHASE_LIMIT_REACHED', '该体验服务每位用户限购一次');
    }

    const now = this.clock.now();
    const seedBalance = await this.seeds.getAvailableSeedQuantity(
      command.ownerUserId,
      offering.businessSpace,
    );
    const rules = await this.repository.listActivePromotionRules(offering.offeringVersionId, now);
    const eligibleRules = rules.filter(
      (rule) =>
        seedBalance >= rule.minimumSeedBalance && eligibleIdentity(rule.identityConstraint, purchaseCount),
    );
    const promotion = eligibleRules.sort(
      (left, right) => left.activityAmountMinor - right.activityAmountMinor,
    )[0];
    const issuedAt = now;
    const expiresAt = new Date(now.getTime() + CHECKOUT_QUOTE_TTL_MS);
    const view: CheckoutQuoteView = {
      quoteId: randomUUID(),
      offering,
      price: {
        amountMinor: promotion?.activityAmountMinor ?? offering.amountMinor,
        currency: 'CNY',
      },
      promotion: {
        eligible: Boolean(promotion),
        ruleVersion: promotion?.ruleVersion ?? null,
        seedReservationRequired: promotion?.reservedSeedQuantity ?? 0,
        message: promotion ? '消耗指定智慧种子，解锁本商品活动价' : null,
      },
      businessContext: command.businessContext ?? null,
      issuedAt,
      expiresAt,
    };
    return this.repository.createQuote(
      {
        quoteId: view.quoteId,
        ownerUserId: command.ownerUserId,
        businessSpace: offering.businessSpace,
        offeringVersionId: offering.offeringVersionId,
        seedPromotionRuleId: promotion?.id ?? null,
        pricingMode: promotion ? 'SEED_PROMOTION' : 'STANDARD',
        amountMinor: view.price.amountMinor,
        reservedSeedQuantity: view.promotion.seedReservationRequired,
        qualificationSnapshot: { purchaseCount, seedBalance },
        pricingSnapshot: {
          standardAmountMinor: offering.amountMinor,
          quotedAmountMinor: view.price.amountMinor,
        },
        businessContext: view.businessContext,
        idempotencyKey: command.idempotencyKey,
        requestHash,
        requestId: command.requestId,
        issuedAt,
        expiresAt,
      },
      view,
    );
  }
}

function eligibleIdentity(constraint: Readonly<Record<string, unknown>>, purchaseCount: number) {
  return constraint.audience !== 'NEW_CUSTOMER' || purchaseCount === 0;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}
