import { Inject, Injectable } from '@nestjs/common';
import { SystemClock, type BenefitCandidate, type BenefitReservation } from '@satori/application';
import type { BusinessContext, ServiceRequirement } from '@satori/domain';
import { RuntimeInfrastructure } from '@satori/infrastructure';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type {
  AdjustEntitlementCommand,
  EntitlementCursorPosition,
  EntitlementRepository,
  ReverseEntitlementCommand,
} from '../application/index.js';
import { EntitlementApplicationService } from '../application/index.js';
import {
  activeProjectionStatus,
  assertReservable,
  EntitlementLedgerError,
  type EntitlementEntryType,
} from '../domain/index.js';
import { reconcileEntitlements } from './reconciliation.js';
import {
  advisoryLock,
  type AppendInput,
  type EntryRow,
  type GrantRow,
  mapEntry,
  mapGrant,
  page,
  reservationView,
  sameGrant,
  sourcePortType,
  stateTransition,
  terminalProjectionStatus,
} from './support.js';

@Injectable()
export class PostgresEntitlementRepository implements EntitlementRepository {
  constructor(@Inject(RuntimeInfrastructure) private readonly infrastructure: RuntimeInfrastructure) {}

  async grant(command: Parameters<EntitlementRepository['grant']>[0], businessKey: string) {
    this.assertGrant(command);
    return this.transaction(async (client) => {
      const grantId = randomUUID();
      const inserted = await client.query<{ id: string }>(
        `insert into entitlement_grants
         (id,owner_user_id,business_space,service_type,unit,source_type,source_id,total_quantity,
          available_quantity,reserved_quantity,status,effective_at,expires_at,granted_at,
          expiry_timezone,rule_version,request_id)
         values($1,$2,$3,$4,$5,$6,$7,$8,$8,0,$13,$9,$10,$9,'Asia/Shanghai',$11,$12)
         on conflict (source_type,source_id,service_type) do nothing returning id`,
        [
          grantId,
          command.ownerUserId,
          command.businessSpace,
          command.serviceType,
          command.unit,
          command.sourceType,
          command.sourceId,
          command.quantity,
          command.effectiveAt,
          command.expiresAt,
          command.ruleVersion,
          command.requestId,
          command.initialStatus ?? 'ACTIVE',
        ],
      );
      if (!inserted.rows[0]) {
        const existing = await client.query<GrantRow>(
          `select * from entitlement_grants where source_type=$1 and source_id=$2 and service_type=$3`,
          [command.sourceType, command.sourceId, command.serviceType],
        );
        const row = existing.rows[0];
        if (!row || !sameGrant(row, command)) {
          throw new EntitlementLedgerError(
            'IDEMPOTENCY_KEY_REUSED',
            'The entitlement source already exists with a different payload',
          );
        }
        return { grantId: row.id };
      }
      await this.append(client, {
        grantId,
        ownerUserId: command.ownerUserId,
        businessSpace: command.businessSpace,
        entryType: 'GRANT',
        quantity: command.quantity,
        availableAfter: command.quantity,
        reservedAfter: 0,
        businessKey,
        businessContext: { type: command.sourceType, id: command.sourceId },
        requestId: command.requestId,
        metadata: { sourceType: command.sourceType, sourceId: command.sourceId, unit: command.unit },
      });
      return { grantId };
    });
  }

  async listCandidates(requirement: ServiceRequirement): Promise<readonly BenefitCandidate[]> {
    const result = await this.infrastructure.pool.query<GrantRow>(
      `select * from entitlement_grants
       where owner_user_id=$1 and business_space=$2 and service_type=$3 and unit=$4 and status='ACTIVE'
         and effective_at <= now() and expires_at > now() and available_quantity >= $5
       order by case when source_type='MEMBERSHIP' then 0 else 1 end, expires_at, granted_at, id`,
      [
        requirement.userId,
        requirement.businessSpace,
        requirement.serviceType,
        requirement.unit,
        requirement.quantity,
      ],
    );
    return result.rows.map((row) => ({
      sourceId: row.id,
      sourceType: sourcePortType(row.source_type),
      serviceType: requirement.serviceType,
      availableQuantity: row.available_quantity,
      requiredQuantity: requirement.quantity,
      expiresAt: row.expires_at,
      grantedAt: row.granted_at,
      ruleVersion: row.rule_version,
    }));
  }

