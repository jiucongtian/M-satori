import type { MessageEvent } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GenerationTaskStream } from './generation-task.stream.js';
import type { GenerationTaskService } from './generation-task.service.js';
import type { GenerationTaskNotifications } from './generation-task.notifications.js';

describe('generation event stream', () => {
  let status: string;
  let rows: { id: string; eventType: string; payload: Record<string, unknown> }[];
  let notify: () => void;
  const unwatch = vi.fn();
  const tasks = {
    getOwned: vi.fn(),
    listEvents: vi.fn(),
    currentSnapshot: vi.fn(),
  };
  const notifications = { watch: vi.fn() };
  const stream = new GenerationTaskStream(tasks as unknown as GenerationTaskService, notifications as unknown as GenerationTaskNotifications);
  const tick = () => vi.advanceTimersByTimeAsync(0);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    status = 'GENERATING';
    rows = [{ id: 'e1', eventType: 'generation.stage_changed', payload: { stage: 'START' } }];
    tasks.getOwned.mockResolvedValue({});
    tasks.currentSnapshot.mockImplementation(() => Promise.resolve({ status }));
    tasks.listEvents.mockImplementation((_user, _task, cursor?: string) =>
      Promise.resolve(rows.slice(cursor ? rows.findIndex((row) => row.id === cursor) + 1 : 0)));
    notifications.watch.mockImplementation((_id: string, fn: () => void) => { notify = fn; return unwatch; });
  });
  afterEach(() => { vi.useRealTimers(); });

  it('does not query every second while idle; reconciles every 15 seconds', async () => {
    const messages: MessageEvent[] = [];
    const subscription = stream.events('user', 'task').subscribe((m) => messages.push(m));
    await tick();
    const count = tasks.listEvents.mock.calls.length;
    await vi.advanceTimersByTimeAsync(14_999);
    expect(tasks.listEvents).toHaveBeenCalledTimes(count);
    await vi.advanceTimersByTimeAsync(1);
    expect(tasks.listEvents).toHaveBeenCalledTimes(count + 1);
    expect(messages.some((m) => m.type === 'heartbeat')).toBe(true);
    subscription.unsubscribe();
    expect(unwatch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('pushes a notified event immediately and deduplicates duplicate notifications', async () => {
    const messages: MessageEvent[] = [];
    const subscription = stream.events('user', 'task').subscribe((m) => messages.push(m));
    await tick();
    rows.push({ id: 'e2', eventType: 'generation.stage_changed', payload: { stage: 'NEXT' } });
    notify(); notify(); notify();
    await tick();
    await vi.advanceTimersByTimeAsync(250);
    expect(messages.filter((m) => m.id === 'e2')).toHaveLength(1);
    subscription.unsubscribe();
  });

  it('rechecks a notification received before its database transaction commits', async () => {
    const messages: MessageEvent[] = [];
    const subscription = stream.events('user', 'task').subscribe((m) => messages.push(m));
    await tick();
    notify();
    await tick();
    rows.push({ id: 'e2', eventType: 'generation.stage_changed', payload: {} });
    await vi.advanceTimersByTimeAsync(250);
    expect(messages.some((m) => m.id === 'e2')).toBe(true);
    subscription.unsubscribe();
  });

  it('recovers a missed Redis notification and emits the terminal event before closing', async () => {
    const messages: MessageEvent[] = [];
    const complete = vi.fn();
    stream.events('user', 'task').subscribe({ next: (m) => messages.push(m), complete });
    await tick();
    rows.push({ id: 'e2', eventType: 'generation.ready', payload: { status: 'READY' } });
    status = 'READY';
    await vi.advanceTimersByTimeAsync(15_000);
    expect(messages.at(-1)?.id).toBe('e2');
    expect(complete).toHaveBeenCalledOnce();
    expect(unwatch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('replays events after Last-Event-ID, including a completed task', async () => {
    rows.push({ id: 'e2', eventType: 'generation.ready', payload: {} });
    status = 'READY';
    const messages: MessageEvent[] = [];
    const complete = vi.fn();
    stream.events('user', 'task', 'e1').subscribe({ next: (m) => messages.push(m), complete });
    await tick();
    expect(messages.map((m) => m.id)).toEqual(['e1', 'e2']);
    expect(complete).toHaveBeenCalledOnce();
  });

  it('does not subscribe or expose events before ownership is checked', async () => {
    tasks.getOwned.mockRejectedValue(new Error('not owned'));
    await expect(firstValueFrom(stream.events('other', 'task'))).rejects.toThrow('not owned');
    expect(notifications.watch).not.toHaveBeenCalled();
    expect(tasks.listEvents).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up when firstValueFrom disconnects during the initial snapshot', async () => {
    await firstValueFrom(stream.events('user', 'task'));
    await tick();
    expect(unwatch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start overlapping reads when notifications arrive during a query', async () => {
    const messages: MessageEvent[] = [];
    const subscription = stream.events('user', 'task').subscribe((m) => messages.push(m));
    await tick();
    let release!: (value: typeof rows) => void;
    tasks.listEvents.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    notify();
    const count = tasks.listEvents.mock.calls.length;
    notify(); notify();
    expect(tasks.listEvents).toHaveBeenCalledTimes(count);
    rows.push({ id: 'e2', eventType: 'generation.stage_changed', payload: {} });
    release([]);
    await tick();
    expect(messages.some((m) => m.id === 'e2')).toBe(true);
    subscription.unsubscribe();
  });

  it('drains an event committed between event reading and terminal snapshot reading', async () => {
    const messages: MessageEvent[] = [];
    stream.events('user', 'task').subscribe((m) => messages.push(m));
    await tick();
    tasks.currentSnapshot.mockImplementationOnce(() => {
      rows.push({ id: 'e2', eventType: 'generation.ready', payload: {} });
      return Promise.resolve({ status: 'READY' });
    });
    notify();
    await tick();
    expect(messages.at(-1)?.id).toBe('e2');
    expect(unwatch).toHaveBeenCalledOnce();
  });
});
