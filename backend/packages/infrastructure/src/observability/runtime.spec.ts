import type { Pool } from 'pg';
import type { Queue } from 'bullmq';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startRuntimeTelemetry } from './runtime.js';
import { metrics } from './telemetry.js';

const diagnostics = vi.hoisted(() => ({
  sample: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./database-diagnostics.js', () => ({ createDatabaseDiagnostics: () => diagnostics }));
describe('runtime snapshots', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    metrics.drain();
  });
  it('samples both queues, full interval histograms and pool gauges, then stops timers', async () => {
    vi.useFakeTimers();
    const logs = vi.spyOn(console, 'info').mockImplementation(() => {});
    const queues = ['generation', 'commerce'].map((name) => ({
      name,
      getJobCounts: vi.fn().mockResolvedValue({ waiting: 2, active: 1, failed: 0 }),
      getWorkersCount: vi.fn().mockResolvedValue(1),
      getJobs: vi.fn().mockResolvedValue([{ timestamp: Date.now() - 1000 }]),
      isPaused: vi.fn().mockResolvedValue(false),
    })) as unknown as Queue[];
    const stop = startRuntimeTelemetry(
      { totalCount: 3, idleCount: 1, waitingCount: 2, options: { max: 10 } } as Pool,
      queues,
    );
    metrics.observe('http_request_ms', 120, { route: '/tasks/:id' });
    await vi.advanceTimersByTimeAsync(15_000);
    const records = logs.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
    expect(records.filter((row) => row.event === 'queue_snapshot').map((row) => row.queue)).toEqual([
      'generation',
      'commerce',
    ]);
    expect(records.find((row) => row.event === 'runtime_snapshot')).toMatchObject({
      dbPoolWaiting: 2,
      dbPoolMax: 10,
    });
    expect(records.find((row) => row.event === 'metric_window')).toMatchObject({
      metric: 'http_request_ms',
      count: 1,
      sum: 120,
    });
    await stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(diagnostics.close).toHaveBeenCalled();
  });
  it('does not pile up Redis probes while an earlier sample is stuck', async () => {
    vi.useFakeTimers();
    const logs = vi.spyOn(console, 'info').mockImplementation(() => {});
    const getJobCounts = vi.fn(() => new Promise(() => {}));
    const queue = {
      name: 'generation',
      getJobCounts,
      getWorkersCount: vi.fn().mockResolvedValue(0),
      getJobs: vi.fn().mockResolvedValue([]),
      isPaused: vi.fn().mockResolvedValue(false),
    } as unknown as Queue;
    const stop = startRuntimeTelemetry(
      { totalCount: 0, idleCount: 0, waitingCount: 0, options: { max: 10 } } as Pool,
      [queue],
    );
    await vi.advanceTimersByTimeAsync(45_000);
    expect(getJobCounts).toHaveBeenCalledOnce();
    expect(
      logs.mock.calls
        .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
        .filter((row) => row.event === 'runtime_snapshot')
        .at(-1)!.queueSnapshotPendingMs,
    ).toBeGreaterThanOrEqual(30_000);
    await stop();
  });
});
