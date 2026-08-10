import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ApiEnvelopeInterceptor, ApiExceptionFilter } from '@satori/contracts';
import { newId, type Environment } from '@satori/infrastructure';
import fastifyCookie from '@fastify/cookie';
import type { IncomingMessage } from 'node:http';
import { validate as validateUuid } from 'uuid';

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
  return adapter;
}

export async function configureApi(app: NestFastifyApplication, environment: Environment): Promise<void> {
  await app.register(fastifyCookie);
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: environment.CORS_ORIGINS.split(','), credentials: true });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  app.useGlobalInterceptors(new ApiEnvelopeInterceptor());
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
}
