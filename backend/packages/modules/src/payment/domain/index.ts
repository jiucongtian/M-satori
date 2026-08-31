export const PAYMENT_RECOVERY_INTERVAL_MS = 10_000;
export const PAYMENT_RECOVERY_STALE_AFTER_MS = 15_000;

export class PaymentError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
