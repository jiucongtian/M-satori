import { Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { CommerceOperationsService } from './commerce-operations.service.js';

@Injectable()
export class CommerceReconciliationWorker implements OnModuleInit, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;
  constructor(private readonly operations: CommerceOperationsService) {}
  onModuleInit() {
    this.timer = setInterval(() => void this.operations.reconcile(), 5 * 60_000);
    this.timer.unref();
    void this.operations.reconcile();
  }
  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }
}
