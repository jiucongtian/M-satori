import { Global, Module } from '@nestjs/common';
import {
  ENTITLEMENT_GRANT_PORT,
  MEMBERSHIP_GRANT_PORT,
  SystemClock,
  type EntitlementGrantPort,
} from '@satori/application';
import { MEMBERSHIP_REPOSITORY, MembershipApplicationService } from './application/index.js';
import { PostgresMembershipRepository } from './repository-adapter/index.js';
import { MembershipController } from './controller/index.js';

@Global()
@Module({
  controllers: [MembershipController],
  providers: [
    PostgresMembershipRepository,
    { provide: MEMBERSHIP_REPOSITORY, useExisting: PostgresMembershipRepository },
    {
      provide: MembershipApplicationService,
      inject: [MEMBERSHIP_REPOSITORY, ENTITLEMENT_GRANT_PORT],
      useFactory: (repository: PostgresMembershipRepository, entitlements: EntitlementGrantPort) =>
        new MembershipApplicationService(repository, entitlements, new SystemClock()),
    },
    { provide: MEMBERSHIP_GRANT_PORT, useExisting: MembershipApplicationService },
  ],
  exports: [MembershipApplicationService, MEMBERSHIP_GRANT_PORT],
})
export class MembershipModule {}
