import type {
  BusinessClock,
  EntitlementGrantPort,
  MembershipGrantCommand,
  MembershipGrantPort,
} from '@satori/application';
import {
  assertUpgradeAllowed,
  MEMBERSHIP_PERIOD_RULE_VERSION,
  MEMBERSHIP_UPGRADE_ASSESSMENT_RULE_VERSION,
  MEMBERSHIP_UPGRADE_CONFIRMATION,
  MembershipError,
  ratioBasisPoints,
} from '../domain/index.js';

export const MEMBERSHIP_REPOSITORY = Symbol('MEMBERSHIP_REPOSITORY');

export interface MembershipBenefitSpec {
  serviceType: 'DAILY_INSIGHT' | 'CARD_READING';
  unit: 'DAILY_INSIGHT_CREDIT' | 'READING_CREDIT';
  quantity: number;
}

export interface PreparedMembershipPeriod {
  subscriptionId: string;
  periodId: string;
  ownerUserId: string;
  sourceOrderId: string;
  startsAt: Date;
  endsAt: Date;
  planVersionId: string;
  benefits: readonly MembershipBenefitSpec[];
  mode: 'ACTIVE' | 'QUEUED' | 'UPGRADE';
  benefitsGranted: boolean;
  upgrade?: {
    upgradeId: string;
    previousSubscriptionId: string;
    previousPeriodId: string;
    committed: boolean;
  };
}

export interface MembershipUpgradeContext {
  previousSubscriptionId: string;
  previousPeriodId: string;
  previousPlanCode: string;
  previousPlanAmountMinor: number;
  previousStartsAt: Date;
  previousEndsAt: Date;
  targetPlanVersionId: string;
  targetPlanCode: string;
  targetPlanAmountMinor: number;
}

export interface UpgradeAssessment {
  remainingTimeBasisPoints: number;
  remainingQuotaBasisPoints: number;
  residualValueEstimateMinor: number;
  assessmentRuleVersion: string;
  inputSnapshot: Record<string, unknown>;
}

export interface MembershipRepository {
  prepare(command: MembershipGrantCommand, idempotencyKey: string): Promise<PreparedMembershipPeriod>;
  markBenefitsGranted(periodId: string): Promise<void>;
  commitUpgrade(prepared: PreparedMembershipPeriod): Promise<void>;
  endDue(now: Date): Promise<number>;
  listDueQueued(now: Date, limit: number): Promise<readonly string[]>;
  activateQueued(periodId: string): Promise<PreparedMembershipPeriod | null>;
  listRepairable(limit: number): Promise<readonly PreparedMembershipPeriod[]>;
  listFailedPreparing(limit: number): Promise<readonly PreparedMembershipPeriod[]>;
  cancelFailedPreparing(prepared: PreparedMembershipPeriod): Promise<void>;
  openRepairCase(
    prepared: PreparedMembershipPeriod,
    expectedTotal: number,
    actualTotal: number,
  ): Promise<void>;
  resolveRepairCase(periodId: string): Promise<void>;
  getUpgradeContext(
    ownerUserId: string,
    previousSubscriptionId: string,
    targetPlanVersionId: string,
  ): Promise<MembershipUpgradeContext>;
  registerUpgrade(command: {
    ownerUserId: string;
    previousSubscriptionId: string;
    targetPlanVersionId: string;
    newOrderId: string;
    assessment: UpgradeAssessment;
    requestId: string;
  }): Promise<{ upgradeId: string; status: string }>;
  getCurrent(ownerUserId: string): Promise<Record<string, unknown> | null>;
  listPeriods(ownerUserId: string): Promise<readonly Record<string, unknown>[]>;
  listUpgrades(ownerUserId: string): Promise<readonly Record<string, unknown>[]>;
}

export class MembershipApplicationService implements MembershipGrantPort {
  constructor(
    private readonly repository: MembershipRepository,
    private readonly entitlements: EntitlementGrantPort,
    private readonly clock: BusinessClock,
  ) {}

