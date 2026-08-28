import type {
  BusinessClock,
  EntitlementGrantPort,
  PaymentProvider,
  RefundCommandPort,
} from '@satori/application';
import { randomUUID } from 'node:crypto';
import { REFUND_QUOTE_TTL_MS, RefundError } from '../domain/index.js';

export const REFUND_REPOSITORY = Symbol('REFUND_REPOSITORY');

export interface RefundOrderFacts {
  orderId: string;
  ownerUserId: string;
  orderStatus: string;
  amountMinor: number;
  offeringKind: string;
  refundPolicyVersion: string;
  refundPolicy: Record<string, unknown>;
  paymentAttemptId: string;
  providerAttemptId: string;
  isUpgradePreviousOrder: boolean;
}

export interface RefundRecord {
  refundId: string;
  orderId: string;
  ownerUserId: string;
  paymentAttemptId: string;
  status: string;
  reasonCode: string;
  amountMinor: number;
  refundPolicyVersion: string;
  providerRefundId: string | null;
  requestId: string;
  createdAt: Date;
  completedAt: Date | null;
}

export interface RefundRepository {
  facts(ownerUserId: string | null, orderId: string): Promise<RefundOrderFacts | null>;
  factsByAttempt(orderId: string, paymentAttemptId: string): Promise<RefundOrderFacts | null>;
  create(input: {
    facts: RefundOrderFacts;
    businessKey: string;
    reasonCode: string;
    amountMinor: number;
    policyVersion: string;
    eligibilitySnapshot: Record<string, unknown>;
    requestId: string;
    affectsOrderEntitlement: boolean;
  }): Promise<RefundRecord>;
  get(refundId: string): Promise<RefundRecord | null>;
  findByOrder(orderId: string): Promise<RefundRecord | null>;
  markProcessing(refundId: string): Promise<RefundRecord>;
  recordProvider(refundId: string, providerRefundId: string): Promise<void>;
  succeed(refundId: string): Promise<void>;
  fail(refundId: string, error: Error): Promise<void>;
  listRecoverable(limit: number): Promise<readonly string[]>;
  listOwned(ownerUserId: string): Promise<readonly RefundRecord[]>;
}

export class RefundApplicationService implements RefundCommandPort {
  constructor(
    private readonly repository: RefundRepository,
    private readonly provider: PaymentProvider,
    private readonly entitlements: EntitlementGrantPort,
    private readonly clock: BusinessClock,
  ) {}

  async quote(ownerUserId: string, orderId: string) {
    const facts = await this.requireFacts(ownerUserId, orderId);
    const eligibility = await this.ordinaryEligibility(facts);
    const now = this.clock.now();
    return {
      refundQuoteId: randomUUID(),
      orderId,
      eligible: true,
      amount: { amount: eligibility.amountMinor, currency: 'CNY' as const },
      policyVersion: facts.refundPolicyVersion,
      expiresAt: new Date(now.getTime() + REFUND_QUOTE_TTL_MS),
    };
  }

  async request(ownerUserId: string, orderId: string, requestId: string) {
    const replay = await this.repository.findByOrder(orderId);
    if (replay) {
      if (replay.ownerUserId !== ownerUserId) {
        throw new RefundError('REFUND_ORDER_NOT_FOUND', 'Refundable order was not found');
      }
      return replay;
    }
    const facts = await this.requireFacts(ownerUserId, orderId);
    const eligibility = await this.ordinaryEligibility(facts);
    await this.entitlements.freezeBySource(orderId, 'ORDINARY_REFUND_REQUESTED');
    const refund = await this.repository.create({
      facts,
      businessKey: `ordinary-refund:${orderId}`,
      reasonCode: 'CUSTOMER_REQUEST_UNUSED',
      amountMinor: eligibility.amountMinor,
      policyVersion: facts.refundPolicyVersion,
      eligibilitySnapshot: eligibility.snapshot,
      requestId,
      affectsOrderEntitlement: true,
    });
    await this.process(refund.refundId);
    return this.repository.get(refund.refundId);
  }

  async reverseExceptional(orderId: string, reasonCode: string) {
    const replay = await this.repository.findByOrder(orderId);
    if (replay) return { refundId: replay.refundId };
    const facts = await this.requireFacts(null, orderId);
    if (facts.isUpgradePreviousOrder) {
      throw new RefundError(
        'MEMBERSHIP_UPGRADE_RESIDUAL_FORBIDDEN',
        'Previous membership value cannot enter a payment reversal',
      );
    }
    if (facts.orderStatus !== 'EXCEPTION') return null;
    const existingBalance = await this.entitlements.summarizeBySource(orderId);
    if (existingBalance.reservedQuantity > 0) {
      throw new RefundError('ENTITLEMENT_HAS_ACTIVE_RESERVATIONS', 'Exceptional reversal is waiting', true);
    }
    if (existingBalance.totalQuantity > 0) {
      await this.entitlements.freezeBySource(orderId, 'EXCEPTIONAL_REVERSAL_REQUESTED');
    }
    const refund = await this.repository.create({
      facts,
      businessKey: `exceptional-reversal:${orderId}`,
      reasonCode,
      amountMinor: facts.amountMinor,
      policyVersion: 'system-exceptional-reversal-v1',
      eligibilitySnapshot: { systemInitiated: true, orderStatus: facts.orderStatus },
      requestId: randomUUID(),
      affectsOrderEntitlement: true,
    });
    await this.process(refund.refundId);
    return { refundId: refund.refundId };
  }

