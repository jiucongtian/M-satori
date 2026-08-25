import { validate as validateUuid } from 'uuid';
import { describe, expect, it } from 'vitest';
import { newId } from '../database/ids.js';
import { validateEnvironment } from './environment.js';

describe('runtime baseline', () => {
  it('uses auditable R1 defaults', () => {
    const environment = validateEnvironment({});
    expect(environment.QUEUE_JOB_TIMEOUT_MS).toBe(360_000);
    expect(environment.HOME_ENERGY_PREWARM_PROFILE).toBe('NORMAL');
    expect(environment).not.toHaveProperty('DAILY_INSIGHT_PRICE');
    expect(environment).not.toHaveProperty('FEATURE_DAILY_INSIGHT');
  });

  it('rejects invalid configuration', () => {
    expect(() => validateEnvironment({ PORT: '70000' })).toThrow();
    expect(() => validateEnvironment({ CORS_ORIGINS: '*' })).toThrow();
    expect(() => validateEnvironment({ NODE_ENV: 'production', COOKIE_SECURE: 'false' })).toThrow();
    expect(() => validateEnvironment({ DAILY_INSIGHT_GENERATOR: 'AQUA' })).toThrow();
  });

  it('accepts Aqua daily-insight configuration without accepting a JWT signing secret', () => {
    const environment = validateEnvironment({
      DAILY_INSIGHT_GENERATOR: 'AQUA',
      AQUA_AI_BASE_URL: 'https://aqua.example.com',
      AQUA_AI_SERVICE_KEY: 'test-service-key-with-safe-length',
    });
    expect(environment.AQUA_AI_WORKFLOW_ID).toBe('daily-insight');
    expect(environment).not.toHaveProperty('AQUA_JWT_SECRET');
  });

  it('uses local first-look generation without Aqua credentials and validates the Aqua opt-in', () => {
    const local = validateEnvironment({ PROFILE_FIRST_LOOK_ENABLED: 'true' });
    expect(local.PROFILE_FIRST_LOOK_GENERATOR).toBe('LOCAL');
    expect(() =>
      validateEnvironment({
        PROFILE_FIRST_LOOK_ENABLED: 'true',
        PROFILE_FIRST_LOOK_GENERATOR: 'AQUA',
      }),
    ).toThrow();
    const aqua = validateEnvironment({
      PROFILE_FIRST_LOOK_ENABLED: 'true',
      PROFILE_FIRST_LOOK_GENERATOR: 'AQUA',
      AQUA_AI_BASE_URL: 'https://aqua.example.com',
      AQUA_AI_SERVICE_KEY: 'test-service-key-with-safe-length',
    });
    expect(aqua.PROFILE_FIRST_LOOK_GENERATOR).toBe('AQUA');
  });

  it('requires server-only Aqua credentials when home energy summaries are enabled', () => {
    expect(() => validateEnvironment({ HOME_ENERGY_SUMMARY_ENABLED: 'true' })).toThrow();
    const environment = validateEnvironment({
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
        HOME_ENERGY_SUMMARY_ENABLED: 'true',
        HOME_ENERGY_PREWARM_ENABLED: 'true',
        HOME_ENERGY_PREWARM_PROFILE: 'CONSERVATIVE',
        AQUA_BASE_URL: 'https://aqua.example.com',
        AQUA_TENANT_SERVICE_KEY: 'test-tenant-service-key-safe-length',
      }).HOME_ENERGY_PREWARM_PROFILE,
    ).toBe('CONSERVATIVE');
    expect(() => validateEnvironment({ HOME_ENERGY_PREWARM_PROFILE: 'AGGRESSIVE' })).toThrow();
    expect(() => validateEnvironment({ HOME_ENERGY_PREWARM_ENABLED: 'true' })).toThrow();
  });

  it('generates UUIDv7 identifiers', () => {
    const generated = newId();
    expect(validateUuid(generated)).toBe(true);
    expect(generated.at(14)).toBe('7');
  });
});
