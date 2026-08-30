export class RefundError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

export const REFUND_QUOTE_TTL_MS = 10 * 60 * 1_000;
