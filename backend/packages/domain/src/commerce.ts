export type BusinessSpace = 'SATORI';

export type ServiceType = 'DAILY_INSIGHT' | 'CARD_READING';

export type BenefitUnit = 'DAILY_INSIGHT_CREDIT' | 'READING_CREDIT' | 'SEED';

export type BenefitSourceType = 'MEMBERSHIP_ENTITLEMENT' | 'PURCHASED_ENTITLEMENT' | 'COMPLIMENTARY_SEED';

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
