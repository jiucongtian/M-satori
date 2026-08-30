import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { EntitlementReconciliationReport } from '../application/index.js';
import { type EntryRow, type GrantRow, replayLedger } from './support.js';

export async function reconcileEntitlements(
  client: PoolClient,
  now: Date,
  requestId: string,
): Promise<EntitlementReconciliationReport> {
  const grants = await client.query<GrantRow>(`select * from entitlement_grants order by id`);
  let openedCases = 0;
  let resolvedCases = 0;
  for (const grantRow of grants.rows) {
    const entriesResult = await client.query<EntryRow>(
      `select * from entitlement_usage_entries where grant_id=$1 order by created_at,id`,
      [grantRow.id],
    );
    const projection = replayLedger(entriesResult.rows);
    const orphanResult = await client.query<{ count: string }>(
      `select count(*)::text as count
       from entitlement_usage_entries reserve_entry
       left join entitlement_usage_entries terminal
         on terminal.reservation_id=reserve_entry.reservation_id
        and terminal.entry_type in ('COMMIT','RELEASE')
       left join consumption_intents intent on intent.id=reserve_entry.consumption_intent_id
       where reserve_entry.grant_id=$1 and reserve_entry.entry_type='RESERVE' and terminal.id is null
         and (intent.id is null or intent.status not in ('RESERVING','RESERVED','RUNNING'))`,
      [grantRow.id],
    );
    const checks = reconciliationChecks(grantRow, projection, Number(orphanResult.rows[0]?.count ?? 0));
    for (const check of checks) {
      const businessKey = `${grantRow.id}:${check.type}`;
      if (check.issue) {
        const upsert = await client.query<{ inserted: boolean }>(
          `insert into reconciliation_cases
           (id,business_space,case_type,status,severity,resource_type,resource_id,business_key,
            expected_snapshot,actual_snapshot,request_id,detected_at)
           values($1,$2,$3,'OPEN','CRITICAL','ENTITLEMENT_GRANT',$4,$5,$6,$7,$8,$9)
           on conflict (case_type,business_key) do update set status='OPEN',actual_snapshot=excluded.actual_snapshot,
             expected_snapshot=excluded.expected_snapshot,request_id=excluded.request_id,detected_at=excluded.detected_at,
             resolved_at=null,updated_at=now()
           returning (xmax = 0) as inserted`,
          [
            randomUUID(),
            grantRow.business_space,
            check.type,
            grantRow.id,
            businessKey,
            JSON.stringify(check.expected),
            JSON.stringify(check.actual),
            requestId,
            now,
          ],
        );
        if (upsert.rows[0]?.inserted) openedCases += 1;
      } else {
        const resolved = await client.query(
          `update reconciliation_cases set status='RESOLVED',resolution=$3,resolved_at=$4,updated_at=now()
           where case_type=$1 and business_key=$2 and status <> 'RESOLVED'`,
          [check.type, businessKey, JSON.stringify({ resolution: 'AUTO_VERIFIED' }), now],
        );
        resolvedCases += resolved.rowCount ?? 0;
      }
    }
  }
  return { checkedGrants: grants.rows.length, openedCases, resolvedCases };
}

function reconciliationChecks(
  grant: GrantRow,
  projection: ReturnType<typeof replayLedger>,
  orphanedReservations: number,
) {
  return [
    {
      type: 'ENTITLEMENT_LEDGER_CHAIN_MISMATCH',
      issue: projection.chainErrors.length > 0,
      expected: { chainErrors: [] },
      actual: { chainErrors: projection.chainErrors },
    },
    {
      type: 'ENTITLEMENT_PROJECTION_MISMATCH',
      issue:
        projection.total !== grant.total_quantity ||
        projection.available !== grant.available_quantity ||
        projection.reserved !== grant.reserved_quantity,
      expected: projection,
      actual: {
        total: grant.total_quantity,
        available: grant.available_quantity,
        reserved: grant.reserved_quantity,
      },
    },
    {
      type: 'ENTITLEMENT_ORPHANED_RESERVATION',
      issue: orphanedReservations > 0,
      expected: { orphanedReservations: 0 },
      actual: { orphanedReservations },
    },
  ];
}
