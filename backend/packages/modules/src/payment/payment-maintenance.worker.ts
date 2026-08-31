import { Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { PaymentApplicationService } from './application/index.js';
import { PAYMENT_RECOVERY_INTERVAL_MS } from './domain/index.js';

@Injectable()
export class PaymentMaintenanceWorker implements OnModuleInit, OnApplicationShutdown {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(private readonly payments: PaymentApplicationService) {}

  onModuleInit() {
    void this.run();
    this.timer = setInterval(() => void this.run(), PAYMENT_RECOVERY_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    try {
      const report = await this.payments.maintain();
      if (report.succeeded > 0 || report.closed > 0 || report.failed > 0) {
        console.info('payment_recovery_completed', report);
      }
    } catch (error) {
      console.error('payment_recovery_failed', {
        code: typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'UNKNOWN',
      });
    } finally {
      this.running = false;
    }
  }
}
