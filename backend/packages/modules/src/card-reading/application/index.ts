import type { ServiceRequirement } from '@satori/domain';
import { CardReadingError } from '../domain/index.js';

export interface ReadingSeedCostPolicy {
  readonly version: string;
  readonly costByCardCount: Readonly<Record<1 | 2 | 3 | 4 | 5, number>>;
}

export interface BeginReadingCommand {
  readonly ownerUserId: string;
  readonly readingIntentId: string;
  readonly cardCount: number;
  readonly seedCostPolicy: ReadingSeedCostPolicy;
}

export function buildReadingRequirement(
  command: BeginReadingCommand,
  consumptionAttempt = 1,
): ServiceRequirement {
  if (!Number.isInteger(command.cardCount) || command.cardCount < 1 || command.cardCount > 5) {
    throw new CardReadingError('INVALID_CARD_COUNT', 'Card count must be an integer from 1 to 5');
  }
  const cardCount = command.cardCount as 1 | 2 | 3 | 4 | 5;
  const seedQuantity = command.seedCostPolicy.costByCardCount[cardCount];
  if (!Number.isInteger(seedQuantity) || seedQuantity < 1) {
    throw new CardReadingError('INVALID_SEED_COST_RULE', 'Reading seed cost must be positive');
  }
  return {
    userId: command.ownerUserId,
    businessSpace: 'SATORI',
    serviceType: 'CARD_READING',
    quantity: 1,
    unit: 'READING_CREDIT',
    businessContext: {
      type: 'READING_INTENT_ATTEMPT',
      id: `${command.readingIntentId}:${consumptionAttempt}`,
    },
    attributes: {
      cardCount,
      seedQuantity,
      seedCostRuleVersion: command.seedCostPolicy.version,
    },
  };
}
