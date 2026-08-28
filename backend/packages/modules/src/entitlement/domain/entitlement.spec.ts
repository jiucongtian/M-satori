import { describe, expect, it } from 'vitest';
import { calculateNaturalDayExpiry, EntitlementLedgerError } from './index.js';

describe('entitlement natural-day expiry', () => {
  it('counts the Shanghai purchase date as day one', () => {
    expect(calculateNaturalDayExpiry(new Date('2026-08-28T15:59:59.000Z'), 30).toISOString()).toBe(
      '2026-09-26T15:59:59.999Z',
    );
    expect(calculateNaturalDayExpiry(new Date('2026-08-28T16:00:00.000Z'), 30).toISOString()).toBe(
      '2026-09-27T15:59:59.999Z',
    );
  });

  it('handles month and year boundaries without server-timezone dependence', () => {
    expect(calculateNaturalDayExpiry(new Date('2026-12-31T15:00:00.000Z'), 2).toISOString()).toBe(
      '2027-01-01T15:59:59.999Z',
    );
  });

  it('rejects zero, negative and fractional validity', () => {
    for (const days of [0, -1, 1.5]) {
      expect(() => calculateNaturalDayExpiry(new Date('2026-08-28T00:00:00.000Z'), days)).toThrow(
        EntitlementLedgerError,
      );
    }
  });
});
