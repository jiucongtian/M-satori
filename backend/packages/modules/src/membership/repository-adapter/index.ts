import { Inject, Injectable } from '@nestjs/common';
import { RuntimeInfrastructure } from '@satori/infrastructure';
import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import type {
  MembershipBenefitSpec,
  MembershipRepository,
  PreparedMembershipPeriod,
} from '../application/index.js';
import { addPeriodDays, MembershipError } from '../domain/index.js';

interface PlanRow extends QueryResultRow {
  version_id: string;
  code: string;
  amount_minor: number;
  offering_kind: string;
  entitlement_spec: unknown;
}

interface PreparedRow extends QueryResultRow {
  subscription_id: string;
  period_id: string;
  owner_user_id: string;
  source_order_id: string;
  starts_at: Date;
  ends_at: Date;
  plan_version_id: string;
  period_status: string;
  subscription_status: string;
  benefits_granted_at: Date | null;
  entitlement_spec: unknown;
  upgrade_id: string | null;
  upgrade_status: string | null;
  previous_subscription_id: string | null;
  previous_period_id: string | null;
}

@Injectable()
export class PostgresMembershipRepository implements MembershipRepository {
  constructor(@Inject(RuntimeInfrastructure) private readonly infrastructure: RuntimeInfrastructure) {}

