import { Injectable } from '@nestjs/common';
import { RuntimeInfrastructure } from '@satori/infrastructure';
import { identities } from '@satori/infrastructure';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import { ComplimentarySeedApplicationService } from '../../complimentary-seed/application/index.js';
import { ConsumptionApplicationService } from '../../consumption/application/index.js';
import { EntitlementApplicationService } from '../../entitlement/application/index.js';
import { SeedLedgerService } from '../../seed-ledger/seed-ledger.service.js';

@Injectable()
export class CommerceOperationsService {
  constructor(
    private readonly infrastructure: RuntimeInfrastructure,
    private readonly entitlements: EntitlementApplicationService,
    private readonly seeds: ComplimentarySeedApplicationService,
    private readonly consumption: ConsumptionApplicationService,
    private readonly seedLedger: SeedLedgerService,
  ) {}

  async orderView(orderId: string) {
    const result = await this.infrastructure.pool.query<OperationRow>(
      `select o.id order_id,o.order_number,o.owner_user_id,o.status order_status,o.amount_minor,o.currency,
              o.business_context_type,o.business_context_id,o.created_at,o.paid_at,
              coalesce(jsonb_agg(distinct jsonb_build_object('id',p.id,'status',p.status,'provider',p.provider,
                'providerAttemptId',p.provider_attempt_id)) filter(where p.id is not null),'[]') payments,
              coalesce(jsonb_agg(distinct jsonb_build_object('id',f.id,'status',f.status,'attempt',f.attempt,
                'resultReferences',f.result_references)) filter(where f.id is not null),'[]') fulfillments,
              coalesce(jsonb_agg(distinct jsonb_build_object('id',r.id,'status',r.status,'amountMinor',r.amount_minor,
                'reasonCode',r.reason_code)) filter(where r.id is not null),'[]') refunds
       from money_orders o
       left join payment_attempts p on p.order_id=o.id
       left join fulfillment_jobs f on f.order_id=o.id
       left join refunds r on r.order_id=o.id
       where o.id=$1 group by o.id`,
      [orderId],
    );
    return result.rows[0] ?? null;
  }

  async ownerView(ownerUserId: string) {
    const [orders, grants, seeds, intents, memberships] = await Promise.all([
      this.infrastructure.pool.query<OperationRow>(
        'select id,order_number,status,amount_minor,created_at from money_orders where owner_user_id=$1 order by created_at desc',
        [ownerUserId],
      ),
      this.infrastructure.pool.query<OperationRow>(
        `select id,service_type,source_type,source_id,total_quantity,available_quantity,reserved_quantity,status,
                effective_at,expires_at from entitlement_grants where owner_user_id=$1 order by created_at desc`,
        [ownerUserId],
      ),
      this.infrastructure.pool.query<OperationRow>(
        `select id,source_type,source_id,total_quantity,available_quantity,reserved_quantity,status,expires_at
         from complimentary_seed_grants where owner_user_id=$1 order by created_at desc`,
        [ownerUserId],
      ),
      this.infrastructure.pool.query<OperationRow>(
        `select id,status,selected_source_type,selected_source_id,business_context_type,business_context_id,created_at
         from consumption_intents where owner_user_id=$1 order by created_at desc`,
        [ownerUserId],
      ),
      this.infrastructure.pool.query<OperationRow>(
        `select id,status,current_plan_version_id,starts_at,ends_at from membership_subscriptions
         where owner_user_id=$1 order by created_at desc`,
        [ownerUserId],
      ),
    ]);
    return {
      ownerUserId,
      orders: orders.rows,
      entitlements: grants.rows,
      complimentarySeeds: seeds.rows,
      consumptionIntents: intents.rows,
      memberships: memberships.rows,
    };
  }

  adjustEntitlement(command: {
    grantId: string;
    quantity: number;
    direction: 'INCREASE' | 'DECREASE';
    reasonCode: string;
    note: string;
    operatorUserId: string;
    requestId: string;
    relatedOrderId?: string;
  }) {
    return this.entitlements.adjust(command);
  }

