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
import { EntitlementMaintenanceWorker } from '../../../packages/modules/src/entitlement/entitlement-maintenance.worker.js';
import { ComplimentarySeedMaintenanceWorker } from '../../../packages/modules/src/complimentary-seed/complimentary-seed-maintenance.worker.js';
import { ConsumptionMaintenanceWorker } from '../../../packages/modules/src/consumption/consumption-maintenance.worker.js';
import { FulfillmentMaintenanceWorker } from '../../../packages/modules/src/fulfillment/fulfillment-maintenance.worker.js';

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
  providers: [
    GenerationTaskWorker,
    HomeEnergySummaryPrewarmWorker,
    EntitlementMaintenanceWorker,
    ComplimentarySeedMaintenanceWorker,
    ConsumptionMaintenanceWorker,
    FulfillmentMaintenanceWorker,
  ],
})
export class WorkerModule {}