  async prepare(command: Parameters<MembershipRepository['prepare']>[0], idempotencyKey: string) {
    void idempotencyKey;
    return this.transaction(async (client) => {
      await this.lock(client, `membership:${command.ownerUserId}:${command.businessSpace}`);
      const replay = await this.preparedByOrder(client, command.sourceOrderId);
      if (replay) return replay;
      const plan = await this.plan(client, command.planVersionId);
      const periodDays = periodDaysOf(plan.entitlement_spec);
      await client.query(
        `update membership_periods set status='EXPIRED',ended_at=ends_at,updated_at=now()
         where owner_user_id=$1 and business_space=$2 and status='ACTIVE' and ends_at <= $3`,
        [command.ownerUserId, command.businessSpace, command.startsAt],
      );
      await client.query(
        `update membership_subscriptions s set status='EXPIRED',version=version+1,updated_at=now()
         where owner_user_id=$1 and business_space=$2 and status='ACTIVE' and ends_at <= $3
           and not exists(select 1 from membership_periods p where p.subscription_id=s.id and p.status='QUEUED')`,
        [command.ownerUserId, command.businessSpace, command.startsAt],
      );
      const active = (
        await client.query<{
          id: string;
          current_plan_version_id: string;
          ends_at: Date;
        }>(
          `select id,current_plan_version_id,ends_at from membership_subscriptions
           where owner_user_id=$1 and business_space=$2 and status='ACTIVE' for update`,
          [command.ownerUserId, command.businessSpace],
        )
      ).rows[0];
      if (!active) {
        const subscriptionId = randomUUID();
        const periodId = randomUUID();
        const endsAt = addPeriodDays(command.startsAt, periodDays);
        await client.query(
          `insert into membership_subscriptions
           (id,owner_user_id,business_space,status,current_plan_version_id,source_order_id,starts_at,ends_at,request_id)
           values($1,$2,$3,'ACTIVE',$4,$5,$6,$7,$8)`,
          [
            subscriptionId,
            command.ownerUserId,
            command.businessSpace,
            command.planVersionId,
            command.sourceOrderId,
            command.startsAt,
            endsAt,
            randomUUID(),
          ],
        );
        await client.query(
          `insert into membership_periods
           (id,subscription_id,owner_user_id,business_space,sequence,plan_version_id,source_order_id,status,
            starts_at,ends_at,activated_at,request_id)
           values($1,$2,$3,$4,1,$5,$6,'ACTIVE',$7,$8,$7,$9)`,
          [
            periodId,
            subscriptionId,
            command.ownerUserId,
            command.businessSpace,
            command.planVersionId,
            command.sourceOrderId,
            command.startsAt,
            endsAt,
            randomUUID(),
          ],
        );
        return (await this.preparedByOrder(client, command.sourceOrderId))!;
      }
      if (active.current_plan_version_id === command.planVersionId) {
        const latest = (
          await client.query<{ sequence: number; ends_at: Date }>(
            `select sequence,ends_at from membership_periods where subscription_id=$1
             order by sequence desc limit 1 for update`,
            [active.id],
          )
        ).rows[0];
        const startsAt = latest?.ends_at ?? active.ends_at;
        const endsAt = addPeriodDays(startsAt, periodDays);
        await client.query(
          `insert into membership_periods
           (id,subscription_id,owner_user_id,business_space,sequence,plan_version_id,source_order_id,status,
            starts_at,ends_at,request_id)
           values($1,$2,$3,$4,$5,$6,$7,'QUEUED',$8,$9,$10)`,
          [
            randomUUID(),
            active.id,
            command.ownerUserId,
            command.businessSpace,
            (latest?.sequence ?? 0) + 1,
            command.planVersionId,
            command.sourceOrderId,
            startsAt,
            endsAt,
            randomUUID(),
          ],
        );
        await client.query(
          `update membership_subscriptions set ends_at=$2,version=version+1,updated_at=now() where id=$1`,
          [active.id, endsAt],
        );
        return (await this.preparedByOrder(client, command.sourceOrderId))!;
      }
      const upgrade = (
        await client.query<{
          id: string;
          previous_subscription_id: string;
        }>(
          `select id,previous_subscription_id from membership_upgrades
           where new_order_id=$1 and owner_user_id=$2 and status in ('ORDER_CREATED','PAID','ACTIVATING')
           for update`,
          [command.sourceOrderId, command.ownerUserId],
        )
      ).rows[0];
      if (!upgrade || upgrade.previous_subscription_id !== active.id) {
        throw new MembershipError(
          'MEMBERSHIP_UPGRADE_REQUIRED',
          'Changing an active membership plan requires a registered upgrade',
        );
      }
      const previousPeriod = (
        await client.query<{ id: string }>(
          `select id from membership_periods where subscription_id=$1 and status='ACTIVE' for update`,
          [active.id],
        )
      ).rows[0];
      if (!previousPeriod) {
        throw new MembershipError(
          'ACTIVE_MEMBERSHIP_PERIOD_NOT_FOUND',
          'Active membership period was not found',
        );
      }
      const subscriptionId = randomUUID();
      const periodId = randomUUID();
      const endsAt = addPeriodDays(command.startsAt, periodDays);
      await client.query(
        `insert into membership_subscriptions
         (id,owner_user_id,business_space,status,current_plan_version_id,source_order_id,starts_at,ends_at,request_id)
         values($1,$2,$3,'PREPARING',$4,$5,$6,$7,$8)`,
        [
          subscriptionId,
          command.ownerUserId,
          command.businessSpace,
          command.planVersionId,
          command.sourceOrderId,
          command.startsAt,
          endsAt,
          randomUUID(),
        ],
      );
      await client.query(
        `insert into membership_periods
         (id,subscription_id,owner_user_id,business_space,sequence,plan_version_id,source_order_id,status,
          starts_at,ends_at,request_id)
         values($1,$2,$3,$4,1,$5,$6,'QUEUED',$7,$8,$9)`,
        [
          periodId,
          subscriptionId,
          command.ownerUserId,
          command.businessSpace,
          command.planVersionId,
          command.sourceOrderId,
          command.startsAt,
          endsAt,
          randomUUID(),
        ],
      );
      await client.query(
        `update membership_upgrades set new_subscription_id=$2,status='ACTIVATING',updated_at=now() where id=$1`,
        [upgrade.id, subscriptionId],
      );
      return (await this.preparedByOrder(client, command.sourceOrderId))!;
    });
  }

