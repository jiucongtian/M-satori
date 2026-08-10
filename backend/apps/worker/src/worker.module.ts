import { Module } from '@nestjs/common';
import { RuntimeInfrastructureModule } from '@satori/infrastructure';
import {
  DailyInsightModule,
  FeedbackModule,
  GenerationTaskModule,
  IdentityModule,
  IntegrationsModule,
  OperationsModule,
} from '@satori/modules';
import { GenerationTaskWorker } from '../../../packages/modules/src/generation-task/generation-task.worker.js';

@Module({
  imports: [
    RuntimeInfrastructureModule,
    IdentityModule,
    GenerationTaskModule,
    DailyInsightModule,
    FeedbackModule,
    IntegrationsModule,
    OperationsModule,
  ],
  providers: [GenerationTaskWorker],
})
export class WorkerModule {}
