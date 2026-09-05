import { Module } from '@nestjs/common';
import { RuntimeInfrastructureModule } from '@satori/infrastructure';
import {
  CardReadingModule,
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
import { MembershipMaintenanceWorker } from '../../../packages/modules/src/membership/membership-maintenance.worker.js';
import { RefundMaintenanceWorker } from '../../../packages/modules/src/refund/refund-maintenance.worker.js';
import { CommerceReconciliationWorker } from '../../../packages/modules/src/operations/commerce/commerce-reconciliation.worker.js';
import { OrderMaintenanceWorker } from '../../../packages/modules/src/order/order-maintenance.worker.js';
import { PaymentMaintenanceWorker } from '../../../packages/modules/src/payment/payment-maintenance.worker.js';
import { CardReadingMaintenanceWorker } from '../../../packages/modules/src/card-reading/card-reading-maintenance.worker.js';

@Module({
  imports: [
    RuntimeInfrastructureModule,
    IdentityModule,
    SeedLedgerModule,
    GenerationTaskModule,
    DailyInsightModule,
    CardReadingModule,
    FeedbackModule,
    IntegrationsModule,
    OperationsModule,
    ...R11CommerceModules,
  ],
  providers: [
    GenerationTaskWorker,
    CardReadingMaintenanceWorker,
    HomeEnergySummaryPrewarmWorker,
    EntitlementMaintenanceWorker,
    ComplimentarySeedMaintenanceWorker,
    ConsumptionMaintenanceWorker,
    FulfillmentMaintenanceWorker,
    MembershipMaintenanceWorker,
    RefundMaintenanceWorker,
    CommerceReconciliationWorker,
    OrderMaintenanceWorker,
    PaymentMaintenanceWorker,
  ],
})
export class WorkerModule {}
