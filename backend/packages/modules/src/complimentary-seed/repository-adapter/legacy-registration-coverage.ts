/** SQL boolean expression for a seed_accounts row aliased as `a`.
 * Only provable registration dual-writes qualify: every old entry must point through
 * its claimed reward to the matching new grant. New consumption must never be replayed
 * as a missing opening balance. Other mixed histories still require reconciliation.
 */
export const LEGACY_REGISTRATION_COVERAGE_SQL = `
  a.reserved=0 and a.total_spent=0 and a.available=a.total_earned
  and a.total_earned=(select coalesce(sum(e.amount),0) from seed_entries e where e.account_id=a.id)
  and not exists (
    select 1 from seed_entries e where e.account_id=a.id and (
      e.type<>'GRANT' or e.business_type<>'REGISTRATION_REWARD' or not exists (
        select 1 from registration_rewards r join complimentary_seed_grants g
          on g.owner_user_id=r.user_id and g.source_type='REGISTRATION' and g.source_id=r.id::text
        where r.user_id=a.user_id and r.seed_entry_id=e.id and r.status='CLAIMED'
          and r.amount=e.amount and g.total_quantity=e.amount
      )
    )
  )
`;
