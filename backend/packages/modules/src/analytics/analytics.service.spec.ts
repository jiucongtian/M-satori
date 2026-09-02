import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AnalyticsService } from './analytics.service.js';

const validEvent = {
  event_id: '019a0000-0000-7000-8000-000000000001',
  event_name: 'global_page_viewed',
  schema_version: 1,
  occurred_at: '2026-09-03T01:00:00.000+08:00',
  environment: 'test',
  release: 'R1.1',
  app_version: 'test-build',
  anonymous_id: 'anonymous-1',
  session_id: 'session-1',
  properties: { load_result: 'success' },
  device: { viewport_group: 'mobile' },
};

describe('AnalyticsService', () => {
  it('accepts a valid batch and uses event_id for conflict-safe insertion', async () => {
    const ignoreAnalyticsConflict = vi.fn().mockResolvedValue(undefined);
    const persistAnalyticsRows = vi.fn(() => ({ onConflictDoNothing: ignoreAnalyticsConflict }));
    const beginAnalyticsInsert = vi.fn(() => ({ values: persistAnalyticsRows }));
    const service = new AnalyticsService({
      environment: { ANALYTICS_INGESTION_ENABLED: true },
      database: { insert: beginAnalyticsInsert },
    } as never);

    await expect(service.ingest({ events: [validEvent] })).resolves.toEqual({ accepted: true, acceptedCount: 1 });
    expect(persistAnalyticsRows).toHaveBeenCalledWith([expect.objectContaining({ eventId: validEvent.event_id })]);
    expect(ignoreAnalyticsConflict).toHaveBeenCalledOnce();
  });

  it('is a no-op while ingestion is disabled', async () => {
    const beginAnalyticsInsert = vi.fn();
    const service = new AnalyticsService({
      environment: { ANALYTICS_INGESTION_ENABLED: false },
      database: { insert: beginAnalyticsInsert },
    } as never);
    await expect(service.ingest({ events: [validEvent] })).resolves.toEqual({ accepted: false, acceptedCount: 0 });
    expect(beginAnalyticsInsert).not.toHaveBeenCalled();
  });

  it('rejects sensitive keys before persistence', async () => {
    const service = new AnalyticsService({
      environment: { ANALYTICS_INGESTION_ENABLED: true },
      database: { insert: vi.fn() },
    } as never);
    await expect(service.ingest({ events: [{ ...validEvent, properties: { phone: '13100000000' } }] }))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
