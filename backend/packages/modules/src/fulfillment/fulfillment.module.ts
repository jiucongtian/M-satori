import { Global, Module } from '@nestjs/common';
import {
  ENTITLEMENT_GRANT_PORT,
  FULFILLMENT_COMMAND_PORT,
  MEMBERSHIP_GRANT_PORT,
  type EntitlementGrantPort,
  type MembershipGrantPort,
} from '@satori/application';
import { FULFILLMENT_REPOSITORY, FulfillmentApplicationService } from './application/index.js';
import { DrizzleFulfillmentRepository } from './repository-adapter/index.js';

@Global()
@Module({
  providers: [
    DrizzleFulfillmentRepository,
    { provide: FULFILLMENT_REPOSITORY, useExisting: DrizzleFulfillmentRepository },
    {
      provide: FulfillmentApplicationService,
      inject: [FULFILLMENT_REPOSITORY, ENTITLEMENT_GRANT_PORT, MEMBERSHIP_GRANT_PORT],
      useFactory: (
        repository: DrizzleFulfillmentRepository,
        entitlements: EntitlementGrantPort,
        memberships: MembershipGrantPort,
      ) => new FulfillmentApplicationService(repository, entitlements, memberships),
    },
    { provide: FULFILLMENT_COMMAND_PORT, useExisting: FulfillmentApplicationService },
  ],
  exports: [FulfillmentApplicationService, FULFILLMENT_COMMAND_PORT],
})
export class FulfillmentModule {}
