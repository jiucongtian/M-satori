import { describe, expect, it } from 'vitest';
import { validateEnvironment } from '../../../packages/infrastructure/src/config/environment.js';
import { disabledCommerceFeature } from './configure-api.js';

const baseInput = {
  SMS_DELIVERY_MODE: 'FIXED_CODE',
  AQUA_BASE_URL: 'https://aqua.example.com',
  AQUA_SERVICE_KEY: 'test-service-key-with-safe-length',
} as const;
const baseline = validateEnvironment(baseInput);

describe('R1.1 staged rollout guard', () => {
  it('blocks only new commands while existing order status and payment callbacks keep flowing', () => {
    expect(disabledCommerceFeature(baseline, 'POST', '/api/v1/money-orders')).toBe(
      'R11_NEW_ORDERS_ENABLED',
    );
    expect(disabledCommerceFeature(baseline, 'GET', '/api/v1/money-orders/order-1')).toBeNull();
    expect(
      disabledCommerceFeature(baseline, 'POST', '/api/v1/internal/payment-webhooks/wechat'),
    ).toBeNull();
  });

  it('opens capabilities independently in the prescribed rollout order', () => {
    const environment = validateEnvironment({
      ...baseInput,
      R11_CATALOG_PRICING_ENABLED: 'true',
      R11_ENTITLEMENT_CONSUMPTION_ENABLED: 'true',
      R11_NEW_ORDERS_ENABLED: 'true',
      R11_MEMBERSHIP_ENABLED: 'true',
      R11_ORDINARY_REFUNDS_ENABLED: 'true',
      R11_MEMBERSHIP_UPGRADES_ENABLED: 'false',
    });
    expect(disabledCommerceFeature(environment, 'POST', '/api/v1/checkout-quotes')).toBeNull();
    expect(disabledCommerceFeature(environment, 'POST', '/api/v1/refunds')).toBeNull();
    expect(disabledCommerceFeature(environment, 'POST', '/api/v1/membership-upgrades')).toBe(
      'R11_MEMBERSHIP_UPGRADES_ENABLED',
    );
  });
});
