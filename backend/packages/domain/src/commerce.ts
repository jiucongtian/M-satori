export type BusinessSpace = 'SATORI';

export type ServiceType = 'DAILY_INSIGHT' | 'CARD_READING';

export type BenefitUnit = 'DAILY_INSIGHT_CREDIT' | 'READING_CREDIT' | 'SEED';

export type BenefitSourceType = 'MEMBERSHIP_ENTITLEMENT' | 'PURCHASED_ENTITLEMENT' | 'COMPLIMENTARY_SEED';

/** R1.1 抽卡问事使用智慧种子兜底时的版本化计费规则。 */
export const R1_CARD_READING_SEED_COST_RULE = {
  version: 'reading-seed-cost-r1.1-v1',
  costByCardCount: { 1: 2, 2: 3, 3: 5, 4: 7, 5: 9 },
} as const;

export interface BusinessContext {
  readonly type: string;
  readonly id: string;
}

export interface ServiceRequirement {
  readonly userId: string;
  readonly businessSpace: BusinessSpace;
  readonly serviceType: ServiceType;
  readonly quantity: number;
  readonly unit: BenefitUnit;
  readonly businessContext: BusinessContext;
  readonly attributes?: Readonly<Record<string, string | number | boolean>>;
}
