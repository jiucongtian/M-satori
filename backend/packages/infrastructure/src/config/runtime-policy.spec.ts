import { describe, expect, it } from 'vitest';
import { R1_RUNTIME_POLICY } from './runtime-policy.js';

describe('R1 runtime policy', () => {
  it('keeps security, reliability, and business rules versioned in code', () => {
    expect(R1_RUNTIME_POLICY.version).toMatch(/^r1\.0-/);
    expect(R1_RUNTIME_POLICY.auth.otpTtlSeconds).toBe(300);
    expect(R1_RUNTIME_POLICY.idempotency.ttlSeconds).toBe(604_800);
    expect(R1_RUNTIME_POLICY.queue.maxAttempts).toBe(5);
    expect(R1_RUNTIME_POLICY.aqua.dailyInsight.workflowId).toBe('daily-insight');
    expect(R1_RUNTIME_POLICY.dailyInsight.price).toBe(1);
    expect(R1_RUNTIME_POLICY.registration.rewardAmount).toBe(18);
    expect(R1_RUNTIME_POLICY.accountDeletion.cancellationHours).toBe(168);
  });

  it('keeps one reviewed home-energy execution policy', () => {
    expect(R1_RUNTIME_POLICY.aqua.homeEnergySummary).toMatchObject({
      workflowId: 'daily-energy-home-summary',
      workflowVersion: 'daily-energy-home-summary/1.0.3',
      requestTimeoutMs: 15_000,
      maxAttempts: 2,
      retryBackoffMs: 250,
    });
    expect(R1_RUNTIME_POLICY.aqua.homeEnergySummary.prewarm).toEqual({
      days: 3,
      concurrency: 3,
      spacingMs: 5_000,
      intervalMs: 3_600_000,
    });
  });
});
