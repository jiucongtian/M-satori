import { Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { OrderApplicationService } from './application/index.js';

const ORDER_EXPIRY_INTERVAL_MS = 30_000;

@Injectable()
export class OrderMaintenanceWorker implements OnModuleInit, OnApplicationShutdown {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(private readonly orders: OrderApplicationService) {}

  onModuleInit() {
    void this.run();
    this.timer = setInterval(() => void this.run(), ORDER_EXPIRY_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    try {
      const closed = await this.orders.closeExpired();
      if (closed > 0) console.info('expired_money_orders_closed', { closed });
    } catch (error) {
      console.error('money_order_expiry_failed', {
        code: typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'UNKNOWN',
      });
    } finally {
      this.running = false;
    }
  }
}
