import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { correlation, errorFields, logEvent, metrics, RuntimeInfrastructure } from '@satori/infrastructure';
import type { Redis } from 'ioredis';

/** One dedicated subscriber per API process, shared by all authenticated streams. */
@Injectable()
export class GenerationTaskNotifications implements OnModuleDestroy {
  private subscriber: Redis | undefined;
  private readonly listeners = new Map<string, Set<() => void>>();

  constructor(private readonly infrastructure: RuntimeInfrastructure) {}

  watch(taskId: string, notify: () => void): () => void {
    const context = correlation.getStore();
    const boundNotify = () => correlation.run(context ?? {}, notify);
    const listeners = this.listeners.get(taskId) ?? new Set<() => void>();
    listeners.add(boundNotify);
    this.listeners.set(taskId, listeners);
    if (!this.subscriber) this.connect();
    return () => {
      listeners.delete(boundNotify);
      if (listeners.size === 0) this.listeners.delete(taskId);
      if (this.listeners.size === 0) this.disconnect();
    };
  }

  onModuleDestroy() {
    this.listeners.clear();
    this.disconnect();
  }

  private connect() {
    const subscriber = this.infrastructure.redis.duplicate({
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });
    this.subscriber = subscriber;
    let lastWarningAt = -Infinity;
    let subscribed = false;
    const warn = (phase: string, error: unknown) => {
      if (this.subscriber !== subscriber) return;
      metrics.increment('sse_redis_error', { phase });
      if (Date.now() - lastWarningAt >= 30_000) {
        lastWarningAt = Date.now();
        correlation.run({}, () => logEvent('sse_redis_degraded', { phase, ...errorFields(error) }, 'warn'));
      }
    };
    // Keep the existing channel compatible with Workers running the previous release.
    subscriber.on('pmessage', (_pattern: string, channel: string) => {
      metrics.increment('sse_redis_notification');
      for (const notify of this.listeners.get(channel.slice('generation-task:'.length)) ?? []) notify();
    });
    subscriber.on('ready', () => {
      void subscriber
        .psubscribe('generation-task:*')
        .then(() => {
          if (this.subscriber !== subscriber) return;
          metrics.increment(subscribed ? 'sse_redis_resubscribed' : 'sse_redis_subscribed');
          correlation.run({}, () =>
            logEvent('sse_redis_subscribed', { reconnect: subscribed, tasks: this.listeners.size }),
          );
          subscribed = true;
          // Redis Pub/Sub is transient: reconcile after initial subscription and reconnects.
          for (const listeners of this.listeners.values()) for (const notify of listeners) notify();
        })
        .catch((error: unknown) => warn('subscribe', error));
    });
    subscriber.on('error', (error: unknown) => warn('connection', error));
    subscriber.on('reconnecting', () => {
      if (this.subscriber === subscriber) metrics.increment('sse_redis_reconnecting');
    });
    void subscriber.connect().catch((error: unknown) => warn('connect', error));
  }

  private disconnect() {
    const subscriber = this.subscriber;
    this.subscriber = undefined;
    subscriber?.removeAllListeners('pmessage');
    subscriber?.removeAllListeners('ready');
    // A connection/ready-check already in flight can still emit an error after
    // disconnect(). Keep its guarded error handler until the client is collected.
    subscriber?.disconnect();
  }
}
