import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validate as validateUuid } from 'uuid';
import { describe, expect, it } from 'vitest';
import { newId } from '../database/ids.js';
import { environmentVariableNames, validateEnvironment } from './environment.js';

const aquaEnvironment = {
  SMS_DELIVERY_MODE: 'FIXED_CODE',
  AQUA_BASE_URL: 'https://aqua.example.com',
  AQUA_SERVICE_KEY: 'test-service-key-with-safe-length',
};

describe('runtime baseline', () => {
  it('uses auditable R1 defaults', () => {
    const environment = validateEnvironment(aquaEnvironment);
    expect(environment.QUEUE_JOB_TIMEOUT_MS).toBe(360_000);
    expect(environment).not.toHaveProperty('DAILY_INSIGHT_PRICE');
    expect(environment).not.toHaveProperty('FEATURE_DAILY_INSIGHT');
    expect(environment.R11_CATALOG_PRICING_ENABLED).toBe(false);
    expect(environment.R11_ENTITLEMENT_CONSUMPTION_ENABLED).toBe(false);
    expect(environment.R11_NEW_ORDERS_ENABLED).toBe(false);
    expect(environment.R11_MEMBERSHIP_ENABLED).toBe(false);
    expect(environment.R11_ORDINARY_REFUNDS_ENABLED).toBe(false);
    expect(environment.R11_MEMBERSHIP_UPGRADES_ENABLED).toBe(false);
    expect(environment.FAKE_PAYMENT_RESULT).toBe('PENDING');
    expect(environment.DAILY_INSIGHT_CONSUMPTION_MODE).toBe('UNIFIED');
  });

  it('rejects invalid configuration', () => {
    expect(() => validateEnvironment({ ...aquaEnvironment, PORT: '70000' })).toThrow();
    expect(() => validateEnvironment({ ...aquaEnvironment, CORS_ORIGINS: '*' })).toThrow();
    expect(() => validateEnvironment({})).toThrow();
  });

  it('documents every deployment variable with purpose, values, and impact', () => {
    const example = readFileSync(resolve(process.cwd(), '.env.example'), 'utf8');
    for (const name of environmentVariableNames) {
      expect(example, `${name} must have complete comments`).toMatch(
        new RegExp(`# 用途：[^\\n]+\\n# 取值：[^\\n]+\\n# 影响：[^\\n]+\\n(?:# )?${name}=`, 'm'),
      );
    }
  });

  it('requires one Aqua tenant connection without accepting duplicate credentials', () => {
    const environment = validateEnvironment(aquaEnvironment);
    expect(environment.AQUA_BASE_URL).toBe('https://aqua.example.com');
    expect(environment).not.toHaveProperty('AQUA_JWT_SECRET');
    expect(environment).not.toHaveProperty('AQUA_AI_SERVICE_KEY');
    expect(environment).not.toHaveProperty('AQUA_TENANT_SERVICE_KEY');
  });

  it('requires provider credentials only for real SMS delivery', () => {
    expect(() => validateEnvironment({ ...aquaEnvironment, SMS_DELIVERY_MODE: 'GATEWAY' })).toThrow();
    const gateway = validateEnvironment({
      ...aquaEnvironment,
      SMS_DELIVERY_MODE: 'GATEWAY',
      SMS_GATEWAY_URL: 'https://sms.example.com',
      SMS_GATEWAY_API_KEY: 'test-sms-key-safe-length',
    });
    expect(gateway.SMS_DELIVERY_MODE).toBe('GATEWAY');
  });

  it('requires all payment secrets together and keeps the fake adapter credential-free', () => {
    expect(validateEnvironment(aquaEnvironment)).toMatchObject({
      PAYMENT_PROVIDER_MODE: 'FAKE',
      FAKE_PAYMENT_RESULT: 'PENDING',
    });
    expect(validateEnvironment({ ...aquaEnvironment, FAKE_PAYMENT_RESULT: 'SUCCEEDED' })).toMatchObject({
      PAYMENT_PROVIDER_MODE: 'FAKE',
      FAKE_PAYMENT_RESULT: 'SUCCEEDED',
    });
    expect(() => validateEnvironment({ ...aquaEnvironment, PAYMENT_PROVIDER_MODE: 'WECHAT_PAY' })).toThrow();
    const payment = validateEnvironment({
      ...aquaEnvironment,
      PAYMENT_PROVIDER_MODE: 'WECHAT_PAY',
      WECHAT_MERCHANT_ID: 'merchant-10001',
      WECHAT_APP_ID: 'wx-app-10001',
      WECHAT_APP_SECRET: 'wechat-app-secret-for-test',
      WECHAT_OAUTH_REDIRECT_ORIGIN: 'https://pay.example.com',
      WECHAT_API_V3_KEY: '12345678901234567890123456789012',
      WECHAT_MERCHANT_PRIVATE_KEY_BASE64: 'x'.repeat(120),
      WECHAT_MERCHANT_SERIAL_NO: 'MERCHANTSERIAL001',
      WECHAT_PLATFORM_PUBLIC_KEY_BASE64: 'y'.repeat(120),
      WECHAT_PUBLIC_KEY_ID: 'PUB_KEY_ID_001',
      WECHAT_NOTIFY_URL: 'https://pay.example.com/api/v1/internal/payment-webhooks/wechat',
    });
    expect(payment.PAYMENT_PROVIDER_MODE).toBe('WECHAT_PAY');
  });

  it('generates UUIDv7 identifiers', () => {
    const generated = newId();
    expect(validateUuid(generated)).toBe(true);
    expect(generated.at(14)).toBe('7');
  });
});
