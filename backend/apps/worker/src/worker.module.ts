import { Module } from '@nestjs/common';
import { RuntimeInfrastructureModule } from '@satori/infrastructure';
import {
  DailyInsightModule,
  FeedbackModule,
  GenerationTaskModule,
  IdentityModule,
  IntegrationsModule,
  OperationsModule,
  R11CommerceModules,
  SeedLedgerModule,
} from '@satori/modules';
import { GenerationTaskWorker } from '../../../packages/modules/src/generation-task/generation-task.worker.js';
import { HomeEnergySummaryPrewarmWorker } from '../../../packages/modules/src/daily-insight/home-energy-summary-prewarm.worker.js';

@Module({
  imports: [
    RuntimeInfrastructureModule,
    IdentityModule,
    SeedLedgerModule,
    GenerationTaskModule,
    DailyInsightModule,
    FeedbackModule,
    IntegrationsModule,
    OperationsModule,
    ...R11CommerceModules,
  ],
  providers: [GenerationTaskWorker, HomeEnergySummaryPrewarmWorker],
})
export class WorkerModule {}
