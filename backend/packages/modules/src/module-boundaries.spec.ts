import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const modulesRoot = dirname(fileURLToPath(import.meta.url));
const moduleNames = readdirSync(modulesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

describe('domain module boundaries', () => {
  for (const moduleName of moduleNames) {
    it(`${moduleName} does not import another domain module directly`, () => {
      const sourcePath = join(modulesRoot, moduleName, `${moduleName}.module.ts`);
      const source = readFileSync(sourcePath, 'utf8');
      for (const otherModule of moduleNames.filter((candidate) => candidate !== moduleName)) {
        expect(source).not.toContain(`/modules/${otherModule}`);
        expect(source).not.toContain(`../${otherModule}/`);
      }
    });
  }
});
