import { Global, Module } from '@nestjs/common';
import {
  BUSINESS_CLOCK,
  COMPLIMENTARY_SEED_BENEFIT_SOURCE_PORT,
  CONSUMPTION_OUTCOME_QUERY_PORT,
  CONSUMPTION_PORT,
  ENTITLEMENT_BENEFIT_SOURCE_PORT,
  SystemClock,
  type BenefitSourcePort,
} from '@satori/application';
import {
  CONSUMPTION_REPOSITORY,
  ConsumptionApplicationService,
  UnknownConsumptionOutcomeQuery,
} from './application/index.js';
import { ConsumptionController } from './controller/index.js';
import { PostgresConsumptionRepository } from './repository-adapter/index.js';

@Global()
@Module({
  controllers: [ConsumptionController],
  providers: [
    PostgresConsumptionRepository,
    { provide: CONSUMPTION_REPOSITORY, useExisting: PostgresConsumptionRepository },
    { provide: BUSINESS_CLOCK, useClass: SystemClock },
    { provide: CONSUMPTION_OUTCOME_QUERY_PORT, useClass: UnknownConsumptionOutcomeQuery },
    {
      provide: ConsumptionApplicationService,
      inject: [
        ENTITLEMENT_BENEFIT_SOURCE_PORT,
        COMPLIMENTARY_SEED_BENEFIT_SOURCE_PORT,
        CONSUMPTION_REPOSITORY,
        BUSINESS_CLOCK,
        CONSUMPTION_OUTCOME_QUERY_PORT,
      ],
      useFactory: (
        entitlements: BenefitSourcePort,
        seeds: BenefitSourcePort,
        repository: PostgresConsumptionRepository,
        clock: SystemClock,
        outcomes: UnknownConsumptionOutcomeQuery,
      ) => new ConsumptionApplicationService(entitlements, seeds, repository, clock, outcomes),
    },
    { provide: CONSUMPTION_PORT, useExisting: ConsumptionApplicationService },
  ],
  exports: [ConsumptionApplicationService, CONSUMPTION_PORT],
})
export class ConsumptionModule {}
