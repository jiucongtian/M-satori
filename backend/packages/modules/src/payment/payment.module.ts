import { Global, Module } from '@nestjs/common';
import {
  PAYMENT_PROVIDER,
  PAYMENT_ORDER_LIFECYCLE_PORT,
  SEED_PROMOTION_LIFECYCLE_PORT,
  type PaymentProvider,
  type PaymentOrderLifecyclePort,
  type SeedPromotionLifecyclePort,
} from '@satori/application';
import {
  PAYMENT_REPOSITORY,
  PaymentApplicationService,
  WECHAT_WEBHOOK_ALLOWED_IPS,
} from './application/index.js';
import { PaymentController } from './controller/index.js';
import { WechatWebhookNetworkGuard } from './controller/wechat-webhook-network.guard.js';
import { DrizzlePaymentRepository, PaymentRuntimeAdapter } from './repository-adapter/index.js';

@Global()
@Module({
  controllers: [PaymentController],
  providers: [
    DrizzlePaymentRepository,
    PaymentRuntimeAdapter,
    WechatWebhookNetworkGuard,
    {
      provide: WECHAT_WEBHOOK_ALLOWED_IPS,
      inject: [PaymentRuntimeAdapter],
      useFactory: (runtime: PaymentRuntimeAdapter) => runtime.webhookAllowedIps(),
    },
    { provide: PAYMENT_REPOSITORY, useExisting: DrizzlePaymentRepository },
    {
      provide: PAYMENT_PROVIDER,
      inject: [PaymentRuntimeAdapter],
      useFactory: (runtime: PaymentRuntimeAdapter): PaymentProvider => runtime.provider(),
    },
    {
      provide: PaymentApplicationService,
      inject: [
        PAYMENT_REPOSITORY,
        PAYMENT_PROVIDER,
        SEED_PROMOTION_LIFECYCLE_PORT,
        PAYMENT_ORDER_LIFECYCLE_PORT,
      ],
      useFactory: (
        repository: DrizzlePaymentRepository,
        provider: PaymentProvider,
        seeds: SeedPromotionLifecyclePort,
        orders: PaymentOrderLifecyclePort,
      ) => new PaymentApplicationService(repository, provider, seeds, orders),
    },
  ],
  exports: [PaymentApplicationService, PAYMENT_PROVIDER],
})
export class PaymentModule {}
