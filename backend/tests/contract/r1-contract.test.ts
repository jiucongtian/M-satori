import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DailyInsightContentSchema, validateDailyInsightResult } from '@satori/application';
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
  '/me/life-profile*': [
    'get /me/life-profile',
    'patch /me/life-profile',
    'post /me/life-profile/revisions/preview',
    'get /me/life-profile/revisions/{revisionId}/first-look',
    'post /me/life-profile/revisions/{revisionId}/first-look',
  ],
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

  it('freezes the provider-neutral PROFILE-11 result contract in the product API', () => {
    expect(openapi).toContain('ProfileFirstLookContent:');
    expect(openapi).toContain("schemaVersion: {const: '1.0.0'}");
    expect(openapi).toContain('position: {type: string, enum: [hour, day, month, year]}');
    expect(openapi).toContain('dimension: {type: string, enum: [思想, 行为, 事业, 梦想目标]}');
    expect(openapi).toContain('workflowVersion: {type: string}');
    expect(openapi).toContain('skillVersion: {type: string}');
    expect(openapi).toContain('generator: {type: string, enum: [aqua, deterministic]}');
    expect(openapi).toContain('notice: {const: 这是一份基础认识，不是对你人生的定论。}');
  });

  it('validates provider-neutral daily-insight content', () => {
    const result = {
      content: {
        theme: '保持清晰的边界',
        insight: '今天适合观察自己的感受与选择。',
        action: '选择一件真正重要的小事。',
        reflectionQuestion: '今天什么事情最值得投入注意力？',
        notice: '内容用于自我观察与成长参考。' as const,
      },
      manifest: {
        generator: 'AQUA_AI',
        modelVersion: 'contract-test',
        promptVersion: 'daily-insight/1.0',
        knowledgeVersion: 'knowledge/2026-08-10',
        schemaVersion: 'daily-insight/1.0',
        contentPolicyVersion: 'r1.0',
        generatedAt: new Date(0).toISOString(),
      },
    };
    expect(DailyInsightContentSchema.parse(result.content)).toEqual(result.content);
    expect(validateDailyInsightResult(result)).toBe(result);
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

  it('defines the R1.1 catalog and authoritative quote contract', () => {
    expect(routeBlock('/service-offerings')).toContain('\n    get:');
    expect(routeBlock('/service-offerings/{offeringId}')).toContain('\n    get:');
    expect(routeBlock('/membership-plans')).toContain('\n    get:');
    expect(routeBlock('/checkout-quotes')).toContain('\n    post:');
    expect(openapi).toContain('additionalProperties: false, required: [offeringId]');
    expect(openapi).not.toContain('seedExchangeRate');
    expect(openapi).not.toContain('seedDiscountAmount');
  });

  it('implements the source-separated R1.1 entitlement query contract', () => {
    expect(routeBlock('/me/entitlements')).toContain('\n    get:');
    expect(routeBlock('/me/entitlements/{entitlementId}')).toContain('\n    get:');
    expect(routeBlock('/me/usage-records')).toContain('\n    get:');
    const controller = readFileSync(
      `${backendRoot}/packages/modules/src/entitlement/controller/index.ts`,
      'utf8',
    );
    const application = readFileSync(
      `${backendRoot}/packages/modules/src/entitlement/application/index.ts`,
      'utf8',
    );
    expect(controller).toContain("@Get('entitlements')");
    expect(controller).toContain("@Get('entitlements/:entitlementId')");
    expect(controller).toContain("@Get('usage-records')");
    expect(application).toContain('entitlementId: grant.id');
    expect(application).toContain("grant.status === 'ACTIVE'");
    expect(application).toContain("? 'AVAILABLE'");
  });

  it('exposes system-only consumption resolution without a client source override', () => {
    expect(routeBlock('/entitlement-resolutions')).toContain('\n    post:');
    expect(routeBlock('/consumption-intents')).toContain('\n    post:');
    expect(routeBlock('/consumption-intents/{intentId}')).toContain('\n    get:');
    expect(routeBlock('/consumption-intents/{intentId}/start')).toContain('\n    post:');
    const requestSchema = openapi
      .split('\n')
      .find((line) => line.includes('CreateEntitlementResolutionRequest:'));
    expect(requestSchema).toContain('additionalProperties: false');
    expect(requestSchema).not.toContain('sourceId');
    expect(openapi).not.toContain('/entitlement-resolutions/{resolutionId}/selection');
  });

  it('keeps /me nextAction aligned with pending registration rewards', () => {
    const source = readFileSync(`${backendRoot}/packages/modules/src/identity/me/me.service.ts`, 'utf8');
    expect(source).toContain('registrationRewards.status');
    expect(source).toMatch(/reward\?\.status === 'AVAILABLE' \? 'CLAIM_REGISTRATION_REWARD' : 'VIEW_HOME'/u);
    expect(source).toMatch(/nextAction = await this\.resolveNextAction/u);
  });
});
