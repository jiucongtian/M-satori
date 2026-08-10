import { createHash } from 'node:crypto';

export interface IdempotencyScope {
  actorKey: string;
  operation: string;
  key: string;
}

export interface StoredIdempotencyRecord extends IdempotencyScope {
  requestHash: string;
  responseStatus: number | null;
  responseBody: unknown;
  expiresAt: Date;
}

export interface IdempotencyStore {
  find(scope: IdempotencyScope): Promise<StoredIdempotencyRecord | null>;
  tryCreate(record: StoredIdempotencyRecord): Promise<boolean>;
  complete(scope: IdempotencyScope, status: number, body: unknown): Promise<void>;
  abandon(scope: IdempotencyScope): Promise<void>;
  deleteExpired(now: Date): Promise<number>;
}

export class IdempotencyKeyReusedError extends Error {
  readonly code = 'IDEMPOTENCY_KEY_REUSED';
}

export class IdempotencyInProgressError extends Error {
  readonly code = 'IDEMPOTENCY_IN_PROGRESS';
}

export interface IdempotentResult<T> {
  status: number;
  body: T;
  replayed: boolean;
}

export class IdempotencyService {
  constructor(
    private readonly store: IdempotencyStore,
    private readonly retentionMs: number,
  ) {}

  async execute<T>(
    scope: IdempotencyScope,
    payload: unknown,
    command: () => Promise<{ status: number; body: T }>,
  ): Promise<IdempotentResult<T>> {
    const requestHash = hashPayload(payload);
    const existing = await this.store.find(scope);
    if (existing) return this.replay<T>(existing, requestHash);
    const created = await this.store.tryCreate({
      ...scope,
      requestHash,
      responseStatus: null,
      responseBody: null,
      expiresAt: new Date(Date.now() + this.retentionMs),
    });
    if (!created) {
      const concurrent = await this.store.find(scope);
      if (!concurrent) throw new IdempotencyInProgressError('Concurrent command not visible');
      return this.replay<T>(concurrent, requestHash);
    }
    try {
      const result = await command();
      await this.store.complete(scope, result.status, result.body);
      return { ...result, replayed: false };
    } catch (error) {
      await this.store.abandon(scope);
      throw error;
    }
  }

  private replay<T>(record: StoredIdempotencyRecord, requestHash: string): IdempotentResult<T> {
    if (record.requestHash !== requestHash) {
      throw new IdempotencyKeyReusedError('Idempotency key was used with a different payload');
    }
    if (record.responseStatus === null) throw new IdempotencyInProgressError('Command is still processing');
    return { status: record.responseStatus, body: record.responseBody as T, replayed: true };
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

export function hashPayload(payload: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(payload)))
    .digest('hex');
}
