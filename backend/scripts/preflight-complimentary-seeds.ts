import { RuntimeInfrastructure } from '../packages/infrastructure/src/runtime.module.js';
import { inspectSeedCutover } from './seed-cutover-preflight.js';

const infrastructure = new RuntimeInfrastructure();
try {
  const report = await inspectSeedCutover(infrastructure.pool, process.argv.includes('--require-migrated'));
  console.info('complimentary_seed_preflight_report', report);
  if (report.blocked) process.exitCode = 1;
} finally {
  await infrastructure.onApplicationShutdown();
}
