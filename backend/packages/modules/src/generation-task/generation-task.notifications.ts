import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { RuntimeInfrastructure } from '@satori/infrastructure';
import type { Redis } from 'ioredis';

/** One dedicated subscriber per API process, shared by all authenticated streams. */
@Injectable()
export class GenerationTaskNotifications implements OnModuleDestroy {
  private subscriber: Redis | undefined;
  private readonly listeners = new Map<string, Set<() => void>>();

  constructor(private readonly infrastructure: RuntimeInfrastructure) {}

  watch(taskId: string, notify: () => void): () => void {
    const listeners = this.listeners.get(taskId) ?? new Set<() => void>();
    listeners.add(notify);
    this.listeners.set(taskId, listeners);
    if (!this.subscriber) this.connect();
    return () => {
      listeners.delete(notify);
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
    // Keep the existing channel compatible with Workers running the previous release.
    subscriber.on('pmessage', (_pattern: string, channel: string) => {
      for (const notify of this.listeners.get(channel.slice('generation-task:'.length)) ?? []) notify();
    });
    subscriber.on('ready', () => {
      void subscriber.psubscribe('generation-task:*').then(() => {
        if (this.subscriber !== subscriber) return;
        // Redis Pub/Sub is transient: reconcile after initial subscription and reconnects.
        for (const listeners of this.listeners.values()) for (const notify of listeners) notify();
      }).catch(() => { /* The stream's reconciliation timer remains authoritative. */ });
    });
    subscriber.on('error', () => { /* Redis reconnects; database reconciliation stays available. */ });
    void subscriber.connect().catch(() => { /* Do not block SSE on Redis availability. */ });
  }

  private disconnect() {
    const subscriber = this.subscriber;
    this.subscriber = undefined;
    subscriber?.removeAllListeners('pmessage');
    subscriber?.removeAllListeners('ready');
    // A connection/ready-check already in flight can still emit an error after
    // disconnect(). Keep its no-op error handler until the client is collected.
    subscriber?.disconnect();
  }
}