  async markBenefitsGranted(periodId: string) {
    await this.infrastructure.pool.query(
      `update membership_periods set benefits_granted_at=coalesce(benefits_granted_at,now()),updated_at=now()
       where id=$1`,
      [periodId],
    );
  }

  async commitUpgrade(prepared: PreparedMembershipPeriod) {
    const upgrade = prepared.upgrade;
    if (!upgrade) throw new MembershipError('MEMBERSHIP_UPGRADE_NOT_FOUND', 'Upgrade was not found');
    await this.transaction(async (client) => {
      await this.lock(client, `membership:${prepared.ownerUserId}:SATORI`);
      const current = (
        await client.query<{ status: string }>(
          'select status from membership_upgrades where id=$1 for update',
          [upgrade.upgradeId],
        )
      ).rows[0];
      if (current?.status === 'COMPLETED') return;
      await client.query(
        `update membership_periods set status='TERMINATED',ended_at=now(),updated_at=now()
         where id=$1 and status='ACTIVE'`,
        [upgrade.previousPeriodId],
      );
      await client.query(
        `update membership_subscriptions
         set status='TERMINATED',terminated_at=now(),termination_reason='UPGRADED',version=version+1,updated_at=now()
         where id=$1 and status='ACTIVE'`,
        [upgrade.previousSubscriptionId],
      );
      await client.query(
        `update membership_subscriptions set status='ACTIVE',version=version+1,updated_at=now()
         where id=$1 and status='PREPARING'`,
        [prepared.subscriptionId],
      );
      await client.query(
        `update membership_periods set status='ACTIVE',activated_at=coalesce(activated_at,now()),updated_at=now()
         where id=$1 and status='QUEUED'`,
        [prepared.periodId],
      );
      await client.query(
        `update membership_upgrades set status='COMPLETED',completed_at=coalesce(completed_at,now()),updated_at=now()
         where id=$1`,
        [upgrade.upgradeId],
      );
    });
  }

  async endDue(now: Date) {
    return this.transaction(async (client) => {
      const due = await client.query<{ id: string; subscription_id: string }>(
        `select id,subscription_id from membership_periods where status='ACTIVE' and ends_at <= $1 for update`,
        [now],
      );
      for (const period of due.rows) {
        await client.query(
          `update membership_periods set status='EXPIRED',ended_at=ends_at,updated_at=now() where id=$1`,
          [period.id],
        );
        const queued = await client.query(
          `select 1 from membership_periods where subscription_id=$1 and status='QUEUED' limit 1`,
          [period.subscription_id],
        );
        if (!queued.rowCount) {
          await client.query(
            `update membership_subscriptions set status='EXPIRED',version=version+1,updated_at=now()
             where id=$1 and status='ACTIVE'`,
            [period.subscription_id],
          );
        }
      }
      return due.rowCount ?? 0;
    });
  }

  async listDueQueued(now: Date, limit: number) {
    const result = await this.infrastructure.pool.query<{ id: string }>(
      `select p.id from membership_periods p
       join membership_subscriptions s on s.id=p.subscription_id
       where p.status='QUEUED' and p.starts_at <= $1 and s.status='ACTIVE'
       order by p.starts_at,p.id limit $2`,
      [now, limit],
    );
    return result.rows.map((row) => row.id);
  }

  async activateQueued(periodId: string) {
    return this.transaction(async (client) => {
      const row = (
        await client.query<{ owner_user_id: string; business_space: string; source_order_id: string }>(
          `select owner_user_id,business_space,source_order_id from membership_periods where id=$1 for update`,
          [periodId],
        )
      ).rows[0];
      if (!row) return null;
      await this.lock(client, `membership:${row.owner_user_id}:${row.business_space}`);
      const active = await client.query(
        `select 1 from membership_periods where owner_user_id=$1 and business_space=$2 and status='ACTIVE' limit 1`,
        [row.owner_user_id, row.business_space],
      );
      if (active.rowCount) return null;
      await client.query(
        `update membership_periods set status='ACTIVE',activated_at=coalesce(activated_at,now()),updated_at=now()
         where id=$1 and status='QUEUED'`,
        [periodId],
      );
      await client.query(
        `update membership_subscriptions s set current_plan_version_id=p.plan_version_id,version=version+1,updated_at=now()
         from membership_periods p where p.id=$1 and s.id=p.subscription_id`,
        [periodId],
      );
      return this.preparedByOrder(client, row.source_order_id);
    });
  }

