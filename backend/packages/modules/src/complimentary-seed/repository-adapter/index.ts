import { Inject, Injectable } from '@nestjs/common';
import type { BenefitCandidate, SeedEligibilityPort } from '@satori/application';
import type { BusinessContext, ServiceRequirement, ServiceType } from '@satori/domain';
import { RuntimeInfrastructure } from '@satori/infrastructure';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type {
  ComplimentarySeedRepository,
  GrantComplimentarySeedsCommand,
  SeedMigrationReport,
  SeedReservationCommand,
  SeedReservationView,
} from '../application/index.js';
import {
  assertSeedQuantity,
  ComplimentarySeedError,
  type ComplimentarySeedGrantView,
} from '../domain/index.js';

@Injectable()
export class PostgresComplimentarySeedRepository implements ComplimentarySeedRepository, SeedEligibilityPort {
  constructor(@Inject(RuntimeInfrastructure) private readonly infrastructure: RuntimeInfrastructure) {}

  async grant(command: GrantComplimentarySeedsCommand, idempotencyKey: string) {
    assertSeedQuantity(command.quantity);
    assertScopes(command.applicableServices);
    return this.transaction(async (client) => {
      const grantId = randomUUID();
      const inserted = await client.query<{ id: string }>(
        `insert into complimentary_seed_grants
         (id,owner_user_id,business_space,source_type,source_id,applicable_services,total_quantity,
          available_quantity,reserved_quantity,status,effective_at,expires_at,granted_at,expiry_timezone,
          rule_version,migration_version,request_id)
         values($1,$2,$3,$4,$5,$6,$7,$7,0,'ACTIVE',$8,$9,$8,$10,$11,$12,$13)
         on conflict (owner_user_id,source_type,source_id) do nothing returning id`,
        [
          grantId,
          command.ownerUserId,
          command.businessSpace,
          command.sourceType,
          command.sourceId,
          JSON.stringify(command.applicableServices),
          command.quantity,
          command.effectiveAt,
          command.expiresAt,
          command.expiresAt ? 'Asia/Shanghai' : null,
          command.ruleVersion,
          command.migrationVersion ?? null,
          command.requestId,
        ],
      );
      if (!inserted.rows[0]) {
        const existing = await client.query<GrantRow>(
          `select * from complimentary_seed_grants where owner_user_id=$1 and source_type=$2 and source_id=$3`,
          [command.ownerUserId, command.sourceType, command.sourceId],
        );
        const row = existing.rows[0];
        if (
          !row ||
          row.owner_user_id !== command.ownerUserId ||
          row.business_space !== command.businessSpace ||
          row.total_quantity !== command.quantity ||
          row.rule_version !== command.ruleVersion ||
          row.effective_at.getTime() !== command.effectiveAt.getTime() ||
          row.expires_at?.getTime() !== command.expiresAt?.getTime() ||
          !sameStrings(row.applicable_services, command.applicableServices)
        ) {
          throw new ComplimentarySeedError(
            'IDEMPOTENCY_KEY_REUSED',
            'Seed source already exists with another payload',
          );
        }
        return { grantId: row.id };
      }
      const account = await this.lockAccount(client, command.ownerUserId, command.businessSpace);
      const available = account.available_quantity + command.quantity;
      await this.updateAccount(client, account, available, account.reserved_quantity, command.quantity, 0);
      await append(client, {
        grantId,
        ownerUserId: command.ownerUserId,
        businessSpace: command.businessSpace,
        entryType: 'GRANT',
        quantity: command.quantity,
        availableAfter: command.quantity,
        reservedAfter: 0,
        businessKey: idempotencyKey,
        context: { type: command.sourceType, id: command.sourceId },
        requestId: command.requestId,
        metadata: { applicableServices: command.applicableServices, ruleVersion: command.ruleVersion },
      });
      return { grantId };
    });
  }

