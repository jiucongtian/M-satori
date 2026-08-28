import { Global, Module } from '@nestjs/common';
import { ENTITLEMENT_BENEFIT_SOURCE_PORT, ENTITLEMENT_GRANT_PORT } from '@satori/application';
import { ENTITLEMENT_REPOSITORY, EntitlementApplicationService } from './application/index.js';
import { EntitlementController } from './controller/index.js';
import {
  EntitlementApplicationServiceFactory,
  PostgresEntitlementRepository,
} from './repository-adapter/index.js';

@Global()
@Module({
  controllers: [EntitlementController],
  providers: [
    PostgresEntitlementRepository,
    EntitlementApplicationServiceFactory,
    { provide: ENTITLEMENT_REPOSITORY, useExisting: PostgresEntitlementRepository },
    {
      provide: EntitlementApplicationService,
      inject: [EntitlementApplicationServiceFactory],
      useFactory: (factory: EntitlementApplicationServiceFactory) => factory.create(),
    },
    { provide: ENTITLEMENT_GRANT_PORT, useExisting: EntitlementApplicationService },
    { provide: ENTITLEMENT_BENEFIT_SOURCE_PORT, useExisting: EntitlementApplicationService },
  ],
  exports: [EntitlementApplicationService, ENTITLEMENT_GRANT_PORT, ENTITLEMENT_BENEFIT_SOURCE_PORT],
})
export class EntitlementModule {}
