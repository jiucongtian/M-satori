import { Test } from '@nestjs/testing';
import { RuntimeInfrastructure, RuntimeInfrastructureModule } from '@satori/infrastructure';
import { describe, expect, it } from 'vitest';
import { R11CommerceModules, R1DomainModules } from './index.js';

describe('R1.1 commerce module assembly', () => {
  it('compiles all commerce modules as an independent Nest graph', async () => {
    const builder = Test.createTestingModule({
      imports: [RuntimeInfrastructureModule, ...R11CommerceModules],
    });
    builder.overrideProvider(RuntimeInfrastructure).useValue({
      environment: {
        DATA_ENCRYPTION_KEY:
          '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
      },
    });
    const testingModule = await builder.compile();

    expect(R11CommerceModules).toHaveLength(9);
    for (const domainModule of R11CommerceModules) {
      expect(R1DomainModules).toContain(domainModule);
      expect(() => testingModule.select(domainModule)).not.toThrow();
    }

    await testingModule.close();
  });
});