  async listCandidates(requirement: ServiceRequirement) {
    const result = await this.infrastructure.pool.query<GrantRow>(
      `select * from complimentary_seed_grants
       where owner_user_id=$1 and business_space=$2 and status='ACTIVE'
         and effective_at<=now() and (expires_at is null or expires_at>now())
         and applicable_services ? $3 and available_quantity>0
       order by expires_at asc nulls last,granted_at,id`,
      [requirement.userId, requirement.businessSpace, requirement.serviceType],
    );
    const total = result.rows.reduce((sum, row) => sum + row.available_quantity, 0);
    return result.rows.map((row) => ({
      sourceId: row.id,
      sourceType: 'COMPLIMENTARY_SEED' as const,
      serviceType: requirement.serviceType,
      availableQuantity: total,
      requiredQuantity: requirement.quantity,
      expiresAt: row.expires_at,
      grantedAt: row.granted_at,
      ruleVersion: row.rule_version,
    }));
  }

  async reserveCandidate(candidate: BenefitCandidate, intentId: string, requestId: string) {
    const first = await this.infrastructure.pool.query<GrantRow>(
      `select * from complimentary_seed_grants where id=$1`,
      [candidate.sourceId],
    );
    const grant = first.rows[0];
    if (!grant) throw new ComplimentarySeedError('SEED_GRANT_NOT_FOUND', 'Seed grant was not found');
    return this.reserve({
      ownerUserId: grant.owner_user_id,
      businessSpace: 'SATORI',
      serviceType: candidate.serviceType,
      quantity: candidate.requiredQuantity,
      businessKey: `${intentId}:RESERVE`,
      consumptionIntentId: intentId,
      businessContext: { type: 'CONSUMPTION_INTENT', id: intentId },
      requestId,
    });
  }

  async reserve(command: SeedReservationCommand): Promise<SeedReservationView> {
    assertSeedQuantity(command.quantity);
    return this.transaction(async (client) => {
      await advisoryLock(client, `seed-reservation:${command.businessKey}`);
      const replayEntry = await client.query<{
        reservation_id: string;
        business_context_type: string;
        business_context_id: string;
        metadata: { serviceType?: string };
      }>(
        `select reservation_id,business_context_type,business_context_id,metadata from complimentary_seed_entries
         where owner_user_id=$1 and entry_type='RESERVE' and business_key=$2 limit 1`,
        [command.ownerUserId, command.businessKey],
      );
      if (replayEntry.rows[0]) {
        const entry = replayEntry.rows[0];
        const replay = await client.query<AllocationRow>(
          `select * from complimentary_seed_allocations where reservation_id=$1 order by created_at,id`,
          [entry.reservation_id],
        );
        const view = allocationView(replay.rows);
        const replayExpiry = view.expiresAt?.getTime() ?? null;
        const commandExpiry = command.expiresAt?.getTime() ?? null;
        if (
          view.quantity !== command.quantity ||
          entry.metadata.serviceType !== command.serviceType ||
          entry.business_context_type !== command.businessContext.type ||
          entry.business_context_id !== command.businessContext.id ||
          replayExpiry !== commandExpiry
        ) {
          throw new ComplimentarySeedError(
            'IDEMPOTENCY_KEY_REUSED',
            'Seed reservation key was reused with another payload',
          );
        }
        return view;
      }
      const account = await this.lockAccount(client, command.ownerUserId, command.businessSpace);
      const grants = await client.query<GrantRow>(
        `select * from complimentary_seed_grants
         where owner_user_id=$1 and business_space=$2 and status='ACTIVE'
           and effective_at<=now() and (expires_at is null or expires_at>now())
           and applicable_services ? $3 and available_quantity>0
         order by expires_at asc nulls last,granted_at,id for update`,
        [command.ownerUserId, command.businessSpace, command.serviceType],
      );
      if (grants.rows.reduce((sum, row) => sum + row.available_quantity, 0) < command.quantity) {
        throw new ComplimentarySeedError('INSUFFICIENT_WISDOM_SEEDS', 'Insufficient applicable wisdom seeds');
      }
      const reservationId = randomUUID();
      let remaining = command.quantity;
      const allocations: { grantId: string; quantity: number }[] = [];
      for (const row of grants.rows) {
        if (remaining === 0) break;
        const quantity = Math.min(row.available_quantity, remaining);
        const available = row.available_quantity - quantity;
        const reserved = row.reserved_quantity + quantity;
        await client.query(
          `update complimentary_seed_grants set available_quantity=$2,reserved_quantity=$3,
           status=case when $2=0 then 'EXHAUSTED' else 'ACTIVE' end,version=version+1,updated_at=now()
           where id=$1`,
          [row.id, available, reserved],
        );
        await client.query(
          `insert into complimentary_seed_allocations
           (id,grant_id,owner_user_id,reservation_id,consumption_intent_id,quantity,status,expires_at)
           values($1,$2,$3,$4,$5,$6,'RESERVED',$7)`,
          [
            randomUUID(),
            row.id,
            command.ownerUserId,
            reservationId,
            command.consumptionIntentId ?? null,
            quantity,
            command.expiresAt ?? null,
          ],
        );
        await append(client, {
          grantId: row.id,
          ownerUserId: command.ownerUserId,
          businessSpace: command.businessSpace,
          entryType: 'RESERVE',
          quantity,
          availableAfter: available,
          reservedAfter: reserved,
          businessKey: command.businessKey,
          reservationId,
          consumptionIntentId: command.consumptionIntentId,
          context: command.businessContext,
          requestId: command.requestId,
          metadata: { serviceType: command.serviceType },
        });
        allocations.push({ grantId: row.id, quantity });
        remaining -= quantity;
      }
      await this.updateAccount(
        client,
        account,
        account.available_quantity - command.quantity,
        account.reserved_quantity + command.quantity,
        0,
        0,
      );
      return { reservationId, quantity: command.quantity, allocations, expiresAt: command.expiresAt ?? null };
    });
  }

