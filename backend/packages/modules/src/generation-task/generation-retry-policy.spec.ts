import { describe, expect, it } from 'vitest';
import { canManuallyRetryGeneration } from './generation-retry-policy.js';

describe('manual task recovery', () => {
  const task = { status: 'FAILED', targetType: 'DAILY_INSIGHT', failure: { code: 'SKILL_VERSION_MISMATCH', retryable: false } };
  it('allows the repaired daily workflow to retry its original task', () => {
    expect(canManuallyRetryGeneration(task)).toBe(true);
  });
  it('does not reopen running, completed or cancelled tasks', () => {
    for (const status of ['QUEUED', 'RUNNING', 'SUCCEEDED', 'CANCELLED']) {
      expect(canManuallyRetryGeneration({ ...task, status })).toBe(false);
    }
  });
  it('keeps unrelated permanent failures and conflicts blocked', () => {
    expect(canManuallyRetryGeneration({ ...task, targetType: 'CARD_READING' })).toBe(false);
    expect(canManuallyRetryGeneration({ ...task, failure: null })).toBe(false);
    expect(canManuallyRetryGeneration({ ...task, failure: { code: 'INVALID_INPUT', retryable: false } })).toBe(false);
    expect(canManuallyRetryGeneration({ ...task, failure: { code: 'IDEMPOTENCY_CONFLICT', retryable: true } })).toBe(false);
  });
  it('preserves retryable failures', () => {
    expect(canManuallyRetryGeneration({ ...task, failure: { retryable: true } })).toBe(true);
  });
});