  async reverseDuplicate(orderId: string, paymentAttemptId: string) {
    const facts = await this.repository.factsByAttempt(orderId, paymentAttemptId);
    if (!facts)
      throw new RefundError('DUPLICATE_PAYMENT_NOT_FOUND', 'Duplicate payment attempt was not found');
    const refund = await this.repository.create({
      facts,
      businessKey: `duplicate-charge:${paymentAttemptId}`,
      reasonCode: 'DUPLICATE_CHARGE',
      amountMinor: facts.amountMinor,
      policyVersion: 'system-duplicate-charge-v1',
      eligibilitySnapshot: { systemInitiated: true, duplicatePaymentAttemptId: paymentAttemptId },
      requestId: randomUUID(),
      affectsOrderEntitlement: false,
    });
    await this.process(refund.refundId);
    return { refundId: refund.refundId };
  }

  async process(refundId: string) {
    const refund = await this.repository.markProcessing(refundId);
    if (refund.status === 'SUCCEEDED') return refund;
    const facts =
      (await this.repository.factsByAttempt(refund.orderId, refund.paymentAttemptId)) ??
      (await this.requireFacts(null, refund.orderId));
    try {
      const result = await this.provider.refund({
        refundId: refund.refundId,
        orderId: refund.orderId,
        providerAttemptId: facts.providerAttemptId,
        amountMinor: refund.amountMinor,
        currency: 'CNY',
        reasonCode: refund.reasonCode,
      });
      await this.repository.recordProvider(refund.refundId, result.providerRefundId);
      if (refund.reasonCode !== 'DUPLICATE_CHARGE') {
        await this.entitlements.reverseAvailableBySource(
          refund.orderId,
          `money-refund:${refund.refundId}`,
          refund.requestId,
        );
      }
      await this.repository.succeed(refund.refundId);
      return this.repository.get(refund.refundId);
    } catch (error) {
      const failure = error instanceof Error ? error : new Error('Unknown refund failure');
      await this.repository.fail(refund.refundId, failure);
      throw error;
    }
  }

  async maintain(limit = 100) {
    let processed = 0;
    for (const refundId of await this.repository.listRecoverable(limit)) {
      await this.process(refundId).catch(() => undefined);
      processed += 1;
    }
    return processed;
  }

  list(ownerUserId: string) {
    return this.repository.listOwned(ownerUserId);
  }

  private async ordinaryEligibility(facts: RefundOrderFacts) {
    if (facts.offeringKind === 'MEMBERSHIP') {
      throw new RefundError(
        'MEMBERSHIP_REFUND_NOT_SUPPORTED',
        'This order is not eligible for ordinary refund',
      );
    }
    if (facts.orderStatus !== 'FULFILLED') {
      throw new RefundError('REFUND_ORDER_STATE_INVALID', 'Only fulfilled ordinary orders can be refunded');
    }
    if (facts.refundPolicy.eligibility !== 'UNUSED_ONLY') {
      throw new RefundError('REFUND_POLICY_UNSUPPORTED', 'The snapshotted refund policy is unsupported');
    }
    const balance = await this.entitlements.summarizeBySource(facts.orderId);
    if (
      balance.totalQuantity < 1 ||
      balance.reservedQuantity > 0 ||
      balance.availableQuantity !== balance.totalQuantity
    ) {
      throw new RefundError('REFUND_ENTITLEMENT_ALREADY_USED', 'The order entitlement is not fully unused');
    }
    const basisPoints = Number(facts.refundPolicy.refundableBasisPoints ?? 0);
    if (!Number.isInteger(basisPoints) || basisPoints < 1 || basisPoints > 10_000) {
      throw new RefundError('REFUND_POLICY_INVALID', 'The snapshotted refund policy is invalid');
    }
    return {
      amountMinor: Math.floor((facts.amountMinor * basisPoints) / 10_000),
      snapshot: { ...balance, eligibility: 'UNUSED_ONLY', refundableBasisPoints: basisPoints },
    };
  }

  private async requireFacts(ownerUserId: string | null, orderId: string) {
    const facts = await this.repository.facts(ownerUserId, orderId);
    if (!facts) throw new RefundError('REFUND_ORDER_NOT_FOUND', 'Refundable order was not found');
    return facts;
  }
}
