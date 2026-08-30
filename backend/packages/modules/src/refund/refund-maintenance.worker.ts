import { Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { RefundApplicationService } from './application/index.js';

@Injectable()
export class RefundMaintenanceWorker implements OnModuleInit, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;
  constructor(private readonly refunds: RefundApplicationService) {}
  onModuleInit() {
    this.timer = setInterval(() => void this.refunds.maintain(), 60_000);
    this.timer.unref();
    void this.refunds.maintain();
  }
  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }
}
