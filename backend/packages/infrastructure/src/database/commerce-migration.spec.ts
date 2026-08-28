import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const migration = readFileSync(resolve(backendRoot, 'drizzle/0008_damp_absorbing_man.sql'), 'utf8');

const commerceTables = [
  'service_offerings',
  'offering_versions',
  'seed_promotion_rules',
  'checkout_quotes',
  'money_orders',
  'order_snapshots',
  'payment_attempts',
  'payment_events',
  'refunds',
  'fulfillment_jobs',
  'entitlement_grants',
  'entitlement_usage_entries',
  'complimentary_seed_grants',
  'complimentary_seed_allocations',
  'complimentary_seed_entries',
  'complimentary_seed_account_projections',
  'entitlement_resolutions',
  'resolution_candidates',
  'consumption_intents',
  'reservation_allocations',
  'membership_subscriptions',
  'membership_periods',
  'membership_upgrades',
  'upgrade_assessments',
  'reconciliation_cases',
  'operator_adjustments',
  'inbox_consumptions',
] as const;

describe('R1.1 commerce expand-only migration', () => {
  it.each(commerceTables)('creates %s', (table) => {
    expect(migration).toContain(`CREATE TABLE "${table}"`);
  });

  it('does not remove or rename an R1.0 database object', () => {
    expect(migration).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN|TYPE|INDEX)\b/i);
    expect(migration).not.toMatch(/\bRENAME\s+(?:TO|COLUMN)\b/i);
    expect(migration).not.toMatch(/ALTER\s+COLUMN\s+.+\s+SET\s+NOT\s+NULL/i);
  });

  it('extends the outbox with backward-compatible defaults', () => {
    expect(migration).toContain('ADD COLUMN "envelope_version" integer DEFAULT 1 NOT NULL');
    expect(migration).toContain('ADD COLUMN "producer" varchar(64) DEFAULT \'legacy\' NOT NULL');
  });
});
