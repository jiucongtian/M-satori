export const FULFILLMENT_MAX_ATTEMPTS = 5;
export const FULFILLMENT_STALE_AFTER_MS = 6 * 60 * 1_000;
export class FulfillmentError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}
