import { EventEmitter } from 'node:events';
import type { Pool, PoolClient } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { instrumentDatabase } from './database.js';
import { correlation, metrics } from './telemetry.js';

describe('database telemetry compatibility', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    metrics.drain();
  });
  it('keeps callbacks, promises, SQL parameters and errors intact while restoring checkout context', async () => {
    const pool = new EventEmitter() as Pool;
    let connectCallback: ((error: unknown, client: unknown, release: unknown) => void) | undefined;
    const release = vi.fn();
    const queryError = Object.assign(new Error('sensitive bind parameter'), { code: '23505' });
    const original = vi.fn((...args: unknown[]) => {
      const callback = args.at(-1);
      const error = args[0] === 'bad' ? queryError : undefined;
      if (typeof callback === 'function') {
        queueMicrotask(() => {
          (callback as (...values: unknown[]) => unknown)(error, { rows: [1] });
        });
        return;
      }
      return error ? Promise.reject(error) : Promise.resolve({ rows: [1] });
    });
    const client = { query: original } as unknown as PoolClient;
    pool.connect = vi.fn((callback?: typeof connectCallback) => {
      if (callback) {
        connectCallback = callback;
        return;
      }
      return Promise.resolve(client);
    }) as Pool['connect'];
    instrumentDatabase(pool);
    pool.emit('connect', client);
    pool.emit('connect', client);
    const logs = vi.spyOn(console, 'info').mockImplementation(() => {});
    let context: unknown;
    correlation.run({ requestId: 'request-B' }, () => {
      pool.connect((_error, _client, done) => {
        context = correlation.getStore();
        done();
      });
    });
    correlation.run({ requestId: 'request-A' }, () => connectCallback!(undefined, client, release));
    expect(context).toEqual({ requestId: 'request-B' });
    expect(release).toHaveBeenCalledOnce();
    expect(await pool.connect()).toBe(client);
    const params = ['secret'];
    expect(await client.query('select $1', params)).toEqual({ rows: [1] });
    expect(original).toHaveBeenCalledWith('select $1', params);
    await new Promise<void>((resolve) =>
      client.query('bad', (error) => {
        expect(error).toBe(queryError);
        resolve();
      }),
    );
    await expect(client.query('bad')).rejects.toBe(queryError);
    const rows = metrics.drain().series;
    expect(
      rows.filter((row) => row.metric === 'db_acquire_ms').reduce((sum, row) => sum + row.count, 0),
    ).toBe(2);
    expect(rows.filter((row) => row.metric === 'db_query_ms').reduce((sum, row) => sum + row.count, 0)).toBe(
      3,
    );
    expect(JSON.stringify(logs.mock.calls)).not.toMatch(/sensitive|secret|select \$1/);
  });
});
