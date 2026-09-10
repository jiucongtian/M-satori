import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const backendRoot = fileURLToPath(new URL('../..', import.meta.url));
const compose = readFileSync(`${backendRoot}/docker-compose.test.yml`, 'utf8');

describe('test deployment data migration contract', () => {
  it('defaults to fixed OTPs while allowing an explicit real SMS delivery mode', () => {
    expect(compose).toContain('SMS_DELIVERY_MODE: ${SMS_DELIVERY_MODE:-FIXED_CODE}');
  });

  it('applies the current schema before seeding content and starting the application', () => {
    expect(compose).not.toContain('migrate-seed-batches:');
    expect(compose).toMatch(
      /seed:\n[\s\S]*?depends_on:\n\s+migrate:\n\s+condition: service_completed_successfully/,
    );
  });
});
