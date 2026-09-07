import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const backendRoot = fileURLToPath(new URL('../..', import.meta.url));
const compose = readFileSync(`${backendRoot}/docker-compose.test.yml`, 'utf8');

describe('test deployment data migration contract', () => {
  it('defaults to fixed OTPs while allowing an explicit real SMS delivery mode', () => {
    expect(compose).toContain('SMS_DELIVERY_MODE: ${SMS_DELIVERY_MODE:-FIXED_CODE}');
  });

  it('migrates legacy wisdom seeds before seeding content and starting the application', () => {
    expect(compose).toContain('migrate-seed-batches:');
    expect(compose).toContain("command: ['node_modules/.bin/tsx', 'scripts/migrate-complimentary-seeds.ts']");
    expect(compose).toMatch(
      /seed:\n[\s\S]*?depends_on:\n\s+migrate-seed-batches:\n\s+condition: service_completed_successfully/,
    );
    expect(compose).toMatch(
      /migrate-seed-batches:\n[\s\S]*?depends_on:\n\s+migrate:\n\s+condition: service_completed_successfully/,
    );
  });
});
