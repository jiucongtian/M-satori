import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it } from 'vitest';
import { SeedLedgerModule } from '@satori/modules';
import { WorkerModule } from './worker.module.js';

describe('WorkerModule', () => {
  it('imports the seed ledger dependency required by daily insight jobs', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, WorkerModule) as unknown[];

    expect(imports).toContain(SeedLedgerModule);
  });
});
