import {
  CursorCodec,
  normalizePageLimit,
  type BenefitCandidate,
  type BenefitReservation,
  type BenefitSourcePort,
  type BusinessClock,
  type EntitlementGrantCommand,
  type EntitlementGrantPort,
} from '@satori/application';
import type { BusinessContext, ServiceRequirement } from '@satori/domain';
import { randomUUID } from 'node:crypto';
import {
  calculateNaturalDayExpiry,
  ENTITLEMENT_EXPIRY_RULE_VERSION,
  ENTITLEMENT_EXPIRY_TIMEZONE,
  type EntitlementBatchView,
  type EntitlementUsageView,
} from '../domain/index.js';

export const ENTITLEMENT_REPOSITORY = Symbol('ENTITLEMENT_REPOSITORY');

export interface GrantPurchasedEntitlementCommand extends Omit<
  EntitlementGrantCommand,
  'effectiveAt' | 'expiresAt' | 'ruleVersion'
> {
  readonly paymentSucceededAt: Date;
  readonly validityDays: number;
  readonly requestId: string;
}

export interface EntitlementCursorPosition {
  readonly createdAt: Date;
  readonly id: string;
}

export interface EntitlementPage<T> {
  readonly rows: readonly T[];
  readonly hasMore: boolean;
}

export interface ReverseEntitlementCommand {
  readonly grantId: string;
  readonly originalEntryId: string;
  readonly quantity: number;
  readonly businessKey: string;
  readonly requestId: string;
  readonly businessContext?: BusinessContext;
  readonly reasonCode: string;
}

export interface AdjustEntitlementCommand {
  readonly grantId: string;
  readonly quantity: number;
  readonly direction: 'INCREASE' | 'DECREASE';
  readonly reasonCode: string;
  readonly note: string;
  readonly operatorUserId: string;
  readonly requestId: string;
  readonly relatedOrderId?: string;
  readonly relatedTaskId?: string;
}

export interface EntitlementReconciliationReport {
  readonly checkedGrants: number;
  readonly openedCases: number;
  readonly resolvedCases: number;
}

export interface EntitlementRepository {
  grant(
    command: EntitlementGrantCommand & { requestId: string },
    businessKey: string,
  ): Promise<{ grantId: string }>;
  listCandidates(requirement: ServiceRequirement): Promise<readonly BenefitCandidate[]>;
  reserve(candidate: BenefitCandidate, intentId: string): Promise<BenefitReservation>;
  settle(reservationId: string, action: 'COMMIT' | 'RELEASE', context: BusinessContext): Promise<void>;
  changeSourceState(
    sourceId: string,
    action: 'FREEZE' | 'UNFREEZE' | 'FORFEIT',
    reasonCode: string,
    requestId: string,
  ): Promise<number>;
  reverse(command: ReverseEntitlementCommand): Promise<void>;
  adjust(command: AdjustEntitlementCommand): Promise<{ entryId: string }>;
  list(
    ownerUserId: string,
    cursor: EntitlementCursorPosition | null,
    limit: number,
  ): Promise<EntitlementPage<EntitlementBatchView>>;
  get(ownerUserId: string, grantId: string): Promise<EntitlementBatchView | null>;
  listUsage(
    ownerUserId: string,
    grantId: string | null,
    cursor: EntitlementCursorPosition | null,
    limit: number,
    entryType?: EntitlementUsageView['entryType'],
  ): Promise<EntitlementPage<EntitlementUsageView>>;
  expireDue(now: Date, requestId: string): Promise<number>;
  reconcile(now: Date, requestId: string): Promise<EntitlementReconciliationReport>;
  summarizeBySource(sourceId: string): Promise<{
    totalQuantity: number;
    availableQuantity: number;
    reservedQuantity: number;
  }>;
  reverseAvailableBySource(sourceId: string, businessKey: string, requestId: string): Promise<number>;
}

export class EntitlementApplicationService implements BenefitSourcePort, EntitlementGrantPort {
  private readonly cursors: CursorCodec;

  constructor(
    private readonly repository: EntitlementRepository,
    cursorSigningSecret: string,
    private readonly clock: BusinessClock,
  ) {
    this.cursors = new CursorCodec(cursorSigningSecret);
  }

  grant(command: EntitlementGrantCommand, idempotencyKey: string) {
    return this.repository.grant({ ...command, requestId: randomUUID() }, idempotencyKey);
  }

  grantPurchased(command: GrantPurchasedEntitlementCommand, idempotencyKey: string) {
    return this.repository.grant(
      {
        ...command,
        effectiveAt: command.paymentSucceededAt,
        expiresAt: calculateNaturalDayExpiry(command.paymentSucceededAt, command.validityDays),
        ruleVersion: ENTITLEMENT_EXPIRY_RULE_VERSION,
      },
      idempotencyKey,
    );
  }