  async summarizeBySource(sourceId: string) {
    const result = await this.infrastructure.pool.query<{
      total_quantity: string;
      available_quantity: string;
      reserved_quantity: string;
    }>(
      `select coalesce(sum(total_quantity),0)::text total_quantity,
              coalesce(sum(available_quantity),0)::text available_quantity,
              coalesce(sum(reserved_quantity),0)::text reserved_quantity
       from entitlement_grants where source_id=$1`,
      [sourceId],
    );
    const row = result.rows[0]!;
    return {
      totalQuantity: Number(row.total_quantity),
      availableQuantity: Number(row.available_quantity),
      reservedQuantity: Number(row.reserved_quantity),
    };
  }

  async reserve(candidate: BenefitCandidate, intentId: string): Promise<BenefitReservation> {
    return this.transaction(async (client) => {
      await advisoryLock(client, `entitlement-intent:${intentId}`);
      const replay = await client.query<EntryRow & { source_type: string; expires_at: Date }>(
        `select e.*,g.source_type,g.expires_at from entitlement_usage_entries e
         join entitlement_grants g on g.id=e.grant_id
         where e.consumption_intent_id=$1 and e.entry_type='RESERVE' order by e.created_at,e.id limit 1`,
        [intentId],
      );
      if (replay.rows[0]) return reservationView(replay.rows[0]);

      const batch = await this.lockGrant(client, candidate.sourceId);
      if (sourcePortType(batch.sourceType) !== candidate.sourceType) {
        throw new EntitlementLedgerError(
          'ENTITLEMENT_SOURCE_MISMATCH',
          'Candidate source does not match grant',
        );
      }
      if (batch.serviceType !== candidate.serviceType) {
        throw new EntitlementLedgerError(
          'ENTITLEMENT_SERVICE_MISMATCH',
          'Candidate service does not match grant',
        );
      }
      assertReservable(batch, candidate.requiredQuantity, new Date());
      const reservationId = randomUUID();
      const available = batch.availableQuantity - candidate.requiredQuantity;
      const reserved = batch.reservedQuantity + candidate.requiredQuantity;
      await client.query(
        `update entitlement_grants set available_quantity=$2,reserved_quantity=$3,status=$4,
         version=version+1,updated_at=now() where id=$1`,
        [batch.id, available, reserved, activeProjectionStatus(available)],
      );
      await this.append(client, {
        grantId: batch.id,
        ownerUserId: batch.ownerUserId,
        businessSpace: batch.businessSpace,
        entryType: 'RESERVE',
        quantity: candidate.requiredQuantity,
        availableAfter: available,
        reservedAfter: reserved,
        businessKey: `${intentId}:RESERVE`,
        reservationId,
        consumptionIntentId: intentId,
        requestId: randomUUID(),
      });
      return {
        reservationId,
        sourceId: batch.id,
        sourceType: candidate.sourceType,
        quantity: candidate.requiredQuantity,
        expiresAt: batch.expiresAt,
      };
    });
  }

