import { Inject, Injectable } from '@nestjs/common';
import { RuntimeInfrastructure } from '@satori/infrastructure';
import { randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import type { RefundOrderFacts, RefundRecord, RefundRepository } from '../application/index.js';
import { RefundError } from '../domain/index.js';

interface RefundRow extends QueryResultRow {
  id: string;
  order_id: string;
  payment_attempt_id: string;
  owner_user_id: string;
  status: string;
  reason_code: string;
  amount_minor: number;
  refund_policy_version: string;
  provider_refund_id: string | null;
  request_id: string;
}

@Injectable()
export class PostgresRefundRepository implements RefundRepository {
  constructor(@Inject(RuntimeInfrastructure) private readonly infrastructure: RuntimeInfrastructure) {}

  async facts(ownerUserId: string | null, orderId: string) {
    const result = await this.infrastructure.pool.query<{
      order_id: string;
      owner_user_id: string;
      order_status: string;
      amount_minor: number;
      offering_kind: string;
      refund_policy_version: string;
      refund_policy: unknown;
      payment_attempt_id: string;
      provider_attempt_id: string;
      is_upgrade_previous_order: boolean;
    }>(
      `select o.id order_id,o.owner_user_id,o.status order_status,o.amount_minor,
              coalesce(s.offering_snapshot->>'offeringKind','') offering_kind,
              coalesce(s.refund_policy_snapshot->>'version',v.refund_policy_version) refund_policy_version,
              s.refund_policy_snapshot refund_policy,p.id payment_attempt_id,p.provider_attempt_id,
              exists(select 1 from membership_upgrades u join membership_subscriptions ms
                on ms.id=u.previous_subscription_id where ms.source_order_id=o.id) is_upgrade_previous_order
       from money_orders o
       join order_snapshots s on s.order_id=o.id
       join offering_versions v on v.id=o.offering_version_id
       join payment_attempts p on p.order_id=o.id and p.status='SUCCEEDED'
       where o.id=$1 and ($2::uuid is null or o.owner_user_id=$2) limit 1`,
      [orderId, ownerUserId],
    );
    const row = result.rows[0];
    if (!row?.provider_attempt_id) return null;
    return {
      orderId: row.order_id,
      ownerUserId: row.owner_user_id,
      orderStatus: row.order_status,
      amountMinor: row.amount_minor,
      offeringKind: row.offering_kind,
      refundPolicyVersion: row.refund_policy_version,
      refundPolicy: record(row.refund_policy),
      paymentAttemptId: row.payment_attempt_id,
      providerAttemptId: row.provider_attempt_id,
      isUpgradePreviousOrder: row.is_upgrade_previous_order,
    } satisfies RefundOrderFacts;
  }

  async factsByAttempt(orderId: string, paymentAttemptId: string) {
    const result = await this.infrastructure.pool.query<{
      order_id: string;
      owner_user_id: string;
      order_status: string;
      amount_minor: number;
      offering_kind: string;
      refund_policy_version: string;
      refund_policy: unknown;
      payment_attempt_id: string;
      provider_attempt_id: string;
      is_upgrade_previous_order: boolean;
    }>(
      `select o.id order_id,o.owner_user_id,o.status order_status,p.amount_minor,
              coalesce(s.offering_snapshot->>'offeringKind','') offering_kind,
              v.refund_policy_version,s.refund_policy_snapshot refund_policy,
              p.id payment_attempt_id,p.provider_attempt_id,
              exists(select 1 from membership_upgrades u join membership_subscriptions ms
                on ms.id=u.previous_subscription_id where ms.source_order_id=o.id) is_upgrade_previous_order
       from payment_attempts p join money_orders o on o.id=p.order_id
       join order_snapshots s on s.order_id=o.id join offering_versions v on v.id=o.offering_version_id
       where o.id=$1 and p.id=$2 limit 1`,
      [orderId, paymentAttemptId],
    );
    const row = result.rows[0];
    if (!row?.provider_attempt_id) return null;
    return {
      orderId: row.order_id,
      ownerUserId: row.owner_user_id,
      orderStatus: row.order_status,
      amountMinor: row.amount_minor,
      offeringKind: row.offering_kind,
      refundPolicyVersion: row.refund_policy_version,
      refundPolicy: record(row.refund_policy),
      paymentAttemptId: row.payment_attempt_id,
      providerAttemptId: row.provider_attempt_id,
      isUpgradePreviousOrder: row.is_upgrade_previous_order,
    } satisfies RefundOrderFacts;
  }

  async create(input: Parameters<RefundRepository['create']>[0]) {
    const client = await this.infrastructure.pool.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
        `refund:${input.facts.orderId}`,
      ]);
      const replay = (
        await client.query<RefundRow>('select * from refunds where business_key=$1 limit 1', [
          input.businessKey,
        ])
      ).rows[0];
      if (replay) {
        await client.query('commit');
        return toRecord(replay);
      }
      const refundId = randomUUID();
      const created = (
        await client.query<RefundRow>(
          `insert into refunds
           (id,order_id,payment_attempt_id,owner_user_id,business_space,business_key,status,reason_code,
            amount_minor,refund_policy_version,eligibility_snapshot,request_id,requested_at)
           values($1,$2,$3,$4,'SATORI',$5,'REQUESTED',$6,$7,$8,$9,$10,now()) returning *`,
          [
            refundId,
            input.facts.orderId,
            input.facts.paymentAttemptId,
            input.facts.ownerUserId,
            input.businessKey,
            input.reasonCode,
            input.amountMinor,
            input.policyVersion,
            input.eligibilitySnapshot,
            input.requestId,
          ],
        )
      ).rows[0]!;
      if (input.affectsOrderEntitlement) {
        await client.query(
          `update money_orders set status='REFUNDING',version=version+1,updated_at=now() where id=$1`,
          [input.facts.orderId],
        );
      }
      await client.query('commit');
      return toRecord(created);
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async get(refundId: string) {
    const row = (
      await this.infrastructure.pool.query<RefundRow>('select * from refunds where id=$1', [refundId])
    ).rows[0];
    return row ? toRecord(row) : null;
  }

  async findByOrder(orderId: string) {
    const row = (
      await this.infrastructure.pool.query<RefundRow>(
        `select * from refunds where order_id=$1 and reason_code <> 'DUPLICATE_CHARGE'
         order by created_at limit 1`,
        [orderId],
      )
    ).rows[0];
    return row ? toRecord(row) : null;
  }

  async markProcessing(refundId: string) {
    const row = (
      await this.infrastructure.pool.query<RefundRow>(
        `update refunds set status=case when status='SUCCEEDED' then status else 'PROCESSING' end,updated_at=now()
         where id=$1 returning *`,
        [refundId],
      )
    ).rows[0];
    if (!row) throw new RefundError('REFUND_NOT_FOUND', 'Refund was not found');
    return toRecord(row);
  }

  async recordProvider(refundId: string, providerRefundId: string) {
    await this.infrastructure.pool.query(
      'update refunds set provider_refund_id=coalesce(provider_refund_id,$2),updated_at=now() where id=$1',
      [refundId, providerRefundId],
    );
  }

  async succeed(refundId: string) {
    const client = await this.infrastructure.pool.connect();
    try {
      await client.query('begin');
      const refund = (
        await client.query<{ order_id: string; reason_code: string }>(
          'select order_id,reason_code from refunds where id=$1 for update',
          [refundId],
        )
      ).rows[0];
      if (!refund) throw new RefundError('REFUND_NOT_FOUND', 'Refund was not found');
      await client.query(
        `update refunds set status='SUCCEEDED',completed_at=coalesce(completed_at,now()),updated_at=now() where id=$1`,
        [refundId],
      );
      if (refund.reason_code !== 'DUPLICATE_CHARGE') {
        await client.query(
          `update money_orders set status='REFUNDED',version=version+1,updated_at=now() where id=$1`,
          [refund.order_id],
        );
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async fail(refundId: string, error: Error) {
    await this.infrastructure.pool.query(
      `update refunds set status='FAILED',failed_at=now(),eligibility_snapshot=eligibility_snapshot || $2::jsonb,
       updated_at=now() where id=$1`,
      [refundId, JSON.stringify({ lastFailure: { message: error.message } })],
    );
  }

  async listRecoverable(limit: number) {
    const result = await this.infrastructure.pool.query<{ id: string }>(
      `select id from refunds where status in ('REQUESTED','PROCESSING','FAILED') order by updated_at,id limit $1`,
      [limit],
    );
    return result.rows.map((row) => row.id);
  }

  async listOwned(ownerUserId: string) {
    const result = await this.infrastructure.pool.query<RefundRow>(
      'select * from refunds where owner_user_id=$1 order by created_at desc,id desc',
      [ownerUserId],
    );
    return result.rows.map(toRecord);
  }
}

function toRecord(row: RefundRow): RefundRecord {
  return {
    refundId: row.id,
    orderId: row.order_id,
    ownerUserId: row.owner_user_id,
    paymentAttemptId: row.payment_attempt_id,
    status: row.status,
    reasonCode: row.reason_code,
    amountMinor: row.amount_minor,
    refundPolicyVersion: row.refund_policy_version,
    providerRefundId: row.provider_refund_id,
    requestId: row.request_id,
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
