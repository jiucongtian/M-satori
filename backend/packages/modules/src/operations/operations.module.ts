import { Module } from '@nestjs/common';
import { BootstrapController } from './foundation/bootstrap.controller.js';
import { BootstrapService } from './foundation/bootstrap.service.js';
import { LegalDocumentController } from './foundation/legal-document.controller.js';
import { LegalDocumentService } from './foundation/legal-document.service.js';

@Module({
  controllers: [BootstrapController, LegalDocumentController],
  providers: [BootstrapService, LegalDocumentService],
  exports: [LegalDocumentService],
})
export class OperationsModule {}
