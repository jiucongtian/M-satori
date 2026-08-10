import { Module } from '@nestjs/common';
import { RuntimeInfrastructureModule } from '@satori/infrastructure';
import {
  DailyInsightModule,
  GenerationTaskModule,
  IntegrationsModule,
  OperationsModule,
} from '@satori/modules';
import { GenerationTaskWorker } from '../../../packages/modules/src/generation-task/generation-task.worker.js';

@Module({
  imports: [
    RuntimeInfrastructureModule,
    GenerationTaskModule,
    DailyInsightModule,
    IntegrationsModule,
    OperationsModule,
  ],
  providers: [GenerationTaskWorker],
})
export class WorkerModule {}
