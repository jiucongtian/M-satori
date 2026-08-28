import { Global, Module } from '@nestjs/common';
import { MEMBERSHIP_GRANT_PORT } from '@satori/application';
import { PendingMembershipGrantService } from './application/index.js';

@Global()
@Module({
  providers: [
    PendingMembershipGrantService,
    { provide: MEMBERSHIP_GRANT_PORT, useExisting: PendingMembershipGrantService },
  ],
  exports: [MEMBERSHIP_GRANT_PORT],
})
export class MembershipModule {}
