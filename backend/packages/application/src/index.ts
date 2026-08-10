export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export * from './idempotency/idempotency.js';
export * from './astrology/birth-chart-calculator.js';
export * from './daily-insight/daily-insight-generator.js';
export * from './locations/location-provider.js';
export * from './pagination/cursor.js';
