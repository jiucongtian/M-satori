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
  PAYMENT_PAYER_AUTHORIZER,
  PAYMENT_REPOSITORY,
  PaymentApplicationService,
  type PaymentPayerAuthorizer,
  WECHAT_WEBHOOK_ALLOWED_IPS,
} from './application/index.js';
import { PaymentController } from './controller/index.js';
import { WechatWebhookNetworkGuard } from './controller/wechat-webhook-network.guard.js';
import { DrizzlePaymentRepository, PaymentRuntimeAdapter } from './repository-adapter/index.js';
import { WechatPayerAuthorizer } from './repository-adapter/wechat-payer-authorizer.js';

@Global()
@Module({
  controllers: [PaymentController],
  providers: [
    DrizzlePaymentRepository,
    PaymentRuntimeAdapter,
    WechatWebhookNetworkGuard,
    WechatPayerAuthorizer,
    { provide: PAYMENT_PAYER_AUTHORIZER, useExisting: WechatPayerAuthorizer },
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
        PAYMENT_PAYER_AUTHORIZER,
      ],
      useFactory: (
        repository: DrizzlePaymentRepository,
        provider: PaymentProvider,
        seeds: SeedPromotionLifecyclePort,
        orders: PaymentOrderLifecyclePort,
        payerAuthorizer: PaymentPayerAuthorizer,
      ) => new PaymentApplicationService(repository, provider, seeds, orders, payerAuthorizer),
    },
  ],
  exports: [PaymentApplicationService, PAYMENT_PROVIDER],
})
export class PaymentModule {}
