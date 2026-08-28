import { describe, expect, it } from 'vitest';
import { commerceIdentifiers } from './commerce-observability.interceptor.js';

describe('commerce observability', () => {
  it('logs only correlation identifiers and never copies sensitive business content', () => {
    const identifiers = commerceIdentifiers({
      data: {
        orderId: 'order-1',
        paymentAttemptId: 'attempt-1',
        fulfillmentJobId: 'fulfillment-1',
        entitlement: { entitlementId: 'grant-1' },
        intentId: 'intent-1',
        question: 'must not be logged',
        accessToken: 'must not be logged',
        clientParameters: { token: 'must not be logged' },
      },
    });
    expect(identifiers).toEqual({
      orderId: 'order-1',
      paymentAttemptId: 'attempt-1',
      fulfillmentId: 'fulfillment-1',
      grantId: 'grant-1',
      consumptionIntentId: 'intent-1',
    });
    expect(JSON.stringify(identifiers)).not.toContain('must not be logged');
  });
});

