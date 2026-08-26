export const HOME_ENERGY_SUMMARY_GENERATOR = Symbol('HOME_ENERGY_SUMMARY_GENERATOR');
export const SEXAGENARY_CYCLE = Object.freeze(
  Array.from({ length: 60 }, (_, index) => {
    const stems = '甲乙丙丁戊己庚辛壬癸';
    const branches = '子丑寅卯辰巳午未申酉戌亥';
    return `${stems[index % stems.length]}${branches[index % branches.length]}`;
  }),
);

export interface HomeEnergySummaryInput {
  runReference: string;
  userName?: string;
  dayCard: string;
  heavenCard: string;
  date: string;
}

export interface HomeEnergySummary {
  greeting: string;
  guidance: string;
  energyLevel: '高' | '中' | '低';
  suitableActions: string[];
  cautions: string[];
  date: string;
  dayCard: string;
  heavenCard: string;
  score: number;
  signals: string[];
  ruleVersion: string;
  copyVersion: string;
}

export interface HomeEnergySummaryGenerationResult {
  summary: HomeEnergySummary;
  providerRequestId: string;
}

export interface HomeEnergySummaryGenerator {
  generate(input: HomeEnergySummaryInput): Promise<HomeEnergySummaryGenerationResult>;
}
