/** Reconstruct a grant_row's balances from all immutable entry facts.
 * Historical imports can have out-of-order timestamps; a latest snapshot alone
 * is not a reliable projection of the complete ledger.
 */
export const SEED_ENTRY_PROJECTION_SQL = `
  select count(*) entry_count,
    coalesce(sum(case
      when entry_type in ('GRANT','RELEASE','RESTORE') then quantity
      when entry_type in ('RESERVE','EXPIRE') then -quantity
      when entry_type='ADJUSTMENT' then case when metadata->>'direction'='DECREASE' then -quantity else quantity end
      else 0 end),0) available,
    coalesce(sum(case when entry_type='RESERVE' then quantity
      when entry_type in ('CONSUME','RELEASE') then -quantity else 0 end),0) reserved
  from complimentary_seed_entries where grant_id=grant_row.id
`;