  async settle(reservationId: string, action: 'COMMIT' | 'RELEASE', context: BusinessContext) {
    await this.transaction(async (client) => {
      await advisoryLock(client, `entitlement-reservation:${reservationId}`);
      const reserved = await client.query<EntryRow>(
        `select * from entitlement_usage_entries where reservation_id=$1 and entry_type='RESERVE' for update`,
        [reservationId],
      );
      const entry = reserved.rows[0];
      if (!entry) throw new EntitlementLedgerError('RESERVATION_NOT_FOUND', 'Reservation was not found');
      const terminal = await client.query<{ entry_type: EntitlementEntryType }>(
        `select entry_type from entitlement_usage_entries
         where reservation_id=$1 and entry_type in ('COMMIT','RELEASE') order by created_at,id limit 1`,
        [reservationId],
      );
      if (terminal.rows[0]) {
        if (terminal.rows[0].entry_type === action) return;
        throw new EntitlementLedgerError(
          'CONSUMPTION_ALREADY_SETTLED',
          `Reservation was already settled as ${terminal.rows[0].entry_type}`,
        );
      }
      const batch = await this.lockGrant(client, entry.grant_id);
      if (!entry.consumption_intent_id) {
        throw new EntitlementLedgerError(
          'ENTITLEMENT_LEDGER_INVARIANT',
          'Reservation has no consumption intent',
        );
      }
      if (batch.reservedQuantity < entry.quantity) {
        throw new EntitlementLedgerError('ENTITLEMENT_LEDGER_INVARIANT', 'Reserved projection is too low');
      }
      const expiredRelease = action === 'RELEASE' && batch.expiresAt <= new Date();
      const releasedAvailable =
        action === 'RELEASE' && !expiredRelease
          ? batch.availableQuantity + entry.quantity
          : batch.availableQuantity;
      const available = expiredRelease ? 0 : releasedAvailable;
      const reservedAfter = batch.reservedQuantity - entry.quantity;
      const status = terminalProjectionStatus(batch, available, expiredRelease);
      await client.query(
        `update entitlement_grants set available_quantity=$2,reserved_quantity=$3,status=$4,
         version=version+1,updated_at=now() where id=$1`,
        [batch.id, available, reservedAfter, status],
      );
      await this.append(client, {
        grantId: batch.id,
        ownerUserId: batch.ownerUserId,
        businessSpace: batch.businessSpace,
        entryType: action,
        quantity: entry.quantity,
        availableAfter: releasedAvailable,
        reservedAfter,
        businessKey: `${entry.consumption_intent_id}:${action}`,
        reservationId,
        consumptionIntentId: entry.consumption_intent_id,
        businessContext: context,
        requestId: randomUUID(),
        metadata: expiredRelease ? { effect: 'DISCARD_EXPIRED' } : {},
      });
      if (expiredRelease && releasedAvailable > 0) {
        await this.append(client, {
          grantId: batch.id,
          ownerUserId: batch.ownerUserId,
          businessSpace: batch.businessSpace,
          entryType: 'EXPIRE',
          quantity: releasedAvailable,
          availableAfter: 0,
          reservedAfter,
          businessKey: `${batch.id}:EXPIRE:${batch.expiresAt.toISOString()}`,
          businessContext: { type: 'ENTITLEMENT_GRANT', id: batch.id },
          requestId: randomUUID(),
          metadata: { expiresAt: batch.expiresAt.toISOString(), triggeredBy: 'RELEASE' },
        });
      }
    });
  }

  async changeSourceState(
    sourceId: string,
    action: 'FREEZE' | 'UNFREEZE' | 'FORFEIT',
    reasonCode: string,
    requestId: string,
  ) {
    return this.transaction(async (client) => {
      await advisoryLock(client, `entitlement-source:${sourceId}`);
      const result = await client.query<GrantRow>(
        `select * from entitlement_grants where source_id=$1 order by id for update`,
        [sourceId],
      );
      if (result.rows.length === 0) {
        throw new EntitlementLedgerError('ENTITLEMENT_NOT_FOUND', 'Entitlement source was not found');
      }
      let changed = 0;
      for (const row of result.rows) {
        const batch = mapGrant(row);
        const businessKey = `${sourceId}:${action}:${reasonCode}`;
        const replay = await client.query(
          `select 1 from entitlement_usage_entries where grant_id=$1 and entry_type=$2 and business_key=$3`,
          [batch.id, action, businessKey],
        );
        if (replay.rowCount) continue;
        const next = stateTransition(batch, action);
        if (!next) continue;
        await client.query(
          `update entitlement_grants set status=$2,available_quantity=$3,version=version+1,updated_at=now()
           where id=$1`,
          [batch.id, next.status, next.availableQuantity],
        );
        await this.append(client, {
          grantId: batch.id,
          ownerUserId: batch.ownerUserId,
          businessSpace: batch.businessSpace,
          entryType: action,
          quantity: Math.max(0, batch.availableQuantity - next.availableQuantity),
          availableAfter: next.availableQuantity,
          reservedAfter: batch.reservedQuantity,
          businessKey,
          businessContext: { type: 'ENTITLEMENT_SOURCE', id: sourceId },
          requestId,
          metadata: { reasonCode },
        });
        changed += 1;
      }
      return changed;
    });
  }

