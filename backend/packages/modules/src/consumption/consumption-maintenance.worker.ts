import { Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { ConsumptionApplicationService } from './application/index.js';

@Injectable()
export class ConsumptionMaintenanceWorker implements OnModuleInit, OnApplicationShutdown {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(private readonly consumption: ConsumptionApplicationService) {}

  onModuleInit() {
    void this.run();
    this.timer = setInterval(() => void this.run(), 60_000);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    try {
      const expired = await this.consumption.expireDue();
      if (expired > 0) console.info('consumption_reservations_expired', { expired });
      const reconciliation = await this.consumption.reconcile();
      if (
        reconciliation.recoveredReservations > 0 ||
        reconciliation.committed > 0 ||
        reconciliation.released > 0
      ) {
        console.info('consumption_reconciliation_completed', reconciliation);
      }
    } catch (error) {
      console.error('consumption_maintenance_failed', {
        code: typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'UNKNOWN',
      });
    } finally {
      this.running = false;
    }
  }
}
