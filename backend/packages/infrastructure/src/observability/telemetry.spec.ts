import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  MetricWindow,
  correlation,
  correlationIds,
  errorFields,
  logEvent,
  trackActive,
  activeGauges,
} from './telemetry.js';

describe('telemetry', () => {
  afterEach(() => vi.restoreAllMocks());
  it('keeps full interval histogram counts with bounded cardinality and resets windows', () => {
    const window = new MetricWindow();
    for (const value of [1, 1, 100, 1000, 1_000_000])
      window.observe('latency', value, { route: '/tasks/:id' });
    const first = window.drain();
    expect(first.series[0]).toMatchObject({ count: 5, sum: 1_001_102, max: 1_000_000 });
    expect(first.series[0]!.buckets.reduce((sum, n) => sum + n, 0)).toBe(5);
    expect(window.drain().series).toHaveLength(0);
    for (let i = 0; i < 2050; i++) window.increment('event', { route: String(i) });
    const bounded = window.drain();
    expect(bounded.series).toHaveLength(2048);
    expect(bounded.overflow).toBe(2);
  });
  it('logs a single JSON record and excludes error bodies and non-identifier fields', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    correlation.run({ requestId: 'request-1' }, () =>
      logEvent('failure', {
        ...correlationIds({ taskId: 'task-1', token: 'secret' }),
        ...errorFields(Object.assign(new Error('secret'), { code: 'ETIMEDOUT', response: 'secret' })),
      }),
    );
    const line = String(spy.mock.calls[0]![0]);
    expect(JSON.parse(line)).toMatchObject({ requestId: 'request-1', taskId: 'task-1', code: 'ETIMEDOUT' });
    expect(line).not.toContain('secret');
    expect(line).not.toContain('\n');
    spy.mockImplementation(() => {
      throw new Error('sink unavailable');
    });
    expect(() => logEvent('safe')).not.toThrow();
  });
  it('releases active counters once even on multiple close paths', () => {
    const close = trackActive('testActive');
    expect(activeGauges().testActive).toBe(1);
    close();
    close();
    expect(activeGauges().testActive).toBe(0);
  });
});