  async reverse(command: ReverseEntitlementCommand) {
    if (!Number.isInteger(command.quantity) || command.quantity < 1) {
      throw new EntitlementLedgerError('INVALID_ENTITLEMENT_QUANTITY', 'Reverse quantity must be positive');
    }
    await this.transaction(async (client) => {
      await advisoryLock(client, `entitlement-reverse:${command.originalEntryId}`);
      const duplicate = await client.query(
        `select 1 from entitlement_usage_entries where grant_id=$1 and entry_type='REVERSE'
         and business_key=$2`,
        [command.grantId, command.businessKey],
      );
      if (duplicate.rowCount) return;
      const originalResult = await client.query<EntryRow>(
        `select * from entitlement_usage_entries where id=$1 and grant_id=$2 for update`,
        [command.originalEntryId, command.grantId],
      );
      const original = originalResult.rows[0];
      if (!original || !['GRANT', 'COMMIT'].includes(original.entry_type)) {
        throw new EntitlementLedgerError(
          'ENTITLEMENT_REVERSE_NOT_ALLOWED',
          'Only grant or commit entries can be reversed',
        );
      }
      if (command.quantity > original.quantity) {
        throw new EntitlementLedgerError(
          'ENTITLEMENT_REVERSE_EXCEEDS_ORIGINAL',
          'Reverse exceeds original entry',
        );
      }
      const prior = await client.query<{ quantity: string }>(
        `select coalesce(sum(quantity),0)::text as quantity from entitlement_usage_entries
         where original_entry_id=$1 and entry_type='REVERSE'`,
        [command.originalEntryId],
      );
      if (Number(prior.rows[0]?.quantity ?? 0) + command.quantity > original.quantity) {
        throw new EntitlementLedgerError(
          'ENTITLEMENT_REVERSE_EXCEEDS_ORIGINAL',
          'Reverse exceeds original entry',
        );
      }
      const batch = await this.lockGrant(client, command.grantId);
      let available = batch.availableQuantity;
      let total = batch.totalQuantity;
      let effect: 'REMOVE_AVAILABLE' | 'RESTORE_AVAILABLE';
      if (original.entry_type === 'GRANT') {
        if (
          available < command.quantity ||
          total - command.quantity < available - command.quantity + batch.reservedQuantity
        ) {
          throw new EntitlementLedgerError(
            'ENTITLEMENT_REVERSE_NOT_AVAILABLE',
            'Granted quantity is no longer reversible',
          );
        }
        available -= command.quantity;
        total -= command.quantity;
        effect = 'REMOVE_AVAILABLE';
      } else {
        if (
          ['EXPIRED', 'FORFEITED'].includes(batch.status) ||
          available + command.quantity + batch.reservedQuantity > total
        ) {
          throw new EntitlementLedgerError(
            'ENTITLEMENT_REVERSE_NOT_AVAILABLE',
            'Committed quantity cannot be restored',
          );
        }
        available += command.quantity;
        effect = 'RESTORE_AVAILABLE';
      }
      const status = batch.status === 'FROZEN' ? 'FROZEN' : activeProjectionStatus(available);
      await client.query(
        `update entitlement_grants set total_quantity=$2,available_quantity=$3,status=$4,
         version=version+1,updated_at=now() where id=$1`,
        [batch.id, total, available, status],
      );
      await this.append(client, {
        grantId: batch.id,
        ownerUserId: batch.ownerUserId,
        businessSpace: batch.businessSpace,
        entryType: 'REVERSE',
        quantity: command.quantity,
        availableAfter: available,
        reservedAfter: batch.reservedQuantity,
        businessKey: command.businessKey,
        ...(command.businessContext ? { businessContext: command.businessContext } : {}),
        originalEntryId: command.originalEntryId,
        requestId: command.requestId,
        metadata: { effect, reasonCode: command.reasonCode },
      });
    });
  }