  async listRepairable(limit: number) {
    const result = await this.infrastructure.pool.query<{ source_order_id: string }>(
      `select source_order_id from membership_periods where status='ACTIVE'
       order by updated_at,id limit $1`,
      [limit],
    );
    const prepared: PreparedMembershipPeriod[] = [];
    for (const row of result.rows) {
      const value = await this.withClient((client) => this.preparedByOrder(client, row.source_order_id));
      if (value) prepared.push(value);
    }
    return prepared;
  }

  async listFailedPreparing(limit: number) {
    const result = await this.infrastructure.pool.query<{ source_order_id: string }>(
      `select p.source_order_id from membership_periods p
       join membership_subscriptions s on s.id=p.subscription_id
       join money_orders o on o.id=p.source_order_id
       where s.status='PREPARING' and o.status='EXCEPTION' limit $1`,
      [limit],
    );
    const prepared: PreparedMembershipPeriod[] = [];
    for (const row of result.rows) {
      const value = await this.withClient((client) => this.preparedByOrder(client, row.source_order_id));
      if (value) prepared.push(value);
    }
    return prepared;
  }

  async cancelFailedPreparing(prepared: PreparedMembershipPeriod) {
    await this.transaction(async (client) => {
      await client.query(
        `update membership_periods set status='CANCELLED',ended_at=coalesce(ended_at,now()),updated_at=now()
         where id=$1 and status='QUEUED'`,
        [prepared.periodId],
      );
      await client.query(
        `update membership_subscriptions set status='CANCELLED',version=version+1,updated_at=now()
         where id=$1 and status='PREPARING'`,
        [prepared.subscriptionId],
      );
      if (prepared.upgrade) {
        await client.query(
          `update membership_upgrades set status='FAILED',failed_at=coalesce(failed_at,now()),
           failure='{"code":"NEW_ORDER_EXCEPTION"}'::jsonb,updated_at=now() where id=$1`,
          [prepared.upgrade.upgradeId],
        );
      }
    });
  }

  async openRepairCase(prepared: PreparedMembershipPeriod, expectedTotal: number, actualTotal: number) {
    await this.infrastructure.pool.query(
      `insert into reconciliation_cases
       (id,business_space,case_type,status,severity,resource_type,resource_id,business_key,
        expected_snapshot,actual_snapshot,request_id,detected_at)
       values($1,'SATORI','MEMBERSHIP_PERIOD_GRANT_MISSING','OPEN','WARNING','MEMBERSHIP_PERIOD',$2,$2,
              jsonb_build_object('totalQuantity',$3),jsonb_build_object('totalQuantity',$4),$5,now())
       on conflict(case_type,business_key) do update set status='OPEN',actual_snapshot=excluded.actual_snapshot,
         resolution=null,resolved_at=null,updated_at=now()`,
      [randomUUID(), prepared.periodId, expectedTotal, actualTotal, randomUUID()],
    );
  }

  async resolveRepairCase(periodId: string) {
    await this.infrastructure.pool.query(
      `update reconciliation_cases set status='RESOLVED',resolution='{"action":"REPLAYED_GRANTS"}'::jsonb,
       resolved_at=now(),updated_at=now()
       where case_type='MEMBERSHIP_PERIOD_GRANT_MISSING' and business_key=$1`,
      [periodId],
    );
  }

