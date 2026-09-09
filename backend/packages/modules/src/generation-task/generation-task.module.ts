import { Global, Module } from '@nestjs/common';
import { GenerationTaskController } from './generation-task.controller.js';
import { GenerationTaskRunner } from './generation-task.runner.js';
import { GenerationTaskService } from './generation-task.service.js';
import { OutboxPublisher } from './outbox.publisher.js';
import { GenerationTaskNotifications } from './generation-task.notifications.js';
import { GenerationTaskStream } from './generation-task.stream.js';

@Global()
@Module({
  controllers: [GenerationTaskController],
  providers: [GenerationTaskService, GenerationTaskRunner, OutboxPublisher, GenerationTaskNotifications, GenerationTaskStream],
  exports: [GenerationTaskService, GenerationTaskRunner, OutboxPublisher],
})
export class GenerationTaskModule {}