  listCandidates(requirement: ServiceRequirement) {
    return this.repository.listCandidates(requirement);
  }

  reserve(candidate: BenefitCandidate, intentId: string) {
    return this.repository.reserve(candidate, intentId);
  }

  commit(reservationId: string, businessContext: BusinessContext) {
    return this.repository.settle(reservationId, 'COMMIT', businessContext);
  }

  release(reservationId: string, businessContext: BusinessContext) {
    return this.repository.settle(reservationId, 'RELEASE', businessContext);
  }

  freezeBySource(sourceId: string, reasonCode: string) {
    return this.repository
      .changeSourceState(sourceId, 'FREEZE', reasonCode, randomUUID())
      .then(() => undefined);
  }

  unfreezeBySource(sourceId: string, reasonCode: string) {
    return this.repository
      .changeSourceState(sourceId, 'UNFREEZE', reasonCode, randomUUID())
      .then(() => undefined);
  }

  forfeitBySource(sourceId: string, reasonCode: string) {
    return this.repository
      .changeSourceState(sourceId, 'FORFEIT', reasonCode, randomUUID())
      .then(() => undefined);
  }

  reverse(command: ReverseEntitlementCommand) {
    return this.repository.reverse(command);
  }

  adjust(command: AdjustEntitlementCommand) {
    return this.repository.adjust(command);
  }

  async list(ownerUserId: string, input: { cursor?: string; limit?: number }) {
    const limit = normalizePageLimit(input.limit);
    const page = await this.repository.list(ownerUserId, this.decodeCursor(input.cursor), limit);
    return { data: page.rows.map(toEntitlementResponse), meta: this.pageMeta(page) };
  }

  async get(ownerUserId: string, grantId: string) {
    const grant = await this.repository.get(ownerUserId, grantId);
    if (!grant) return null;
    return toEntitlementResponse(grant);
  }

  async listUsage(ownerUserId: string, input: { grantId?: string; cursor?: string; limit?: number }) {
    const limit = normalizePageLimit(input.limit);
    const page = await this.repository.listUsage(
      ownerUserId,
      input.grantId ?? null,
      this.decodeCursor(input.cursor),
      limit,
      'COMMIT',
    );
    return { data: page.rows.map(toUsageResponse), meta: this.pageMeta(page) };
  }

  expireDue(now = this.clock.now()) {
    return this.repository.expireDue(now, randomUUID());
  }

  summarizeBySource(sourceId: string) {
    return this.repository.summarizeBySource(sourceId);
  }

  reverseAvailableBySource(sourceId: string, businessKey: string, requestId: string) {
    return this.repository.reverseAvailableBySource(sourceId, businessKey, requestId);
  }

  reconcile(now = this.clock.now()) {
    return this.repository.reconcile(now, randomUUID());
  }

  private decodeCursor(cursor: string | undefined): EntitlementCursorPosition | null {
    if (!cursor) return null;
    const decoded = this.cursors.decode(cursor);
    return { createdAt: new Date(decoded.createdAt), id: decoded.id };
  }

  private pageMeta<T extends { id: string; createdAt: Date }>(page: EntitlementPage<T>) {
    const last = page.rows.at(-1);
    return {
      hasMore: page.hasMore,
      nextCursor:
        page.hasMore && last
          ? this.cursors.encode({ createdAt: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }
}

export { ENTITLEMENT_EXPIRY_TIMEZONE };

function toEntitlementResponse(grant: EntitlementBatchView) {
  return {
    entitlementId: grant.id,
    serviceType: grant.serviceType,
    unit: grant.unit,
    sourceType: grant.sourceType === 'MANUAL' ? 'COMPENSATION' : grant.sourceType,
    sourceId: grant.sourceId,
    total: grant.totalQuantity,
    available: grant.availableQuantity,
    reserved: grant.reservedQuantity,
    status:
      grant.reservedQuantity > 0 && ['ACTIVE', 'EXHAUSTED'].includes(grant.status)
        ? 'RESERVED'
        : grant.status === 'ACTIVE'
          ? 'AVAILABLE'
          : grant.status,
    validFrom: grant.effectiveAt,
    expiresAt: grant.expiresAt,
    expiryTimezone: grant.expiryTimezone,
    ruleVersion: grant.ruleVersion,
  };
}

function toUsageResponse(entry: EntitlementUsageView) {
  return {
    recordId: entry.id,
    entitlementId: entry.grantId,
    type: entry.entryType,
    quantity: entry.quantity,
    businessContext: entry.businessContext ?? { type: 'ENTITLEMENT_GRANT', id: entry.grantId },
    originalRecordId: entry.originalEntryId,
    createdAt: entry.createdAt,
  };
}