  async adjustSeeds(command: {
    grantId: string;
    ownerUserId: string;
    quantity: number;
    direction: 'INCREASE' | 'DECREASE';
    reasonCode: string;
    note: string;
    operatorUserId: string;
    requestId: string;
  }) {
    await this.seeds.adjust(
      command.grantId,
      command.quantity,
      command.direction,
      command.reasonCode,
      command.requestId,
    );
    await this.infrastructure.pool.query(
      `insert into operator_adjustments
       (id,owner_user_id,business_space,ledger_type,grant_id,quantity,direction,reason_code,note,
        operator_user_id,request_id)
       values($1,$2,'SATORI','COMPLIMENTARY_SEED',$3,$4,$5,$6,$7,$8,$9)
       on conflict(request_id) do nothing`,
      [
        randomUUID(),
        command.ownerUserId,
        command.grantId,
        command.quantity,
        command.direction,
        command.reasonCode,
        command.note,
        command.operatorUserId,
        command.requestId,
      ],
    );
  }

  async grantManualSeeds(command: {
    phoneHash: string;
    actionId: string;
    quantity: number;
    reason: string;
    operatorUserId: string | null;
    requestId: string;
  }) {
    const [identity] = await this.infrastructure.database
      .select({ userId: identities.userId })
      .from(identities)
      .where(and(eq(identities.provider, 'PHONE'), eq(identities.providerSubjectHash, command.phoneHash)))
      .limit(1);
    if (!identity) throw new Error('MANUAL_GRANT_USER_NOT_FOUND');
    const applied = await this.seedLedger.grantManual({
      userId: identity.userId,
      amount: command.quantity,
      businessKey: `operations-manual-grant:${command.actionId}`,
      resourceId: null,
      title: '运营平台人工赠送智慧种子',
    });
    await this.audit(command.operatorUserId, 'MANUAL_SEED_GRANTED', 'WISDOM_SEED', command.actionId, command.requestId, {
      quantity: command.quantity,
      reason: command.reason,
      transactionId: applied.transaction.transactionId,
      actorType: command.operatorUserId ? 'USER_OPERATOR' : 'OPERATIONS_SERVICE',
    });
    return { delivered: true, available: applied.account.available, transactionId: applied.transaction.transactionId };
  }

  async forfeitEntitlements(
    sourceId: string,
    reasonCode: string,
    note: string,
    operatorUserId: string,
    requestId: string,
  ) {
    await this.entitlements.forfeitBySource(sourceId, reasonCode);
    await this.audit(
      operatorUserId,
      'ENTITLEMENT_SOURCE_FORFEITED',
      'ENTITLEMENT_SOURCE',
      sourceId,
      requestId,
      {
        reasonCode,
        note,
      },
    );
  }

  async restoreEntitlements(
    sourceId: string,
    reasonCode: string,
    note: string,
    operatorUserId: string | null,
    requestId: string,
  ) {
    await this.entitlements.unfreezeBySource(sourceId, reasonCode);
    await this.audit(
      operatorUserId,
      'ENTITLEMENT_SOURCE_RESTORED',
      'ENTITLEMENT_SOURCE',
      sourceId,
      requestId,
      {
        reasonCode,
        note,
      },
    );
  }

  async releaseConsumption(
    intentId: string,
    reasonCode: string,
    note: string,
    operatorUserId: string,
    requestId: string,
  ) {
    const result = await this.consumption.release(intentId, requestId);
    await this.audit(
      operatorUserId,
      'CONSUMPTION_INTENT_RELEASED',
      'CONSUMPTION_INTENT',
      intentId,
      requestId,
      {
        reasonCode,
        note,
      },
    );
    return result;
  }

  async reconcile() {
    const requestId = randomUUID();
    const inserted = await this.infrastructure.pool.query(
      `insert into reconciliation_cases
       (id,business_space,case_type,status,severity,resource_type,resource_id,business_key,
        expected_snapshot,actual_snapshot,request_id,detected_at)
       select gen_random_uuid(),'SATORI','PAID_ORDER_WITHOUT_FULFILLMENT','OPEN','CRITICAL','MONEY_ORDER',o.id::text,
              o.id::text,'{"fulfillment":"SUCCEEDED"}'::jsonb,
              jsonb_build_object('orderStatus',o.status,'fulfillmentStatus',coalesce(f.status,'MISSING')),$1,now()
       from money_orders o left join fulfillment_jobs f on f.order_id=o.id
       where o.status in ('PAID','FULFILLING','EXCEPTION') and coalesce(f.status,'MISSING') <> 'SUCCEEDED'
       on conflict(case_type,business_key) do update set actual_snapshot=excluded.actual_snapshot,
         status=case when reconciliation_cases.status='RESOLVED' then 'OPEN' else reconciliation_cases.status end,
         updated_at=now() returning id`,
      [requestId],
    );
    return { detected: inserted.rowCount ?? 0, requestId };
  }

