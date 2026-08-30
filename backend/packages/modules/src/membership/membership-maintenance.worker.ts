import { Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { MembershipApplicationService } from './application/index.js';

@Injectable()
export class MembershipMaintenanceWorker implements OnModuleInit, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;

  constructor(private readonly memberships: MembershipApplicationService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.memberships.maintain(), 60_000);
    this.timer.unref();
    void this.memberships.maintain();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }
}
