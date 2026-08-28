import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { R11CommerceModules, R1DomainModules } from './index.js';

describe('R1.1 commerce module assembly', () => {
  it('compiles all commerce modules as an independent Nest graph', async () => {
    const testingModule = await Test.createTestingModule({ imports: R11CommerceModules }).compile();

    expect(R11CommerceModules).toHaveLength(9);
    for (const domainModule of R11CommerceModules) {
      expect(R1DomainModules).toContain(domainModule);
      expect(() => testingModule.select(domainModule)).not.toThrow();
    }

    await testingModule.close();
  });
});
