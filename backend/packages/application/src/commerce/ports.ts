import type {
  BenefitSourceType,
  BusinessContext,
  BusinessSpace,
  ServiceRequirement,
  ServiceType,
} from '@satori/domain';

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
