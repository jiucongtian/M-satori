export const BUSINESS_CLOCK = Symbol('BUSINESS_CLOCK');

export interface BusinessClock {
  now(): Date;
}

/** @deprecated Prefer BusinessClock for new commerce modules. */
export type Clock = BusinessClock;

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export * from './idempotency/idempotency.js';
export * from './commerce/ports.js';
export * from './events/inbox-consumer.js';
export * from './astrology/birth-chart-calculator.js';
export * from './daily-insight/daily-insight-generator.js';
export * from './daily-energy/home-energy-summary-generator.js';
export * from './locations/location-provider.js';
export * from './pagination/cursor.js';
export * from './profile/profile-first-look-generator.js';