  async settle(
    reservationId: string,
    action: 'CONSUME' | 'RELEASE',
    context: BusinessContext,
    requestId: string,
  ) {
    await this.transaction(async (client) => {
      await advisoryLock(client, `seed-settlement:${reservationId}`);
      const allocations = await client.query<AllocationRow>(
        `select * from complimentary_seed_allocations where reservation_id=$1 order by grant_id for update`,
        [reservationId],
      );
      if (allocations.rows.length === 0)
        throw new ComplimentarySeedError('SEED_RESERVATION_NOT_FOUND', 'Seed reservation was not found');
      const target = action === 'CONSUME' ? 'CONSUMED' : 'RELEASED';
      if (allocations.rows.every((row) => row.status === target)) return;
      if (allocations.rows.some((row) => row.status !== 'RESERVED')) {
        throw new ComplimentarySeedError(
          'SEED_RESERVATION_ALREADY_SETTLED',
          'Seed reservation already has another terminal state',
        );
      }
      const account = await this.lockAccount(client, allocations.rows[0]!.owner_user_id, 'SATORI');
      let released = 0;
      let consumed = 0;
      for (const allocation of allocations.rows) {
        const grantResult = await client.query<GrantRow>(
          `select * from complimentary_seed_grants where id=$1 for update`,
          [allocation.grant_id],
        );
        const grant = grantResult.rows[0]!;
        const canRelease = action === 'RELEASE' && (!grant.expires_at || grant.expires_at > new Date());
        const available = grant.available_quantity + (canRelease ? allocation.quantity : 0);
        const reserved = grant.reserved_quantity - allocation.quantity;
        await client.query(
          `update complimentary_seed_grants set available_quantity=$2,reserved_quantity=$3,
           status=case when expires_at is not null and expires_at<=now() then 'EXPIRED' when $2>0 then 'ACTIVE' else 'EXHAUSTED' end,
           version=version+1,updated_at=now() where id=$1`,
          [grant.id, available, reserved],
        );
        await client.query(
          `update complimentary_seed_allocations set status=$2,updated_at=now() where id=$1`,
          [allocation.id, target],
        );
        await append(client, {
          grantId: grant.id,
          ownerUserId: grant.owner_user_id,
          businessSpace: grant.business_space,
          entryType: action,
          quantity: allocation.quantity,
          availableAfter: available,
          reservedAfter: reserved,
          businessKey: `${reservationId}:${action}`,
          reservationId,
          consumptionIntentId: allocation.consumption_intent_id ?? undefined,
          context,
          requestId,
          metadata: canRelease || action === 'CONSUME' ? {} : { effect: 'DISCARD_EXPIRED' },
        });
        if (canRelease) released += allocation.quantity;
        if (action === 'CONSUME') consumed += allocation.quantity;
      }
      await this.updateAccount(
        client,
        account,
        account.available_quantity + released,
        account.reserved_quantity - allocations.rows.reduce((sum, row) => sum + row.quantity, 0),
        0,
        consumed,
      );
    });
  }

