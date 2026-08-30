import type { BusinessContext } from './commerce.js';
import type { EntityId, UtcTimestamp } from './index.js';

export const DOMAIN_EVENT_ENVELOPE_VERSION = 1;

export interface EventTraceContext {
  readonly requestId: string;
  readonly correlationId: string;
  readonly causationId?: string;
}

export interface VersionedDomainEvent<TPayload = unknown> {
  readonly eventId: EntityId;
  readonly eventType: string;
  readonly schemaVersion: number;
  readonly aggregateType: string;
  readonly aggregateId: EntityId;
  readonly occurredAt: UtcTimestamp;
  readonly producer: string;
  readonly trace: EventTraceContext;
  readonly businessContext?: BusinessContext;
  readonly payload: TPayload;
}
