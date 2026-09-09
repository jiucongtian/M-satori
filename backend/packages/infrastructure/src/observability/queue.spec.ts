import type { Job } from 'bullmq';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeJob } from './queue.js';
import { activeGauges, correlation, metrics } from './telemetry.js';

const job = (attemptsMade = 0) =>
  ({
    id: 'outbox-1',
    name: 'commerce.fulfillment.requested',
    data: {
      orderId: 'order-1',
      secret: 'sensitive',
      _telemetry: { requestId: 'http-1', traceId: 'http-1', outboxId: 'outbox-1' },
    },
    timestamp: Date.now() - 1000,
    attemptsMade,
    opts: { attempts: 3, delay: 100 },
  }) as Job;
describe('job telemetry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    metrics.drain();
  });
  it('carries correlation across awaits and separates first scheduling wait from execution', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const result = await observeJob('commerce', job(), async () => {
      await Promise.resolve();
      expect(correlation.getStore()).toMatchObject({
        requestId: 'http-1',
        jobId: 'outbox-1',
        orderId: 'order-1',
      });
      return 42;
    });
    expect(result).toBe(42);
    expect(activeGauges().commerceJobsActive).toBe(0);
    expect(metrics.drain().series.map((row) => row.metric)).toContain('queue_first_attempt_wait_ms');
    expect(JSON.stringify(spy.mock.calls)).not.toContain('sensitive');
  });
  it('keeps the original failure and does not call accumulated retry age queue wait', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const error = Object.assign(new Error('sensitive'), { code: 'TEMPORARY' });
    await expect(observeJob('commerce', job(2), () => Promise.reject(error))).rejects.toBe(error);
    const failure = spy.mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .find((row) => row.event === 'queue_job_failed');
    expect(failure).toMatchObject({ attempt: 3, attemptsExhausted: true, code: 'TEMPORARY' });
    expect(metrics.drain().series.map((row) => row.metric)).not.toContain('queue_first_attempt_wait_ms');
    expect(activeGauges().commerceJobsActive).toBe(0);
  });
});