  async adjust(command: AdjustEntitlementCommand) {
    if (!Number.isInteger(command.quantity) || command.quantity < 1 || !command.reasonCode || !command.note) {
      throw new EntitlementLedgerError('INVALID_ADJUSTMENT', 'Adjustment requires quantity, reason and note');
    }
    return this.transaction(async (client) => {
      await advisoryLock(client, `entitlement-adjustment:${command.requestId}`);
      const replay = await client.query<{ id: string }>(
        `select id from entitlement_usage_entries where grant_id=$1 and entry_type='ADJUSTMENT'
         and business_key=$2`,
        [command.grantId, `adjustment:${command.requestId}`],
      );
      if (replay.rows[0]) return { entryId: replay.rows[0].id };
      const batch = await this.lockGrant(client, command.grantId);
      if (['EXPIRED', 'FORFEITED'].includes(batch.status)) {
        throw new EntitlementLedgerError(
          'ENTITLEMENT_ADJUSTMENT_NOT_ALLOWED',
          'Terminal grant cannot be adjusted',
        );
      }
      if (command.direction === 'DECREASE' && batch.availableQuantity < command.quantity) {
        throw new EntitlementLedgerError(
          'ENTITLEMENT_INSUFFICIENT',
          'Adjustment would make balance negative',
        );
      }
      const delta = command.direction === 'INCREASE' ? command.quantity : -command.quantity;
      const total = batch.totalQuantity + delta;
      const available = batch.availableQuantity + delta;
      const adjustmentId = randomUUID();
      const entryId = randomUUID();
      await client.query(
        `insert into operator_adjustments
         (id,owner_user_id,business_space,ledger_type,grant_id,quantity,direction,reason_code,note,
          operator_user_id,related_order_id,related_task_id,request_id,ledger_entry_id)
         values($1,$2,$3,'ENTITLEMENT',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          adjustmentId,
          batch.ownerUserId,
          batch.businessSpace,
          batch.id,
          command.quantity,
          command.direction,
          command.reasonCode,
          command.note,
          command.operatorUserId,
          command.relatedOrderId ?? null,
          command.relatedTaskId ?? null,
          command.requestId,
          entryId,
        ],
      );
      const status = batch.status === 'FROZEN' ? 'FROZEN' : activeProjectionStatus(available);
      await client.query(
        `update entitlement_grants set total_quantity=$2,available_quantity=$3,status=$4,
         version=version+1,updated_at=now() where id=$1`,
        [batch.id, total, available, status],
      );
      await this.append(client, {
        id: entryId,
        grantId: batch.id,
        ownerUserId: batch.ownerUserId,
        businessSpace: batch.businessSpace,
        entryType: 'ADJUSTMENT',
        quantity: command.quantity,
        availableAfter: available,
        reservedAfter: batch.reservedQuantity,
        businessKey: `adjustment:${command.requestId}`,
        operatorAdjustmentId: adjustmentId,
        businessContext: { type: 'OPERATOR_ADJUSTMENT', id: adjustmentId },
        requestId: command.requestId,
        metadata: { direction: command.direction, reasonCode: command.reasonCode, note: command.note },
      });
      return { entryId };
    });
  }

  async list(ownerUserId: string, cursor: EntitlementCursorPosition | null, limit: number) {
    const values: unknown[] = [ownerUserId];
    const cursorSql = cursor ? `and (created_at < $2 or (created_at = $2 and id < $3))` : '';
    if (cursor) values.push(cursor.createdAt, cursor.id);
    values.push(limit + 1);
    const result = await this.infrastructure.pool.query<GrantRow>(
      `select * from entitlement_grants where owner_user_id=$1 ${cursorSql}
       order by created_at desc,id desc limit $${values.length}`,
      values,
    );
    return page(result.rows.map(mapGrant), limit);
  }

  async get(ownerUserId: string, grantId: string) {
    const result = await this.infrastructure.pool.query<GrantRow>(
      `select * from entitlement_grants where owner_user_id=$1 and id=$2`,
      [ownerUserId, grantId],
    );
    return result.rows[0] ? mapGrant(result.rows[0]) : null;
  }

  async listUsage(
    ownerUserId: string,
    grantId: string | null,
    cursor: EntitlementCursorPosition | null,
    limit: number,
  ) {
    const conditions = ['owner_user_id=$1'];
    const values: unknown[] = [ownerUserId];
    if (grantId) {
      values.push(grantId);
      conditions.push(`grant_id=$${values.length}`);
    }
    if (cursor) {
      values.push(cursor.createdAt);
      const dateIndex = values.length;
      values.push(cursor.id);
      conditions.push(
        `(created_at < $${dateIndex} or (created_at = $${dateIndex} and id < $${values.length}))`,
      );
    }
    values.push(limit + 1);
    const result = await this.infrastructure.pool.query<EntryRow>(
      `select * from entitlement_usage_entries where ${conditions.join(' and ')}
       order by created_at desc,id desc limit $${values.length}`,
      values,
    );
    return page(result.rows.map(mapEntry), limit);
  }

  async expireDue(now: Date, requestId: string) {
    return this.transaction(async (client) => {
      const due = await client.query<GrantRow>(
        `select * from entitlement_grants
         where status in ('ACTIVE','FROZEN','EXHAUSTED') and expires_at <= $1
         order by expires_at,id for update skip locked limit 1000`,
        [now],
      );
      for (const row of due.rows) {
        const batch = mapGrant(row);
        const quantity = batch.availableQuantity;
        await client.query(
          `update entitlement_grants set status='EXPIRED',available_quantity=0,
           version=version+1,updated_at=now() where id=$1`,
          [batch.id],
        );
        await this.append(client, {
          grantId: batch.id,
          ownerUserId: batch.ownerUserId,
          businessSpace: batch.businessSpace,
          entryType: 'EXPIRE',
          quantity,
          availableAfter: 0,
          reservedAfter: batch.reservedQuantity,
          businessKey: `${batch.id}:EXPIRE:${batch.expiresAt.toISOString()}`,
          businessContext: { type: 'ENTITLEMENT_GRANT', id: batch.id },
          requestId,
          metadata: { expiresAt: batch.expiresAt.toISOString() },
        });
      }
      return due.rows.length;
    });
  }

  async reconcile(now: Date, requestId: string) {
    return this.transaction((client) => reconcileEntitlements(client, now, requestId));
  }

  private assertGrant(command: Parameters<EntitlementRepository['grant']>[0]) {
    if (!Number.isInteger(command.quantity) || command.quantity < 1) {
      throw new EntitlementLedgerError('INVALID_ENTITLEMENT_QUANTITY', 'Grant quantity must be positive');
    }
    if (command.expiresAt <= command.effectiveAt) {
      throw new EntitlementLedgerError(
        'INVALID_ENTITLEMENT_PERIOD',
        'Grant expiry must follow effective time',
      );
    }
  }

  private async lockGrant(client: PoolClient, id: string) {
    const result = await client.query<GrantRow>(`select * from entitlement_grants where id=$1 for update`, [
      id,
    ]);
    if (!result.rows[0])
      throw new EntitlementLedgerError('ENTITLEMENT_NOT_FOUND', 'Entitlement was not found');
    return mapGrant(result.rows[0]);
  }

  private async append(client: PoolClient, input: AppendInput) {
    const id = input.id ?? randomUUID();
    await client.query(
      `insert into entitlement_usage_entries
       (id,grant_id,owner_user_id,business_space,entry_type,quantity,available_after,reserved_after,
        business_key,reservation_id,consumption_intent_id,business_context_type,business_context_id,
        original_entry_id,operator_adjustment_id,request_id,metadata,created_at)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,clock_timestamp())`,
      [
        id,
        input.grantId,
        input.ownerUserId,
        input.businessSpace,
        input.entryType,
        input.quantity,
        input.availableAfter,
        input.reservedAfter,
        input.businessKey,
        input.reservationId ?? null,
        input.consumptionIntentId ?? null,
        input.businessContext?.type ?? null,
        input.businessContext?.id ?? null,
        input.originalEntryId ?? null,
        input.operatorAdjustmentId ?? null,
        input.requestId,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    return id;
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>) {
    const client = await this.infrastructure.pool.connect();
    try {
      await client.query('begin');
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}

@Injectable()
export class EntitlementApplicationServiceFactory {
  constructor(
    private readonly repository: PostgresEntitlementRepository,
    @Inject(RuntimeInfrastructure) private readonly infrastructure: RuntimeInfrastructure,
  ) {}

  create() {
    return new EntitlementApplicationService(
      this.repository,
      this.infrastructure.environment.CURSOR_SIGNING_SECRET,
      new SystemClock(),
    );
  }
}
