import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('performance log report', () => {
  it('merges interval buckets across instances instead of averaging percentiles', () => {
    const row = {
      event: 'metric_window',
      metric: 'http_request_ms',
      labels: { route: '/tasks/:id' },
      windowStart: '2026-09-09T00:00:00Z',
      windowEnd: '2026-09-09T00:00:15Z',
      boundsMs: [10, 100],
      buckets: [99, 0, 0],
      count: 99,
      sum: 990,
      max: 10,
    };
    const second = { ...row, instance: 'second', count: 1, sum: 100, max: 100, buckets: [0, 1, 0] };
    const input = [
      'Nest startup',
      JSON.stringify(row),
      JSON.stringify({ log: JSON.stringify(second) }),
      JSON.stringify({ event: 'runtime_snapshot', dbPoolWaiting: 8, droppedLogs: 2 }),
    ].join('\n');
    const result = JSON.parse(
      execFileSync(process.execPath, ['scripts/summarize-performance.mjs'], { input, encoding: 'utf8' }),
    ) as { durationMetrics: unknown[]; peaks: Record<string, number>; droppedLogs: number };
    expect(result.durationMetrics[0]).toMatchObject({
      count: 100,
      meanMs: 10.9,
      p95UpperBoundMs: 10,
      p99UpperBoundMs: 10,
      maxMs: 100,
    });
    expect(result.peaks.dbPoolWaiting).toBe(8);
    expect(result.droppedLogs).toBe(2);
  });
});
