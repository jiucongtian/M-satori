import { seedAccounts } from '@satori/infrastructure';
import { RuntimeInfrastructure } from '../packages/infrastructure/src/runtime.module.js';
import { SeedLedgerService } from '../packages/modules/src/seed-ledger/seed-ledger.service.js';

const infrastructure = new RuntimeInfrastructure();
const ledger = new SeedLedgerService(infrastructure);

try {
  const accounts = await infrastructure.database.select({ userId: seedAccounts.userId }).from(seedAccounts);
  let mismatches = 0;
  for (const account of accounts) {
    const result = await ledger.reconcile(account.userId);
    if (!result.consistent) mismatches += 1;
  }
  console.info('seed_ledger_reconciliation_metric', {
    checkedAccounts: accounts.length,
    mismatchCount: mismatches,
    consistentCount: accounts.length - mismatches,
  });
  if (mismatches > 0) {
    console.error('seed_ledger_reconciliation_alert', { severity: 'critical', mismatchCount: mismatches });
    process.exitCode = 1;
  }
} finally {
  await infrastructure.onApplicationShutdown();
}
