import { UnauthorizedException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { RuntimeInfrastructure } from '@satori/infrastructure';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { validateEnvironment } from '../../../packages/infrastructure/src/config/environment.js';
import { CatalogApplicationService } from '../../../packages/modules/src/catalog/application/index.js';
import { CatalogController } from '../../../packages/modules/src/catalog/controller/index.js';
import { ConsumptionApplicationService } from '../../../packages/modules/src/consumption/application/index.js';
import { ConsumptionController } from '../../../packages/modules/src/consumption/controller/index.js';
import { AccessTokenGuard } from '../../../packages/modules/src/identity/auth/access-token.guard.js';
import { AccessTokenService } from '../../../packages/modules/src/identity/auth/access-token.service.js';
import { MembershipApplicationService } from '../../../packages/modules/src/membership/application/index.js';
import { MembershipController } from '../../../packages/modules/src/membership/controller/index.js';
import { OrderApplicationService } from '../../../packages/modules/src/order/application/index.js';
import { OrderController } from '../../../packages/modules/src/order/controller/index.js';
import {
  PAYMENT_PAYER_AUTHORIZER,
  PaymentApplicationService,
  WECHAT_WEBHOOK_ALLOWED_IPS,
} from '../../../packages/modules/src/payment/application/index.js';
import { PaymentController } from '../../../packages/modules/src/payment/controller/index.js';
import { PricingApplicationService } from '../../../packages/modules/src/pricing/application/index.js';
import { PricingController } from '../../../packages/modules/src/pricing/controller/index.js';
import { RefundApplicationService } from '../../../packages/modules/src/refund/application/index.js';
import { RefundController } from '../../../packages/modules/src/refund/controller/index.js';
import { configureApi, createFastifyAdapter } from './configure-api.js';

const retiredFlags = [
  'R11_CATALOG_PRICING_ENABLED',
  'R11_ENTITLEMENT_CONSUMPTION_ENABLED',
  'R11_NEW_ORDERS_ENABLED',
  'R11_MEMBERSHIP_ENABLED',
  'R11_ORDINARY_REFUNDS_ENABLED',
  'R11_MEMBERSHIP_UPGRADES_ENABLED',
];
const commands = [
  '/checkout-quotes',
  '/entitlement-resolutions',
  '/consumption-intents',
  '/money-orders',
  '/money-orders/order-1/payment-attempts',
  '/refund-quotes',
  '/refunds',
  '/membership-upgrades',
  '/membership-upgrades/preview',
];

describe.each(['absent', 'false'] as const)('commerce routes with retired flags %s', (legacyValue) => {
  let app: NestFastifyApplication;
  const acceptWebhook = vi.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    const environment = validateEnvironment({
      SMS_DELIVERY_MODE: 'FIXED_CODE',
      AQUA_BASE_URL: 'https://aqua.example.com',
      AQUA_SERVICE_KEY: 'test-service-key-with-safe-length',
      ...(legacyValue === 'false' ? Object.fromEntries(retiredFlags.map((name) => [name, 'false'])) : {}),
    });
    for (const name of retiredFlags) expect(environment).not.toHaveProperty(name);
    const module = await Test.createTestingModule({
      controllers: [
        CatalogController,
        PricingController,
        ConsumptionController,
        OrderController,
        PaymentController,
        MembershipController,
        RefundController,
      ],
      providers: [
        { provide: APP_GUARD, useClass: AccessTokenGuard },
        {
          provide: RuntimeInfrastructure,
          useValue: {
            environment,
            database: {
              select: () => ({
                from: () => ({
                  innerJoin: () => ({
                    where: () => ({
                      limit: () => Promise.resolve([{ userId: 'user-1', sessionId: 'session-1' }]),
                    }),
                  }),
                }),
              }),
            },
          },
        },
        {
          provide: AccessTokenService,
          useValue: {
            verify: (token: string) => {
              if (token !== 'test-session') throw new UnauthorizedException({ code: 'ACCESS_TOKEN_INVALID' });
              return Promise.resolve({ userId: 'user-1', sessionId: 'session-1' });
            },
          },
        },
        {
          provide: CatalogApplicationService,
          useValue: { list: () => Promise.resolve([]), listMembershipPlans: () => Promise.resolve([]) },
        },
        ...[
          PricingApplicationService,
          ConsumptionApplicationService,
          OrderApplicationService,
          MembershipApplicationService,
          RefundApplicationService,
        ].map((provide) => ({ provide, useValue: {} })),
        { provide: PaymentApplicationService, useValue: { acceptWebhook } },
        { provide: PAYMENT_PAYER_AUTHORIZER, useValue: {} },
        { provide: WECHAT_WEBHOOK_ALLOWED_IPS, useValue: new Set(['127.0.0.1']) },
      ],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(createFastifyAdapter());
    await configureApi(app, environment);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => app?.close());

  it.each(['/service-offerings', '/membership-plans'])('serves authenticated catalog %s', async (path) => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1${path}`,
      headers: { authorization: 'Bearer test-session' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: unknown[] }>().data).toEqual([]);
  });

  it.each(commands)('keeps authentication on %s', async (path) => {
    const response = await app.inject({ method: 'POST', url: `/api/v1${path}`, payload: {} });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('ACCESS_TOKEN_MISSING');
  });

  it.each(commands.filter((path) => !path.includes('payment-attempts')))(
    'keeps request validation on %s',
    async (path) => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1${path}`,
        payload: {},
        headers: { authorization: 'Bearer test-session' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_FAILED');
    },
  );

  it('keeps the public payment callback and its exact raw body', async () => {
    const payload = '{ "event_type": "TRANSACTION.SUCCESS" }';
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/internal/payment-webhooks/wechat',
      headers: { 'content-type': 'application/json' },
      payload,
    });
    expect(response.statusCode).toBe(204);
    expect(acceptWebhook).toHaveBeenCalledWith(expect.any(Object), payload);
  });

  it('still rejects callbacks from an untrusted network', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/internal/payment-webhooks/wechat',
      remoteAddress: '192.0.2.1',
      payload: {},
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('WECHAT_WEBHOOK_NETWORK_FORBIDDEN');
  });
});
