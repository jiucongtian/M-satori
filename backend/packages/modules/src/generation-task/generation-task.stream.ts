import { Injectable, type MessageEvent } from '@nestjs/common';
import { errorFields, logEvent, metrics, trackActive } from '@satori/infrastructure';
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
      const started = performance.now();
      let closeReason = 'client_disconnect';
      let releaseActive: (() => void) | undefined;
      let replaying = Boolean(lastEventId);
      let emitted = 0;
      let notifiedAt: number | undefined;
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
          emitted++;
          metrics.increment('sse_event_emitted');
          if (event.createdAt instanceof Date)
            metrics.observe('sse_event_age_at_emit_ms', Math.max(0, Date.now() - event.createdAt.getTime()), {
              mode: replaying ? 'replay' : 'live',
            });
          subscriber.next({
            id: event.id,
            type: event.eventType,
            data: event.payload as Record<string, unknown>,
          });
        }
        if (events.length)
          logEvent('sse_events_emitted', {
            taskId,
            count: events.length,
            lastEventId: cursor,
            replay: replaying,
          });
        replaying = false;
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
              if (!stopped) {
                closeReason = 'terminal';
                subscriber.complete();
              }
              return;
            }
          }
        } catch (error) {
          if (!stopped) {
            closeReason = 'error';
            logEvent('sse_stream_failed', { taskId, ...errorFields(error) }, 'warn');
            subscriber.error(error);
          }
        } finally {
          reading = false;
          if (notifiedAt !== undefined) {
            metrics.observe('sse_notification_reconcile_ms', performance.now() - notifiedAt);
            notifiedAt = undefined;
          }
        }
      };
      const wake = (source: 'initial' | 'notification' | 'commit_recheck' | 'fallback') => {
        metrics.increment('sse_reconcile_requested', { source });
        dirty = true;
        void drain();
      };
      const notified = () => {
        if (stopped) return;
        notifiedAt ??= performance.now();
        wake('notification');
        // Existing publishers send within a DB transaction. Retry once after the
        // notification, then rely on low-frequency reconciliation if commit is slow.
        if (!commitRecheck) {
          commitRecheck = setTimeout(() => {
            commitRecheck = undefined;
            wake('commit_recheck');
          }, COMMIT_RECHECK_MS);
          commitRecheck.unref();
        }
      };
      const initialize = async () => {
        await this.tasks.getOwned(userId, taskId);
        if (stopped) return;
        releaseActive = trackActive('sseActive');
        metrics.increment('sse_opened');
        logEvent('sse_stream_opened', { taskId, resumed: Boolean(lastEventId) });
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
          wake('fallback');
        }, RECONCILE_MS);
        reconcile.unref();
        wake('initial');
      };
      void initialize().catch((error) => {
        if (!stopped) {
          closeReason = 'error';
          logEvent('sse_stream_failed', { taskId, ...errorFields(error) }, 'warn');
          subscriber.error(error);
        }
      });
      return () => {
        stopped = true;
        releaseActive?.();
        if (releaseActive) {
          metrics.observe('sse_lifetime_ms', performance.now() - started, { reason: closeReason });
          logEvent('sse_stream_closed', {
            taskId,
            reason: closeReason,
            emitted,
            durationMs: performance.now() - started,
          });
        }
        unwatch?.();
        clearInterval(reconcile);
        clearTimeout(commitRecheck);
      };
    });
  }
}
