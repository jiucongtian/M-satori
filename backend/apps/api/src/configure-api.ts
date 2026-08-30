import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ApiEnvelopeInterceptor, ApiExceptionFilter, CommerceObservabilityInterceptor } from '@satori/contracts';
import { newId, type Environment } from '@satori/infrastructure';
import fastifyCookie from '@fastify/cookie';
import type { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import { validate as validateUuid } from 'uuid';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

export function createFastifyAdapter(): FastifyAdapter {
  const adapter = new FastifyAdapter({
    genReqId(request: IncomingMessage) {
      const supplied = request.headers['x-request-id'];
      const candidate = Array.isArray(supplied) ? supplied[0] : supplied;
      return candidate && validateUuid(candidate) ? candidate : newId();
    },
  });
  adapter.getInstance().addHook('onRequest', (request, reply, done) => {
    void reply.header('X-Request-Id', request.id);
    done();
  });
  adapter.getInstance().addHook('preParsing', async (request, _reply, payload) => {
    if (!request.url.startsWith('/api/v1/internal/payment-webhooks/wechat')) return payload;
    const chunks: Buffer[] = [];
    for await (const chunk of payload as AsyncIterable<unknown>) {
      if (typeof chunk === 'string' || chunk instanceof Uint8Array) chunks.push(Buffer.from(chunk));
      else throw new TypeError('Unsupported webhook body chunk');
    }
    const body = Buffer.concat(chunks);
    request.rawBody = body.toString('utf8');
    return Readable.from(body);
  });
  return adapter;
}

export async function configureApi(app: NestFastifyApplication, environment: Environment): Promise<void> {
  await app.register(fastifyCookie);
  app.getHttpAdapter().getInstance().addHook('onRequest', (request, reply, done) => {
    const disabledFeature = disabledCommerceFeature(environment, request.method, request.url);
    if (!disabledFeature) return done();
    console.info('commerce_feature_blocked', { requestId: request.id, feature: disabledFeature });
    void reply.status(503).send({
      error: {
        code: 'FEATURE_NOT_AVAILABLE',
        message: '该能力正在分阶段开放，请稍后再试',
        requestId: request.id,
        details: { feature: disabledFeature },
      },
    });
  });
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: environment.CORS_ORIGINS.split(','), credentials: true });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  app.useGlobalInterceptors(new CommerceObservabilityInterceptor(), new ApiEnvelopeInterceptor());
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
}

export function disabledCommerceFeature(
  environment: Environment,
  method: string,
  requestUrl: string,
): string | null {
  const path = new URL(requestUrl, 'http://satori.local').pathname;
  if (
    !environment.R11_CATALOG_PRICING_ENABLED &&
    (path.startsWith('/api/v1/service-offerings') ||
      path === '/api/v1/membership-plans' ||
      path === '/api/v1/checkout-quotes')
  ) return 'R11_CATALOG_PRICING_ENABLED';
  if (
    !environment.R11_ENTITLEMENT_CONSUMPTION_ENABLED &&
    method === 'POST' &&
    (path === '/api/v1/entitlement-resolutions' || path.startsWith('/api/v1/consumption-intents'))
  ) return 'R11_ENTITLEMENT_CONSUMPTION_ENABLED';
  if (
    !environment.R11_NEW_ORDERS_ENABLED &&
    method === 'POST' &&
    (path === '/api/v1/money-orders' || /^\/api\/v1\/money-orders\/[^/]+\/payment-attempts$/.test(path))
  ) return 'R11_NEW_ORDERS_ENABLED';
  if (!environment.R11_MEMBERSHIP_ENABLED && path === '/api/v1/membership-plans') {
    return 'R11_MEMBERSHIP_ENABLED';
  }
  if (
    !environment.R11_ORDINARY_REFUNDS_ENABLED &&
    method === 'POST' &&
    (path === '/api/v1/refund-quotes' || path === '/api/v1/refunds')
  ) return 'R11_ORDINARY_REFUNDS_ENABLED';
  if (
    !environment.R11_MEMBERSHIP_UPGRADES_ENABLED &&
    method === 'POST' &&
    path.startsWith('/api/v1/membership-upgrades')
  ) return 'R11_MEMBERSHIP_UPGRADES_ENABLED';
  return null;
}
