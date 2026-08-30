import { describe, expect, it } from 'vitest';
import { calculateLocalBaziDayV13, calculateLocalBaziV13 } from './local-bazi-v1-3.js';

describe('localCalculateBazi v1.3 port', () => {
  it('matches the source calculator golden case', () => {
    expect(calculateLocalBaziV13({ year: 1990, month: 5, day: 20, hour: 13, minute: 25 })).toEqual({
      year: '庚午',
      month: '辛巳',
      day: '乙酉',
      hour: '癸未',
    });
  });

  it('uses the full v1.3 converter as the business date-to-day-pillar entry point', () => {
    expect(calculateLocalBaziDayV13(1990, 5, 20)).toBe('乙酉');
    expect(calculateLocalBaziDayV13(2026, 8, 13)).toBe('己未');
  });

  it('treats a solar term inside the birth shichen as after the term', () => {
    // 2026 立春为 2 月 4 日 04:02，落在寅时（03:00-05:00）内。
    expect(calculateLocalBaziV13({ year: 2026, month: 2, day: 4, hour: 3, minute: 1 })).toMatchObject({
      year: '丙午',
      month: '庚寅',
      hour: '丙寅',
    });
  });

  it('keeps the preceding pillar when the whole shichen is before the term', () => {
    expect(calculateLocalBaziV13({ year: 2026, month: 2, day: 4, hour: 1, minute: 1 })).toMatchObject({
      year: '乙巳',
      month: '己丑',
      hour: '乙丑',
    });
  });
});
