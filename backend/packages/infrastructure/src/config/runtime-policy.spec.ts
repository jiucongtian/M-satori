import { describe, expect, it } from 'vitest';
import { HOME_ENERGY_PREWARM_PROFILES, R1_RUNTIME_POLICY } from './runtime-policy.js';

describe('R1 runtime policy', () => {
  it('keeps security, reliability, and business rules versioned in code', () => {
    expect(R1_RUNTIME_POLICY.version).toMatch(/^r1\.0-/);
    expect(R1_RUNTIME_POLICY.auth.otpTtlSeconds).toBe(300);
    expect(R1_RUNTIME_POLICY.idempotency.ttlSeconds).toBe(604_800);
    expect(R1_RUNTIME_POLICY.queue.maxAttempts).toBe(5);
    expect(R1_RUNTIME_POLICY.dailyInsight.price).toBe(1);
    expect(R1_RUNTIME_POLICY.registration.rewardAmount).toBe(18);
    expect(R1_RUNTIME_POLICY.accountDeletion.cancellationHours).toBe(168);
  });

  it('provides bounded home-energy prewarm profiles', () => {
    expect(Object.keys(HOME_ENERGY_PREWARM_PROFILES)).toEqual(['CONSERVATIVE', 'NORMAL']);
    expect(HOME_ENERGY_PREWARM_PROFILES.CONSERVATIVE.concurrency).toBeLessThan(
      HOME_ENERGY_PREWARM_PROFILES.NORMAL.concurrency,
    );
    expect(HOME_ENERGY_PREWARM_PROFILES.NORMAL).toEqual({
      days: 3,
      concurrency: 3,
      spacingMs: 5_000,
      intervalMs: 3_600_000,
    });
  });
});
