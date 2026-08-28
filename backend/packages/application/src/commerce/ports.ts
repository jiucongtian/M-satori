import type {
  BenefitUnit,
  BenefitSourceType,
  BusinessContext,
  BusinessSpace,
  ServiceRequirement,
  ServiceType,
} from '@satori/domain';

export const OFFERING_QUERY_PORT = Symbol('OFFERING_QUERY_PORT');
export const PURCHASE_HISTORY_PORT = Symbol('PURCHASE_HISTORY_PORT');
export const SEED_ELIGIBILITY_PORT = Symbol('SEED_ELIGIBILITY_PORT');
export const ENTITLEMENT_GRANT_PORT = Symbol('ENTITLEMENT_GRANT_PORT');
export const ENTITLEMENT_BENEFIT_SOURCE_PORT = Symbol('ENTITLEMENT_BENEFIT_SOURCE_PORT');
export const COMPLIMENTARY_SEED_BENEFIT_SOURCE_PORT = Symbol('COMPLIMENTARY_SEED_BENEFIT_SOURCE_PORT');
export const SEED_BATCH_PROJECTION_QUERY_PORT = Symbol('SEED_BATCH_PROJECTION_QUERY_PORT');
export const SEED_PROMOTION_LIFECYCLE_PORT = Symbol('SEED_PROMOTION_LIFECYCLE_PORT');

export interface OfferingQuoteSnapshot {
  readonly offeringId: string;
  readonly offeringCode: string;
  readonly offeringVersionId: string;
  readonly offeringVersion: number;
  readonly businessSpace: BusinessSpace;
  readonly serviceType: ServiceType;
  readonly offeringKind: 'SINGLE' | 'PACKAGE' | 'MEMBERSHIP';
  readonly status: 'PUBLISHED' | 'RETIRED';
  readonly displayName: string;
  readonly description: string;
  readonly amountMinor: number;
  readonly currency: 'CNY';
  readonly entitlementSpec: Readonly<Record<string, unknown>>;
  readonly validityDays: number | null;
  readonly purchaseLimit: Readonly<Record<string, unknown>>;
  readonly refundPolicyVersion: string;
  readonly refundPolicy: Readonly<Record<string, unknown>>;
  readonly termsVersion: string;
}

export interface OfferingQueryPort {
  findPublished(offeringId: string, version?: number): Promise<OfferingQuoteSnapshot | null>;
}

export interface PurchaseHistoryPort {
  countFulfilledPurchases(ownerUserId: string, offeringId: string): Promise<number>;
}

export interface SeedEligibilityPort {
  getAvailableSeedQuantity(ownerUserId: string, businessSpace: BusinessSpace): Promise<number>;
}

export interface SeedBatchAccountView {
  readonly accountId: string;
  readonly available: number;
  readonly reserved: number;
  readonly totalEarned: number;
  readonly totalSpent: number;
  readonly updatedAt: string;
}

export interface SeedBatchTransactionView {
  readonly transactionId: string;
  readonly type: 'GRANT' | 'RESERVE' | 'CONSUME' | 'RELEASE' | 'REFUND' | 'ADJUSTMENT';
  readonly amount: number;
  readonly balanceAfter: number;
  readonly businessType: 'REGISTRATION_REWARD' | 'DAILY_INSIGHT';
  readonly resourceId: string;
  readonly originalTransactionId: string | null;
  readonly title: string;
  readonly createdAt: string;
}

export interface SeedBatchProjectionQueryPort {
  getAccount(ownerUserId: string): Promise<SeedBatchAccountView | null>;
  listTransactions(
    ownerUserId: string,
    cursor: { readonly createdAt: Date; readonly id: string } | null,
    limit: number,
  ): Promise<{ readonly rows: readonly SeedBatchTransactionView[]; readonly hasMore: boolean }>;
}

export interface ReserveSeedPromotionCommand {
  readonly ownerUserId: string;
  readonly businessSpace: BusinessSpace;
  readonly serviceType: ServiceType;
  readonly orderId: string;
  readonly quantity: number;
  readonly reservationExpiresAt: Date;
  readonly requestId: string;
}

export interface SeedPromotionLifecyclePort {
  reserveForOrderCreation(command: ReserveSeedPromotionCommand): Promise<{
    readonly reservationId: string;
    readonly quantity: number;
  }>;
  consumeAfterPaymentSuccess(
    reservationId: string,
    paymentAttemptId: string,
    requestId: string,
  ): Promise<void>;
  releaseAfterOrderClosure(
    reservationId: string,
    orderId: string,
    reason: 'ORDER_CANCELLED' | 'ORDER_EXPIRED' | 'PAYMENT_FAILED',
    requestId: string,
  ): Promise<void>;
}

