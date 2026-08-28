export const ENTITLEMENT_EXPIRY_TIMEZONE = 'Asia/Shanghai';
export const ENTITLEMENT_EXPIRY_RULE_VERSION = 'natural-day-asia-shanghai-v1';

export type EntitlementEntryType =
  | 'GRANT'
  | 'RESERVE'
  | 'COMMIT'
  | 'RELEASE'
  | 'REVERSE'
  | 'EXPIRE'
  | 'FREEZE'
  | 'UNFREEZE'
  | 'FORFEIT'
  | 'ADJUSTMENT';

export type EntitlementGrantStatus = 'PENDING' | 'ACTIVE' | 'FROZEN' | 'EXHAUSTED' | 'EXPIRED' | 'FORFEITED';

export interface EntitlementBatchView {
  readonly id: string;
  readonly ownerUserId: string;
  readonly businessSpace: string;
  readonly serviceType: string;
  readonly unit: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly totalQuantity: number;
  readonly availableQuantity: number;
  readonly reservedQuantity: number;
  readonly status: EntitlementGrantStatus;
  readonly effectiveAt: Date;
  readonly expiresAt: Date;
  readonly grantedAt: Date;
  readonly expiryTimezone: string;
  readonly ruleVersion: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface EntitlementUsageView {
  readonly id: string;
  readonly grantId: string;
  readonly ownerUserId: string;
  readonly businessSpace: string;
  readonly entryType: EntitlementEntryType;
  readonly quantity: number;
  readonly availableAfter: number;
  readonly reservedAfter: number;
  readonly businessKey: string;
  readonly reservationId: string | null;
  readonly consumptionIntentId: string | null;
  readonly businessContext: { readonly type: string; readonly id: string } | null;
  readonly originalEntryId: string | null;
  readonly operatorAdjustmentId: string | null;
  readonly requestId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
}

export class EntitlementLedgerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function calculateNaturalDayExpiry(paymentSucceededAt: Date, validityDays: number): Date {
  if (!Number.isInteger(validityDays) || validityDays < 1) {
    throw new EntitlementLedgerError('INVALID_VALIDITY_DAYS', 'validityDays must be positive');
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ENTITLEMENT_EXPIRY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(paymentSucceededAt);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return new Date(
    Date.UTC(value('year'), value('month') - 1, value('day') + validityDays - 1, 15, 59, 59, 999),
  );
}

export function assertReservable(batch: EntitlementBatchView, quantity: number, now: Date) {
  if (!Number.isInteger(quantity) || quantity < 1 || batch.availableQuantity < quantity) {
    throw new EntitlementLedgerError('ENTITLEMENT_INSUFFICIENT', 'Insufficient entitlement balance');
  }
  if (batch.status !== 'ACTIVE') {
    throw new EntitlementLedgerError('ENTITLEMENT_NOT_ACTIVE', 'Entitlement is not active');
  }
  if (batch.effectiveAt > now || batch.expiresAt <= now) {
    throw new EntitlementLedgerError('ENTITLEMENT_EXPIRED', 'Entitlement is outside its valid period');
  }
}

export function activeProjectionStatus(availableQuantity: number): EntitlementGrantStatus {
  return availableQuantity > 0 ? 'ACTIVE' : 'EXHAUSTED';
}
