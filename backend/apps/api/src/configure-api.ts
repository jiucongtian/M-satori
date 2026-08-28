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
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: environment.CORS_ORIGINS.split(','), credentials: true });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  app.useGlobalInterceptors(new CommerceObservabilityInterceptor(), new ApiEnvelopeInterceptor());
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
}
