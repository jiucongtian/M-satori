import { seedAccounts } from '@satori/infrastructure';
import { randomUUID } from 'node:crypto';
import { RuntimeInfrastructure } from '../packages/infrastructure/src/runtime.module.js';
import { PostgresComplimentarySeedRepository } from '../packages/modules/src/complimentary-seed/repository-adapter/index.js';

import { inspectSeedCutover } from './seed-cutover-preflight.js';

const infrastructure = new RuntimeInfrastructure();
const repository = new PostgresComplimentarySeedRepository(infrastructure);

try {
  const preflight = await inspectSeedCutover(infrastructure.pool);
  if (preflight.blocked) throw new Error(`Seed migration blocked: ${JSON.stringify(preflight)}`);
  const accounts = await infrastructure.database.select({ userId: seedAccounts.userId }).from(seedAccounts);
  const reports = [];
  for (const account of accounts) {
    reports.push(await repository.migrateLegacyAccount(account.userId, randomUUID()));
  }
  const blocked = reports.filter((report) => report.state === 'BLOCKED' || !report.consistent);
  console.info('complimentary_seed_migration_report', {
    migrationVersion: 'legacy-seed-opening-v1',
    checkedAccounts: reports.length,
    migrated: reports.filter((report) => report.state === 'MIGRATED').length,
    replayed: reports.filter((report) => report.state === 'REPLAYED').length,
    blocked: blocked.length,
    reports,
  });
  const verification = await inspectSeedCutover(infrastructure.pool, true);
  console.info('complimentary_seed_cutover_verification', verification);
  if (blocked.length > 0 || verification.blocked) process.exitCode = 1;
} finally {
  await infrastructure.onApplicationShutdown();
}
