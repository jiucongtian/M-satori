import type { StandardLocation } from '../locations/location-provider.js';

export type CalendarType = 'SOLAR' | 'LUNAR';
export type TimePrecision = 'EXACT_MINUTE' | 'APPROXIMATE' | 'HOUR_RANGE' | 'DATE_ONLY';
export type HourBranch =
  'ZI' | 'CHOU' | 'YIN' | 'MAO' | 'CHEN' | 'SI' | 'WU' | 'WEI' | 'SHEN' | 'YOU' | 'XU' | 'HAI';

export interface BirthInput {
  calendarType: CalendarType;
  date: { year: number; month: number; day: number; isLeapMonth: boolean };
  timePrecision: TimePrecision;
  time: { localTime: string | null; hourBranchCode: HourBranch | null };
  locationId: string;
  calculationGender: 'MALE' | 'FEMALE';
}

export interface BirthChartResult {
  algorithmVersion: string;
  normalizedBirthData: {
    solarDate: string;
    civilDateTime: string | null;
    timezone: string;
    coordinates: { latitude: number; longitude: number };
    trueSolarDateTime: string | null;
    trueSolarOffsetMinutes: number | null;
    adoptedDateTime: string;
    crossesCalendarDate: boolean;
    crossesHourBranch: boolean;
  };
  calculationPreview: {
    calendarConversion: { solarDate: string; lunarDisplay: string };
    pillars: { year: string; month: string; day: string; hour: string | null };
    certainty: 'HIGH' | 'MEDIUM' | 'LOW';
  };
  requiresEnhancedConfirmation: boolean;
  warnings: string[];
}

export interface BirthChartCalculator {
  calculate(input: BirthInput, location: StandardLocation): BirthChartResult;
}

export const BIRTH_CHART_CALCULATOR = Symbol('BIRTH_CHART_CALCULATOR');
