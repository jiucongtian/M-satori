import type { ConsumptionPort } from '@satori/application';
import type { ServiceRequirement } from '@satori/domain';
import { CardReadingError, type ReadingDrawSnapshot, type ReadingIntent } from '../domain/index.js';

export interface ReadingSeedCostPolicy {
  readonly version: string;
  readonly costByCardCount: Readonly<Record<1 | 2 | 3 | 4 | 5, number>>;
}

export interface ReadingIntentRepository {
  get(readingIntentId: string): Promise<ReadingIntent | null>;
  create(intent: ReadingIntent): Promise<ReadingIntent>;
  update(
    readingIntentId: string,
    patch: Partial<Pick<ReadingIntent, 'consumptionAttempt' | 'consumptionIntentId' | 'status' | 'draw'>>,
  ): Promise<ReadingIntent>;
}

export interface ServerCardDrawPort {
  draw(command: {
    readonly readingIntentId: string;
    readonly cardCount: 1 | 2 | 3 | 4 | 5;
  }): Promise<ReadingDrawSnapshot>;
}

export interface BeginReadingCommand {
  readonly ownerUserId: string;
  readonly readingIntentId: string;
  readonly cardCount: number;
  readonly seedCostPolicy: ReadingSeedCostPolicy;
}

export type GenerationTaskTerminalEvent = {
  readonly eventId: string;
  readonly taskId: string;
  readonly targetType: 'CARD_READING';
  readonly targetId: string;
  readonly status: 'READY' | 'FAILED' | 'CANCELLED';
};

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

export class CardReadingApplicationService {
  constructor(
    private readonly consumption: ConsumptionPort,
    private readonly readings: ReadingIntentRepository,
    private readonly cards: ServerCardDrawPort,
  ) {}

  /** 预留并进入 RUNNING 后才调用服务端抽卡端口。 */
  async begin(command: BeginReadingCommand): Promise<ReadingIntent> {
    const existing = await this.readings.get(command.readingIntentId);
    if (existing) {
      this.assertSameReading(existing, command);
      return existing.draw ? existing : this.draw(existing);
    }
    const requirement = buildReadingRequirement(command);
    const reserved = await this.consumption.reserve(requirement, `${command.readingIntentId}:1:RESERVE`);
    const intent = await this.readings.create({
      readingIntentId: command.readingIntentId,
      ownerUserId: command.ownerUserId,
      cardCount: requirement.attributes!.cardCount as 1 | 2 | 3 | 4 | 5,
      seedQuantity: requirement.attributes!.seedQuantity as number,
      seedCostRuleVersion: command.seedCostPolicy.version,
      consumptionAttempt: 1,
      consumptionIntentId: reserved.intentId,
      status: 'RESERVED',
      draw: null,
    });
    return this.draw(intent);
  }

  /** 生成失败后的新消费尝试沿用已冻结牌面，不再次抽卡。 */
  async retryGeneration(readingIntentId: string): Promise<ReadingIntent> {
    const reading = await this.requireReading(readingIntentId);
    if (reading.status !== 'FAILED') {
      throw new CardReadingError('READING_NOT_RETRYABLE', 'Only a failed reading can be retried');
    }
    if (!reading.draw) throw new CardReadingError('READING_DRAW_MISSING', 'Frozen cards are required');
    const attempt = reading.consumptionAttempt + 1;
    const requirement = buildReadingRequirement(
      {
        ownerUserId: reading.ownerUserId,
        readingIntentId: reading.readingIntentId,
        cardCount: reading.cardCount,
        seedCostPolicy: {
          version: reading.seedCostRuleVersion,
          costByCardCount: fixedCost(reading.seedQuantity),
        },
      },
      attempt,
    );
    const reserved = await this.consumption.reserve(
      requirement,
      `${reading.readingIntentId}:${attempt}:RESERVE`,
    );
    await this.consumption.start(reserved.intentId, `${reserved.intentId}:START`);
    return this.readings.update(readingIntentId, {
      consumptionAttempt: attempt,
      consumptionIntentId: reserved.intentId,
      status: 'RUNNING',
    });
  }

  private async draw(reading: ReadingIntent): Promise<ReadingIntent> {
    await this.consumption.start(reading.consumptionIntentId, `${reading.consumptionIntentId}:START`);
    try {
      const draw = await this.cards.draw({
        readingIntentId: reading.readingIntentId,
        cardCount: reading.cardCount,
      });
      if (draw.cardIds.length !== reading.cardCount) {
        throw new CardReadingError('READING_DRAW_INCOMPLETE', 'Card draw count does not match');
      }
      return this.readings.update(reading.readingIntentId, { status: 'RUNNING', draw });
    } catch (error) {
      await this.consumption.release(
        reading.consumptionIntentId,
        `${reading.consumptionIntentId}:DRAW_FAILED`,
      );
      await this.readings.update(reading.readingIntentId, { status: 'FAILED' });
      throw error;
    }
  }

  private async requireReading(readingIntentId: string) {
    const reading = await this.readings.get(readingIntentId);
    if (!reading) throw new CardReadingError('READING_INTENT_NOT_FOUND', 'Reading intent was not found');
    return reading;
  }

  private assertSameReading(reading: ReadingIntent, command: BeginReadingCommand) {
    if (reading.ownerUserId !== command.ownerUserId || reading.cardCount !== command.cardCount) {
      throw new CardReadingError('READING_INTENT_REUSED', 'Reading intent was reused with other inputs');
    }
  }
}

export class GenerationTaskConsumptionAdapter {
  constructor(
    private readonly consumption: ConsumptionPort,
    private readonly readings: ReadingIntentRepository,
  ) {}

  async handle(event: GenerationTaskTerminalEvent): Promise<ReadingIntent> {
    const reading = await this.readings.get(event.targetId);
    if (!reading) throw new CardReadingError('READING_INTENT_NOT_FOUND', 'Reading intent was not found');
    const actionKey = `${reading.consumptionIntentId}:GENERATION:${event.eventId}`;
    if (event.status === 'READY') {
      await this.consumption.commit(reading.consumptionIntentId, actionKey);
    } else {
      await this.consumption.release(reading.consumptionIntentId, actionKey);
    }
    return this.readings.update(reading.readingIntentId, {
      status: event.status,
    });
  }
}

function fixedCost(quantity: number): Readonly<Record<1 | 2 | 3 | 4 | 5, number>> {
  return { 1: quantity, 2: quantity, 3: quantity, 4: quantity, 5: quantity };
}