  async activate(command: MembershipGrantCommand, idempotencyKey: string) {
    const prepared = await this.repository.prepare(command, idempotencyKey);
    if (prepared.mode !== 'QUEUED') await this.completePrepared(prepared);
    return { subscriptionId: prepared.subscriptionId, periodId: prepared.periodId };
  }

  async queueRenewal(command: MembershipGrantCommand, idempotencyKey: string) {
    const prepared = await this.repository.prepare(command, idempotencyKey);
    if (prepared.mode !== 'QUEUED') {
      throw new MembershipError('MEMBERSHIP_RENEWAL_NOT_QUEUED', 'Membership renewal was not queued');
    }
    return { periodId: prepared.periodId };
  }

  async replaceForUpgrade(
    command: MembershipGrantCommand & { previousSubscriptionId: string; upgradeId: string },
    idempotencyKey: string,
  ) {
    const prepared = await this.repository.prepare(command, idempotencyKey);
    if (
      prepared.mode !== 'UPGRADE' ||
      prepared.upgrade?.upgradeId !== command.upgradeId ||
      prepared.upgrade.previousSubscriptionId !== command.previousSubscriptionId
    ) {
      throw new MembershipError('MEMBERSHIP_UPGRADE_MISMATCH', 'Membership upgrade context does not match');
    }
    await this.completePrepared(prepared);
    return { subscriptionId: prepared.subscriptionId };
  }

  async previewUpgrade(ownerUserId: string, previousSubscriptionId: string, targetPlanVersionId: string) {
    const { context } = await this.assessUpgrade(ownerUserId, previousSubscriptionId, targetPlanVersionId);
    return {
      previousSubscriptionId,
      targetPlanVersionId,
      payableAmount: { amount: context.targetPlanAmountMinor, currency: 'CNY' as const },
      confirmation: MEMBERSHIP_UPGRADE_CONFIRMATION,
    };
  }

  async registerUpgrade(command: {
    ownerUserId: string;
    previousSubscriptionId: string;
    targetPlanVersionId: string;
    newOrderId: string;
    requestId: string;
  }) {
    const { assessment } = await this.assessUpgrade(
      command.ownerUserId,
      command.previousSubscriptionId,
      command.targetPlanVersionId,
    );
    const upgrade = await this.repository.registerUpgrade({ ...command, assessment });
    return { ...upgrade, confirmation: MEMBERSHIP_UPGRADE_CONFIRMATION };
  }

  getCurrent(ownerUserId: string) {
    return this.repository.getCurrent(ownerUserId);
  }

  listPeriods(ownerUserId: string) {
    return this.repository.listPeriods(ownerUserId);
  }

  listUpgrades(ownerUserId: string) {
    return this.repository.listUpgrades(ownerUserId);
  }

  async maintain(limit = 100) {
    const now = this.clock.now();
    await this.entitlements.expireDue(now);
    const ended = await this.repository.endDue(now);
    let started = 0;
    for (const periodId of await this.repository.listDueQueued(now, limit)) {
      const prepared = await this.repository.activateQueued(periodId);
      if (!prepared) continue;
      await this.completePrepared(prepared);
      started += 1;
    }
    const repaired = await this.reconcile(limit);
    return { ended, started, repaired };
  }

  async reconcile(limit = 100) {
    let repaired = 0;
    for (const prepared of await this.repository.listRepairable(limit)) {
      const expectedTotal = prepared.benefits.reduce((sum, benefit) => sum + benefit.quantity, 0);
      const actual = await this.entitlements.summarizeBySource(prepared.periodId);
      if (actual.totalQuantity < expectedTotal) {
        await this.repository.openRepairCase(prepared, expectedTotal, actual.totalQuantity);
      }
      await this.completePrepared(prepared);
      if (actual.totalQuantity < expectedTotal) {
        await this.repository.resolveRepairCase(prepared.periodId);
      }
      repaired += 1;
    }
    for (const prepared of await this.repository.listFailedPreparing(limit)) {
      await this.entitlements
        .forfeitBySource(prepared.periodId, 'UPGRADE_ORDER_EXCEPTION')
        .catch(() => undefined);
      await this.repository.cancelFailedPreparing(prepared);
      repaired += 1;
    }
    return repaired;
  }

