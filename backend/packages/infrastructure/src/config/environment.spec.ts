import { validate as validateUuid } from 'uuid';
import { describe, expect, it } from 'vitest';
import { newId } from '../database/ids.js';
import { validateEnvironment } from './environment.js';

describe('runtime baseline', () => {
  it('uses auditable R1 defaults', () => {
    const environment = validateEnvironment({});
    expect(environment.DAILY_INSIGHT_PRICE).toBe(1);
    expect(environment.QUEUE_JOB_TIMEOUT_MS).toBe(360_000);
    expect(environment.REGISTRATION_REWARD_AMOUNT).toBe(3);
    expect(environment.OTP_TTL_SECONDS).toBe(300);
    expect(environment.ACCOUNT_DELETION_CANCELLATION_HOURS).toBe(168);
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

  it('generates UUIDv7 identifiers', () => {
    const generated = newId();
    expect(validateUuid(generated)).toBe(true);
    expect(generated.at(14)).toBe('7');
  });
});
