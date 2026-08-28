import type { BenefitReservation } from '@satori/application';
import type { BusinessContext } from '@satori/domain';
import type { PoolClient } from 'pg';
import type { EntitlementPage, EntitlementRepository } from '../application/index.js';
import {
  activeProjectionStatus,
  EntitlementLedgerError,
  type EntitlementBatchView,
  type EntitlementEntryType,
  type EntitlementGrantStatus,
  type EntitlementUsageView,
} from '../domain/index.js';

export interface GrantRow {
  id: string;
  owner_user_id: string;
  business_space: string;
  service_type: string;
  unit: string;
  source_type: string;
  source_id: string;
  total_quantity: number;
  available_quantity: number;
  reserved_quantity: number;
  status: EntitlementGrantStatus;
  effective_at: Date;
  expires_at: Date;
  granted_at: Date;
  expiry_timezone: string;
  rule_version: string;
  created_at: Date;
  updated_at: Date;
}

export interface EntryRow {
  id: string;
  grant_id: string;
  owner_user_id: string;
  business_space: string;
  entry_type: EntitlementEntryType;
  quantity: number;
  available_after: number;
  reserved_after: number;
  business_key: string;
  reservation_id: string | null;
  consumption_intent_id: string | null;
  business_context_type: string | null;
  business_context_id: string | null;
  original_entry_id: string | null;
  operator_adjustment_id: string | null;
  request_id: string;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export interface AppendInput {
  readonly id?: string;
  readonly grantId: string;
  readonly ownerUserId: string;
  readonly businessSpace: string;
  readonly entryType: EntitlementEntryType;
  readonly quantity: number;
  readonly availableAfter: number;
  readonly reservedAfter: number;
  readonly businessKey: string;
  readonly reservationId?: string;
  readonly consumptionIntentId?: string;
  readonly businessContext?: BusinessContext;
  readonly originalEntryId?: string;
  readonly operatorAdjustmentId?: string;
  readonly requestId: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export function mapGrant(row: GrantRow): EntitlementBatchView {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    businessSpace: row.business_space,
    serviceType: row.service_type,
    unit: row.unit,
    sourceType: row.source_type,
    sourceId: row.source_id,
    totalQuantity: row.total_quantity,
    availableQuantity: row.available_quantity,
    reservedQuantity: row.reserved_quantity,
    status: row.status,
    effectiveAt: row.effective_at,
    expiresAt: row.expires_at,
    grantedAt: row.granted_at,
    expiryTimezone: row.expiry_timezone,
    ruleVersion: row.rule_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapEntry(row: EntryRow): EntitlementUsageView {
  return {
    id: row.id,
    grantId: row.grant_id,
    ownerUserId: row.owner_user_id,
    businessSpace: row.business_space,
    entryType: row.entry_type,
    quantity: row.quantity,
    availableAfter: row.available_after,
    reservedAfter: row.reserved_after,
    businessKey: row.business_key,
    reservationId: row.reservation_id,
    consumptionIntentId: row.consumption_intent_id,
    businessContext:
      row.business_context_type && row.business_context_id
        ? { type: row.business_context_type, id: row.business_context_id }
        : null,
    originalEntryId: row.original_entry_id,
    operatorAdjustmentId: row.operator_adjustment_id,
    requestId: row.request_id,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

export function page<T>(rows: readonly T[], limit: number): EntitlementPage<T> {
  return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
}

export function sourcePortType(sourceType: string): 'MEMBERSHIP_ENTITLEMENT' | 'PURCHASED_ENTITLEMENT' {
  return sourceType === 'MEMBERSHIP' ? 'MEMBERSHIP_ENTITLEMENT' : 'PURCHASED_ENTITLEMENT';
}

export function reservationView(
  row: EntryRow & { source_type: string; expires_at: Date },
): BenefitReservation {
  return {
    reservationId: row.reservation_id!,
    sourceId: row.grant_id,
    sourceType: sourcePortType(row.source_type),
    quantity: row.quantity,
    expiresAt: row.expires_at,
  };
}

export function sameGrant(row: GrantRow, command: Parameters<EntitlementRepository['grant']>[0]) {
  return (
    row.owner_user_id === command.ownerUserId &&
    row.business_space === command.businessSpace &&
    row.unit === command.unit &&
    row.total_quantity === command.quantity &&
    row.effective_at.getTime() === command.effectiveAt.getTime() &&
    row.expires_at.getTime() === command.expiresAt.getTime() &&
    row.rule_version === command.ruleVersion
  );
}

export function terminalProjectionStatus(
  batch: EntitlementBatchView,
  available: number,
  expiredRelease: boolean,
): EntitlementGrantStatus {
  if (expiredRelease || batch.status === 'EXPIRED') return 'EXPIRED';
  if (batch.status === 'FORFEITED') return 'FORFEITED';
  if (batch.status === 'FROZEN') return 'FROZEN';
  return activeProjectionStatus(available);
}

export function stateTransition(
  batch: EntitlementBatchView,
  action: 'FREEZE' | 'UNFREEZE' | 'FORFEIT',
): { status: EntitlementGrantStatus; availableQuantity: number } | null {
  if (action === 'FREEZE') {
    if (batch.status === 'FROZEN') return null;
    if (!['ACTIVE', 'EXHAUSTED'].includes(batch.status)) {
      throw new EntitlementLedgerError('ENTITLEMENT_STATE_CONFLICT', `Cannot freeze ${batch.status} grant`);
    }
    return { status: 'FROZEN', availableQuantity: batch.availableQuantity };
  }
  if (action === 'UNFREEZE') {
    if (batch.status !== 'FROZEN') return null;
    if (batch.expiresAt <= new Date()) {
      throw new EntitlementLedgerError('ENTITLEMENT_EXPIRED', 'Expired grant cannot be unfrozen');
    }
    return {
      status: activeProjectionStatus(batch.availableQuantity),
      availableQuantity: batch.availableQuantity,
    };
  }
  if (batch.status === 'FORFEITED') return null;
  if (batch.reservedQuantity > 0) {
    throw new EntitlementLedgerError(
      'ENTITLEMENT_HAS_ACTIVE_RESERVATIONS',
      'Active reservations must be settled before forfeiture',
    );
  }
  if (batch.status === 'EXPIRED') {
    throw new EntitlementLedgerError('ENTITLEMENT_STATE_CONFLICT', 'Expired grant cannot be forfeited');
  }
  return { status: 'FORFEITED', availableQuantity: 0 };
}

export async function advisoryLock(client: PoolClient, key: string) {
  await client.query(`select pg_advisory_xact_lock(hashtextextended($1,0))`, [key]);
}

export function replayLedger(entries: readonly EntryRow[]) {
  let total = 0;
  let available = 0;
  let reserved = 0;
  const chainErrors: string[] = [];
  for (const entry of entries) {
    switch (entry.entry_type) {
      case 'GRANT':
        total += entry.quantity;
        available += entry.quantity;
        break;
      case 'RESERVE':
        available -= entry.quantity;
        reserved += entry.quantity;
        break;
      case 'COMMIT':
        reserved -= entry.quantity;
        break;
      case 'RELEASE':
        reserved -= entry.quantity;
        if (entry.metadata?.effect !== 'DISCARD_EXPIRED') available += entry.quantity;
        break;
      case 'REVERSE':
        if (entry.metadata?.effect === 'RESTORE_AVAILABLE') available += entry.quantity;
        else {
          available -= entry.quantity;
          total -= entry.quantity;
        }
        break;
      case 'EXPIRE':
      case 'FORFEIT':
        available -= entry.quantity;
        break;
      case 'ADJUSTMENT':
        if (entry.metadata?.direction === 'INCREASE') {
          total += entry.quantity;
          available += entry.quantity;
        } else {
          total -= entry.quantity;
          available -= entry.quantity;
        }
        break;
      case 'FREEZE':
      case 'UNFREEZE':
        break;
    }
    if (
      available !== entry.available_after ||
      reserved !== entry.reserved_after ||
      available < 0 ||
      reserved < 0
    ) {
      chainErrors.push(entry.id);
    }
  }
  return { total, available, reserved, chainErrors };
}
