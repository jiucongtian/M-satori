import { Global, Module } from '@nestjs/common';
import {
  BUSINESS_CLOCK,
  PAYMENT_ORDER_LIFECYCLE_PORT,
  PURCHASE_HISTORY_PORT,
  SEED_PROMOTION_LIFECYCLE_PORT,
  SystemClock,
  type SeedPromotionLifecyclePort,
} from '@satori/application';
import { ORDER_REPOSITORY, OrderApplicationService } from './application/index.js';
import { OrderController } from './controller/index.js';
import { DrizzleOrderRepository } from './repository-adapter/index.js';

@Global()
@Module({
  controllers: [OrderController],
  providers: [
    DrizzleOrderRepository,
    { provide: ORDER_REPOSITORY, useExisting: DrizzleOrderRepository },
    { provide: PURCHASE_HISTORY_PORT, useExisting: DrizzleOrderRepository },
    { provide: BUSINESS_CLOCK, useClass: SystemClock },
    {
      provide: OrderApplicationService,
      inject: [ORDER_REPOSITORY, SEED_PROMOTION_LIFECYCLE_PORT, BUSINESS_CLOCK],
      useFactory: (
        repository: DrizzleOrderRepository,
        seeds: SeedPromotionLifecyclePort,
        clock: SystemClock,
      ) => new OrderApplicationService(repository, seeds, clock),
    },
    { provide: PAYMENT_ORDER_LIFECYCLE_PORT, useExisting: OrderApplicationService },
  ],
  exports: [PURCHASE_HISTORY_PORT, PAYMENT_ORDER_LIFECYCLE_PORT, OrderApplicationService],
})
export class OrderModule {}