export type PaymentAttemptState = 'CREATED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

export interface CreatePaymentRequest {
  readonly attemptId: string;
  readonly orderId: string;
  readonly amountMinor: number;
  readonly currency: 'CNY';
  readonly description: string;
  readonly expiresAt: Date;
}

export interface ProviderPaymentResult {
  readonly providerAttemptId: string;
  readonly state: PaymentAttemptState;
  readonly clientParameters?: Readonly<Record<string, string>>;
}

export interface ProviderRefundRequest {
  readonly refundId: string;
  readonly orderId: string;
  readonly providerAttemptId: string;
  readonly amountMinor: number;
  readonly currency: 'CNY';
  readonly reasonCode: string;
}

export interface PaymentProvider {
  createPayment(request: CreatePaymentRequest): Promise<ProviderPaymentResult>;
  queryPayment(providerAttemptId: string): Promise<ProviderPaymentResult>;
  refund(request: ProviderRefundRequest): Promise<{ providerRefundId: string }>;
}

export interface BenefitCandidate {
  readonly sourceId: string;
  readonly sourceType: BenefitSourceType;
  readonly serviceType: ServiceType;
  readonly availableQuantity: number;
  readonly requiredQuantity: number;
  readonly expiresAt: Date | null;
  readonly grantedAt: Date;
  readonly ruleVersion: string;
}

export interface BenefitReservation {
  readonly reservationId: string;
  readonly sourceId: string;
  readonly sourceType: BenefitSourceType;
  readonly quantity: number;
  readonly expiresAt: Date | null;
}

export interface BenefitSourcePort {
  listCandidates(requirement: ServiceRequirement): Promise<readonly BenefitCandidate[]>;
  reserve(candidate: BenefitCandidate, intentId: string): Promise<BenefitReservation>;
  commit(reservationId: string, businessContext: BusinessContext): Promise<void>;
  release(reservationId: string, businessContext: BusinessContext): Promise<void>;
}

export interface EntitlementResolutionView {
  readonly resolutionId: string;
  readonly selectedCandidate: BenefitCandidate | null;
  readonly reasonCode: string;
  readonly ruleVersion: string;
}

export interface ConsumptionIntentView {
  readonly intentId: string;
  readonly state: 'RESERVED' | 'RUNNING' | 'COMMITTED' | 'RELEASED' | 'EXPIRED';
  readonly resolution: EntitlementResolutionView;
  readonly reservation: BenefitReservation;
}

export interface ConsumptionPort {
  resolve(requirement: ServiceRequirement): Promise<EntitlementResolutionView>;
  reserve(requirement: ServiceRequirement, idempotencyKey: string): Promise<ConsumptionIntentView>;
  start(intentId: string, idempotencyKey: string): Promise<ConsumptionIntentView>;
  commit(intentId: string, idempotencyKey: string): Promise<ConsumptionIntentView>;
  release(intentId: string, idempotencyKey: string): Promise<ConsumptionIntentView>;
}

export interface EntitlementGrantCommand {
  readonly ownerUserId: string;
  readonly businessSpace: BusinessSpace;
  readonly serviceType: ServiceType;
  readonly unit: Exclude<BenefitUnit, 'SEED'>;
  readonly quantity: number;
  readonly sourceType: 'PURCHASE' | 'MEMBERSHIP' | 'MANUAL';
  readonly sourceId: string;
  readonly effectiveAt: Date;
  readonly expiresAt: Date;
  readonly ruleVersion: string;
}

export interface EntitlementGrantPort {
  grant(command: EntitlementGrantCommand, idempotencyKey: string): Promise<{ grantId: string }>;
  freezeBySource(sourceId: string, reasonCode: string): Promise<void>;
  unfreezeBySource(sourceId: string, reasonCode: string): Promise<void>;
  forfeitBySource(sourceId: string, reasonCode: string): Promise<void>;
}

export interface MembershipGrantCommand {
  readonly ownerUserId: string;
  readonly businessSpace: BusinessSpace;
  readonly planVersionId: string;
  readonly sourceOrderId: string;
  readonly startsAt: Date;
}

export interface MembershipGrantPort {
  activate(command: MembershipGrantCommand, idempotencyKey: string): Promise<{ subscriptionId: string }>;
  queueRenewal(command: MembershipGrantCommand, idempotencyKey: string): Promise<{ periodId: string }>;
  replaceForUpgrade(
    command: MembershipGrantCommand & { previousSubscriptionId: string; upgradeId: string },
    idempotencyKey: string,
  ): Promise<{ subscriptionId: string }>;
}
