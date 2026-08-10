import { Global, Module } from '@nestjs/common';
import { SeedLedgerController } from './seed-ledger.controller.js';
import { SeedLedgerService } from './seed-ledger.service.js';

@Global()
@Module({ controllers: [SeedLedgerController], providers: [SeedLedgerService], exports: [SeedLedgerService] })
export class SeedLedgerModule {}
