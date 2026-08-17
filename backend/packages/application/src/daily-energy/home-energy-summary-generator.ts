export const HOME_ENERGY_SUMMARY_GENERATOR = Symbol('HOME_ENERGY_SUMMARY_GENERATOR');
export const HOME_ENERGY_WORKFLOW_VERSION = 'daily-energy-home-summary/1.0.3';

export interface HomeEnergySummaryInput {
  userId: string;
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
