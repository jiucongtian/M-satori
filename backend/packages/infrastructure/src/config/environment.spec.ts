import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validate as validateUuid } from 'uuid';
import { describe, expect, it } from 'vitest';
import { newId } from '../database/ids.js';
import { environmentVariableNames, validateEnvironment } from './environment.js';

const aquaEnvironment = {
  SMS_DELIVERY_MODE: 'FIXED_CODE',
  AQUA_AI_BASE_URL: 'https://aqua.example.com',
  AQUA_AI_SERVICE_KEY: 'test-service-key-with-safe-length',
};

describe('runtime baseline', () => {
  it('uses auditable R1 defaults', () => {
    const environment = validateEnvironment(aquaEnvironment);
    expect(environment.QUEUE_JOB_TIMEOUT_MS).toBe(360_000);
    expect(environment.HOME_ENERGY_PREWARM_PROFILE).toBe('NORMAL');
    expect(environment).not.toHaveProperty('DAILY_INSIGHT_PRICE');
    expect(environment).not.toHaveProperty('FEATURE_DAILY_INSIGHT');
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

  it('requires Aqua daily-insight configuration without accepting a JWT signing secret', () => {
    const environment = validateEnvironment(aquaEnvironment);
    expect(environment.AQUA_AI_WORKFLOW_ID).toBe('daily-insight');
    expect(environment).not.toHaveProperty('AQUA_JWT_SECRET');
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

  it('requires server-only Aqua credentials when home energy summaries are enabled', () => {
    expect(() => validateEnvironment({ ...aquaEnvironment, HOME_ENERGY_SUMMARY_ENABLED: 'true' })).toThrow();
    const environment = validateEnvironment({
      ...aquaEnvironment,
      HOME_ENERGY_SUMMARY_ENABLED: 'true',
      HOME_ENERGY_PREWARM_ENABLED: 'true',
      AQUA_BASE_URL: 'https://aqua.example.com',
      AQUA_TENANT_SERVICE_KEY: 'test-tenant-service-key-safe-length',
    });
    expect(environment.HOME_ENERGY_SUMMARY_ENABLED).toBe(true);
    expect(environment.HOME_ENERGY_PREWARM_ENABLED).toBe(true);
    expect(environment.HOME_ENERGY_SUMMARY_MAX_ATTEMPTS).toBe(2);
    expect(environment.HOME_ENERGY_PREWARM_PROFILE).toBe('NORMAL');
    expect(
      validateEnvironment({
        ...aquaEnvironment,
        HOME_ENERGY_SUMMARY_ENABLED: 'true',
        HOME_ENERGY_PREWARM_ENABLED: 'true',
        HOME_ENERGY_PREWARM_PROFILE: 'CONSERVATIVE',
        AQUA_BASE_URL: 'https://aqua.example.com',
        AQUA_TENANT_SERVICE_KEY: 'test-tenant-service-key-safe-length',
      }).HOME_ENERGY_PREWARM_PROFILE,
    ).toBe('CONSERVATIVE');
    expect(() =>
      validateEnvironment({ ...aquaEnvironment, HOME_ENERGY_PREWARM_PROFILE: 'AGGRESSIVE' }),
    ).toThrow();
    expect(() => validateEnvironment({ ...aquaEnvironment, HOME_ENERGY_PREWARM_ENABLED: 'true' })).toThrow();
  });

  it('generates UUIDv7 identifiers', () => {
    const generated = newId();
    expect(validateUuid(generated)).toBe(true);
    expect(generated.at(14)).toBe('7');
  });
});
