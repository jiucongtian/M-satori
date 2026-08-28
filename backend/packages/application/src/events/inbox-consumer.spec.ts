import type { VersionedDomainEvent } from '@satori/domain';
import { describe, expect, it } from 'vitest';
import {
  InboxConsumer,
  type InboxAcquireResult,
  type InboxFailure,
  type InboxStore,
} from './inbox-consumer.js';

class MemoryInboxStore implements InboxStore {
  state: InboxAcquireResult = 'ACQUIRED';
  failure: { value: InboxFailure; nextAttemptAt: Date | null } | null = null;

  tryAcquire(): Promise<InboxAcquireResult> {
    return Promise.resolve(this.state);
  }

  complete(): Promise<void> {
    this.state = 'COMPLETED';
    return Promise.resolve();
  }

  fail(
    _eventId: string,
    _consumer: string,
    failure: InboxFailure,
    nextAttemptAt: Date | null,
  ): Promise<void> {
    this.failure = { value: failure, nextAttemptAt };
    return Promise.resolve();
  }
}

const event: VersionedDomainEvent<{ orderId: string }> = {
  eventId: 'event-1',
  eventType: 'payment.succeeded',
  schemaVersion: 1,
  aggregateType: 'payment-attempt',
  aggregateId: 'attempt-1',
  occurredAt: '2026-08-28T00:00:00.000Z',
  producer: 'payment',
  trace: { requestId: 'request-1', correlationId: 'order-1' },
  payload: { orderId: 'order-1' },
};

describe('InboxConsumer', () => {
  it('processes an event once and skips the duplicate delivery', async () => {
    const store = new MemoryInboxStore();
    const consumer = new InboxConsumer(store, { now: () => new Date(0) }, retryPolicy());
    let calls = 0;

    const handler = () => {
      calls += 1;
      return Promise.resolve();
    };
    expect(await consumer.consume('fulfillment', event, 1, handler)).toEqual({
      outcome: 'PROCESSED',
    });
    expect(await consumer.consume('fulfillment', event, 2, handler)).toEqual({
      outcome: 'DUPLICATE',
    });
    expect(calls).toBe(1);
  });

  it('records an exponential retry deadline after a transient failure', async () => {
    const store = new MemoryInboxStore();
    const consumer = new InboxConsumer(store, { now: () => new Date(1_000) }, retryPolicy());

    const result = await consumer.consume('fulfillment', event, 2, () =>
      Promise.reject(new Error('temporary')),
    );

    expect(result).toEqual({ outcome: 'IN_PROGRESS', nextAttemptAt: new Date(3_000) });
    expect(store.failure).toEqual({
      value: { code: 'Error', message: 'temporary' },
      nextAttemptAt: new Date(3_000),
    });
  });

  it('rethrows after the retry budget is exhausted', async () => {
    const store = new MemoryInboxStore();
    const consumer = new InboxConsumer(store, { now: () => new Date(0) }, retryPolicy());

    await expect(
      consumer.consume('fulfillment', event, 3, () => Promise.reject(new Error('permanent'))),
    ).rejects.toThrow('permanent');
    expect(store.failure?.nextAttemptAt).toBeNull();
  });
});

function retryPolicy() {
  return { maxAttempts: 3, baseDelayMs: 1_000, maxDelayMs: 10_000 } as const;
}
