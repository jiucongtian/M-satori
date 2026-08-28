export type EntityId = string;
export type UtcTimestamp = string;

export interface DomainEvent<TPayload = unknown> {
  readonly eventId: EntityId;
  readonly occurredAt: UtcTimestamp;
  readonly type: string;
  readonly payload: TPayload;
}

export * from './commerce.js';
export * from './events.js';
