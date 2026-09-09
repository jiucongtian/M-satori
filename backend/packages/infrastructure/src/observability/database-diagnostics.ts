import { Pool } from 'pg';
import { errorFields, logEvent } from './telemetry.js';

/** One separate, time-bounded connection: diagnostics must not queue behind business SQL. */
export function createDatabaseDiagnostics(businessPool: Pool) {
  const pool = new Pool({
    ...businessPool.options,
    max: 1,
    application_name: 'satori-observability',
    connectionTimeoutMillis: 1000,
    statement_timeout: 1000,
    query_timeout: 2000,
    idleTimeoutMillis: 5000,
    allowExitOnIdle: true,
  });
  pool.on('error', (error) => logEvent('db_diagnostics_connection_error', errorFields(error), 'warn'));
  let running = false;
  return {
    async sample() {
      if (running) return;
      running = true;
      try {
        const result = await pool.query<Record<string, number>>(`select
          count(*) filter (where state = 'active')::int as active,
          count(*) filter (where wait_event_type = 'Lock')::int as lock_waiting,
          count(*) filter (where state = 'idle in transaction')::int as idle_in_transaction,
          coalesce(max(extract(epoch from (clock_timestamp() - query_start)) * 1000) filter (where state = 'active'), 0)::float8 as oldest_active_ms,
          coalesce(max(extract(epoch from (clock_timestamp() - xact_start)) * 1000), 0)::float8 as oldest_transaction_ms
          from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()`);
        logEvent('db_activity_snapshot', { ...result.rows[0], scope: 'current_database_visible_sessions' });
      } catch (error) {
        logEvent('db_activity_snapshot_failed', errorFields(error), 'warn');
      } finally {
        running = false;
      }
    },
    close: () => pool.end(),
  };
}
