import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  BirthChartCalculator,
  BirthChartResult,
  BirthInput,
  HourBranch,
  StandardLocation,
} from '@satori/application';
import { Lunar, Solar } from 'lunar-typescript';

const branchHours: Record<HourBranch, number> = {
  ZI: 0,
  CHOU: 2,
  YIN: 4,
  MAO: 6,
  CHEN: 8,
  SI: 10,
  WU: 12,
  WEI: 14,
  SHEN: 16,
  YOU: 18,
  XU: 20,
  HAI: 22,
};

@Injectable()
export class ReferenceBirthChartCalculator implements BirthChartCalculator {
  calculate(input: BirthInput, location: StandardLocation): BirthChartResult {
    try {
      const time = resolveTime(input);
      const source =
        input.calendarType === 'SOLAR'
          ? Solar.fromYmdHms(input.date.year, input.date.month, input.date.day, time.hour, time.minute, 0)
          : Lunar.fromYmdHms(
              input.date.year,
              input.date.isLeapMonth ? -input.date.month : input.date.month,
              input.date.day,
              time.hour,
              time.minute,
              0,
            ).getSolar();
      const solarFields = {
        year: source.getYear(),
        month: source.getMonth(),
        day: source.getDay(),
        hour: source.getHour(),
        minute: source.getMinute(),
      };
      const offsetMinutes =
        input.timePrecision === 'DATE_ONLY' ? null : trueSolarOffset(solarFields, location);
      const adopted = addMinutes(solarFields, offsetMinutes ?? 0);
      const adoptedSolar = Solar.fromYmdHms(
        adopted.year,
        adopted.month,
        adopted.day,
        adopted.hour,
        adopted.minute,
        0,
      );
      const lunar = adoptedSolar.getLunar();
      const eightChar = lunar.getEightChar();
      const crossesCalendarDate =
        adopted.year !== solarFields.year ||
        adopted.month !== solarFields.month ||
        adopted.day !== solarFields.day;
      const crossesHourBranch = hourBranch(solarFields.hour) !== hourBranch(adopted.hour);
      const unknownTime = input.timePrecision === 'DATE_ONLY';
      const approximate = input.timePrecision === 'APPROXIMATE' || input.timePrecision === 'HOUR_RANGE';
      return {
        algorithmVersion: 'lunar-typescript/1.7.8+true-solar/r1.0',
        normalizedBirthData: {
          solarDate: ymd(solarFields),
          civilDateTime: unknownTime ? null : localDateTime(solarFields, location.timezone),
          timezone: location.timezone,
          coordinates: location.coordinates,
          trueSolarDateTime: unknownTime ? null : localDateTime(adopted, location.timezone),
          trueSolarOffsetMinutes: offsetMinutes === null ? null : Math.round(offsetMinutes),
          adoptedDateTime: localDateTime(adopted, location.timezone),
          crossesCalendarDate,
          crossesHourBranch,
        },
        calculationPreview: {
          calendarConversion: {
            solarDate: ymd(solarFields),
            lunarDisplay: lunar.toString(),
          },
          pillars: {
            year: eightChar.getYear(),
            month: eightChar.getMonth(),
            day: eightChar.getDay(),
            hour: unknownTime ? null : eightChar.getTime(),
          },
          certainty: unknownTime ? 'LOW' : approximate ? 'MEDIUM' : 'HIGH',
        },
        requiresEnhancedConfirmation: crossesCalendarDate || crossesHourBranch,
        warnings: [
          ...(unknownTime ? ['出生时间未知，时柱与自我关系卡存在不确定性'] : []),
          ...(approximate ? ['出生时间精度有限，结果按所填时间范围计算'] : []),
          ...(crossesCalendarDate ? ['真太阳时校正跨越自然日'] : []),
          ...(crossesHourBranch ? ['真太阳时校正跨越传统时辰边界'] : []),
        ],
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException({
        code: input.calendarType === 'LUNAR' ? 'LUNAR_DATE_INVALID' : 'BIRTH_DATE_INVALID',
        message: 'Birth date cannot be calculated',
      });
    }
  }
}

function resolveTime(input: BirthInput): { hour: number; minute: number } {
  if (input.timePrecision === 'DATE_ONLY') return { hour: 12, minute: 0 };
  if (input.timePrecision === 'HOUR_RANGE') {
    if (!input.time.hourBranchCode || input.time.localTime !== null) invalidTimeFields();
    return { hour: branchHours[input.time.hourBranchCode], minute: 0 };
  }
  if (!input.time.localTime || input.time.hourBranchCode !== null) invalidTimeFields();
  const match = /^(\d{2}):(\d{2})$/.exec(input.time.localTime);
  const hour = Number(match?.[1]);
  const minute = Number(match?.[2]);
  if (!match || hour > 23 || minute > 59) {
    throw new BadRequestException({ code: 'BIRTH_TIME_INVALID', message: 'Birth time is invalid' });
  }
  return { hour, minute };
}

function invalidTimeFields(): never {
  throw new BadRequestException({
    code: 'TIME_PRECISION_FIELDS_INVALID',
    message: 'Time fields do not match timePrecision',
  });
}

function trueSolarOffset(
  value: { year: number; month: number; day: number },
  location: StandardLocation,
): number {
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day));
  const start = new Date(Date.UTC(value.year, 0, 0));
  const dayOfYear = Math.floor((date.getTime() - start.getTime()) / 86_400_000);
  const b = ((360 / 365) * (dayOfYear - 81) * Math.PI) / 180;
  const equationOfTime = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
  const centralMeridian = timezoneOffsetHours(date, location.timezone) * 15;
  return 4 * (location.coordinates.longitude - centralMeridian) + equationOfTime;
}

function timezoneOffsetHours(date: Date, timezone: string): number {
  const value = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'longOffset',
  })
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName')?.value;
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(value ?? '');
  if (!match) throw new Error(`Timezone offset unavailable: ${timezone}`);
  const direction = match[1] === '-' ? -1 : 1;
  return direction * (Number(match[2]) + Number(match[3]) / 60);
}

function addMinutes(
  value: { year: number; month: number; day: number; hour: number; minute: number },
  minutes: number,
) {
  const date = new Date(
    Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute + Math.round(minutes)),
  );
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  };
}

function hourBranch(hour: number): number {
  return Math.floor(((hour + 1) % 24) / 2);
}

function ymd(value: { year: number; month: number; day: number }): string {
  return `${value.year}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`;
}

function localDateTime(
  value: { year: number; month: number; day: number; hour: number; minute: number },
  timezone: string,
): string {
  const offsetHours = timezoneOffsetHours(
    new Date(Date.UTC(value.year, value.month - 1, value.day, 12)),
    timezone,
  );
  const sign = offsetHours < 0 ? '-' : '+';
  const absolute = Math.abs(offsetHours);
  const offset = `${sign}${String(Math.floor(absolute)).padStart(2, '0')}:${String(Math.round((absolute % 1) * 60)).padStart(2, '0')}`;
  return `${ymd(value)}T${String(value.hour).padStart(2, '0')}:${String(value.minute).padStart(2, '0')}:00${offset}`;
}
