import { describe, expect, it } from 'vitest';
import {
  IdempotencyKeyReusedError,
  IdempotencyService,
  type IdempotencyScope,
  type IdempotencyStore,
  type StoredIdempotencyRecord,
} from './idempotency.js';

class MemoryStore implements IdempotencyStore {
  record: StoredIdempotencyRecord | null = null;
  find(): Promise<StoredIdempotencyRecord | null> {
    return Promise.resolve(this.record);
  }
  tryCreate(record: StoredIdempotencyRecord): Promise<boolean> {
    if (this.record) return Promise.resolve(false);
    this.record = record;
    return Promise.resolve(true);
  }
  complete(_scope: IdempotencyScope, status: number, body: unknown): Promise<void> {
    if (this.record) this.record = { ...this.record, responseStatus: status, responseBody: body };
    return Promise.resolve();
  }
  abandon(): Promise<void> {
    this.record = null;
    return Promise.resolve();
  }
  deleteExpired(): Promise<number> {
    this.record = null;
    return Promise.resolve(1);
  }
}

describe('idempotency', () => {
  const scope = { actorKey: 'user:user', operation: 'claim', key: '0123456789abcdef' };

  it('executes once and replays the first response', async () => {
    const service = new IdempotencyService(new MemoryStore(), 60_000);
    let calls = 0;
    const command = () => Promise.resolve({ status: 200, body: { calls: ++calls } });
    expect((await service.execute(scope, { a: 1, b: 2 }, command)).replayed).toBe(false);
    expect((await service.execute(scope, { b: 2, a: 1 }, command)).replayed).toBe(true);
    expect(calls).toBe(1);
  });

  it('rejects key reuse with a different payload', async () => {
    const service = new IdempotencyService(new MemoryStore(), 60_000);
    await service.execute(scope, { value: 1 }, () => Promise.resolve({ status: 201, body: {} }));
    await expect(
      service.execute(scope, { value: 2 }, () => Promise.resolve({ status: 201, body: {} })),
    ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
  });
});
