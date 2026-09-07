import { Module } from '@nestjs/common';
import { MiniappImportController } from './miniapp-import.controller.js';
import { MiniappImportService } from './miniapp-import.service.js';
import { MiniappImportSource } from './miniapp-import.source.js';

@Module({ controllers: [MiniappImportController], providers: [MiniappImportService, MiniappImportSource] })
export class MiniappImportModule {}