  private async completePrepared(prepared: PreparedMembershipPeriod) {
    await this.issueBenefits(prepared, prepared.mode === 'UPGRADE' && !prepared.upgrade?.committed);
    if (prepared.mode === 'UPGRADE') {
      const upgrade = prepared.upgrade!;
      if (!upgrade.committed) {
        const oldBalance = await this.entitlements.summarizeBySource(upgrade.previousPeriodId);
        if (oldBalance.reservedQuantity > 0) {
          throw new MembershipError(
            'MEMBERSHIP_UPGRADE_ACTIVE_RESERVATION',
            'The previous membership has an active service reservation',
            true,
          );
        }
        await this.repository.commitUpgrade(prepared);
      }
      await this.entitlements.forfeitBySource(upgrade.previousPeriodId, 'MEMBERSHIP_UPGRADED');
      await this.entitlements.unfreezeBySource(prepared.periodId, 'MEMBERSHIP_UPGRADE_ACTIVATED');
    }
    await this.repository.markBenefitsGranted(prepared.periodId);
  }

  private async issueBenefits(prepared: PreparedMembershipPeriod, frozen: boolean) {
    for (const benefit of prepared.benefits) {
      await this.entitlements.grant(
        {
          ownerUserId: prepared.ownerUserId,
          businessSpace: 'SATORI',
          serviceType: benefit.serviceType,
          unit: benefit.unit,
          quantity: benefit.quantity,
          sourceType: 'MEMBERSHIP',
          sourceId: prepared.periodId,
          effectiveAt: prepared.startsAt,
          expiresAt: prepared.endsAt,
          ruleVersion: MEMBERSHIP_PERIOD_RULE_VERSION,
          initialStatus: frozen ? 'FROZEN' : 'ACTIVE',
        },
        `membership:${prepared.periodId}:${benefit.serviceType}`,
      );
    }
  }

  private async assessUpgrade(
    ownerUserId: string,
    previousSubscriptionId: string,
    targetPlanVersionId: string,
  ) {
    const context = await this.repository.getUpgradeContext(
      ownerUserId,
      previousSubscriptionId,
      targetPlanVersionId,
    );
    assertUpgradeAllowed(context.previousPlanCode, context.targetPlanCode);
    const now = this.clock.now();
    const summary = await this.entitlements.summarizeBySource(context.previousPeriodId);
    const timeRatio = ratioBasisPoints(
      Math.max(0, context.previousEndsAt.getTime() - now.getTime()),
      context.previousEndsAt.getTime() - context.previousStartsAt.getTime(),
    );
    const quotaRatio = ratioBasisPoints(summary.availableQuantity, summary.totalQuantity);
    const residualRatio = Math.min(timeRatio, quotaRatio);
    return {
      context,
      assessment: {
        remainingTimeBasisPoints: timeRatio,
        remainingQuotaBasisPoints: quotaRatio,
        residualValueEstimateMinor: Math.floor((context.previousPlanAmountMinor * residualRatio) / 10_000),
        assessmentRuleVersion: MEMBERSHIP_UPGRADE_ASSESSMENT_RULE_VERSION,
        inputSnapshot: {
          assessedAt: now.toISOString(),
          previousPeriodId: context.previousPeriodId,
          previousPlanAmountMinor: context.previousPlanAmountMinor,
          totalQuantity: summary.totalQuantity,
          availableQuantity: summary.availableQuantity,
          reservedQuantity: summary.reservedQuantity,
        },
      },
    };
  }
}
