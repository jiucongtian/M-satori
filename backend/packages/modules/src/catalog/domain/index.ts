import type { OfferingQuoteSnapshot } from '@satori/application';

export const R11_SELLABLE_OFFERING_CODES = [
  'daily-insight-single',
  'daily-insight-newcomer-10',
  'card-reading-single',
  'card-reading-10',
  'membership-glow-r11',
  'membership-serenity-r11',
  'membership-freedom-r11',
] as const;

export type R11SellableOfferingCode = (typeof R11_SELLABLE_OFFERING_CODES)[number];

export type CatalogOffering = OfferingQuoteSnapshot & {
  readonly recommended: boolean;
  readonly displayChannels: readonly ('STORE' | 'SHORTAGE')[];
};

export class OfferingNotSellableError extends Error {
  readonly code = 'OFFERING_NOT_SELLABLE';
}

export class OfferingNotFoundError extends Error {
  readonly code = 'OFFERING_NOT_FOUND';
}

export function assertR11Sellable(code: string): asserts code is R11SellableOfferingCode {
  if (!(R11_SELLABLE_OFFERING_CODES as readonly string[]).includes(code)) {
    throw new OfferingNotSellableError(`${code} is outside the R1.1 sellable scope`);
  }
}

export * from './seed-data.js';