  async getUpgradeContext(ownerUserId: string, previousSubscriptionId: string, targetPlanVersionId: string) {
    const result = await this.infrastructure.pool.query<{
      previous_subscription_id: string;
      previous_period_id: string;
      previous_plan_code: string;
      previous_plan_amount_minor: number;
      previous_starts_at: Date;
      previous_ends_at: Date;
      target_plan_version_id: string;
      target_plan_code: string;
      target_plan_amount_minor: number;
    }>(
      `select s.id previous_subscription_id,p.id previous_period_id,old_o.code previous_plan_code,
              old_v.amount_minor previous_plan_amount_minor,p.starts_at previous_starts_at,p.ends_at previous_ends_at,
              target_v.id target_plan_version_id,target_o.code target_plan_code,
              target_v.amount_minor target_plan_amount_minor
       from membership_subscriptions s
       join membership_periods p on p.subscription_id=s.id and p.status='ACTIVE'
       join offering_versions old_v on old_v.id=p.plan_version_id
       join service_offerings old_o on old_o.id=old_v.offering_id
       join offering_versions target_v on target_v.id=$3
       join service_offerings target_o on target_o.id=target_v.offering_id
       where s.id=$2 and s.owner_user_id=$1 and s.status='ACTIVE' and target_o.offering_kind='MEMBERSHIP'`,
      [ownerUserId, previousSubscriptionId, targetPlanVersionId],
    );
    const row = result.rows[0];
    if (!row) throw new MembershipError('MEMBERSHIP_UPGRADE_CONTEXT_NOT_FOUND', 'Upgrade context not found');
    return {
      previousSubscriptionId: row.previous_subscription_id,
      previousPeriodId: row.previous_period_id,
      previousPlanCode: row.previous_plan_code,
      previousPlanAmountMinor: row.previous_plan_amount_minor,
      previousStartsAt: row.previous_starts_at,
      previousEndsAt: row.previous_ends_at,
      targetPlanVersionId: row.target_plan_version_id,
      targetPlanCode: row.target_plan_code,
      targetPlanAmountMinor: row.target_plan_amount_minor,
    };
  }

  async registerUpgrade(command: Parameters<MembershipRepository['registerUpgrade']>[0]) {
    return this.transaction(async (client) => {
      await this.lock(client, `membership:${command.ownerUserId}:SATORI`);
      const replay = (
        await client.query<{
          id: string;
          status: string;
          owner_user_id: string;
          previous_subscription_id: string;
        }>(
          `select id,status,owner_user_id,previous_subscription_id
           from membership_upgrades where new_order_id=$1`,
          [command.newOrderId],
        )
      ).rows[0];
      if (replay) {
        if (
          replay.owner_user_id !== command.ownerUserId ||
          replay.previous_subscription_id !== command.previousSubscriptionId
        ) {
          throw new MembershipError('MEMBERSHIP_UPGRADE_IDEMPOTENCY_CONFLICT', 'Upgrade order was reused');
        }
        return { upgradeId: replay.id, status: replay.status };
      }
      const previous = await client.query(
        `select 1 from membership_subscriptions
         where id=$1 and owner_user_id=$2 and status='ACTIVE' for update`,
        [command.previousSubscriptionId, command.ownerUserId],
      );
      if (!previous.rowCount) {
        throw new MembershipError('MEMBERSHIP_UPGRADE_CONTEXT_NOT_FOUND', 'Active membership was not found');
      }
      const order = (
        await client.query<{ offering_version_id: string }>(
          `select offering_version_id from money_orders
           where id=$1 and owner_user_id=$2 and status in ('PENDING_PAYMENT','PAYMENT_PROCESSING') for update`,
          [command.newOrderId, command.ownerUserId],
        )
      ).rows[0];
      if (!order || order.offering_version_id !== command.targetPlanVersionId) {
        throw new MembershipError('MEMBERSHIP_UPGRADE_ORDER_INVALID', 'Upgrade order is invalid');
      }
      const upgradeId = randomUUID();
      await client.query(
        `insert into membership_upgrades
         (id,owner_user_id,business_space,previous_subscription_id,new_order_id,status,request_id,requested_at)
         values($1,$2,'SATORI',$3,$4,'ORDER_CREATED',$5,now())`,
        [
          upgradeId,
          command.ownerUserId,
          command.previousSubscriptionId,
          command.newOrderId,
          command.requestId,
        ],
      );
      await client.query(
        `insert into upgrade_assessments
         (id,upgrade_id,owner_user_id,previous_subscription_id,remaining_time_basis_points,
          remaining_quota_basis_points,residual_value_estimate_minor,currency,assessment_rule_version,
          internal_only,input_snapshot,request_id)
         values($1,$2,$3,$4,$5,$6,$7,'CNY',$8,true,$9,$10)`,
        [
          randomUUID(),
          upgradeId,
          command.ownerUserId,
          command.previousSubscriptionId,
          command.assessment.remainingTimeBasisPoints,
          command.assessment.remainingQuotaBasisPoints,
          command.assessment.residualValueEstimateMinor,
          command.assessment.assessmentRuleVersion,
          command.assessment.inputSnapshot,
          command.requestId,
        ],
      );
      return { upgradeId, status: 'ORDER_CREATED' };
    });
  }

