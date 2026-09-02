import { BadRequestException, Injectable } from '@nestjs/common';
import { analyticsEvents, RuntimeInfrastructure } from '@satori/infrastructure';
import { z } from 'zod';

const resultValues = ['success', 'failed', 'cancelled', 'blocked', 'timeout'] as const;
const forbiddenKey = /(phone|mobile|name|question|prompt|report|birth|address|password|token|cookie|secret|credential|identity|imei)/i;
const sensitiveValue = /(?:^|\D)1[3-9]\d{9}(?:\D|$)|bearer\s+[a-z0-9._-]+|(?:password|token|secret)=/i;

const eventSchema = z.object({
  event_id: z.string().uuid(),
  event_name: z.string().regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+){2,}$/).max(128),
  schema_version: z.number().int().min(1).max(100),
  occurred_at: z.string().datetime({ offset: true }),
  environment: z.enum(['local', 'test', 'production']),
  release: z.string().min(1).max(32),
  app_version: z.string().min(1).max(64),
  commit_sha: z.string().max(64).optional(),
  anonymous_id: z.string().min(8).max(128),
  session_id: z.string().min(8).max(128),
  page_code: z.string().max(64).optional(),
  route: z.string().max(240).optional(),
  source_page: z.string().max(64).optional(),
  object_type: z.string().max(64).optional(),
  object_id: z.string().max(128).optional(),
  result: z.enum(resultValues).optional(),
  reason_code: z.string().max(96).optional(),
  request_id: z.string().uuid().optional(),
  entry: z.string().max(64).optional(),
  properties: z.record(z.string(), z.unknown()).default({}),
  consent_version: z.string().max(64).optional(),
  device: z.record(z.string(), z.unknown()).default({}),
}).strict();

const batchSchema = z.object({ events: z.array(eventSchema).min(1).max(20) }).strict();

@Injectable()
export class AnalyticsService {
  constructor(private readonly infrastructure: RuntimeInfrastructure) {}

  async ingest(input: unknown, authenticatedUserId?: string): Promise<{ accepted: boolean; acceptedCount: number }> {
    if (!this.infrastructure.environment.ANALYTICS_INGESTION_ENABLED) {
      return { accepted: false, acceptedCount: 0 };
    }

    const parsed = batchSchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'ANALYTICS_BATCH_INVALID', message: 'Analytics batch is invalid' });
    }
    for (const event of parsed.data.events) assertNoSensitiveData(event.properties, 'properties');
    for (const event of parsed.data.events) assertNoSensitiveData(event.device, 'device');

    const rows = parsed.data.events.map((event) => ({
      eventId: event.event_id,
      userId: authenticatedUserId ?? null,
      eventName: event.event_name,
      schemaVersion: event.schema_version,
      occurredAt: new Date(event.occurred_at),
      environment: event.environment,
      release: event.release,
      appVersion: event.app_version,
      commitSha: event.commit_sha,
      anonymousId: event.anonymous_id,
      sessionId: event.session_id,
      pageCode: event.page_code,
      route: event.route,
      sourcePage: event.source_page,
      objectType: event.object_type,
      objectId: event.object_id,
      result: event.result,
      reasonCode: event.reason_code,
      requestId: event.request_id,
      entry: event.entry,
      properties: event.properties,
      consentVersion: event.consent_version,
      device: event.device,
    }));
    await this.infrastructure.database.insert(analyticsEvents).values(rows).onConflictDoNothing();
    return { accepted: true, acceptedCount: rows.length };
  }
}

function assertNoSensitiveData(value: unknown, path: string): void {
  if (typeof value === 'string') {
    if (value.length > 500 || sensitiveValue.test(value)) {
      throw new BadRequestException({ code: 'ANALYTICS_SENSITIVE_DATA', message: `Sensitive analytics value at ${path}` });
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 50) throw new BadRequestException({ code: 'ANALYTICS_VALUE_TOO_LARGE' });
    value.forEach((item, index) => assertNoSensitiveData(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 50) throw new BadRequestException({ code: 'ANALYTICS_VALUE_TOO_LARGE' });
  for (const [key, child] of entries) {
    if (forbiddenKey.test(key)) {
      throw new BadRequestException({ code: 'ANALYTICS_SENSITIVE_DATA', message: `Forbidden analytics key at ${path}.${key}` });
    }
    assertNoSensitiveData(child, `${path}.${key}`);
  }
}
