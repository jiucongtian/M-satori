import { RuntimeInfrastructure } from '../packages/infrastructure/src/runtime.module.js';

type Row = {
  legacy_accounts: string;
  legacy_available: string;
  legacy_reserved: string;
  accounts_with_reserved: string;
  accounts_with_batch: string;
  missing_batch_accounts: string;
  batch_internal_mismatches: string;
};

const infrastructure = new RuntimeInfrastructure();

try {
  const result = await infrastructure.pool.query<Row>(`
    with grant_totals as (
      select owner_user_id,
        coalesce(sum(available_quantity), 0)::bigint available,
        coalesce(sum(reserved_quantity), 0)::bigint reserved
      from complimentary_seed_grants group by owner_user_id
    )
    select
      count(*)::text legacy_accounts,
      coalesce(sum(a.available), 0)::text legacy_available,
      coalesce(sum(a.reserved), 0)::text legacy_reserved,
      count(*) filter (where a.reserved > 0)::text accounts_with_reserved,
      count(*) filter (where p.owner_user_id is not null)::text accounts_with_batch,
      count(*) filter (where p.owner_user_id is null)::text missing_batch_accounts,
      count(*) filter (
        where p.owner_user_id is not null
          and (p.available_quantity is distinct from coalesce(g.available, 0)
            or p.reserved_quantity is distinct from coalesce(g.reserved, 0))
      )::text batch_internal_mismatches
    from seed_accounts a
    left join complimentary_seed_account_projections p on p.owner_user_id = a.user_id
    left join grant_totals g on g.owner_user_id = a.user_id
  `);
  const row = result.rows[0]!;
  const summary = {
    legacy_accounts: Number(row.legacy_accounts),
    legacy_available: Number(row.legacy_available),
    legacy_reserved: Number(row.legacy_reserved),
    accounts_with_reserved: Number(row.accounts_with_reserved),
    accounts_with_batch: Number(row.accounts_with_batch),
    missing_batch_accounts: Number(row.missing_batch_accounts),
    batch_internal_mismatches: Number(row.batch_internal_mismatches),
  };
  const blocked = summary.accounts_with_reserved > 0 || summary.batch_internal_mismatches > 0;
  console.info('complimentary_seed_preflight_report', { mode: 'READ_ONLY', blocked, ...summary });
  if (blocked) process.exitCode = 1;
} finally {
  await infrastructure.onApplicationShutdown();
}
