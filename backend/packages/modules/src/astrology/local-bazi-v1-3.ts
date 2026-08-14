import { Solar } from 'lunar-typescript';

const GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'] as const;
const ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'] as const;
const SOLAR_TERMS = [
  '小寒',
  '大寒',
  '立春',
  '雨水',
  '惊蛰',
  '春分',
  '清明',
  '谷雨',
  '立夏',
  '小满',
  '芒种',
  '夏至',
  '小暑',
  '大暑',
  '立秋',
  '处暑',
  '白露',
  '秋分',
  '寒露',
  '霜降',
  '立冬',
  '小雪',
  '大雪',
  '冬至',
] as const;

export interface LocalBaziV13Input {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export interface LocalBaziV13Result {
  year: string;
  month: string;
  day: string;
  hour: string;
}

/**
 * Port of localCalculateBazi_v1_3/core-converter/bazi-calculator.js.
 *
 * The original converter embeds minute-level solar-term data. lunar-typescript
 * exposes the same term instants, so it remains the data source here while the
 * v1.3 pillar rules (including its whole-shichen boundary rule) are preserved.
 */
export function calculateLocalBaziV13(input: LocalBaziV13Input): LocalBaziV13Result {
  const shichenHour = normalizeShichenHour(input.hour);
  const yearPillar = computeYearPillar(input, shichenHour);
  const monthPillar = computeMonthPillar(input, shichenHour, yearPillar.ganIndex);
  const dayPillar = computeDayPillar(input.year, input.month, input.day);
  return {
    year: `${yearPillar.gan}${yearPillar.zhi}`,
    month: `${monthPillar.gan}${monthPillar.zhi}`,
    day: dayPillar,
    hour: computeHourPillar(dayPillar, shichenHour),
  };
}

function computeYearPillar(input: LocalBaziV13Input, shichenHour: number) {
  const lichun = getSolarTerm(input.year, 2);
  const effectiveYear = isBirthBeforeTerm(input, shichenHour, lichun) ? input.year - 1 : input.year;
  const ganIndex = positiveModulo(effectiveYear - 4, 10);
  const zhiIndex = positiveModulo(effectiveYear - 4, 12);
  return { gan: GAN[ganIndex], zhi: ZHI[zhiIndex], ganIndex };
}

function computeMonthPillar(input: LocalBaziV13Input, shichenHour: number, yearGanIndex: number) {
  const termIndex = (input.month - 1) * 2;
  const term = getSolarTerm(input.year, termIndex);
  let effectiveSolarMonth: number;
  if (!isBirthBeforeTerm(input, shichenHour, term)) {
    effectiveSolarMonth = input.month;
  } else if (input.month === 1) {
    effectiveSolarMonth = 12;
  } else {
    effectiveSolarMonth = input.month - 1;
  }
  const zhiIndex = effectiveSolarMonth % 12;
  const startStemForYin = ((yearGanIndex % 5) * 2 + 2) % 10;
  const offset = positiveModulo(effectiveSolarMonth - 2, 12);
  const ganIndex = (startStemForYin + offset) % 10;
  return { gan: GAN[ganIndex], zhi: ZHI[zhiIndex] };
}

function computeDayPillar(year: number, month: number, day: number): string {
  // Same epoch and formula as js-calendar-converter-v2.solar2lunar().gzDay.
  const dayCyclical = Date.UTC(year, month - 1, 1) / 86_400_000 + 25_567 + 10;
  const index = positiveModulo(Math.trunc(dayCyclical + day - 1), 60);
  return `${GAN[index % 10]}${ZHI[index % 12]}`;
}

function computeHourPillar(dayPillar: string, shichenHour: number): string {
  const zhiNumber = shichenHour === 0 ? 1 : Math.floor((shichenHour + 1) / 2) + 1;
  const dayGanIndex = GAN.indexOf(dayPillar[0] as (typeof GAN)[number]);
  if (dayGanIndex < 0) throw new Error(`无效的日干：${dayPillar[0] ?? ''}`);
  const hourGanNumber = positiveModulo((dayGanIndex + 1) * 2 + zhiNumber - 3, 10) + 1;
  return `${GAN[hourGanNumber - 1]}${ZHI[zhiNumber - 1]}`;
}

function normalizeShichenHour(hour: number): number {
  if (hour >= 23 || hour < 1) return 0;
  return Math.floor((hour + 1) / 2) * 2;
}

function isBirthBeforeTerm(input: LocalBaziV13Input, shichenHour: number, term: LocalBaziV13Input): boolean {
  if (term.year === input.year && term.month === input.month && term.day === input.day) {
    const slotEndHour = shichenHour === 0 ? 1 : shichenHour + 1;
    return (
      fieldsToEpochMinute(term) >= Date.UTC(input.year, input.month - 1, input.day, slotEndHour, 0) / 60_000
    );
  }
  return fieldsToEpochMinute({ ...input, hour: shichenHour }) < fieldsToEpochMinute(term);
}

function getSolarTerm(year: number, index: number): LocalBaziV13Input {
  const termName = SOLAR_TERMS[index];
  if (!termName) throw new Error(`无效的节气索引：${index}`);
  const table = Solar.fromYmdHms(year, Math.floor(index / 2) + 1, 15, 12, 0, 0)
    .getLunar()
    .getJieQiTable();
  const term = table[termName];
  if (!term) throw new Error(`无法获取 ${year} 年${termName}时刻`);
  return {
    year: term.getYear(),
    month: term.getMonth(),
    day: term.getDay(),
    hour: term.getHour(),
    minute: term.getMinute(),
  };
}

function fieldsToEpochMinute(value: LocalBaziV13Input): number {
  return Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute) / 60_000;
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
