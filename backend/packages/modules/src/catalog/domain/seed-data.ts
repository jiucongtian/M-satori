export interface CatalogSeedDefinition {
  readonly version?: number;
  readonly code: string;
  readonly serviceType: 'DAILY_INSIGHT' | 'CARD_READING';
  readonly offeringKind: 'SINGLE' | 'PACKAGE' | 'MEMBERSHIP';
  readonly displayName: string;
  readonly description: string;
  readonly amountMinor: number;
  readonly validityDays: number;
  readonly entitlementSpec: Readonly<Record<string, unknown>>;
  readonly purchaseLimit: Readonly<Record<string, unknown>>;
  readonly promotion?: {
    readonly minimumSeedBalance: number;
    readonly reservedSeedQuantity: number;
    readonly activityAmountMinor: number;
  };
}

const common = {
  refundPolicyVersion: 'r11-unused-only-v1',
  refundPolicy: { eligibility: 'UNUSED_ONLY', refundableBasisPoints: 10_000 },
  termsVersion: 'r11-commerce-terms-v1',
} as const;

export const R11_CATALOG_SEED: readonly (CatalogSeedDefinition & typeof common)[] = [
  {
    code: 'daily-insight-single',
    serviceType: 'DAILY_INSIGHT',
    offeringKind: 'SINGLE',
    displayName: '今日能量·单次',
    description: '1 次当天完整指引',
    amountMinor: 190,
    validityDays: 1,
    entitlementSpec: {
      benefits: [{ serviceType: 'DAILY_INSIGHT', unit: 'DAILY_INSIGHT_CREDIT', quantity: 1 }],
    },
    purchaseLimit: { displayChannels: ['SHORTAGE'] },
    ...common,
  },
  {
    code: 'daily-insight-newcomer-10',
    serviceType: 'DAILY_INSIGHT',
    offeringKind: 'PACKAGE',
    displayName: '今日能量·10次体验',
    description: '10 次完整指引，30 天有效',
    amountMinor: 990,
    validityDays: 30,
    entitlementSpec: {
      benefits: [{ serviceType: 'DAILY_INSIGHT', unit: 'DAILY_INSIGHT_CREDIT', quantity: 10 }],
    },
    purchaseLimit: { lifetime: 1, audience: 'NEW_CUSTOMER', displayChannels: ['STORE', 'SHORTAGE'] },
    ...common,
  },
  {
    code: 'card-reading-single',
    serviceType: 'CARD_READING',
    offeringKind: 'SINGLE',
    displayName: '抽卡问事·单次',
    description: '1 份完整问事报告',
    amountMinor: 990,
    validityDays: 30,
    entitlementSpec: { benefits: [{ serviceType: 'CARD_READING', unit: 'READING_CREDIT', quantity: 1 }] },
    purchaseLimit: { displayChannels: ['SHORTAGE'] },
    ...common,
  },
  {
    code: 'card-reading-10',
    serviceType: 'CARD_READING',
    offeringKind: 'PACKAGE',
    displayName: '抽卡问事·10次包',
    description: '10 份完整问事报告，90 天有效',
    amountMinor: 5_990,
    validityDays: 90,
    entitlementSpec: { benefits: [{ serviceType: 'CARD_READING', unit: 'READING_CREDIT', quantity: 10 }] },
    purchaseLimit: { recommended: true, displayChannels: ['STORE', 'SHORTAGE'] },
    ...common,
  },
  membership('glow', '微光计划', 1_290, 7, 3, 30, 1_090),
  membership('serenity', '清和计划', 2_490, 15, 5, 80, 2_190, true),
  membership('freedom', '自在计划', 3_990, 30, 8, 168, 3_490),
];

export const JSAPI_TEST_OFFERING_SEED: CatalogSeedDefinition & typeof common = {
  code: 'jsapi-payment-test-001',
  serviceType: 'CARD_READING',
  offeringKind: 'SINGLE',
  displayName: '微信支付联调商品',
  description: '测试环境专用，支付 0.01 元后发放 1 次抽卡问事权益',
  amountMinor: 1,
  validityDays: 7,
  entitlementSpec: {
    benefits: [{ serviceType: 'CARD_READING', unit: 'READING_CREDIT', quantity: 1 }],
  },
  purchaseLimit: { testOnly: true, displayChannels: ['STORE'] },
  ...common,
};

function membership(
  code: 'glow' | 'serenity' | 'freedom',
  displayName: string,
  amountMinor: number,
  dailyQuantity: number,
  readingQuantity: number,
  seedThreshold: number,
  activityAmountMinor: number,
  recommended = false,
) {
  return {
    version: 2,
    code: `membership-${code}-r11`,
    serviceType: 'CARD_READING' as const,
    offeringKind: 'MEMBERSHIP' as const,
    displayName,
    description: `30 天周期，今日能量 ${dailyQuantity} 次、抽卡问事 ${readingQuantity} 份`,
    amountMinor,
    validityDays: 30,
    entitlementSpec: {
      periodDays: 30,
      benefits: [
        { serviceType: 'DAILY_INSIGHT', unit: 'DAILY_INSIGHT_CREDIT', quantity: dailyQuantity },
        { serviceType: 'CARD_READING', unit: 'READING_CREDIT', quantity: readingQuantity },
      ],
    },
    purchaseLimit: { recommended, displayChannels: ['STORE', 'SHORTAGE'] },
    promotion: {
      minimumSeedBalance: seedThreshold,
      reservedSeedQuantity: seedThreshold,
      activityAmountMinor,
    },
    ...common,
  };
}
