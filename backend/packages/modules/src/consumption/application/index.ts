import type {
  BenefitSourcePort,
  BusinessClock,
  ConsumptionIntentView,
  ConsumptionPort,
  ConsumptionOutcomeQueryPort,
  EntitlementResolutionView as ConsumptionPortResolutionView,
} from '@satori/application';
import type { BenefitSourceType, BusinessContext, ServiceRequirement } from '@satori/domain';
import { randomUUID } from 'node:crypto';
import {
  CONSUMPTION_RESERVATION_TTL_MS,
  CONSUMPTION_RULE_VERSION,
  ConsumptionError,
  type ConsumptionIntentDetail,
  type ConsumptionIntentStatus,
  type EntitlementResolutionView,
  rankCandidates,
  sourceReason,
} from '../domain/index.js';

export const CONSUMPTION_REPOSITORY = Symbol('CONSUMPTION_REPOSITORY');

export interface ConsumptionRepository {
  saveResolution(
    resolution: EntitlementResolutionView,
    idempotencyKey: string,
  ): Promise<EntitlementResolutionView>;
  getResolution(resolutionId: string): Promise<EntitlementResolutionView | null>;
  findIntentByContext(ownerUserId: string, context: BusinessContext): Promise<ConsumptionIntentDetail | null>;
  createIntentDraft(
    resolution: EntitlementResolutionView,
    deadline: Date,
    requestId: string,
  ): Promise<ConsumptionIntentDetail>;
  attachReservation(
    intentId: string,
    sourceReservationId: string,
    reservedAt: Date,
  ): Promise<ConsumptionIntentDetail>;
  getIntent(intentId: string): Promise<ConsumptionIntentDetail | null>;
  transitionIntent(
    intentId: string,
    from: readonly ConsumptionIntentStatus[],
    to: ConsumptionIntentStatus,
    at: Date,
  ): Promise<ConsumptionIntentDetail>;
  markAllocation(intentId: string, status: 'COMMITTED' | 'RELEASED'): Promise<void>;
  listExpiredReservations(now: Date, limit: number): Promise<readonly ConsumptionIntentDetail[]>;
  listRecoverableIntents(limit: number): Promise<readonly ConsumptionIntentDetail[]>;
}

export class UnknownConsumptionOutcomeQuery implements ConsumptionOutcomeQueryPort {
  getOutcome() {
    return Promise.resolve('UNKNOWN' as const);
  }
}

export class ConsumptionApplicationService implements ConsumptionPort {
  constructor(
    private readonly entitlements: BenefitSourcePort,
    private readonly seeds: BenefitSourcePort,
    private readonly repository: ConsumptionRepository,
    private readonly clock: BusinessClock,
    private readonly outcomes: ConsumptionOutcomeQueryPort = new UnknownConsumptionOutcomeQuery(),
  ) {}

  async createResolution(requirement: ServiceRequirement, idempotencyKey: string) {
    assertRequirement(requirement);
    const seedQuantity = seedCost(requirement);
    const [entitlements, seeds] = await Promise.all([
      this.entitlements.listCandidates(requirement),
      seedQuantity === null
        ? Promise.resolve([])
        : this.seeds.listCandidates({ ...requirement, unit: 'SEED', quantity: seedQuantity }),
    ]);
    const candidates = rankCandidates(entitlements, seeds);
    const selectedSource = candidates[0] ?? null;
    const now = this.clock.now();
    return this.repository.saveResolution(
      {
        resolutionId: randomUUID(),
        ownerUserId: requirement.userId,
        requirement,
        status: selectedSource ? 'RESOLVED' : 'NO_SOURCE',
        selectionMode: 'SYSTEM_RULE',
        candidates,
        selectedSource,
        reasonCode: sourceReason(selectedSource?.sourceType ?? null),
        ruleVersion: CONSUMPTION_RULE_VERSION,
        resolvedAt: now,
        expiresAt: new Date(now.getTime() + CONSUMPTION_RESERVATION_TTL_MS),
      },
      idempotencyKey,
    );
  }

