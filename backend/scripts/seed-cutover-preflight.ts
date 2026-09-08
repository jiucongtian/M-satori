import { SEED_ENTRY_PROJECTION_SQL } from '../packages/modules/src/complimentary-seed/repository-adapter/seed-entry-projection.js';
import { LEGACY_REGISTRATION_COVERAGE_SQL } from '../packages/modules/src/complimentary-seed/repository-adapter/legacy-registration-coverage.js';
import type { Pool } from 'pg';

/** Run with writers paused. A populated batch account alone is not evidence of migration. */
export async function inspectSeedCutover(pool: Pool, requireMigrated = false) {
  const result = await pool.query<Record<string, string>>(`
    with grant_totals as (
      select owner_user_id, sum(available_quantity) available, sum(reserved_quantity) reserved
      from complimentary_seed_grants group by owner_user_id
    )
    select
      (select count(*) from seed_accounts)::text legacy_accounts,
      (select coalesce(sum(available),0) from seed_accounts)::text legacy_available,
      (select coalesce(sum(reserved),0) from seed_accounts)::text legacy_reserved,
      (select count(*) from seed_accounts where reserved<>0)::text accounts_with_reserved,
      (select count(*) from seed_accounts a where not exists
        (select 1 from complimentary_seed_account_projections p where p.owner_user_id=a.user_id))::text missing_batch_accounts,
      (select count(*) from complimentary_seed_account_projections p full join grant_totals g using(owner_user_id)
        where p.owner_user_id is null or p.available_quantity is distinct from coalesce(g.available,0)
        or p.reserved_quantity is distinct from coalesce(g.reserved,0))::text batch_internal_mismatches,
      (select count(*) from complimentary_seed_grants grant_row
        left join lateral (${SEED_ENTRY_PROJECTION_SQL}) replay on true
        where replay.entry_count=0 or replay.available is distinct from grant_row.available_quantity
          or replay.reserved is distinct from grant_row.reserved_quantity)::text batch_entry_mismatches,
      (select count(*) from seed_accounts a
        where not exists (select 1 from complimentary_seed_grants g where g.owner_user_id=a.user_id
          and g.source_type='MIGRATION' and g.source_id='legacy-account:' || a.id::text)
        and exists (select 1 from complimentary_seed_grants g where g.owner_user_id=a.user_id)
        and (a.available<>0 or a.reserved<>0 or a.total_earned<>0 or a.total_spent<>0)
        and not (${LEGACY_REGISTRATION_COVERAGE_SQL})
        and not exists (select 1 from complimentary_seed_account_projections p where p.owner_user_id=a.user_id
          and p.available_quantity=a.available and p.reserved_quantity=a.reserved
          and p.total_granted=a.total_earned and p.total_consumed=a.total_spent))::text ambiguous_batch_accounts,
      (select count(*) from daily_insights d left join seed_entries e on e.id=d.seed_settlement_entry_id
        where d.consumption_intent_id is null and
          (d.status in ('PENDING','GENERATING') or
            (d.status='FAILED' and d.seed_reservation_entry_id is not null
              and (e.id is null or e.type not in ('RELEASE','REFUND')))))::text unsettled_legacy_insights,
      (select count(*) from seed_accounts a where not exists
        (select 1 from complimentary_seed_account_projections p where p.owner_user_id=a.user_id)
        or (not exists (select 1 from complimentary_seed_grants g where g.owner_user_id=a.user_id)
          and exists (select 1 from complimentary_seed_account_projections p where p.owner_user_id=a.user_id
            and (p.available_quantity<>a.available or p.reserved_quantity<>a.reserved
              or p.total_granted<>a.total_earned or p.total_consumed<>a.total_spent))))::text unmigrated_accounts
  `);
  const counts = Object.fromEntries(
    Object.entries(result.rows[0]!).map(([key, value]) => [key, Number(value)]),
  );
  const blocked =
    counts.accounts_with_reserved! > 0 ||
    counts.batch_internal_mismatches! > 0 ||
    counts.batch_entry_mismatches! > 0 ||
    counts.ambiguous_batch_accounts! > 0 ||
    counts.unsettled_legacy_insights! > 0 ||
    (requireMigrated && counts.unmigrated_accounts! > 0);
  return { mode: 'READ_ONLY', requireMigrated, blocked, ...counts };
}
