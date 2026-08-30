import type { BusinessClock } from '../index.js';
import type { VersionedDomainEvent } from '@satori/domain';

export type InboxAcquireResult = 'ACQUIRED' | 'IN_PROGRESS' | 'COMPLETED';

export interface InboxFailure {
  readonly code: string;
  readonly message: string;
}

export interface InboxStore {
  tryAcquire(eventId: string, consumer: string, attempt: number): Promise<InboxAcquireResult>;
  complete(eventId: string, consumer: string): Promise<void>;
  fail(eventId: string, consumer: string, failure: InboxFailure, nextAttemptAt: Date | null): Promise<void>;
}

export interface EventRetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export interface InboxConsumeResult {
  readonly outcome: 'PROCESSED' | 'DUPLICATE' | 'IN_PROGRESS';
  readonly nextAttemptAt?: Date;
}

export class InboxConsumer {
  constructor(
    private readonly store: InboxStore,
    private readonly clock: BusinessClock,
    private readonly policy: EventRetryPolicy,
  ) {}

  async consume<TPayload>(
    consumer: string,
    event: VersionedDomainEvent<TPayload>,
    attempt: number,
    handler: (event: VersionedDomainEvent<TPayload>) => Promise<void>,
  ): Promise<InboxConsumeResult> {
    const acquired = await this.store.tryAcquire(event.eventId, consumer, attempt);
    if (acquired === 'COMPLETED') return { outcome: 'DUPLICATE' };
    if (acquired === 'IN_PROGRESS') return { outcome: 'IN_PROGRESS' };

    try {
      await handler(event);
      await this.store.complete(event.eventId, consumer);
      return { outcome: 'PROCESSED' };
    } catch (error) {
      const nextAttemptAt = this.nextAttemptAt(attempt);
      await this.store.fail(event.eventId, consumer, toInboxFailure(error), nextAttemptAt);
      if (nextAttemptAt) return { outcome: 'IN_PROGRESS', nextAttemptAt };
      throw error;
    }
  }

  private nextAttemptAt(attempt: number): Date | null {
    if (attempt >= this.policy.maxAttempts) return null;
    const delay = Math.min(this.policy.maxDelayMs, this.policy.baseDelayMs * 2 ** Math.max(0, attempt - 1));
    return new Date(this.clock.now().getTime() + delay);
  }
}

function toInboxFailure(error: unknown): InboxFailure {
  if (error instanceof Error) return { code: error.name, message: error.message };
  return { code: 'UNKNOWN', message: String(error) };
}
