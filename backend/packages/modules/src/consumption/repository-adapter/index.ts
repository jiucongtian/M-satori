import { Inject, Injectable } from '@nestjs/common';
import { RuntimeInfrastructure } from '@satori/infrastructure';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { ConsumptionRepository } from '../application/index.js';
import {
  ConsumptionError,
  type ConsumptionIntentDetail,
  type ConsumptionIntentStatus,
  type EntitlementResolutionView,
  type ResolutionCandidateSnapshot,
} from '../domain/index.js';

@Injectable()
export class PostgresConsumptionRepository implements ConsumptionRepository {
  constructor(@Inject(RuntimeInfrastructure) private readonly infrastructure: RuntimeInfrastructure) {}

  async saveResolution(resolution: EntitlementResolutionView, idempotencyKey: string) {
    return this.transaction(async (client) => {
      await client.query(
        `insert into entitlement_resolutions
         (id,owner_user_id,business_space,service_type,quantity,unit,business_context_type,
          business_context_id,status,selected_source_type,selected_source_id,reason_code,
          selection_mode,rule_version,requirement_snapshot,request_id,created_at)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'SYSTEM_RULE',$13,$14,$15,$16)`,
        [
          resolution.resolutionId,
          resolution.ownerUserId,
          resolution.requirement.businessSpace,
          resolution.requirement.serviceType,
          resolution.requirement.quantity,
          resolution.requirement.unit,
          resolution.requirement.businessContext.type,
          resolution.requirement.businessContext.id,
          resolution.status === 'NO_SOURCE' ? 'NO_BENEFIT' : 'RESOLVED',
          resolution.selectedSource?.sourceType ?? null,
          resolution.selectedSource?.sourceId ?? null,
          resolution.reasonCode,
          resolution.ruleVersion,
          JSON.stringify({
            ...resolution.requirement,
            idempotencyKey,
            selectedSource: resolution.selectedSource
              ? {
                  sourceType: resolution.selectedSource.sourceType,
                  sourceId: resolution.selectedSource.sourceId,
                }
              : null,
            expiresAt: resolution.expiresAt.toISOString(),
          }),
          randomUUID(),
          resolution.resolvedAt,
        ],
      );
      for (const candidate of resolution.candidates) {
        await client.query(
          `insert into resolution_candidates
           (id,resolution_id,source_type,source_id,priority,available_quantity,required_quantity,
            expires_at,granted_at,cost_snapshot,rule_snapshot,selected)
           values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            randomUUID(),
            resolution.resolutionId,
            candidate.sourceType,
            candidate.sourceId,
            candidate.rank,
            candidate.availableQuantity,
            candidate.requiredQuantity,
            candidate.expiresAt,
            candidate.grantedAt,
            JSON.stringify({ cost: candidate.cost, unit: candidate.unit }),
            JSON.stringify({ ruleVersion: candidate.ruleVersion }),
            candidate.sourceId === resolution.selectedSource?.sourceId &&
              candidate.sourceType === resolution.selectedSource.sourceType,
          ],
        );
      }
      return resolution;
    });
  }

  async getResolution(resolutionId: string) {
    const result = await this.infrastructure.pool.query<ResolutionRow>(
      `select * from entitlement_resolutions where id=$1`,
      [resolutionId],
    );
    const row = result.rows[0];
    return row ? this.hydrateResolution(row) : null;
  }

  async findIntentByContext(ownerUserId: string, context: { type: string; id: string }) {
    const result = await this.infrastructure.pool.query<IntentRow>(
      `select * from consumption_intents
       where owner_user_id=$1 and business_context_type=$2 and business_context_id=$3`,
      [ownerUserId, context.type, context.id],
    );
    return result.rows[0] ? this.hydrateIntent(result.rows[0]) : null;
  }

  async createIntentDraft(resolution: EntitlementResolutionView, deadline: Date, requestId: string) {
    const selected = resolution.selectedSource!;
    const intentId = randomUUID();
    await this.infrastructure.pool.query(
      `insert into consumption_intents
       (id,resolution_id,owner_user_id,business_space,service_type,business_context_type,
        business_context_id,status,selected_source_type,selected_source_id,required_quantity,
        reservation_deadline,request_id)
       values($1,$2,$3,$4,$5,$6,$7,'RESERVING',$8,$9,$10,$11,$12)
       on conflict (business_space,business_context_type,business_context_id) do nothing`,
      [
        intentId,
        resolution.resolutionId,
        resolution.ownerUserId,
        resolution.requirement.businessSpace,
        resolution.requirement.serviceType,
        resolution.requirement.businessContext.type,
        resolution.requirement.businessContext.id,
        selected.sourceType,
        selected.sourceId,
        selected.requiredQuantity,
        deadline,
        requestId,
      ],
    );
    const replay = await this.findIntentByContext(
      resolution.ownerUserId,
      resolution.requirement.businessContext,
    );
    if (!replay) throw new ConsumptionError('CONSUMPTION_INTENT_CREATE_FAILED', 'Intent was not created');
    return replay;
  }

  async attachReservation(intentId: string, sourceReservationId: string, reservedAt: Date) {
    await this.transaction(async (client) => {
      await advisoryLock(client, `consumption-intent:${intentId}`);
      const intentResult = await client.query<IntentRow>(
        `select * from consumption_intents where id=$1 for update`,
        [intentId],
      );
      const intent = intentResult.rows[0];
      if (!intent) throw new ConsumptionError('CONSUMPTION_INTENT_NOT_FOUND', 'Intent was not found');
      const existing = await client.query(
        `select 1 from reservation_allocations where consumption_intent_id=$1`,
        [intentId],
      );
      if (!existing.rowCount) {
        await client.query(
          `insert into reservation_allocations
           (id,consumption_intent_id,source_type,source_id,source_reservation_id,quantity,status)
           values($1,$2,$3,$4,$5,$6,'RESERVED')`,
          [
            randomUUID(),
            intentId,
            intent.selected_source_type,
            intent.selected_source_id,
            sourceReservationId,
            intent.required_quantity,
          ],
        );
      }
      if (intent.status === 'RESERVING') {
        await client.query(
          `update consumption_intents set status='RESERVED',version=version+1,updated_at=$2 where id=$1`,
          [intentId, reservedAt],
        );
      }
    });
    return (await this.getIntent(intentId))!;
  }

  async getIntent(intentId: string) {
    const result = await this.infrastructure.pool.query<IntentRow>(
      `select * from consumption_intents where id=$1`,
      [intentId],
    );
    return result.rows[0] ? this.hydrateIntent(result.rows[0]) : null;
  }

  async transitionIntent(
    intentId: string,
    from: readonly ConsumptionIntentStatus[],
    to: ConsumptionIntentStatus,
    at: Date,
  ) {
    const result = await this.infrastructure.pool.query<IntentRow>(
      `update consumption_intents set status=$2::varchar,
       started_at=case when $2::text='RUNNING' then coalesce(started_at,$3) else started_at end,
       settled_at=case when $2::text in ('COMMITTED','RELEASED','EXPIRED','FAILED') then coalesce(settled_at,$3) else settled_at end,
       version=version+1,updated_at=$3 where id=$1 and status=any($4::text[]) returning *`,
      [intentId, to, at, from],
    );
    if (result.rows[0]) return this.hydrateIntent(result.rows[0]);
    const current = await this.getIntent(intentId);
    if (!current) throw new ConsumptionError('CONSUMPTION_INTENT_NOT_FOUND', 'Intent was not found');
    if (current.status === to) return current;
    throw new ConsumptionError(
      'INVALID_CONSUMPTION_TRANSITION',
      `Cannot transition ${current.status} to ${to}`,
    );
  }

  async markAllocation(intentId: string, status: 'COMMITTED' | 'RELEASED') {
    await this.infrastructure.pool.query(
      `update reservation_allocations set status=$2,updated_at=now()
       where consumption_intent_id=$1 and status='RESERVED'`,
      [intentId, status],
    );
  }

  async listExpiredReservations(now: Date, limit: number) {
    const result = await this.infrastructure.pool.query<IntentRow>(
      `select i.* from consumption_intents i
       where (i.status='RESERVED' and i.reservation_deadline<=$1)
          or (i.status='EXPIRED' and exists (
            select 1 from reservation_allocations a
            where a.consumption_intent_id=i.id and a.status='RESERVED'
          ))
       order by i.reservation_deadline,i.id limit $2`,
      [now, limit],
    );
    return Promise.all(result.rows.map((row) => this.hydrateIntent(row)));
  }

  async listRecoverableIntents(limit: number) {
    const result = await this.infrastructure.pool.query<IntentRow>(
      `select * from consumption_intents where status in ('RESERVING','RUNNING')
       order by updated_at,id limit $1`,
      [limit],
    );
    return Promise.all(result.rows.map((row) => this.hydrateIntent(row)));
  }

  private async hydrateResolution(row: ResolutionRow) {
    const candidates = await this.infrastructure.pool.query<CandidateRow>(
      `select * from resolution_candidates where resolution_id=$1 order by priority`,
      [row.id],
    );
    return mapResolution(
      row,
      candidates.rows.map((candidate) => mapCandidate(candidate, row.service_type)),
    );
  }

  private async hydrateIntent(row: IntentRow): Promise<ConsumptionIntentDetail> {
    const resolution = await this.getResolution(row.resolution_id);
    if (!resolution?.selectedSource) {
      throw new ConsumptionError('RESOLUTION_CORRUPTED', 'Intent resolution has no selected source');
    }
    const allocation = await this.infrastructure.pool.query<{ source_reservation_id: string }>(
      `select source_reservation_id from reservation_allocations where consumption_intent_id=$1`,
      [row.id],
    );
    return mapIntent(row, resolution.selectedSource, allocation.rows[0]?.source_reservation_id ?? null);
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

interface ResolutionRow {
  id: string;
  owner_user_id: string;
  business_space: 'SATORI';
  service_type: 'DAILY_INSIGHT' | 'CARD_READING';
  quantity: number;
  unit: 'DAILY_INSIGHT_CREDIT' | 'READING_CREDIT' | 'SEED';
  business_context_type: string;
  business_context_id: string;
  status: 'RESOLVED' | 'NO_BENEFIT';
  reason_code: string;
  rule_version: string;
  requirement_snapshot: Record<string, unknown>;
  created_at: Date;
}
interface CandidateRow {
  source_type: ResolutionCandidateSnapshot['sourceType'];
  source_id: string;
  priority: number;
  available_quantity: number;
  required_quantity: number;
  expires_at: Date | null;
  granted_at: Date;
  cost_snapshot: { cost?: number; unit?: 'COUNT' | 'WISDOM_SEED' };
  rule_snapshot: { ruleVersion?: string };
  selected: boolean;
}
interface IntentRow {
  id: string;
  resolution_id: string;
  owner_user_id: string;
  business_context_type: string;
  business_context_id: string;
  status: ConsumptionIntentStatus;
  selected_source_type: ResolutionCandidateSnapshot['sourceType'];
  selected_source_id: string;
  required_quantity: number;
  reservation_deadline: Date;
  started_at: Date | null;
  settled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function mapCandidate(
  row: CandidateRow,
  serviceType: ResolutionCandidateSnapshot['serviceType'],
): ResolutionCandidateSnapshot {
  return {
    sourceId: row.source_id,
    sourceType: row.source_type,
    serviceType,
    availableQuantity: row.available_quantity,
    requiredQuantity: row.required_quantity,
    expiresAt: row.expires_at,
    grantedAt: row.granted_at,
    ruleVersion: row.rule_snapshot.ruleVersion ?? 'unknown',
    rank: row.priority,
    eligible: true,
    cost: row.cost_snapshot.cost ?? row.required_quantity,
    unit: row.cost_snapshot.unit ?? 'COUNT',
  };
}

function mapResolution(
  row: ResolutionRow,
  candidates: readonly ResolutionCandidateSnapshot[],
): EntitlementResolutionView {
  const snapshot = row.requirement_snapshot;
  const attributes = asRecord(snapshot.attributes);
  const requirement = {
    userId: row.owner_user_id,
    businessSpace: row.business_space,
    serviceType: row.service_type,
    quantity: row.quantity,
    unit: row.unit,
    businessContext: { type: row.business_context_type, id: row.business_context_id },
    ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
  } as EntitlementResolutionView['requirement'];
  const selectedSource =
    candidates.find((candidate) => {
      const source = snapshot.selectedSource as { sourceId?: string } | undefined;
      return source?.sourceId === candidate.sourceId;
    }) ??
    candidates[0] ??
    null;
  const expiresAt = typeof snapshot.expiresAt === 'string' ? new Date(snapshot.expiresAt) : row.created_at;
  return {
    resolutionId: row.id,
    ownerUserId: row.owner_user_id,
    requirement,
    status: row.status === 'RESOLVED' ? 'RESOLVED' : 'NO_SOURCE',
    selectionMode: 'SYSTEM_RULE' as const,
    candidates,
    selectedSource: row.status === 'RESOLVED' ? selectedSource : null,
    reasonCode: row.reason_code,
    ruleVersion: row.rule_version,
    resolvedAt: row.created_at,
    expiresAt,
  };
}

function mapIntent(
  row: IntentRow,
  selectedSource: ResolutionCandidateSnapshot,
  sourceReservationId: string | null,
): ConsumptionIntentDetail {
  return {
    intentId: row.id,
    resolutionId: row.resolution_id,
    ownerUserId: row.owner_user_id,
    businessContext: { type: row.business_context_type, id: row.business_context_id },
    status: row.status,
    selectedSource,
    sourceReservationId,
    reservedAt: sourceReservationId ? row.created_at : null,
    reservationExpiresAt: row.status === 'RUNNING' ? null : row.reservation_deadline,
    startedAt: row.started_at,
    settledAt: row.settled_at,
  };
}

function asRecord(value: unknown): Record<string, string | number | boolean> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, string | number | boolean>)
    : {};
}

async function advisoryLock(client: PoolClient, key: string) {
  await client.query(`select pg_advisory_xact_lock(hashtextextended($1,0))`, [key]);
}
