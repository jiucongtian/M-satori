export type ReadingIntentStatus = 'RESERVED' | 'RUNNING' | 'READY' | 'FAILED' | 'CANCELLED';

export interface ReadingDrawSnapshot {
  readonly drawId: string;
  readonly cardIds: readonly string[];
}

/**
 * 问事正文不进入消费、商品或支付模块；跨模块只传递此不透明意图标识。
 */
export interface ReadingIntent {
  readonly readingIntentId: string;
  readonly ownerUserId: string;
  readonly cardCount: 1 | 2 | 3 | 4 | 5;
  readonly seedQuantity: number;
  readonly seedCostRuleVersion: string;
  readonly consumptionAttempt: number;
  readonly consumptionIntentId: string;
  readonly status: ReadingIntentStatus;
  readonly draw: ReadingDrawSnapshot | null;
}

export class CardReadingError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
