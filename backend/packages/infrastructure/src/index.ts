export interface TransactionContext {
  readonly transactionId: string;
}

export interface TransactionManager {
  run<T>(work: (context: TransactionContext) => Promise<T>): Promise<T>;
}

export * from './config/environment.js';
export * from './config/runtime-policy.js';
export * from './database/client.js';
export * from './database/ids.js';
export * from './database/postgres-idempotency.store.js';
export * from './database/schema.js';
export * from './health.js';
export * from './queue/client.js';
export * from './runtime.module.js';
export * from './security/field-cipher.js';
