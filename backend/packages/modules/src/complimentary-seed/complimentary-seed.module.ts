import { Global, Module } from '@nestjs/common';
import {
  COMPLIMENTARY_SEED_BENEFIT_SOURCE_PORT,
  SEED_BATCH_PROJECTION_QUERY_PORT,
  SEED_ELIGIBILITY_PORT,
} from '@satori/application';
import { COMPLIMENTARY_SEED_REPOSITORY, ComplimentarySeedApplicationService } from './application/index.js';
import { PostgresComplimentarySeedRepository } from './repository-adapter/index.js';

@Global()
@Module({
  providers: [
    PostgresComplimentarySeedRepository,
    { provide: COMPLIMENTARY_SEED_REPOSITORY, useExisting: PostgresComplimentarySeedRepository },
    { provide: SEED_ELIGIBILITY_PORT, useExisting: PostgresComplimentarySeedRepository },
    {
      provide: ComplimentarySeedApplicationService,
      inject: [COMPLIMENTARY_SEED_REPOSITORY],
      useFactory: (repository: PostgresComplimentarySeedRepository) =>
        new ComplimentarySeedApplicationService(repository),
    },
    {
      provide: COMPLIMENTARY_SEED_BENEFIT_SOURCE_PORT,
      useExisting: ComplimentarySeedApplicationService,
    },
    { provide: SEED_BATCH_PROJECTION_QUERY_PORT, useExisting: ComplimentarySeedApplicationService },
  ],
  exports: [
    ComplimentarySeedApplicationService,
    COMPLIMENTARY_SEED_BENEFIT_SOURCE_PORT,
    SEED_BATCH_PROJECTION_QUERY_PORT,
    SEED_ELIGIBILITY_PORT,
  ],
})
export class ComplimentarySeedModule {}
