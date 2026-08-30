import { Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { EntitlementApplicationService } from './application/index.js';

const EXPIRY_INTERVAL_MS = 60_000;
const RECONCILIATION_INTERVAL_MS = 5 * 60_000;

@Injectable()
export class EntitlementMaintenanceWorker implements OnModuleInit, OnApplicationShutdown {
  private expiryTimer?: ReturnType<typeof setInterval>;
  private reconciliationTimer?: ReturnType<typeof setInterval>;
  private expiring = false;
  private reconciling = false;

  constructor(private readonly entitlements: EntitlementApplicationService) {}

  onModuleInit() {
    void this.expire();
    void this.reconcile();
    this.expiryTimer = setInterval(() => void this.expire(), EXPIRY_INTERVAL_MS);
    this.reconciliationTimer = setInterval(() => void this.reconcile(), RECONCILIATION_INTERVAL_MS);
    this.expiryTimer.unref();
    this.reconciliationTimer.unref();
  }

  onApplicationShutdown() {
    if (this.expiryTimer) clearInterval(this.expiryTimer);
    if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
  }

  private async expire() {
    if (this.expiring) return;
    this.expiring = true;
    try {
      const expired = await this.entitlements.expireDue();
      if (expired > 0) console.info('entitlement_expiry_completed', { expired });
    } catch (error) {
      console.error('entitlement_expiry_failed', { code: errorCode(error) });
    } finally {
      this.expiring = false;
    }
  }

  private async reconcile() {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      const report = await this.entitlements.reconcile();
      if (report.openedCases > 0) console.warn('entitlement_reconciliation_cases_opened', report);
    } catch (error) {
      console.error('entitlement_reconciliation_failed', { code: errorCode(error) });
    } finally {
      this.reconciling = false;
    }
  }
}

function errorCode(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : 'ENTITLEMENT_MAINTENANCE_UNKNOWN';
}