  async getCurrent(ownerUserId: string) {
    const subscription = (
      await this.infrastructure.pool.query<{
        id: string;
        status: string;
        current_plan_version_id: string;
        starts_at: Date;
        ends_at: Date;
      }>(
        `select id,status,current_plan_version_id,starts_at,ends_at from membership_subscriptions
         where owner_user_id=$1 and status in ('ACTIVE','PREPARING')
         order by case when status='ACTIVE' then 0 else 1 end,created_at desc limit 1`,
        [ownerUserId],
      )
    ).rows[0];
    if (!subscription) return null;
    const periods = await this.listPeriods(ownerUserId);
    return {
      subscriptionId: subscription.id,
      status: subscription.status,
      currentPlanVersionId: subscription.current_plan_version_id,
      startsAt: subscription.starts_at,
      endsAt: subscription.ends_at,
      periods,
    };
  }

  async listPeriods(ownerUserId: string) {
    const result = await this.infrastructure.pool.query<{
      id: string;
      subscription_id: string;
      sequence: number;
      plan_version_id: string;
      source_order_id: string;
      status: string;
      starts_at: Date;
      ends_at: Date;
      benefits_granted_at: Date | null;
    }>(
      `select id,subscription_id,sequence,plan_version_id,source_order_id,status,starts_at,ends_at,
              benefits_granted_at
       from membership_periods where owner_user_id=$1 order by starts_at,id`,
      [ownerUserId],
    );
    return result.rows.map((row) => ({
      periodId: row.id,
      subscriptionId: row.subscription_id,
      sequence: row.sequence,
      planVersionId: row.plan_version_id,
      sourceOrderId: row.source_order_id,
      status: row.status,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      benefitsGrantedAt: row.benefits_granted_at,
    }));
  }

  async listUpgrades(ownerUserId: string) {
    const result = await this.infrastructure.pool.query<{
      id: string;
      previous_subscription_id: string;
      new_order_id: string;
      new_subscription_id: string | null;
      status: string;
      requested_at: Date;
      completed_at: Date | null;
    }>(
      `select id,previous_subscription_id,new_order_id,new_subscription_id,status,requested_at,completed_at
       from membership_upgrades where owner_user_id=$1 order by created_at desc,id desc`,
      [ownerUserId],
    );
    return result.rows.map((row) => ({
      upgradeId: row.id,
      previousSubscriptionId: row.previous_subscription_id,
      newOrderId: row.new_order_id,
      newSubscriptionId: row.new_subscription_id,
      status: row.status,
      requestedAt: row.requested_at,
      completedAt: row.completed_at,
    }));
  }

