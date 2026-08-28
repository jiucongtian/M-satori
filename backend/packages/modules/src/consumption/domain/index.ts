import type { BenefitCandidate } from '@satori/application';
import type { BenefitSourceType, BusinessContext, ServiceRequirement } from '@satori/domain';

export const CONSUMPTION_RULE_VERSION = 'fixed-source-priority-v1';
export const CONSUMPTION_RESERVATION_TTL_MS = 30 * 60 * 1_000;

export type ResolutionStatus = 'RESOLVED' | 'NO_SOURCE';
export type ConsumptionIntentStatus =
  'RESERVING' | 'RESERVED' | 'RUNNING' | 'COMMITTED' | 'RELEASED' | 'EXPIRED' | 'FAILED';

export interface ResolutionCandidateSnapshot extends BenefitCandidate {
  readonly rank: number;
  readonly eligible: boolean;
  readonly cost: number;
  readonly unit: 'COUNT' | 'WISDOM_SEED';
}

export interface EntitlementResolutionView {
  readonly resolutionId: string;
  readonly ownerUserId: string;
  readonly requirement: ServiceRequirement;
  readonly status: ResolutionStatus;
  readonly selectionMode: 'SYSTEM_RULE';
  readonly candidates: readonly ResolutionCandidateSnapshot[];
  readonly selectedSource: ResolutionCandidateSnapshot | null;
  readonly reasonCode: string;
  readonly ruleVersion: string;
  readonly resolvedAt: Date;
  readonly expiresAt: Date;
}

export interface ConsumptionIntentDetail {
  readonly intentId: string;
  readonly resolutionId: string;
  readonly ownerUserId: string;
  readonly businessContext: BusinessContext;
  readonly status: ConsumptionIntentStatus;
  readonly selectedSource: ResolutionCandidateSnapshot;
  readonly sourceReservationId: string | null;
  readonly reservedAt: Date | null;
  readonly reservationExpiresAt: Date | null;
  readonly startedAt: Date | null;
  readonly settledAt: Date | null;
}

export class ConsumptionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function rankCandidates(
  entitlementCandidates: readonly BenefitCandidate[],
  seedCandidates: readonly BenefitCandidate[],
): readonly ResolutionCandidateSnapshot[] {
  return [...entitlementCandidates, ...seedCandidates]
    .filter((candidate) => candidate.availableQuantity >= candidate.requiredQuantity)
    .sort(compareCandidate)
    .map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
      eligible: true,
      cost: candidate.requiredQuantity,
      unit: candidate.sourceType === 'COMPLIMENTARY_SEED' ? 'WISDOM_SEED' : 'COUNT',
    }));
}

export function sourceReason(sourceType: BenefitSourceType | null) {
  return sourceType === 'MEMBERSHIP_ENTITLEMENT'
    ? 'CURRENT_MEMBERSHIP_SELECTED'
    : sourceType === 'PURCHASED_ENTITLEMENT'
      ? 'EARLIEST_PURCHASED_PACKAGE_SELECTED'
      : sourceType === 'COMPLIMENTARY_SEED'
        ? 'EARLIEST_COMPLIMENTARY_SEEDS_SELECTED'
        : 'PURCHASE_REQUIRED';
}

function compareCandidate(left: BenefitCandidate, right: BenefitCandidate) {
  const priority = sourcePriority(left.sourceType) - sourcePriority(right.sourceType);
  if (priority !== 0) return priority;
  const leftExpiry = left.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const rightExpiry = right.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
  return (
    leftExpiry - rightExpiry ||
    left.grantedAt.getTime() - right.grantedAt.getTime() ||
    left.sourceId.localeCompare(right.sourceId)
  );
}

function sourcePriority(sourceType: BenefitSourceType) {
  return sourceType === 'MEMBERSHIP_ENTITLEMENT' ? 1 : sourceType === 'PURCHASED_ENTITLEMENT' ? 2 : 3;
}
