import { defineConfig, defineProject } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const alias = {
  '@satori/application': fileURLToPath(new URL('./packages/application/src/index.ts', import.meta.url)),
  '@satori/contracts': fileURLToPath(new URL('./packages/contracts/src/index.ts', import.meta.url)),
  '@satori/domain': fileURLToPath(new URL('./packages/domain/src/index.ts', import.meta.url)),
  '@satori/infrastructure': fileURLToPath(new URL('./packages/infrastructure/src/index.ts', import.meta.url)),
  '@satori/modules': fileURLToPath(new URL('./packages/modules/src/index.ts', import.meta.url)),
};

const base = { resolve: { alias }, test: { environment: 'node' as const, passWithNoTests: true } };

export default defineConfig({
  resolve: {
    alias,
  },
  test: {
    projects: [
      defineProject({ ...base, test: { ...base.test, name: 'unit', include: ['packages/**/*.spec.ts'] } }),
      defineProject({
        ...base,
        test: { ...base.test, name: 'integration', include: ['tests/integration/**/*.test.ts'] },
      }),
      defineProject({
        ...base,
        test: { ...base.test, name: 'contract', include: ['tests/contract/**/*.test.ts'] },
      }),
      defineProject({ ...base, test: { ...base.test, name: 'e2e', include: ['tests/e2e/**/*.test.ts'] } }),
    ],
  },
});