  private async preparedByOrder(client: PoolClient, sourceOrderId: string) {
    const row = (
      await client.query<PreparedRow>(
        `select s.id subscription_id,p.id period_id,p.owner_user_id,p.source_order_id,p.starts_at,p.ends_at,
                p.plan_version_id,p.status period_status,s.status subscription_status,p.benefits_granted_at,
                v.entitlement_spec,u.id upgrade_id,u.status upgrade_status,u.previous_subscription_id,
                oldp.id previous_period_id
         from membership_periods p
         join membership_subscriptions s on s.id=p.subscription_id
         join offering_versions v on v.id=p.plan_version_id
         left join membership_upgrades u on u.new_order_id=p.source_order_id
         left join membership_periods oldp on oldp.subscription_id=u.previous_subscription_id
              and oldp.status in ('ACTIVE','TERMINATED')
         where p.source_order_id=$1 order by oldp.updated_at desc nulls last limit 1`,
        [sourceOrderId],
      )
    ).rows[0];
    if (!row) return null;
    const mode = row.upgrade_id
      ? ('UPGRADE' as const)
      : row.period_status === 'QUEUED'
        ? ('QUEUED' as const)
        : ('ACTIVE' as const);
    return {
      subscriptionId: row.subscription_id,
      periodId: row.period_id,
      ownerUserId: row.owner_user_id,
      sourceOrderId: row.source_order_id,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      planVersionId: row.plan_version_id,
      benefits: benefitsOf(row.entitlement_spec),
      mode,
      benefitsGranted: row.benefits_granted_at !== null,
      ...(row.upgrade_id && row.previous_subscription_id && row.previous_period_id
        ? {
            upgrade: {
              upgradeId: row.upgrade_id,
              previousSubscriptionId: row.previous_subscription_id,
              previousPeriodId: row.previous_period_id,
              committed: row.upgrade_status === 'COMPLETED',
            },
          }
        : {}),
    } satisfies PreparedMembershipPeriod;
  }

  private async plan(client: PoolClient, versionId: string) {
    const row = (
      await client.query<PlanRow>(
        `select v.id version_id,o.code,v.amount_minor,o.offering_kind,v.entitlement_spec
         from offering_versions v join service_offerings o on o.id=v.offering_id
         where v.id=$1 and v.status='PUBLISHED'`,
        [versionId],
      )
    ).rows[0];
    if (!row || row.offering_kind !== 'MEMBERSHIP') {
      throw new MembershipError('MEMBERSHIP_PLAN_NOT_FOUND', 'Published membership plan was not found');
    }
    benefitsOf(row.entitlement_spec);
    return row;
  }

  private lock(client: PoolClient, key: string) {
    return client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
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

  private async withClient<T>(work: (client: PoolClient) => Promise<T>) {
    const client = await this.infrastructure.pool.connect();
    try {
      return await work(client);
    } finally {
      client.release();
    }
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function periodDaysOf(value: unknown) {
  const days = Number(record(value).periodDays ?? 30);
  if (!Number.isInteger(days) || days < 1) {
    throw new MembershipError('INVALID_MEMBERSHIP_PLAN', 'Membership plan period is invalid');
  }
  return days;
}

function benefitsOf(value: unknown): readonly MembershipBenefitSpec[] {
  const benefits = record(value).benefits;
  if (!Array.isArray(benefits) || benefits.length === 0) {
    throw new MembershipError('INVALID_MEMBERSHIP_PLAN', 'Membership plan benefits are missing');
  }
  return benefits.map((value) => {
    const benefit = record(value);
    const serviceType = benefit.serviceType;
    const unit = benefit.unit;
    const quantity = Number(benefit.quantity);
    if (
      (serviceType !== 'DAILY_INSIGHT' && serviceType !== 'CARD_READING') ||
      (unit !== 'DAILY_INSIGHT_CREDIT' && unit !== 'READING_CREDIT') ||
      !Number.isInteger(quantity) ||
      quantity < 1
    ) {
      throw new MembershipError('INVALID_MEMBERSHIP_PLAN', 'Membership benefit is invalid');
    }
    return { serviceType, unit, quantity };
  });
}
