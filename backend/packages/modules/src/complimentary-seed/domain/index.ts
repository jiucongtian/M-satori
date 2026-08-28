import type { ServiceType } from '@satori/domain';

export type ComplimentarySeedSourceType =
  | 'REGISTRATION'
  | 'MEMBERSHIP'
  | 'ACADEMY'
  | 'ACTIVITY'
  | 'COMPENSATION'
  | 'MANUAL'
  | 'RESTORE'
  | 'MIGRATION';

export type ComplimentarySeedEntryType =
  'GRANT' | 'RESERVE' | 'CONSUME' | 'RELEASE' | 'RESTORE' | 'EXPIRE' | 'ADJUSTMENT';

export interface ComplimentarySeedGrantView {
  readonly id: string;
  readonly ownerUserId: string;
  readonly businessSpace: string;
  readonly sourceType: ComplimentarySeedSourceType;
  readonly sourceId: string;
  readonly applicableServices: readonly ServiceType[];
  readonly totalQuantity: number;
  readonly availableQuantity: number;
  readonly reservedQuantity: number;
  readonly status: string;
  readonly effectiveAt: Date;
  readonly expiresAt: Date | null;
  readonly grantedAt: Date;
  readonly ruleVersion: string;
  readonly migrationVersion: string | null;
}

export interface ReadingSeedCostRule {
  readonly version: string;
  readonly costByCardCount: Readonly<Record<1 | 2 | 3 | 4 | 5, number>>;
}

export interface ReadingSeedCost {
  readonly cardCount: 1 | 2 | 3 | 4 | 5;
  readonly quantity: number;
  readonly unit: 'SEED';
  readonly ruleVersion: string;
}

export class ComplimentarySeedError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function calculateReadingSeedCost(cardCount: number, rule: ReadingSeedCostRule): ReadingSeedCost {
  if (!Number.isInteger(cardCount) || cardCount < 1 || cardCount > 5) {
    throw new ComplimentarySeedError('INVALID_CARD_COUNT', 'Card count must be an integer from 1 to 5');
  }
  const quantity = rule.costByCardCount[cardCount as 1 | 2 | 3 | 4 | 5];
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new ComplimentarySeedError('INVALID_SEED_COST_RULE', 'Seed cost rule must define positive costs');
  }
  return { cardCount: cardCount as 1 | 2 | 3 | 4 | 5, quantity, unit: 'SEED', ruleVersion: rule.version };
}

export function assertSeedQuantity(quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new ComplimentarySeedError('INVALID_SEED_QUANTITY', 'Seed quantity must be positive');
  }
}
