export const MONEY_ORDER_TTL_MS = 30 * 60 * 1_000;

export class MoneyOrderError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
