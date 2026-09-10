import type {
  BenefitCandidate,
  BenefitReservation,
  BenefitSourcePort,
  ReserveSeedPromotionCommand,
  SeedBatchAccountView,
  SeedBatchProjectionQueryPort,
  SeedPromotionLifecyclePort,
} from '@satori/application';
import type { BusinessContext, ServiceRequirement, ServiceType } from '@satori/domain';
import type { ComplimentarySeedGrantView, ComplimentarySeedSourceType } from '../domain/index.js';

export const COMPLIMENTARY_SEED_REPOSITORY = Symbol('COMPLIMENTARY_SEED_REPOSITORY');

export interface GrantComplimentarySeedsCommand {
  readonly ownerUserId: string;
  readonly businessSpace: 'SATORI';
  readonly sourceType: ComplimentarySeedSourceType;
  readonly sourceId: string;
  readonly applicableServices: readonly ServiceType[];
  readonly quantity: number;
  readonly effectiveAt: Date;
  readonly expiresAt: Date | null;
  readonly ruleVersion: string;
  readonly migrationVersion?: string;
  readonly requestId: string;
}

export interface SeedReservationCommand {
  readonly ownerUserId: string;
  readonly businessSpace: 'SATORI';
  readonly serviceType: ServiceType;
  readonly quantity: number;
  readonly businessKey: string;
  readonly consumptionIntentId?: string;
  readonly businessContext: BusinessContext;
  readonly expiresAt?: Date;
  readonly requestId: string;
}

export interface SeedReservationView {
  readonly reservationId: string;
  readonly quantity: number;
  readonly allocations: readonly { grantId: string; quantity: number }[];
  readonly expiresAt: Date | null;
}

export interface SeedReconciliationReport {
  readonly ownerUserId: string;
  readonly consistent: boolean;
  readonly account: { available: number; reserved: number };
  readonly grants: { available: number; reserved: number };
  readonly entryProjectionMismatches: number;
}

export interface ComplimentarySeedRepository extends SeedBatchProjectionQueryPort {
  grant(command: GrantComplimentarySeedsCommand, idempotencyKey: string): Promise<{ grantId: string }>;
  listCandidates(requirement: ServiceRequirement): Promise<readonly BenefitCandidate[]>;
  reserve(command: SeedReservationCommand): Promise<SeedReservationView>;
  reserveCandidate(
    candidate: BenefitCandidate,
    intentId: string,
    requestId: string,
  ): Promise<SeedReservationView>;
  settle(
    reservationId: string,
    action: 'CONSUME' | 'RELEASE',
    businessContext: BusinessContext,
    requestId: string,
  ): Promise<void>;
  restore(reservationId: string, businessKey: string, requestId: string): Promise<void>;
  expireDue(now: Date, requestId: string): Promise<number>;
  adjust(
    grantId: string,
    quantity: number,
    direction: 'INCREASE' | 'DECREASE',
    reasonCode: string,
    requestId: string,
  ): Promise<void>;
  reconcile(ownerUserId: string): Promise<SeedReconciliationReport>;
  listGrants(ownerUserId: string): Promise<readonly ComplimentarySeedGrantView[]>;
}

export class ComplimentarySeedApplicationService
  implements BenefitSourcePort, SeedBatchProjectionQueryPort, SeedPromotionLifecyclePort
{
  constructor(private readonly repository: ComplimentarySeedRepository) {}

  grant(command: GrantComplimentarySeedsCommand, idempotencyKey: string) {
    return this.repository.grant(command, idempotencyKey);
  }

  listCandidates(requirement: ServiceRequirement) {
    return this.repository.listCandidates(requirement);
  }

  async reserve(candidate: BenefitCandidate, intentId: string): Promise<BenefitReservation> {
    const reservation = await this.repository.reserveCandidate(candidate, intentId, crypto.randomUUID());
    return {
      reservationId: reservation.reservationId,
      sourceId: candidate.sourceId,
      sourceType: 'COMPLIMENTARY_SEED',
      quantity: reservation.quantity,
      expiresAt: reservation.expiresAt,
    };
  }

  commit(reservationId: string, businessContext: BusinessContext) {
    return this.repository.settle(reservationId, 'CONSUME', businessContext, crypto.randomUUID());
  }

  release(reservationId: string, businessContext: BusinessContext) {
    return this.repository.settle(reservationId, 'RELEASE', businessContext, crypto.randomUUID());
  }

  reservePromotion(command: SeedReservationCommand) {
    return this.repository.reserve(command);
  }

  reserveForOrderCreation(command: ReserveSeedPromotionCommand) {
    return this.repository.reserve({
      ownerUserId: command.ownerUserId,
      businessSpace: 'SATORI',
      // 商城活动价是种子的独立用途，不等于直接消费该商品的服务。
      // 注册赠送种子只开放每日指引直接消费，同时仍可在商城锁定活动价。
      serviceType: 'DAILY_INSIGHT',
      quantity: command.quantity,
      businessKey: `money-order:${command.orderId}:seed-promotion`,
      businessContext: { type: 'MONEY_ORDER', id: command.orderId },
      expiresAt: command.reservationExpiresAt,
      requestId: command.requestId,
    });
  }

  consumeAfterPaymentSuccess(reservationId: string, paymentAttemptId: string, requestId: string) {
    return this.repository.settle(
      reservationId,
      'CONSUME',
      { type: 'PAYMENT_ATTEMPT', id: paymentAttemptId },
      requestId,
    );
  }

  releaseAfterOrderClosure(
    reservationId: string,
    orderId: string,
    reason: 'ORDER_CANCELLED' | 'ORDER_EXPIRED' | 'PAYMENT_FAILED',
    requestId: string,
  ) {
    return this.repository.settle(reservationId, 'RELEASE', { type: reason, id: orderId }, requestId);
  }

  consumePromotion(reservationId: string, businessContext: BusinessContext, requestId: string) {
    return this.repository.settle(reservationId, 'CONSUME', businessContext, requestId);
  }

  releasePromotion(reservationId: string, businessContext: BusinessContext, requestId: string) {
    return this.repository.settle(reservationId, 'RELEASE', businessContext, requestId);
  }

  restore(reservationId: string, businessKey: string, requestId: string) {
    return this.repository.restore(reservationId, businessKey, requestId);
  }

  getAccount(ownerUserId: string): Promise<SeedBatchAccountView | null> {
    return this.repository.getAccount(ownerUserId);
  }

  listTransactions(ownerUserId: string, cursor: { createdAt: Date; id: string } | null, limit: number) {
    return this.repository.listTransactions(ownerUserId, cursor, limit);
  }

  expireDue(now = new Date(), requestId = crypto.randomUUID()) {
    return this.repository.expireDue(now, requestId);
  }

  adjust(
    grantId: string,
    quantity: number,
    direction: 'INCREASE' | 'DECREASE',
    reasonCode: string,
    requestId: string,
  ) {
    return this.repository.adjust(grantId, quantity, direction, reasonCode, requestId);
  }

  reconcile(ownerUserId: string) {
    return this.repository.reconcile(ownerUserId);
  }
}