  async restore(reservationId: string, businessKey: string, requestId: string) {
    await this.transaction(async (client) => {
      await advisoryLock(client, `seed-restore:${businessKey}`);
      const allocations = await client.query<AllocationRow>(
        `select * from complimentary_seed_allocations where reservation_id=$1 and status='CONSUMED' order by grant_id for update`,
        [reservationId],
      );
      if (allocations.rows.length === 0)
        throw new ComplimentarySeedError('SEED_CONSUMPTION_NOT_FOUND', 'Consumed reservation was not found');
      const account = await this.lockAccount(client, allocations.rows[0]!.owner_user_id, 'SATORI');
      let restored = 0;
      for (const allocation of allocations.rows) {
        const replay = await client.query(
          `select 1 from complimentary_seed_entries
           where grant_id=$1 and reservation_id=$2 and entry_type='RESTORE'`,
          [allocation.grant_id, reservationId],
        );
        if (replay.rowCount) continue;
        const result = await client.query<GrantRow>(
          `select * from complimentary_seed_grants where id=$1 for update`,
          [allocation.grant_id],
        );
        const grant = result.rows[0]!;
        if (grant.expires_at && grant.expires_at <= new Date()) continue;
        const available = grant.available_quantity + allocation.quantity;
        await client.query(
          `update complimentary_seed_grants set available_quantity=$2,status='ACTIVE',version=version+1,updated_at=now() where id=$1`,
          [grant.id, available],
        );
        await append(client, {
          grantId: grant.id,
          ownerUserId: grant.owner_user_id,
          businessSpace: grant.business_space,
          entryType: 'RESTORE',
          quantity: allocation.quantity,
          availableAfter: available,
          reservedAfter: grant.reserved_quantity,
          businessKey,
          reservationId,
          requestId,
          context: { type: 'SEED_RESERVATION', id: reservationId },
        });
        restored += allocation.quantity;
      }
      if (restored > 0)
        await this.updateAccount(
          client,
          account,
          account.available_quantity + restored,
          account.reserved_quantity,
          0,
          -restored,
        );
    });
  }

  async expireDue(now: Date, requestId: string) {
    return this.transaction(async (client) => {
      const due = await client.query<GrantRow>(
        `select * from complimentary_seed_grants where status in ('ACTIVE','FROZEN','EXHAUSTED') and expires_at<=$1 order by expires_at,id for update skip locked limit 1000`,
        [now],
      );
      for (const grant of due.rows) {
        const account = await this.lockAccount(client, grant.owner_user_id, grant.business_space);
        await client.query(
          `update complimentary_seed_grants set status='EXPIRED',available_quantity=0,version=version+1,updated_at=now() where id=$1`,
          [grant.id],
        );
        await this.updateAccount(
          client,
          account,
          account.available_quantity - grant.available_quantity,
          account.reserved_quantity,
          0,
          0,
        );
        await append(client, {
          grantId: grant.id,
          ownerUserId: grant.owner_user_id,
          businessSpace: grant.business_space,
          entryType: 'EXPIRE',
          quantity: grant.available_quantity,
          availableAfter: 0,
          reservedAfter: grant.reserved_quantity,
          businessKey: `${grant.id}:EXPIRE:${grant.expires_at!.toISOString()}`,
          requestId,
          context: { type: 'SEED_GRANT', id: grant.id },
        });
      }
      return due.rows.length;
    });
  }