  async createIntent(ownerUserId: string, resolutionId: string, idempotencyKey: string) {
    const resolution = await this.repository.getResolution(resolutionId);
    if (!resolution || resolution.ownerUserId !== ownerUserId) {
      throw new ConsumptionError('RESOLUTION_NOT_FOUND', 'Entitlement resolution was not found');
    }
    if (!resolution.selectedSource) {
      throw new ConsumptionError(
        'PURCHASE_REQUIRED',
        '当前没有可用的服务权益，请前往“我的权益”查看',
      );
    }
    if (resolution.expiresAt <= this.clock.now()) {
      throw new ConsumptionError('RESOLUTION_EXPIRED', 'Entitlement resolution has expired');
    }
    const replay = await this.repository.findIntentByContext(
      ownerUserId,
      resolution.requirement.businessContext,
    );
    if (replay) {
      assertSameRequirement(replay, resolution.requirement);
      return replay.status === 'RESERVING' ? this.finishReservation(replay) : replay;
    }
    const draft = await this.repository.createIntentDraft(resolution, resolution.expiresAt, randomUUID());
    if (draft.resolutionId !== resolution.resolutionId) {
      assertSameRequirement(draft, resolution.requirement);
      return draft.status === 'RESERVING' ? this.finishReservation(draft) : draft;
    }
    void idempotencyKey;
    return this.finishReservation(draft);
  }

  async resolve(requirement: ServiceRequirement): Promise<ConsumptionPortResolutionView> {
    return toPortResolution(await this.createResolution(requirement, randomUUID()));
  }

  async reserve(requirement: ServiceRequirement, idempotencyKey: string): Promise<ConsumptionIntentView> {
    const replay = await this.repository.findIntentByContext(requirement.userId, requirement.businessContext);
    const intent = replay
      ? (assertSameRequirement(replay, requirement),
        replay.status === 'RESERVING' ? await this.finishReservation(replay) : replay)
      : await this.createIntent(
          requirement.userId,
          (await this.createResolution(requirement, idempotencyKey)).resolutionId,
          idempotencyKey,
        );
    return toPortIntent(intent);
  }

  async start(intentId: string, _idempotencyKey: string): Promise<ConsumptionIntentView> {
    void _idempotencyKey;
    const intent = await this.requireIntent(intentId);
    if (['RUNNING', 'COMMITTED'].includes(intent.status)) return toPortIntent(intent);
    if (intent.status !== 'RESERVED') throw invalidTransition(intent.status, 'RUNNING');
    return toPortIntent(
      await this.repository.transitionIntent(intentId, ['RESERVED'], 'RUNNING', this.clock.now()),
    );
  }

  async commit(intentId: string, _idempotencyKey: string): Promise<ConsumptionIntentView> {
    void _idempotencyKey;
    return toPortIntent(await this.settle(intentId, 'COMMITTED'));
  }

  async release(intentId: string, _idempotencyKey: string): Promise<ConsumptionIntentView> {
    void _idempotencyKey;
    return toPortIntent(await this.settle(intentId, 'RELEASED'));
  }

  getIntent(intentId: string) {
    return this.repository.getIntent(intentId);
  }

  getByContext(ownerUserId: string, context: BusinessContext) {
    return this.repository.findIntentByContext(ownerUserId, context);
  }

  async expireDue(now = this.clock.now(), limit = 200) {
    const due = await this.repository.listExpiredReservations(now, limit);
    let expired = 0;
    for (const intent of due) {
      const claimed =
        intent.status === 'RESERVED'
          ? await this.repository.transitionIntent(intent.intentId, ['RESERVED'], 'EXPIRED', now)
          : intent;
      await this.source(intent.selectedSource.sourceType).release(intent.sourceReservationId!, {
        type: 'CONSUMPTION_TIMEOUT',
        id: intent.intentId,
      });
      await this.repository.markAllocation(claimed.intentId, 'RELEASED');
      expired += 1;
    }
    return expired;
  }

  async reconcile(limit = 200) {
    const intents = await this.repository.listRecoverableIntents(limit);
    let recoveredReservations = 0;
    let committed = 0;
    let released = 0;
    for (const intent of intents) {
      if (intent.status === 'RESERVING') {
        await this.finishReservation(intent);
        recoveredReservations += 1;
        continue;
      }
      const outcome = await this.outcomes.getOutcome(intent.businessContext);
      if (outcome === 'SUCCEEDED') {
        await this.settle(intent.intentId, 'COMMITTED');
        committed += 1;
      } else if (outcome === 'FAILED' || outcome === 'CANCELLED') {
        await this.settle(intent.intentId, 'RELEASED');
        released += 1;
      }
    }
    return { checked: intents.length, recoveredReservations, committed, released };
  }

