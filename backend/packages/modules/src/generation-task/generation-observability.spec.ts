import { EventEmitter } from 'node:events';
import { correlation, metrics, activeGauges, type RuntimeInfrastructure } from '@satori/infrastructure';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GenerationTaskNotifications } from './generation-task.notifications.js';
import { GenerationTaskStream } from './generation-task.stream.js';
import type { GenerationTaskService } from './generation-task.service.js';

describe('SSE observability', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    metrics.drain();
  });
  it('restores each subscriber request context and counts all errors while throttling detail logs', async () => {
    vi.useFakeTimers();
    const logs = vi.spyOn(console, 'info').mockImplementation(() => {});
    const client = Object.assign(new EventEmitter(), {
      connect: vi.fn().mockResolvedValue(undefined),
      psubscribe: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
    });
    const notifications = new GenerationTaskNotifications({
      redis: { duplicate: () => client },
    } as unknown as RuntimeInfrastructure);
    const contexts: unknown[] = [];
    const stopA = correlation.run({ requestId: 'A' }, () =>
      notifications.watch('task', () => contexts.push(correlation.getStore())),
    );
    const stopB = correlation.run({ requestId: 'B' }, () =>
      notifications.watch('task', () => contexts.push(correlation.getStore())),
    );
    correlation.run({ requestId: 'unrelated' }, () =>
      client.emit('pmessage', 'generation-task:*', 'generation-task:task', 'event'),
    );
    expect(contexts).toEqual([{ requestId: 'A' }, { requestId: 'B' }]);
    for (let i = 0; i < 10; i++) client.emit('error', new Error('secret-redis-url'));
    client.emit('ready');
    await Promise.resolve();
    const rows = logs.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
    expect(rows.filter((row) => row.event === 'sse_redis_degraded')).toHaveLength(1);
    expect(metrics.drain().series.find((row) => row.metric === 'sse_redis_error')!.count).toBe(10);
    expect(JSON.stringify(rows)).not.toContain('secret-redis-url');
    stopA();
    stopB();
  });
  it('separates replay age from live sends, records fallback and cleans up the active gauge', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    let rows = [
      {
        id: 'e1',
        eventType: 'generation.stage_changed',
        payload: {},
        createdAt: new Date(Date.now() - 100_000),
      },
    ];
    const tasks = {
      getOwned: vi.fn().mockResolvedValue({}),
      currentSnapshot: vi.fn().mockResolvedValue({ status: 'GENERATING' }),
      listEvents: vi.fn((_user: string, _task: string, cursor: string) =>
        Promise.resolve(cursor === rows[0]?.id ? [] : rows),
      ),
    };
    const stream = new GenerationTaskStream(
      tasks as unknown as GenerationTaskService,
      { watch: () => () => {} } as unknown as GenerationTaskNotifications,
    );
    const subscription = stream.events('user', 'task', 'e0').subscribe();
    await vi.advanceTimersByTimeAsync(0);
    expect(activeGauges().sseActive).toBe(1);
    rows = [{ id: 'e2', eventType: 'generation.stage_changed', payload: {}, createdAt: new Date() }];
    await vi.advanceTimersByTimeAsync(15_000);
    subscription.unsubscribe();
    subscription.unsubscribe();
    const series = metrics.drain().series;
    expect(
      series.filter((row) => row.metric === 'sse_event_age_at_emit_ms').map((row) => row.labels.mode),
    ).toEqual(['replay', 'live']);
    expect(
      series.find((row) => row.metric === 'sse_reconcile_requested' && row.labels.source === 'fallback')!
        .count,
    ).toBe(1);
    expect(activeGauges().sseActive).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