  async adjust(
    grantId: string,
    quantity: number,
    direction: 'INCREASE' | 'DECREASE',
    reasonCode: string,
    requestId: string,
  ) {
    assertSeedQuantity(quantity);
    await this.transaction(async (client) => {
      await advisoryLock(client, `seed-adjust:${requestId}`);
      const replay = await client.query<{
        quantity: number;
        metadata: { direction?: string; reasonCode?: string };
      }>(
        `select quantity,metadata from complimentary_seed_entries
         where grant_id=$1 and entry_type='ADJUSTMENT' and business_key=$2`,
        [grantId, `adjustment:${requestId}`],
      );
      if (replay.rows[0]) {
        const existing = replay.rows[0];
        if (
          existing.quantity !== quantity ||
          existing.metadata.direction !== direction ||
          existing.metadata.reasonCode !== reasonCode
        ) {
          throw new ComplimentarySeedError(
            'IDEMPOTENCY_KEY_REUSED',
            'Seed adjustment key was reused with another payload',
          );
        }
        return;
      }
      const result = await client.query<GrantRow>(
        `select * from complimentary_seed_grants where id=$1 for update`,
        [grantId],
      );
      const grant = result.rows[0];
      if (!grant) throw new ComplimentarySeedError('SEED_GRANT_NOT_FOUND', 'Seed grant was not found');
      if (direction === 'DECREASE' && grant.available_quantity < quantity)
        throw new ComplimentarySeedError(
          'INSUFFICIENT_WISDOM_SEEDS',
          'Adjustment would make balance negative',
        );
      const delta = direction === 'INCREASE' ? quantity : -quantity;
      const account = await this.lockAccount(client, grant.owner_user_id, grant.business_space);
      await client.query(
        `update complimentary_seed_grants set total_quantity=total_quantity+$2,available_quantity=available_quantity+$2,status=case when available_quantity+$2>0 then 'ACTIVE' else 'EXHAUSTED' end,version=version+1,updated_at=now() where id=$1`,
        [grantId, delta],
      );
      await this.updateAccount(
        client,
        account,
        account.available_quantity + delta,
        account.reserved_quantity,
        direction === 'INCREASE' ? quantity : 0,
        direction === 'DECREASE' ? quantity : 0,
      );
      await append(client, {
        grantId,
        ownerUserId: grant.owner_user_id,
        businessSpace: grant.business_space,
        entryType: 'ADJUSTMENT',
        quantity,
        availableAfter: grant.available_quantity + delta,
        reservedAfter: grant.reserved_quantity,
        businessKey: `adjustment:${requestId}`,
        requestId,
        context: { type: 'OPERATOR_ADJUSTMENT', id: requestId },
        metadata: { direction, reasonCode },
      });
    });
  }

  async getAvailableSeedQuantity(ownerUserId: string, businessSpace: 'SATORI') {
    const result = await this.infrastructure.pool.query<AccountRow>(
      `select * from complimentary_seed_account_projections where owner_user_id=$1 and business_space=$2`,
      [ownerUserId, businessSpace],
    );
    return result.rows[0]?.available_quantity ?? 0;
  }

