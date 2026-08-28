import { Module } from '@nestjs/common';
import {
  BUSINESS_CLOCK,
  OFFERING_QUERY_PORT,
  PURCHASE_HISTORY_PORT,
  SEED_ELIGIBILITY_PORT,
  SystemClock,
  type OfferingQueryPort,
  type PurchaseHistoryPort,
  type SeedEligibilityPort,
} from '@satori/application';
import { PRICING_REPOSITORY, PricingApplicationService } from './application/index.js';
import { PricingController } from './controller/index.js';
import { DrizzlePricingRepository } from './repository-adapter/index.js';

@Module({
  controllers: [PricingController],
  providers: [
    DrizzlePricingRepository,
    { provide: PRICING_REPOSITORY, useExisting: DrizzlePricingRepository },
    { provide: BUSINESS_CLOCK, useClass: SystemClock },
    {
      provide: PricingApplicationService,
      inject: [
        OFFERING_QUERY_PORT,
        PURCHASE_HISTORY_PORT,
        SEED_ELIGIBILITY_PORT,
        PRICING_REPOSITORY,
        BUSINESS_CLOCK,
      ],
      useFactory: (
        offerings: OfferingQueryPort,
        purchases: PurchaseHistoryPort,
        seeds: SeedEligibilityPort,
        repository: DrizzlePricingRepository,
        clock: SystemClock,
      ) => new PricingApplicationService(offerings, purchases, seeds, repository, clock),
    },
  ],
})
export class PricingModule {}
