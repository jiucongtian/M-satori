import { Global, Module } from '@nestjs/common';
import {
  ENTITLEMENT_GRANT_PORT,
  PAYMENT_PROVIDER,
  REFUND_COMMAND_PORT,
  SystemClock,
  type EntitlementGrantPort,
  type PaymentProvider,
} from '@satori/application';
import { REFUND_REPOSITORY, RefundApplicationService } from './application/index.js';
import { RefundController } from './controller/index.js';
import { PostgresRefundRepository } from './repository-adapter/index.js';

@Global()
@Module({
  controllers: [RefundController],
  providers: [
    PostgresRefundRepository,
    { provide: REFUND_REPOSITORY, useExisting: PostgresRefundRepository },
    {
      provide: RefundApplicationService,
      inject: [REFUND_REPOSITORY, PAYMENT_PROVIDER, ENTITLEMENT_GRANT_PORT],
      useFactory: (
        repository: PostgresRefundRepository,
        provider: PaymentProvider,
        entitlements: EntitlementGrantPort,
      ) => new RefundApplicationService(repository, provider, entitlements, new SystemClock()),
    },
    { provide: REFUND_COMMAND_PORT, useExisting: RefundApplicationService },
  ],
  exports: [RefundApplicationService, REFUND_COMMAND_PORT],
})
export class RefundModule {}