  async getAccount(ownerUserId: string) {
    const result = await this.infrastructure.pool.query<AccountRow>(
      `select * from complimentary_seed_account_projections where owner_user_id=$1`,
      [ownerUserId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      accountId: `seed-batch:${ownerUserId}`,
      available: row.available_quantity,
      reserved: row.reserved_quantity,
      totalEarned: Number(row.total_granted),
      totalSpent: Number(row.total_consumed),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  async listTransactions(ownerUserId: string, cursor: { createdAt: Date; id: string } | null, limit: number) {
    const values: unknown[] = [ownerUserId];
    const cursorSql = cursor ? `where created_at<$2 or (created_at=$2 and id<$3)` : '';
    if (cursor) values.push(cursor.createdAt, cursor.id);
    values.push(limit + 1);
    const result = await this.infrastructure.pool.query<{
      id: string;
      type: 'GRANT' | 'RESERVE' | 'CONSUME' | 'RELEASE' | 'REFUND' | 'ADJUSTMENT';
      amount: number;
      available_after: number;
      business_type: 'REGISTRATION_REWARD' | 'DAILY_INSIGHT';
      resource_id: string;
      original_id: string | null;
      title: string;
      created_at: Date;
    }>(
      `select * from (
         select e.id,e.type::text as type,e.amount,e.available_after,e.business_type,
           coalesce(e.resource_id::text,e.business_key) resource_id,e.original_entry_id::text original_id,
           coalesce(e.metadata->>'title','智慧种子记录') title,e.created_at
         from seed_entries e join seed_accounts a on a.id=e.account_id where a.user_id=$1
         union all
         select e.id,
           case e.entry_type when 'RESTORE' then 'REFUND' when 'EXPIRE' then 'ADJUSTMENT' else e.entry_type end type,
           case when e.entry_type in ('RESERVE','CONSUME','EXPIRE') then -e.quantity
             when e.entry_type='ADJUSTMENT' and e.metadata->>'direction'='DECREASE' then -e.quantity else e.quantity end amount,
           e.available_after,
           case when e.business_context_type='REGISTRATION' then 'REGISTRATION_REWARD' else 'DAILY_INSIGHT' end business_type,
           coalesce(e.business_context_id,e.business_key) resource_id,e.original_entry_id::text original_id,
           case e.entry_type when 'GRANT' then '智慧种子入账' when 'RESERVE' then '智慧种子预留'
             when 'CONSUME' then '智慧种子消费' when 'RELEASE' then '智慧种子释放'
             when 'RESTORE' then '智慧种子恢复' when 'EXPIRE' then '智慧种子到期' else '智慧种子调整' end title,
           e.created_at
         from complimentary_seed_entries e
         where e.owner_user_id=$1 and not (e.metadata ? 'migrationVersion')
       ) combined ${cursorSql} order by created_at desc,id desc limit $${values.length}`,
      values,
    );
    return {
      rows: result.rows.slice(0, limit).map((row) => ({
        transactionId: row.id,
        type: row.type,
        amount: row.amount,
        balanceAfter: row.available_after,
        businessType: row.business_type,
        resourceId: row.resource_id,
        originalTransactionId: row.original_id,
        title: row.title,
        createdAt: row.created_at.toISOString(),
      })),
      hasMore: result.rows.length > limit,
    };
  }

  async migrateLegacyAccount(ownerUserId: string, requestId: string): Promise<SeedMigrationReport> {
    return this.transaction(async (client) => {
      await advisoryLock(client, `seed-migration:${ownerUserId}`);
      const legacyResult = await client.query<{
        id: string;
        available: number;
        reserved: number;
        total_earned: string;
        total_spent: string;
      }>(
        `select id,available,reserved,total_earned::text,total_spent::text from seed_accounts where user_id=$1 for update`,
        [ownerUserId],
      );
      const legacy = legacyResult.rows[0];
      if (!legacy)
        throw new ComplimentarySeedError('SEED_ACCOUNT_NOT_FOUND', 'Legacy seed account was not found');
      const sourceId = `legacy-account:${legacy.id}`;
      const existing = await client.query<GrantRow>(
        `select * from complimentary_seed_grants where owner_user_id=$1 and source_type='MIGRATION' and source_id=$2`,
        [ownerUserId, sourceId],
      );
      let grantId = existing.rows[0]?.id ?? null;
      let state: SeedMigrationReport['state'] = legacy.reserved > 0 ? 'BLOCKED' : 'REPLAYED';
      if (!grantId && legacy.available + legacy.reserved > 0) {
        grantId = randomUUID();
        const total = legacy.available + legacy.reserved;
        await client.query(
          `insert into complimentary_seed_grants (id,owner_user_id,business_space,source_type,source_id,applicable_services,total_quantity,available_quantity,reserved_quantity,status,effective_at,expires_at,granted_at,expiry_timezone,rule_version,migration_version,request_id) values($1,$2,'SATORI','MIGRATION',$3,$4,$5,$6,$7,case when $6>0 then 'ACTIVE' else 'EXHAUSTED' end,now(),null,now(),null,'legacy-opening-v1','legacy-seed-opening-v1',$8)`,
          [
            grantId,
            ownerUserId,
            sourceId,
            JSON.stringify(['DAILY_INSIGHT', 'CARD_READING']),
            total,
            legacy.available,
            legacy.reserved,
            requestId,
          ],
        );
        await append(client, {
          grantId,
          ownerUserId,
          businessSpace: 'SATORI',
          entryType: 'GRANT',
          quantity: total,
          availableAfter: total,
          reservedAfter: 0,
          businessKey: `${sourceId}:GRANT`,
          requestId,
          context: { type: 'LEGACY_SEED_ACCOUNT', id: legacy.id },
          metadata: { migrationVersion: 'legacy-seed-opening-v1' },
        });
        if (legacy.reserved > 0)
          await append(client, {
            grantId,
            ownerUserId,
            businessSpace: 'SATORI',
            entryType: 'RESERVE',
            quantity: legacy.reserved,
            availableAfter: legacy.available,
            reservedAfter: legacy.reserved,
            businessKey: `${sourceId}:RESERVED_OPENING`,
            reservationId: randomUUID(),
            requestId,
            context: { type: 'LEGACY_SEED_ACCOUNT', id: legacy.id },
            metadata: { migrationVersion: 'legacy-seed-opening-v1', openingReservation: true },
          });
        state = legacy.reserved > 0 ? 'BLOCKED' : 'MIGRATED';
      }
      await client.query(
        `insert into complimentary_seed_account_projections (owner_user_id,business_space,available_quantity,reserved_quantity,total_granted,total_consumed,version) values($1,'SATORI',$2,$3,$4,$5,1) on conflict(owner_user_id) do update set available_quantity=excluded.available_quantity,reserved_quantity=excluded.reserved_quantity,total_granted=excluded.total_granted,total_consumed=excluded.total_consumed,version=complimentary_seed_account_projections.version+1,updated_at=now()`,
        [
          ownerUserId,
          legacy.available,
          legacy.reserved,
          Number(legacy.total_earned),
          Number(legacy.total_spent),
        ],
      );
      const projection = await client.query<AccountRow>(
        `select * from complimentary_seed_account_projections where owner_user_id=$1`,
        [ownerUserId],
      );
      const batch = {
        available: projection.rows[0]!.available_quantity,
        reserved: projection.rows[0]!.reserved_quantity,
        totalEarned: Number(projection.rows[0]!.total_granted),
        totalSpent: Number(projection.rows[0]!.total_consumed),
      };
      const legacyTotals = {
        available: legacy.available,
        reserved: legacy.reserved,
        totalEarned: Number(legacy.total_earned),
        totalSpent: Number(legacy.total_spent),
      };
      const consistent =
        batch.available === legacyTotals.available &&
        batch.reserved === legacyTotals.reserved &&
        batch.totalEarned === legacyTotals.totalEarned &&
        batch.totalSpent === legacyTotals.totalSpent;
      return {
        ownerUserId,
        state: consistent ? state : 'BLOCKED',
        legacy: legacyTotals,
        batch,
        consistent,
        grantId,
      };
    });
  }

  async reconcile(ownerUserId: string) {
    const result = await this.infrastructure.pool.query<{
      account_available: number;
      account_reserved: number;
      grant_available: number;
      grant_reserved: number;
      entry_mismatches: number;
    }>(
      `select p.available_quantity as account_available,p.reserved_quantity as account_reserved,
         coalesce(g.available,0)::int as grant_available,coalesce(g.reserved,0)::int as grant_reserved,
         coalesce(e.mismatches,0)::int as entry_mismatches
       from complimentary_seed_account_projections p
       left join lateral (
         select sum(available_quantity) available,sum(reserved_quantity) reserved
         from complimentary_seed_grants where owner_user_id=p.owner_user_id
       ) g on true
       left join lateral (
         select count(*) mismatches from complimentary_seed_grants grant_row
         left join lateral (
           select available_after,reserved_after from complimentary_seed_entries
           where grant_id=grant_row.id order by created_at desc,id desc limit 1
         ) latest on true
         where grant_row.owner_user_id=p.owner_user_id
           and (latest.available_after is distinct from grant_row.available_quantity
             or latest.reserved_after is distinct from grant_row.reserved_quantity)
       ) e on true
       where p.owner_user_id=$1`,
      [ownerUserId],
    );
    const row = result.rows[0];
    if (!row)
      throw new ComplimentarySeedError('SEED_ACCOUNT_NOT_FOUND', 'Seed batch projection was not found');
    return {
      ownerUserId,
      consistent:
        row.account_available === row.grant_available &&
        row.account_reserved === row.grant_reserved &&
        row.entry_mismatches === 0,
      account: { available: row.account_available, reserved: row.account_reserved },
      grants: { available: row.grant_available, reserved: row.grant_reserved },
      entryProjectionMismatches: row.entry_mismatches,
    };
  }

  async listGrants(ownerUserId: string) {
    const result = await this.infrastructure.pool.query<GrantRow>(
      `select * from complimentary_seed_grants where owner_user_id=$1 order by expires_at asc nulls last,granted_at,id`,
      [ownerUserId],
    );
    return result.rows.map(mapGrant);
  }

  private async lockAccount(client: PoolClient, ownerUserId: string, businessSpace: string) {
    await client.query(
      `insert into complimentary_seed_account_projections (owner_user_id,business_space) values($1,$2) on conflict(owner_user_id) do nothing`,
      [ownerUserId, businessSpace],
    );
    const result = await client.query<AccountRow>(
      `select * from complimentary_seed_account_projections where owner_user_id=$1 for update`,
      [ownerUserId],
    );
    return result.rows[0]!;
  }

  private async updateAccount(
    client: PoolClient,
    account: AccountRow,
    available: number,
    reserved: number,
    grantedDelta: number,
    consumedDelta: number,
  ) {
    if (available < 0 || reserved < 0 || Number(account.total_consumed) + consumedDelta < 0)
      throw new ComplimentarySeedError(
        'SEED_LEDGER_INVARIANT_VIOLATION',
        'Seed projection would become negative',
      );
    await client.query(
      `update complimentary_seed_account_projections set available_quantity=$2,reserved_quantity=$3,total_granted=total_granted+$4,total_consumed=total_consumed+$5,version=version+1,updated_at=now() where owner_user_id=$1`,
      [account.owner_user_id, available, reserved, grantedDelta, consumedDelta],
    );
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>) {
    const client = await this.infrastructure.pool.connect();
    try {
      await client.query('begin');
      const value = await work(client);
      await client.query('commit');
      return value;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}

interface GrantRow {
  id: string;
  owner_user_id: string;
  business_space: string;
  source_type: string;
  source_id: string;
  applicable_services: ServiceType[];
  total_quantity: number;
  available_quantity: number;
  reserved_quantity: number;
  status: string;
  effective_at: Date;
  expires_at: Date | null;
  granted_at: Date;
  rule_version: string;
  migration_version: string | null;
}
interface AccountRow {
  owner_user_id: string;
  business_space: string;
  available_quantity: number;
  reserved_quantity: number;
  total_granted: number;
  total_consumed: number;
  updated_at: Date;
}
interface AllocationRow {
  id: string;
  grant_id: string;
  owner_user_id: string;
  reservation_id: string;
  consumption_intent_id: string | null;
  quantity: number;
  status: string;
  expires_at: Date | null;
  created_at: Date;
}
interface AppendSeed {
  grantId: string;
  ownerUserId: string;
  businessSpace: string;
  entryType: string;
  quantity: number;
  availableAfter: number;
  reservedAfter: number;
  businessKey: string;
  reservationId?: string | undefined;
  consumptionIntentId?: string | undefined;
  context: BusinessContext;
  requestId: string;
  metadata?: Readonly<Record<string, unknown>>;
}

async function append(client: PoolClient, input: AppendSeed) {
  await client.query(
    `insert into complimentary_seed_entries (id,grant_id,owner_user_id,business_space,entry_type,quantity,available_after,reserved_after,business_key,reservation_id,consumption_intent_id,business_context_type,business_context_id,request_id,metadata,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,clock_timestamp())`,
    [
      randomUUID(),
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
      input.context.type,
      input.context.id,
      input.requestId,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}
async function advisoryLock(client: PoolClient, key: string) {
  await client.query(`select pg_advisory_xact_lock(hashtextextended($1,0))`, [key]);
}
function assertScopes(scopes: readonly ServiceType[]) {
  if (scopes.length === 0 || scopes.some((scope) => !['DAILY_INSIGHT', 'CARD_READING'].includes(scope)))
    throw new ComplimentarySeedError('INVALID_SEED_SCOPE', 'At least one approved service scope is required');
}
function sameStrings(left: readonly string[], right: readonly string[]) {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((value, index) => value === sortedRight[index])
  );
}
function allocationView(rows: readonly AllocationRow[]): SeedReservationView {
  return {
    reservationId: rows[0]!.reservation_id,
    quantity: rows.reduce((sum, row) => sum + row.quantity, 0),
    allocations: rows.map((row) => ({ grantId: row.grant_id, quantity: row.quantity })),
    expiresAt:
      rows
        .map((row) => row.expires_at)
        .filter((value): value is Date => Boolean(value))
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? null,
  };
}
function mapGrant(row: GrantRow): ComplimentarySeedGrantView {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    businessSpace: row.business_space,
    sourceType: row.source_type as ComplimentarySeedGrantView['sourceType'],
    sourceId: row.source_id,
    applicableServices: row.applicable_services,
    totalQuantity: row.total_quantity,
    availableQuantity: row.available_quantity,
    reservedQuantity: row.reserved_quantity,
    status: row.status,
    effectiveAt: row.effective_at,
    expiresAt: row.expires_at,
    grantedAt: row.granted_at,
    ruleVersion: row.rule_version,
    migrationVersion: row.migration_version,
  };
}
