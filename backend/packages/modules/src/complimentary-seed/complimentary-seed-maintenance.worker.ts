import { Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { ComplimentarySeedApplicationService } from './application/index.js';

@Injectable()
export class ComplimentarySeedMaintenanceWorker implements OnModuleInit, OnApplicationShutdown {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(private readonly seeds: ComplimentarySeedApplicationService) {}

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
      const expired = await this.seeds.expireDue();
      if (expired > 0) console.info('complimentary_seed_expiry_completed', { expired });
    } catch (error) {
      console.error('complimentary_seed_expiry_failed', {
        code:
          typeof error === 'object' && error !== null && 'code' in error
            ? String(error.code)
            : 'COMPLIMENTARY_SEED_EXPIRY_UNKNOWN',
      });
    } finally {
      this.running = false;
    }
  }
}
