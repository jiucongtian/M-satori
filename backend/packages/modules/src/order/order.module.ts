import { Global, Module } from '@nestjs/common';
import { PURCHASE_HISTORY_PORT } from '@satori/application';
import { DrizzlePurchaseHistoryAdapter } from './repository-adapter/index.js';

@Global()
@Module({
  providers: [
    DrizzlePurchaseHistoryAdapter,
    { provide: PURCHASE_HISTORY_PORT, useExisting: DrizzlePurchaseHistoryAdapter },
  ],
  exports: [PURCHASE_HISTORY_PORT],
})
export class OrderModule {}
