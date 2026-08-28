import type { EntitlementGrantPort, MembershipGrantPort } from '@satori/application';
import { FULFILLMENT_MAX_ATTEMPTS, FulfillmentError } from '../domain/index.js';

export const FULFILLMENT_REPOSITORY = Symbol('FULFILLMENT_REPOSITORY');
export interface FulfillmentClaim {
  jobId: string;
  orderId: string;
  ownerUserId: string;
  paidAt: Date;
  offeringKind: string;
  offeringVersionId: string;
  offeringSnapshot: Record<string, unknown>;
  attempt: number;
}
export interface FulfillmentRepository {
  claim(orderId: string, paymentAttemptId: string): Promise<FulfillmentClaim | null>;
  succeed(jobId: string, references: Record<string, unknown>): Promise<void>;
  fail(
    jobId: string,
    failure: { code: string; message: string },
    retryable: boolean,
  ): Promise<'RETRY_WAIT' | 'FAILED'>;
  listRecoverable(limit: number): Promise<readonly { orderId: string; paymentAttemptId: string }[]>;
}

export class FulfillmentApplicationService {
  constructor(
    private readonly repository: FulfillmentRepository,
    private readonly entitlements: EntitlementGrantPort,
    private readonly memberships: MembershipGrantPort,
  ) {}

  async process(orderId: string, paymentAttemptId: string) {
    const claim = await this.repository.claim(orderId, paymentAttemptId);
    if (!claim) return null;
    try {
      const result =
        claim.offeringKind === 'MEMBERSHIP'
          ? await this.memberships.activate(
              {
                ownerUserId: claim.ownerUserId,
                businessSpace: 'SATORI',
                planVersionId: claim.offeringVersionId,
                sourceOrderId: claim.orderId,
                startsAt: claim.paidAt,
              },
              `fulfillment:${claim.orderId}:membership`,
            )
          : await this.grantBenefits(claim);
      await this.repository.succeed(claim.jobId, result);
      return result;
    } catch (error) {
      const failure = error instanceof Error ? error : new Error('Unknown fulfillment failure');
      const retryable = (error as { retryable?: unknown } | null)?.retryable === true;
      await this.repository.fail(
        claim.jobId,
        {
          code: error instanceof FulfillmentError ? error.code : 'FULFILLMENT_FAILED',
          message: failure.message,
        },
        retryable,
      );
      throw error;
    }
  }

  async reconcile(limit = 200) {
    const jobs = await this.repository.listRecoverable(limit);
    for (const job of jobs) await this.process(job.orderId, job.paymentAttemptId).catch(() => undefined);
    return jobs.length;
  }

  private async grantBenefits(claim: FulfillmentClaim) {
    const spec = record(claim.offeringSnapshot.entitlementSpec);
    const benefits = Array.isArray(spec.benefits) ? spec.benefits.map(record) : [spec];
    const grantIds: string[] = [];
    for (const benefit of benefits) {
      const serviceType = benefit.serviceType;
      const unit = benefit.unit;
      const quantity = Number(benefit.quantity ?? 1);
      const validityDays = Number(claim.offeringSnapshot.validityDays ?? 30);
      if (
        (serviceType !== 'DAILY_INSIGHT' && serviceType !== 'CARD_READING') ||
        (unit !== 'DAILY_INSIGHT_CREDIT' && unit !== 'READING_CREDIT') ||
        !Number.isInteger(quantity) ||
        quantity < 1
      )
        throw new FulfillmentError('INVALID_ENTITLEMENT_SNAPSHOT', 'Order entitlement snapshot is invalid');
      const granted = await this.entitlements.grant(
        {
          ownerUserId: claim.ownerUserId,
          businessSpace: 'SATORI',
          serviceType,
          unit,
          quantity,
          sourceType: 'PURCHASE',
          sourceId: claim.orderId,
          effectiveAt: claim.paidAt,
          expiresAt: naturalDayExpiry(claim.paidAt, validityDays),
          ruleVersion: 'natural-day-cst-v1',
        },
        `fulfillment:${claim.orderId}:${serviceType}:${unit}`,
      );
      grantIds.push(granted.grantId);
    }
    return { grantIds };
  }
}

export { FULFILLMENT_MAX_ATTEMPTS };
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function naturalDayExpiry(paidAt: Date, days: number) {
  const cst = new Date(paidAt.getTime() + 8 * 3_600_000);
  return new Date(
    Date.UTC(cst.getUTCFullYear(), cst.getUTCMonth(), cst.getUTCDate() + days, 15, 59, 59, 999),
  );
}
