export const MEMBERSHIP_PERIOD_RULE_VERSION = 'membership-period-days-v1';
export const MEMBERSHIP_UPGRADE_ASSESSMENT_RULE_VERSION = 'membership-residual-min-v1';
export const MEMBERSHIP_UPGRADE_CONFIRMATION =
  '原会员方案将在新方案生效后结束，原周期剩余次数不保留。新方案按本次订单金额支付。';

export class MembershipError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

export function membershipPlanRank(code: string) {
  if (code.includes('membership-glow-')) return 1;
  if (code.includes('membership-serenity-')) return 2;
  if (code.includes('membership-freedom-')) return 3;
  return 0;
}

export function assertUpgradeAllowed(previousCode: string, targetCode: string) {
  const previous = membershipPlanRank(previousCode);
  const target = membershipPlanRank(targetCode);
  if (previous < 1 || target <= previous) {
    throw new MembershipError('MEMBERSHIP_UPGRADE_NOT_ALLOWED', 'Membership plan replacement is not allowed');
  }
}

export function addPeriodDays(startsAt: Date, days: number) {
  if (!Number.isInteger(days) || days < 1) {
    throw new MembershipError('INVALID_MEMBERSHIP_PERIOD', 'Membership period days are invalid');
  }
  return new Date(startsAt.getTime() + days * 24 * 60 * 60 * 1_000);
}

export function ratioBasisPoints(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return Math.max(0, Math.min(10_000, Math.floor((numerator * 10_000) / denominator)));
}
