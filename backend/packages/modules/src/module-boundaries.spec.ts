import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const modulesRoot = dirname(fileURLToPath(import.meta.url));
const moduleNames = readdirSync(modulesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const commerceModuleNames = [
  'catalog',
  'pricing',
  'order',
  'payment',
  'fulfillment',
  'membership',
  'entitlement',
  'complimentary-seed',
  'consumption',
] as const;

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

  it('payment does not depend on entitlement ledgers', () => {
    const source = readModuleSources('payment');
    expect(source).not.toMatch(/(?:entitlement|complimentary-seed|seed-ledger)/);
  });

  it.each(['catalog', 'pricing', 'order', 'payment', 'fulfillment', 'membership'])(
    '%s does not directly depend on a ledger module',
    (moduleName) => {
      const source = readModuleSources(moduleName);
      expect(source).not.toMatch(/(?:\.\.\/entitlement\/|\.\.\/complimentary-seed\/|\.\.\/seed-ledger\/)/);
    },
  );

  it.each(commerceModuleNames)('%s keeps ORM access inside repository-adapter', (moduleName) => {
    for (const path of sourceFiles(join(modulesRoot, moduleName))) {
      if (path.includes('/repository-adapter/')) continue;
      const source = readFileSync(path, 'utf8');
      expect(source, relative(modulesRoot, path)).not.toMatch(
        /@satori\/infrastructure|database\/schema(?:\.js)?/,
      );
    }
  });

  it.each(commerceModuleNames)('%s public barrel does not expose persistence internals', (moduleName) => {
    const barrel = readFileSync(join(modulesRoot, moduleName, 'index.ts'), 'utf8');
    expect(barrel).not.toMatch(/repository-adapter|@satori\/infrastructure|database\/schema/);
  });

  it.each(commerceModuleNames)('%s controllers only depend on application-facing code', (moduleName) => {
    const controllerRoot = join(modulesRoot, moduleName, 'controller');
    for (const path of sourceFiles(controllerRoot)) {
      const source = readFileSync(path, 'utf8');
      expect(source, relative(modulesRoot, path)).not.toMatch(
        /repository-adapter|@satori\/infrastructure|database\/schema/,
      );
    }
  });
});

function readModuleSources(moduleName: string): string {
  return sourceFiles(join(modulesRoot, moduleName))
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}
