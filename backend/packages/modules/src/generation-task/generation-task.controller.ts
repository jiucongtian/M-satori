import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  Sse,
  type MessageEvent,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import type { AuthenticatedRequest } from '../identity/auth/authenticated-request.js';
import { GenerationTaskService } from './generation-task.service.js';

@Controller('generation-tasks')
export class GenerationTaskController {
  constructor(private readonly tasks: GenerationTaskService) {}

  @Get(':taskId')
  get(@Req() request: AuthenticatedRequest, @Param('taskId') taskId: string) {
    return this.tasks.getOwned(request.auth.userId, taskId);
  }

  @Post(':taskId/retry')
  @HttpCode(202)
  retry(
    @Req() request: AuthenticatedRequest,
    @Param('taskId') taskId: string,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    if (!key || key.length < 16 || key.length > 128) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'A 16-128 character Idempotency-Key is required',
      });
    }
    return this.tasks.retry(request.auth.userId, taskId, key);
  }

  @Sse(':taskId/events')
  @Header('Cache-Control', 'no-cache, no-transform')
  @Header('X-Accel-Buffering', 'no')
  events(
    @Req() request: AuthenticatedRequest,
    @Param('taskId') taskId: string,
    @Headers('last-event-id') lastEventId: string | undefined,
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let cursor = lastEventId;
      let stopped = false;
      const poll = async () => {
        const snapshot = await this.tasks.currentSnapshot(request.auth.userId, taskId);
        const existing = await this.tasks.listEvents(request.auth.userId, taskId);
        if (!cursor) cursor = existing.at(-1)?.id;
        subscriber.next({
          id: cursor ?? `snapshot-${taskId}`,
          type: 'generation.snapshot',
          data: { ...snapshot, occurredAt: new Date().toISOString() },
        });
        while (!stopped) {
          const events = await this.tasks.listEvents(request.auth.userId, taskId, cursor);
          for (const event of events) {
            cursor = event.id;
            subscriber.next({
              id: event.id,
              type: event.eventType,
              data: event.payload as Record<string, unknown>,
            });
          }
          const current = await this.tasks.currentSnapshot(request.auth.userId, taskId);
          if ((current.status === 'READY' || current.status === 'FAILED') && events.length === 0) {
            subscriber.complete();
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
      };
      void poll().catch((error) => subscriber.error(error));
      const heartbeat = setInterval(() => {
        subscriber.next({ type: 'heartbeat', data: { taskId, occurredAt: new Date().toISOString() } });
      }, 15_000);
      heartbeat.unref();
      return () => {
        stopped = true;
        clearInterval(heartbeat);
      };
    });
  }
}
