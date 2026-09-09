import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { RuntimeInfrastructure } from '@satori/infrastructure';
import { GenerationTaskNotifications } from './generation-task.notifications.js';

function fixture() {
  const client = Object.assign(new EventEmitter(), {
    connect: vi.fn(async () => {}),
    psubscribe: vi.fn(async () => {}),
    disconnect: vi.fn(),
  });
  const duplicate = vi.fn(() => client);
  const notifications = new GenerationTaskNotifications({ redis: { duplicate } } as unknown as RuntimeInfrastructure);
  return { client, duplicate, notifications };
}

describe('shared Redis task notifications', () => {
  it('uses one separate Redis connection and dispatches only to the matching task', () => {
    const { client, duplicate, notifications } = fixture();
    const a = vi.fn(); const b = vi.fn(); const c = vi.fn();
    const stopA = notifications.watch('a', a);
    const stopB = notifications.watch('a', b);
    const stopC = notifications.watch('c', c);
    expect(duplicate).toHaveBeenCalledTimes(1);
    client.emit('pmessage', 'generation-task:*', 'generation-task:a', 'event-id');
    expect(a).toHaveBeenCalledOnce(); expect(b).toHaveBeenCalledOnce(); expect(c).not.toHaveBeenCalled();
    stopA(); stopB();
    expect(client.disconnect).not.toHaveBeenCalled();
    stopC();
    expect(client.disconnect).toHaveBeenCalledOnce();
  });

  it('resubscribes and reconciles after Redis reconnects', async () => {
    const { client, notifications } = fixture();
    const notify = vi.fn();
    notifications.watch('a', notify);
    client.emit('ready');
    await Promise.resolve();
    client.emit('error', new Error('disconnected'));
    client.emit('ready');
    await Promise.resolve();
    expect(client.psubscribe).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledTimes(2);
    notifications.onModuleDestroy();
    expect(client.disconnect).toHaveBeenCalledOnce();
  });

  it('keeps the fallback usable if Redis cannot connect', async () => {
    const { client, notifications } = fixture();
    client.connect.mockRejectedValue(new Error('offline'));
    const stop = notifications.watch('a', vi.fn());
    await Promise.resolve();
    stop();
    expect(client.disconnect).toHaveBeenCalledOnce();
  });
});
