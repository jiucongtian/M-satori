import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { correlation, errorFields, logEvent, metrics } from './telemetry.js';

type Callable = (...args: unknown[]) => unknown;
/** Preserve pg's callback and promise forms; do not change transactions or cancellation. */
function instrumentCall(original: Callable, metric: string, fields: Record<string, string>): Callable {
  return function (this: unknown, ...args: unknown[]) {
    const started = performance.now();
    const context = correlation.getStore();
    let finished = false;
    const finish = (error?: unknown) => {
      if (finished) return;
      finished = true;
      const durationMs = performance.now() - started;
      metrics.observe(metric, durationMs, { outcome: error ? 'error' : 'ok' });
      if (error || durationMs >= (metric === 'db_acquire_ms' ? 100 : 250)) {
        logEvent(
          error ? `${metric}_failed` : `${metric}_slow`,
          { ...context, ...fields, durationMs, ...errorFields(error) },
          error ? 'warn' : 'info',
        );
      }
    };
    const last = args.at(-1);
    if (typeof last === 'function') {
      args[args.length - 1] = (...result: unknown[]) => {
        finish(result[0]);
        return correlation.run(context ?? {}, () => Reflect.apply(last as Callable, undefined, result));
      };
    }
    try {
      const result = Reflect.apply(original, this, args);
      if (result instanceof Promise)
        return result.then(
          (value: unknown) => {
            finish();
            return value;
          },
          (error: unknown) => {
            finish(error);
            throw error;
          },
        );
      return result;
    } catch (error) {
      finish(error);
      throw error;
    }
  };
}
export function instrumentDatabase(pool: Pool): void {
  pool.connect = instrumentCall(pool.connect.bind(pool) as Callable, 'db_acquire_ms', {}) as Pool['connect'];
  const seen = new WeakSet<PoolClient>();
  pool.on('connect', (client: PoolClient) => {
    if (seen.has(client)) return;
    seen.add(client);
    const original = client.query.bind(client) as Callable;
    client.query = function (this: PoolClient, ...args: unknown[]) {
      const query = args[0];
      // Custom Query/Submittable streams retain their original behavior; not used by Drizzle.
      if (query && typeof query === 'object' && 'submit' in query) return Reflect.apply(original, this, args);
      const text = typeof query === 'string' ? query : (query as { text?: unknown } | undefined)?.text;
      const sql = typeof text === 'string' ? text : '';
      // Hash only: neither literal SQL nor bind parameters enter logs or metric labels.
      const queryHash = createHash('sha256').update(sql).digest('hex').slice(0, 16);
      return Reflect.apply(instrumentCall(original, 'db_query_ms', { queryHash }), this, args);
    } as PoolClient['query'];
  });
}
