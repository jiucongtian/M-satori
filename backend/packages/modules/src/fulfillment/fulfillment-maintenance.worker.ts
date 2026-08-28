import { Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { FulfillmentApplicationService } from './application/index.js';

@Injectable()
export class FulfillmentMaintenanceWorker implements OnModuleInit, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;
  constructor(private readonly fulfillment: FulfillmentApplicationService) {}
  onModuleInit() {
    this.timer = setInterval(() => void this.fulfillment.reconcile(), 5_000);
    this.timer.unref();
    void this.fulfillment.reconcile();
  }
  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }
}
