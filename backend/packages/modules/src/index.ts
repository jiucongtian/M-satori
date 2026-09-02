import type { Type } from '@nestjs/common';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { AstrologyModule } from './astrology/astrology.module.js';
import { CardReadingModule } from './card-reading/index.js';
import { CatalogModule } from './catalog/index.js';
import { ComplimentarySeedModule } from './complimentary-seed/index.js';
import { ConsumptionModule } from './consumption/index.js';
import { DailyInsightModule } from './daily-insight/daily-insight.module.js';
import { FeedbackModule } from './feedback/feedback.module.js';
import { GenerationTaskModule } from './generation-task/generation-task.module.js';
import { IdentityModule } from './identity/identity.module.js';
import { IntegrationsModule } from './integrations/integrations.module.js';
import { EntitlementModule } from './entitlement/index.js';
import { FulfillmentModule } from './fulfillment/index.js';
import { MembershipModule } from './membership/index.js';
import { OperationsModule } from './operations/operations.module.js';
import { OrderModule } from './order/index.js';
import { PaymentModule } from './payment/index.js';
import { PricingModule } from './pricing/index.js';
import { RefundModule } from './refund/index.js';
import { ProfileLibraryModule } from './profile-library/profile-library.module.js';
import { ProfileModule } from './profile/profile.module.js';
import { SeedLedgerModule } from './seed-ledger/seed-ledger.module.js';

export * from './card-reading/index.js';

export {
  AnalyticsModule,
  AstrologyModule,
  CardReadingModule,
  CatalogModule,
  ComplimentarySeedModule,
  ConsumptionModule,
  DailyInsightModule,
  FeedbackModule,
  GenerationTaskModule,
  IdentityModule,
  IntegrationsModule,
  EntitlementModule,
  FulfillmentModule,
  MembershipModule,
  OperationsModule,
  OrderModule,
  PaymentModule,
  PricingModule,
  RefundModule,
  ProfileLibraryModule,
  ProfileModule,
  SeedLedgerModule,
};

export const R11CommerceModules: Type<unknown>[] = [
  CatalogModule,
  OrderModule,
  ComplimentarySeedModule,
  PricingModule,
  PaymentModule,
  RefundModule,
  FulfillmentModule,
  MembershipModule,
  EntitlementModule,
  ConsumptionModule,
];

export const R1DomainModules: Type<unknown>[] = [
  AnalyticsModule,
  IdentityModule,
  ProfileModule,
  AstrologyModule,
  CardReadingModule,
  ProfileLibraryModule,
  SeedLedgerModule,
  GenerationTaskModule,
  DailyInsightModule,
  FeedbackModule,
  OperationsModule,
  IntegrationsModule,
  ...R11CommerceModules,
];
