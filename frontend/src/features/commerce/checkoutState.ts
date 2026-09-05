export function canSubmitCheckout(quote: unknown, busy: boolean, payerPreparation: string): boolean {
  return Boolean(quote) && !busy && payerPreparation === "ready";
}
