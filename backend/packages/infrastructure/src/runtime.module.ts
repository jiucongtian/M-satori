import { Global, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';
import { validateEnvironment, type Environment } from './config/environment.js';
import { createDatabase, type Database } from './database/client.js';
import { closeQueueInfrastructure, createQueueInfrastructure } from './queue/client.js';
import { FieldCipher } from './security/field-cipher.js';

@Injectable()
export class RuntimeInfrastructure implements OnApplicationShutdown {
  readonly environment: Environment;
  readonly pool: Pool;
  readonly database: Database;
  readonly redis: Redis;
  readonly generationQueue: Queue;

  constructor() {
    this.environment = validateEnvironment(process.env);
    const databaseInfrastructure = createDatabase(this.environment);
    const queueInfrastructure = createQueueInfrastructure(this.environment);
    this.pool = databaseInfrastructure.pool;
    this.database = databaseInfrastructure.database;
    this.redis = queueInfrastructure.redis;
    this.generationQueue = queueInfrastructure.generationQueue;
  }

  async onApplicationShutdown(): Promise<void> {
    await closeQueueInfrastructure(this.redis, this.generationQueue);
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
