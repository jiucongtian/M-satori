import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { validateEnvironment } from '@satori/infrastructure';
import { ApiModule } from './api.module.js';
import { configureApi, createFastifyAdapter } from './configure-api.js';

async function bootstrap(): Promise<void> {
  const environment = validateEnvironment(process.env);
  const app = await NestFactory.create<NestFastifyApplication>(ApiModule, createFastifyAdapter());
  await configureApi(app, environment);
  await app.listen({ host: environment.HOST, port: environment.PORT });
}

void bootstrap();
