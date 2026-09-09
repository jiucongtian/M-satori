import { Injectable, type MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import { GenerationTaskNotifications } from './generation-task.notifications.js';
import { GenerationTaskService } from './generation-task.service.js';

const RECONCILE_MS = 15_000;
const COMMIT_RECHECK_MS = 250;

@Injectable()
export class GenerationTaskStream {
  constructor(
    private readonly tasks: GenerationTaskService,
    private readonly notifications: GenerationTaskNotifications,
  ) {}

  events(userId: string, taskId: string, lastEventId?: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let cursor = lastEventId;
      let stopped = false;
      let initialized = false;
      let reading = false;
      let dirty = false;
      let unwatch: (() => void) | undefined;
      let reconcile: NodeJS.Timeout | undefined;
      let commitRecheck: NodeJS.Timeout | undefined;

      const emitEvents = async () => {
        const events = await this.tasks.listEvents(userId, taskId, cursor);
        for (const event of events) {
          if (stopped) return;
          cursor = event.id;
          subscriber.next({ id: event.id, type: event.eventType, data: event.payload as Record<string, unknown> });
        }
      };

      const drain = async () => {
        if (reading || !initialized || stopped) return;
        reading = true;
        try {
          while (dirty && !stopped) {
            dirty = false;
            await emitEvents();
            if (stopped) return;
            const current = await this.tasks.currentSnapshot(userId, taskId);
            if (current.status === 'READY' || current.status === 'FAILED') {
              // A terminal transaction may have committed between the two reads.
              await emitEvents();
              if (!stopped) subscriber.complete();
              return;
            }
          }
        } catch (error) {
          if (!stopped) subscriber.error(error);
        } finally {
          reading = false;
        }
      };
      const wake = () => {
        dirty = true;
        void drain();
      };
      const notified = () => {
        if (stopped) return;
        wake();
        // Existing publishers send within a DB transaction. Retry once after the
        // notification, then rely on low-frequency reconciliation if commit is slow.
        if (!commitRecheck) {
          commitRecheck = setTimeout(() => {
            commitRecheck = undefined;
            wake();
          }, COMMIT_RECHECK_MS);
          commitRecheck.unref();
        }
      };
      const initialize = async () => {
        await this.tasks.getOwned(userId, taskId);
        if (stopped) return;
        unwatch = this.notifications.watch(taskId, notified);
        // Capture the cursor before the snapshot so a concurrent update cannot
        // disappear between an old snapshot and a newer initial cursor.
        if (!cursor) {
          const existing = await this.tasks.listEvents(userId, taskId);
          cursor = existing.at(-1)?.id;
        }
        const snapshot = await this.tasks.currentSnapshot(userId, taskId);
        if (stopped) return;
        subscriber.next({
          id: cursor ?? `snapshot-${taskId}`,
          type: 'generation.snapshot',
          data: { ...snapshot, occurredAt: new Date().toISOString() },
        });
        if (stopped) return;
        initialized = true;
        reconcile = setInterval(() => {
          subscriber.next({ type: 'heartbeat', data: { taskId, occurredAt: new Date().toISOString() } });
          wake();
        }, RECONCILE_MS);
        reconcile.unref();
        wake();
      };
      void initialize().catch((error) => { if (!stopped) subscriber.error(error); });
      return () => {
        stopped = true;
        unwatch?.();
        clearInterval(reconcile);
        clearTimeout(commitRecheck);
      };
    });
  }
}
