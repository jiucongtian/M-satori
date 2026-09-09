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
import type { Observable } from 'rxjs';
import type { AuthenticatedRequest } from '../identity/auth/authenticated-request.js';
import { GenerationTaskService } from './generation-task.service.js';
import { GenerationTaskStream } from './generation-task.stream.js';

@Controller('generation-tasks')
export class GenerationTaskController {
  constructor(
    private readonly tasks: GenerationTaskService,
    private readonly stream: GenerationTaskStream,
  ) {}

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
    return this.stream.events(request.auth.userId, taskId, lastEventId);
  }
}
