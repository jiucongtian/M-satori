import type pg from 'pg';

export const ensureManualGrantSchema = async (pool: pg.Pool) => {
  await pool.query(`
    create table if not exists operations_pending_benefit_claims(
      id uuid primary key,
      action_request_id uuid not null unique references operations_action_requests(id),
      phone_hash varchar(128) not null,
      phone_masked varchar(20) not null,
      payload jsonb not null,
      status varchar(24) not null default 'PENDING_CLAIM' check(status in('PENDING_CLAIM','CLAIMED','CLAIM_FAILED','REVOKED')),
      claimed_user_id uuid references users(id),
      claimed_at timestamptz,
      claim_error text,
      created_at timestamptz not null default now()
    )
  `);
  await pool.query(`alter table operations_pending_benefit_claims add column if not exists claim_error text`);
  await pool.query(`alter table operations_pending_benefit_claims drop constraint if exists operations_pending_benefit_claims_status_check`);
  await pool.query(`alter table operations_pending_benefit_claims drop constraint if exists operations_pending_benefit_claims_status_ck`);
  await pool.query(`alter table operations_pending_benefit_claims add constraint operations_pending_benefit_claims_status_ck check(status in('PENDING_CLAIM','CLAIMED','CLAIM_FAILED','REVOKED'))`);
  await pool.query(`alter table membership_subscriptions alter column source_order_id drop not null`);
  await pool.query(`alter table membership_periods alter column source_order_id drop not null`);
  await pool.query(`alter table membership_subscriptions add column if not exists grant_source varchar(24) not null default 'PURCHASE'`);
  await pool.query(`alter table membership_periods add column if not exists grant_source varchar(24) not null default 'PURCHASE'`);
  await pool.query(`
    create or replace function operations_apply_manual_benefit(
      p_action_id uuid, p_owner_user_id uuid, p_payload jsonb
    ) returns jsonb language plpgsql as $$
    declare
      v_kind text := p_payload->>'kind';
      v_version uuid := nullif(p_payload->>'offeringVersionId','')::uuid;
      v_quantity integer := coalesce(nullif(p_payload->>'seedQuantity','')::integer, 0);
      v_validity integer := nullif(p_payload->>'validityDays','')::integer;
      v_plan_days integer;
      v_offering_kind text;
      v_expires_at timestamptz;
      v_subscription uuid;
      v_period uuid;
      v_active uuid;
      v_item jsonb;
      v_grant_id uuid;
      v_account_available integer;
      v_account_reserved integer;
    begin
      if p_owner_user_id is null then
        insert into operations_pending_benefit_claims(id,action_request_id,phone_hash,phone_masked,payload)
        values(gen_random_uuid(),p_action_id,p_payload->>'phoneHash',p_payload->>'phoneMasked',p_payload)
        on conflict(action_request_id) do nothing;
        return jsonb_build_object('status','PENDING_CLAIM');
      end if;

      if v_kind='SEED' then
        if v_quantity < 1 then raise exception '智慧种子数量必须大于 0'; end if;
        v_expires_at := case when v_validity is null then null else now() + make_interval(days => v_validity) end;
        insert into complimentary_seed_grants(
          id,owner_user_id,business_space,source_type,source_id,applicable_services,total_quantity,available_quantity,
          reserved_quantity,status,effective_at,expires_at,granted_at,expiry_timezone,rule_version,request_id
        ) values(
          gen_random_uuid(),p_owner_user_id,'SATORI','MANUAL',p_action_id::text,'{}'::jsonb,v_quantity,v_quantity,
          0,'ACTIVE',now(),v_expires_at,now(),'Asia/Shanghai','operations-manual-grant-v1',p_action_id
        ) on conflict(owner_user_id,source_type,source_id) do nothing returning id into v_grant_id;
        -- The user app reads this projection instead of summing grant rows.
        -- Keep the operational grant, projection and immutable ledger atomic.
        if v_grant_id is not null then
          insert into complimentary_seed_account_projections(
            owner_user_id,business_space,available_quantity,reserved_quantity,total_granted,total_consumed,version
          ) values(p_owner_user_id,'SATORI',v_quantity,0,v_quantity,0,1)
          on conflict(owner_user_id) do update set
            available_quantity=complimentary_seed_account_projections.available_quantity+excluded.available_quantity,
            total_granted=complimentary_seed_account_projections.total_granted+excluded.total_granted,
            version=complimentary_seed_account_projections.version+1,
            updated_at=now()
          returning available_quantity,reserved_quantity into v_account_available,v_account_reserved;
          insert into complimentary_seed_entries(
            id,grant_id,owner_user_id,business_space,entry_type,quantity,available_after,reserved_after,business_key,
            business_context_type,business_context_id,request_id,metadata,created_at
          ) values(
            gen_random_uuid(),v_grant_id,p_owner_user_id,'SATORI','GRANT',v_quantity,v_account_available,v_account_reserved,
            concat('manual-grant:',p_action_id::text),'MANUAL_BENEFIT_GRANT',p_action_id::text,p_action_id,
            jsonb_build_object('title','人工赠送智慧种子','source','运营平台'),clock_timestamp()
          );
        end if;
      elsif v_kind='OFFERING' then
        select o.offering_kind,coalesce(nullif(v.entitlement_spec->>'periodDays','')::integer,v.validity_days,30)
          into v_offering_kind,v_plan_days
          from offering_versions v join service_offerings o on o.id=v.offering_id where v.id=v_version;
        if v_offering_kind is null then raise exception '所选商品版本不存在'; end if;
        if v_offering_kind='MEMBERSHIP' then
          select id into v_active from membership_subscriptions
            where owner_user_id=p_owner_user_id and business_space='SATORI' and status='ACTIVE' for update;
          if v_active is not null then
            raise exception '该用户已有生效中的会员计划，请先在用户中心确认续期或升级方案';
          end if;
          v_subscription := gen_random_uuid();
          v_period := gen_random_uuid();
          insert into membership_subscriptions(
            id,owner_user_id,business_space,status,current_plan_version_id,source_order_id,grant_source,starts_at,ends_at,request_id
          ) values(v_subscription,p_owner_user_id,'SATORI','ACTIVE',v_version,null,'MANUAL_GRANT',now(),now()+make_interval(days=>v_plan_days),p_action_id);
          insert into membership_periods(
            id,subscription_id,owner_user_id,business_space,sequence,plan_version_id,source_order_id,grant_source,status,
            starts_at,ends_at,activated_at,benefits_granted_at,request_id
          ) values(v_period,v_subscription,p_owner_user_id,'SATORI',1,v_version,null,'MANUAL_GRANT','ACTIVE',now(),now()+make_interval(days=>v_plan_days),now(),now(),p_action_id);
        end if;
        select coalesce(validity_days,30) into v_validity from offering_versions where id=v_version;
        v_expires_at := now()+make_interval(days=>coalesce(v_validity,30));
        for v_item in select value from offering_versions v, jsonb_array_elements(coalesce(v.entitlement_spec->'benefits','[]'::jsonb)) where v.id=v_version loop
          insert into entitlement_grants(
            id,owner_user_id,business_space,service_type,unit,source_type,source_id,total_quantity,available_quantity,
            reserved_quantity,status,effective_at,expires_at,granted_at,expiry_timezone,rule_version,request_id
          ) values(
            gen_random_uuid(),p_owner_user_id,'SATORI',v_item->>'serviceType',v_item->>'unit',
            case when v_offering_kind='MEMBERSHIP' then 'MEMBERSHIP' else 'MANUAL' end,p_action_id::text,
            (v_item->>'quantity')::integer,(v_item->>'quantity')::integer,0,'ACTIVE',now(),v_expires_at,now(),
            'Asia/Shanghai','operations-manual-grant-v1',p_action_id
          ) on conflict(source_type,source_id,service_type) do nothing;
        end loop;
      else
        raise exception '不支持的人工赠送类型';
      end if;
      return jsonb_build_object('status','GRANTED','ownerUserId',p_owner_user_id);
    end $$
  `);
  await pool.query(`
    create or replace function operations_claim_pending_benefits() returns trigger language plpgsql as $$
    declare v_claim record;
    begin
      if new.provider <> 'PHONE' then return new; end if;
      for v_claim in select * from operations_pending_benefit_claims
        where phone_hash=new.provider_subject_hash and status='PENDING_CLAIM' for update loop
        begin
          perform operations_apply_manual_benefit(v_claim.action_request_id,new.user_id,v_claim.payload);
          update operations_pending_benefit_claims set status='CLAIMED',claimed_user_id=new.user_id,claimed_at=now(),claim_error=null
            where id=v_claim.id;
          insert into operations_audit_logs(id,actor_nickname,action,resource_type,resource_id,metadata)
          values(gen_random_uuid(),'系统','MANUAL_BENEFIT_CLAIMED','BENEFIT_GRANT',v_claim.action_request_id::text,jsonb_build_object('claimId',v_claim.id));
        exception when others then
          update operations_pending_benefit_claims set status='CLAIM_FAILED',claim_error=left(SQLERRM,500)
            where id=v_claim.id;
          insert into operations_audit_logs(id,actor_nickname,action,resource_type,resource_id,metadata)
          values(gen_random_uuid(),'系统','MANUAL_BENEFIT_CLAIM_FAILED','BENEFIT_GRANT',v_claim.action_request_id::text,jsonb_build_object('claimId',v_claim.id,'reason',left(SQLERRM,500)));
        end;
      end loop;
      return new;
    end $$
  `);
  await pool.query(`drop trigger if exists operations_claim_pending_benefits_trigger on identities`);
  await pool.query(`create trigger operations_claim_pending_benefits_trigger after insert on identities for each row execute function operations_claim_pending_benefits()`);
};

export const executeManualGrant = async (
  client: pg.PoolClient,
  actionId: string,
  payload: Record<string, unknown>,
) => {
  const found = await client.query<{ user_id: string }>(
    `select user_id from identities where provider='PHONE' and provider_subject_hash=$1 limit 1`,
    [payload.phoneHash],
  );
  const ownerUserId = found.rows[0]?.user_id ?? null;
  const result = await client.query<{ result: Record<string, unknown> }>(
    `select operations_apply_manual_benefit($1,$2,$3::jsonb) result`,
    [actionId, ownerUserId, payload],
  );
  return result.rows[0]?.result ?? { status: ownerUserId ? 'GRANTED' : 'PENDING_CLAIM' };
};
