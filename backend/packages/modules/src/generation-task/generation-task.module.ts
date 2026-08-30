import { Global, Module } from '@nestjs/common';
import { GenerationTaskController } from './generation-task.controller.js';
import { GenerationTaskRunner } from './generation-task.runner.js';
import { GenerationTaskService } from './generation-task.service.js';
import { OutboxPublisher } from './outbox.publisher.js';

@Global()
@Module({
  controllers: [GenerationTaskController],
  providers: [GenerationTaskService, GenerationTaskRunner, OutboxPublisher],
  exports: [GenerationTaskService, GenerationTaskRunner, OutboxPublisher],
})
export class GenerationTaskModule {}
