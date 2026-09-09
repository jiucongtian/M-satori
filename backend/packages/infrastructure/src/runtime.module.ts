import { Global, Injectable, Module, type OnModuleInit, type OnApplicationShutdown } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';
import { validateEnvironment, type Environment } from './config/environment.js';
import { R1_RUNTIME_POLICY, type RuntimePolicy } from './config/runtime-policy.js';
import { createDatabase, type Database } from './database/client.js';
import { closeQueueInfrastructure, createQueueInfrastructure } from './queue/client.js';
import { startRuntimeTelemetry } from './observability/runtime.js';
import { FieldCipher } from './security/field-cipher.js';

@Injectable()
export class RuntimeInfrastructure implements OnApplicationShutdown, OnModuleInit {
  private stopTelemetry?: () => void;
  readonly environment: Environment;
  readonly policy: RuntimePolicy;
  readonly pool: Pool;
  readonly database: Database;
  readonly redis: Redis;
  readonly generationQueue: Queue;
  readonly commerceQueue: Queue;

  constructor() {
    this.environment = validateEnvironment(process.env);
    this.policy = R1_RUNTIME_POLICY;
    const databaseInfrastructure = createDatabase(this.environment);
    const queueInfrastructure = createQueueInfrastructure(this.environment, this.policy);
    this.pool = databaseInfrastructure.pool;
    this.database = databaseInfrastructure.database;
    this.redis = queueInfrastructure.redis;
    this.generationQueue = queueInfrastructure.generationQueue;
    this.commerceQueue = queueInfrastructure.commerceQueue;
  }

  onModuleInit() {
    this.stopTelemetry = startRuntimeTelemetry(this.pool, [this.generationQueue, this.commerceQueue]);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopTelemetry?.();
    await closeQueueInfrastructure(this.redis, this.generationQueue, this.commerceQueue);
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    RuntimeInfrastructure,
    {
      provide: FieldCipher,
      inject: [RuntimeInfrastructure],
      useFactory: (infrastructure: RuntimeInfrastructure) =>
        new FieldCipher(infrastructure.environment.DATA_ENCRYPTION_KEY),
    },
  ],
  exports: [RuntimeInfrastructure, FieldCipher],
})
export class RuntimeInfrastructureModule {}
