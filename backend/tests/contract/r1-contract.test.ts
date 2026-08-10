import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DailyInsightContentSchema, validateDailyInsightResult } from '@satori/application';
import { DeterministicDailyInsightGenerator } from '../../packages/modules/src/integrations/daily-insight/deterministic-daily-insight.generator.js';
import { describe, expect, it } from 'vitest';

const backendRoot = fileURLToPath(new URL('../..', import.meta.url));
const openapi = readFileSync(`${backendRoot}/openapi/openapi.yaml`, 'utf8');

const deliveryRoutes: Record<string, readonly string[]> = {
  'GET /app/bootstrap': ['get'],
  'GET /legal-documents/{documentId}': ['get'],
  'POST /auth/sms-challenges': ['post'],
  '/auth/sessions*': ['post /auth/sessions', 'post /auth/sessions/refresh', 'delete /auth/sessions/current'],
  '/me core': ['get /me', 'patch /me/preferences', 'post /me/consents'],
  'GET /locations': ['get'],
  '/me/life-profile*': ['get /me/life-profile', 'post /me/life-profile/revisions/preview'],
  '/me/registration-reward*': ['get /me/registration-reward', 'post /me/registration-reward/claim'],
  'GET /me/wisdom-seed-account': ['get'],
  'GET /me/wisdom-seed-transactions': ['get'],
  '/generation-tasks*': [
    'get /generation-tasks/{taskId}',
    'post /generation-tasks/{taskId}/retry',
    'get /generation-tasks/{taskId}/events',
  ],
  '/daily-insights*': [
    'post /daily-insights/today',
    'get /daily-insights',
    'get /daily-insights/{localDate}',
  ],
  'GET /me/home-overview': ['get'],
  '/me/life-profiles*': [
    'get /me/life-profiles',
    'post /me/life-profiles',
    'delete /me/life-profiles/{profileId}',
  ],
  '/me/life-profile-groups*': [
    'get /me/life-profile-groups',
    'post /me/life-profile-groups',
    'delete /me/life-profile-groups/{groupId}',
  ],
  'POST /feedback': ['post'],
  'account deletion': [
    'post /me/account-deletion-requests',
    'get /me/account-deletion-request',
    'delete /me/account-deletion-request',
  ],
};

function routeBlock(path: string): string {
  const marker = `  ${path}:`;
  const start = openapi.indexOf(marker);
  expect(start, `OpenAPI path missing: ${path}`).toBeGreaterThanOrEqual(0);
  const next = openapi.indexOf('\n  /', start + marker.length);
  return openapi.slice(start, next === -1 ? openapi.length : next);
}

describe('R1 delivery contract', () => {
  it('uses the frozen OpenAPI 3.1 baseline and standard security envelope', () => {
    expect(openapi).toContain('openapi: 3.1.0');
    expect(openapi).toMatch(/url: .*\/api\/v1/u);
    expect(openapi).toContain('bearerAuth: {type: http, scheme: bearer');
    expect(openapi).toContain('ErrorEnvelope:');
    expect(openapi).toContain('IdempotencyKey:');
  });

  for (const [capability, assertions] of Object.entries(deliveryRoutes)) {
    it(`covers delivery row: ${capability}`, () => {
      for (const assertion of assertions) {
        const [method, explicitPath] = assertion.split(' ');
        const path = explicitPath ?? capability.slice(capability.indexOf(' ') + 1);
        expect(routeBlock(path)).toMatch(new RegExp(`\\n    ${method}:`));
      }
    });
  }

  it('defines authenticated SSE replay delivery', () => {
    const block = routeBlock('/generation-tasks/{taskId}/events');
    expect(block).toContain('Last-Event-ID');
    expect(block).toContain('text/event-stream');
  });

  it('keeps the Aqua replacement stub deterministic and schema-valid', async () => {
    const generator = new DeterministicDailyInsightGenerator();
    const input = {
      dailyInsightId: '00000000-0000-7000-8000-000000000001',
      localDate: '2026-08-10',
      timezone: 'Asia/Shanghai',
      profileRevisionId: '00000000-0000-7000-8000-000000000002',
      astrologySnapshot: {},
      cards: [],
    };
    const first = await generator.generate(input);
    const second = await generator.generate(input);
    expect(first.content).toEqual(second.content);
    expect(DailyInsightContentSchema.parse(first.content)).toEqual(first.content);
    expect(validateDailyInsightResult(first)).toBe(first);
    expect(first.manifest).toMatchObject({
      generator: 'DETERMINISTIC_STUB',
      schemaVersion: 'daily-insight/1.0',
      contentPolicyVersion: 'r1.0',
    });
  });

  it('exposes test-only deterministic generator fault modes', async () => {
    const previousMode = process.env.DAILY_INSIGHT_STUB_MODE;
    const generator = new DeterministicDailyInsightGenerator();
    const input = {
      dailyInsightId: '00000000-0000-7000-8000-000000000003', localDate: '2026-08-10', timezone: 'Asia/Shanghai',
      profileRevisionId: '00000000-0000-7000-8000-000000000004', astrologySnapshot: {}, cards: [],
    };
    try {
      process.env.DAILY_INSIGHT_STUB_MODE = 'FAILURE';
      await expect(generator.generate(input)).rejects.toMatchObject({ message: 'Test daily-insight generator failure', code: 'TEST_GENERATION_FAILURE' });
    } finally {
      if (previousMode === undefined) delete process.env.DAILY_INSIGHT_STUB_MODE;
      else process.env.DAILY_INSIGHT_STUB_MODE = previousMode;
    }
  });

  it('does not log raw authentication or birth-data secrets', () => {
    const sensitiveFiles = [
      'packages/modules/src/identity/auth/session.service.ts',
      'packages/modules/src/identity/auth/sms-challenge.service.ts',
      'packages/modules/src/profile/self-profile.service.ts',
    ];
    for (const file of sensitiveFiles) {
      const source = readFileSync(`${backendRoot}/${file}`, 'utf8');
      expect(source).not.toMatch(/console\.(?:log|info|warn|error)\s*\(/u);
    }
  });
});
