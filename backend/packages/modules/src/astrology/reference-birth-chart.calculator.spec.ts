import type { BirthInput, StandardLocation } from '@satori/application';
import { describe, expect, it } from 'vitest';
import { ReferenceBirthChartCalculator } from './reference-birth-chart.calculator.js';

const location: StandardLocation = {
  locationId: 'loc_cn_330100',
  displayName: '中国 浙江省 杭州市',
  countryCode: 'CN',
  administrativePath: ['浙江省', '杭州市'],
  timezone: 'Asia/Shanghai',
  coordinates: { latitude: 30.2741, longitude: 120.1551 },
};

const input: BirthInput = {
  calendarType: 'SOLAR',
  date: { year: 1990, month: 5, day: 20, isLeapMonth: false },
  timePrecision: 'EXACT_MINUTE',
  time: { localTime: '13:25', hourBranchCode: null },
  locationId: location.locationId,
  calculationGender: 'MALE',
};

describe('reference birth chart calculator', () => {
  const calculator = new ReferenceBirthChartCalculator();

  it('matches the frozen Hangzhou golden case', () => {
    const result = calculator.calculate(input, location);
    expect(result.calculationPreview.calendarConversion.solarDate).toBe('1990-05-20');
    expect(result.calculationPreview.pillars).toEqual({
      year: '庚午',
      month: '辛巳',
      day: '乙酉',
      hour: '壬午',
    });
    expect(result.normalizedBirthData.trueSolarOffsetMinutes).toBe(-56);
    expect(result.algorithmVersion).toContain('lunar-typescript/1.7.8');
  });

  it('does not expose a guessed hour pillar for DATE_ONLY', () => {
    const result = calculator.calculate(
      { ...input, timePrecision: 'DATE_ONLY', time: { localTime: null, hourBranchCode: null } },
      location,
    );
    expect(result.calculationPreview.pillars.hour).toBeNull();
    expect(result.calculationPreview.certainty).toBe('LOW');
    expect(result.warnings).not.toHaveLength(0);
  });

  it('converts the matching lunar date to the same solar date', () => {
    const result = calculator.calculate(
      {
        ...input,
        calendarType: 'LUNAR',
        date: { year: 1990, month: 4, day: 26, isLeapMonth: false },
      },
      location,
    );
    expect(result.normalizedBirthData.solarDate).toBe('1990-05-20');
    expect(result.calculationPreview.pillars.day).toBe('乙酉');
  });

  it('requires enhanced confirmation when true solar time crosses a date boundary', () => {
    const result = calculator.calculate(
      { ...input, time: { localTime: '00:10', hourBranchCode: null } },
      {
        ...location,
        locationId: 'loc_cn_510100',
        displayName: '中国 四川省 成都市',
        coordinates: { latitude: 30.5728, longitude: 104.0668 },
      },
    );
    expect(result.normalizedBirthData.crossesCalendarDate).toBe(true);
    expect(result.requiresEnhancedConfirmation).toBe(true);
  });
});
