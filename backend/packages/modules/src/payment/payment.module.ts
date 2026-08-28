import { Global, Module } from '@nestjs/common';
import {
  PAYMENT_PROVIDER,
  SEED_PROMOTION_LIFECYCLE_PORT,
  type PaymentProvider,
  type SeedPromotionLifecyclePort,
} from '@satori/application';
import { PAYMENT_REPOSITORY, PaymentApplicationService } from './application/index.js';
import { PaymentController } from './controller/index.js';
import { DeterministicFakePaymentProvider, DrizzlePaymentRepository } from './repository-adapter/index.js';

@Global()
@Module({
  controllers: [PaymentController],
  providers: [
    DrizzlePaymentRepository,
    { provide: PAYMENT_REPOSITORY, useExisting: DrizzlePaymentRepository },
    { provide: PAYMENT_PROVIDER, useClass: DeterministicFakePaymentProvider },
    {
      provide: PaymentApplicationService,
      inject: [PAYMENT_REPOSITORY, PAYMENT_PROVIDER, SEED_PROMOTION_LIFECYCLE_PORT],
      useFactory: (
        repository: DrizzlePaymentRepository,
        provider: PaymentProvider,
        seeds: SeedPromotionLifecyclePort,
      ) => new PaymentApplicationService(repository, provider, seeds),
    },
  ],
  exports: [PaymentApplicationService, PAYMENT_PROVIDER],
})
export class PaymentModule {}
