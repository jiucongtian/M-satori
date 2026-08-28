export interface SeedPromotionRuleView {
  readonly id: string;
  readonly ruleVersion: string;
  readonly minimumSeedBalance: number;
  readonly reservedSeedQuantity: number;
  readonly activityAmountMinor: number;
  readonly identityConstraint: Readonly<Record<string, unknown>>;
  readonly purchaseLimit: Readonly<Record<string, unknown>>;
  readonly restorationPolicy: Readonly<Record<string, unknown>>;
}

export class QuoteRejectedError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