  async listCases() {
    return (
      await this.infrastructure.pool.query<OperationRow>(
        `select id,case_type,status,severity,resource_type,resource_id,expected_snapshot,actual_snapshot,
                resolution,detected_at,resolved_at from reconciliation_cases order by detected_at desc,id desc`,
      )
    ).rows;
  }

  async resolveCase(caseId: string, operatorUserId: string, note: string) {
    const result = await this.infrastructure.pool.query<OperationRow>(
      `update reconciliation_cases set status='RESOLVED',resolution=jsonb_build_object('operatorUserId',$2,'note',$3),
       resolved_at=now(),updated_at=now() where id=$1 returning *`,
      [caseId, operatorUserId, note],
    );
    return result.rows[0] ?? null;
  }

  async metrics() {
    const result = await this.infrastructure.pool.query<{
      open_cases: string;
      paid_unfulfilled: string;
      refund_failures: string;
      stale_reservations: string;
      quotes_24h: string;
      orders_24h: string;
      quote_conversion_basis_points: string;
      payment_succeeded_24h: string;
      payment_failed_24h: string;
      fulfillment_p95_ms: string;
      fulfillment_backlog: string;
      ledger_inconsistencies: string;
      membership_missed_grants: string;
      critical_reconciliation_cases: string;
    }>(
      `select
       (select count(*) from reconciliation_cases where status='OPEN')::text open_cases,
       (select count(*) from money_orders where status in ('PAID','FULFILLING','EXCEPTION'))::text paid_unfulfilled,
       (select count(*) from refunds where status='FAILED')::text refund_failures,
       (select count(*) from consumption_intents where status='RESERVED' and reservation_deadline<now())::text stale_reservations,
       (select count(*) from checkout_quotes where created_at>=now()-interval '24 hours')::text quotes_24h,
       (select count(*) from money_orders where created_at>=now()-interval '24 hours')::text orders_24h,
       (select case when count(*)=0 then 0 else round(10000.0*count(consumed_at)/count(*)) end
          from checkout_quotes where created_at>=now()-interval '24 hours')::text quote_conversion_basis_points,
       (select count(*) from payment_attempts where status='SUCCEEDED' and succeeded_at>=now()-interval '24 hours')::text payment_succeeded_24h,
       (select count(*) from payment_attempts where status in ('FAILED','CANCELLED','CLOSED') and updated_at>=now()-interval '24 hours')::text payment_failed_24h,
       coalesce((select round(extract(epoch from percentile_cont(0.95) within group(order by completed_at-created_at))*1000)
         from fulfillment_jobs where completed_at is not null and completed_at>=now()-interval '24 hours'),0)::text fulfillment_p95_ms,
       (select count(*) from fulfillment_jobs where status in ('PENDING','RUNNING','RETRY_WAIT'))::text fulfillment_backlog,
       (select count(*) from reconciliation_cases where status='OPEN' and
          (case_type like 'ENTITLEMENT_%' or case_type like 'SEED_%'))::text ledger_inconsistencies,
       (select count(*) from reconciliation_cases where status='OPEN' and case_type='MEMBERSHIP_PERIOD_GRANT_MISSING')::text membership_missed_grants,
       (select count(*) from reconciliation_cases where status='OPEN' and severity='CRITICAL')::text critical_reconciliation_cases`,
    );
    const row = result.rows[0]!;
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
  }

  private async audit(
    operatorUserId: string | null,
    action: string,
    resourceType: string,
    resourceId: string,
    requestId: string,
    metadata: Record<string, unknown>,
  ) {
    await this.infrastructure.pool.query(
      `insert into audit_logs(id,actor_user_id,action,resource_type,resource_id,request_id,metadata)
       values($1,$2,$3,$4,$5,$6,$7)`,
      [randomUUID(), operatorUserId, action, resourceType, resourceId, requestId, metadata],
    );
  }
}

export interface OperationRow extends QueryResultRow {
  [key: string]: unknown;
}