  private async finishReservation(intent: ConsumptionIntentDetail) {
    const reservation = await this.source(intent.selectedSource.sourceType).reserve(
      intent.selectedSource,
      intent.intentId,
    );
    return this.repository.attachReservation(intent.intentId, reservation.reservationId, this.clock.now());
  }

  private async settle(intentId: string, target: 'COMMITTED' | 'RELEASED') {
    const intent = await this.requireIntent(intentId);
    if (intent.status === target) {
      await this.repository.markAllocation(intentId, target);
      return intent;
    }
    const allowed: ConsumptionIntentStatus[] = target === 'COMMITTED' ? ['RUNNING'] : ['RESERVED', 'RUNNING'];
    if (!allowed.includes(intent.status)) throw invalidTransition(intent.status, target);
    const source = this.source(intent.selectedSource.sourceType);
    const context = intent.businessContext;
    if (target === 'COMMITTED') await source.commit(intent.sourceReservationId!, context);
    else await source.release(intent.sourceReservationId!, context);
    const transitioned = await this.repository.transitionIntent(intentId, allowed, target, this.clock.now());
    await this.repository.markAllocation(intentId, target);
    return transitioned;
  }

  private source(type: BenefitSourceType) {
    return type === 'COMPLIMENTARY_SEED' ? this.seeds : this.entitlements;
  }

  private async requireIntent(intentId: string) {
    const intent = await this.repository.getIntent(intentId);
    if (!intent)
      throw new ConsumptionError('CONSUMPTION_INTENT_NOT_FOUND', 'Consumption intent was not found');
    return intent;
  }
}

function seedCost(requirement: ServiceRequirement) {
  if (requirement.unit === 'SEED') return requirement.quantity;
  const configured = requirement.attributes?.seedQuantity;
  return typeof configured === 'number' && Number.isInteger(configured) && configured > 0 ? configured : null;
}

function assertRequirement(requirement: ServiceRequirement) {
  if (!Number.isInteger(requirement.quantity) || requirement.quantity < 1) {
    throw new ConsumptionError('INVALID_CONSUMPTION_REQUIREMENT', 'Quantity must be positive');
  }
}

function assertSameRequirement(intent: ConsumptionIntentDetail, requirement: ServiceRequirement) {
  const expectedQuantity =
    intent.selectedSource.sourceType === 'COMPLIMENTARY_SEED'
      ? seedCost(requirement)
      : requirement.quantity;
  if (
    intent.ownerUserId !== requirement.userId ||
    intent.businessContext.type !== requirement.businessContext.type ||
    intent.businessContext.id !== requirement.businessContext.id ||
    intent.selectedSource.serviceType !== requirement.serviceType ||
    expectedQuantity === null ||
    intent.selectedSource.requiredQuantity !== expectedQuantity
  ) {
    throw new ConsumptionError(
      'BUSINESS_CONTEXT_REUSED',
      'Business context was reused with another requirement',
    );
  }
}

function invalidTransition(from: string, to: string) {
  return new ConsumptionError('INVALID_CONSUMPTION_TRANSITION', `Cannot transition from ${from} to ${to}`);
}

function toPortResolution(view: EntitlementResolutionView): ConsumptionPortResolutionView {
  return {
    resolutionId: view.resolutionId,
    selectedCandidate: view.selectedSource,
    reasonCode: view.reasonCode,
    ruleVersion: view.ruleVersion,
  };
}

function toPortIntent(intent: ConsumptionIntentDetail): ConsumptionIntentView {
  return {
    intentId: intent.intentId,
    state: intent.status === 'RESERVING' || intent.status === 'FAILED' ? 'RESERVED' : intent.status,
    resolution: {
      resolutionId: intent.resolutionId,
      selectedCandidate: intent.selectedSource,
      reasonCode: sourceReason(intent.selectedSource.sourceType),
      ruleVersion: CONSUMPTION_RULE_VERSION,
    },
    reservation: {
      reservationId: intent.sourceReservationId!,
      sourceId: intent.selectedSource.sourceId,
      sourceType: intent.selectedSource.sourceType,
      quantity: intent.selectedSource.requiredQuantity,
      expiresAt: intent.reservationExpiresAt,
    },
  };
}
