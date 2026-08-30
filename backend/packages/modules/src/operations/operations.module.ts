import { Module } from '@nestjs/common';
import { BootstrapController } from './foundation/bootstrap.controller.js';
import { BootstrapService } from './foundation/bootstrap.service.js';
import { LegalDocumentController } from './foundation/legal-document.controller.js';
import { LegalDocumentService } from './foundation/legal-document.service.js';
import { CommerceOperationsController } from './commerce/commerce-operations.controller.js';
import { CommerceOperationsService } from './commerce/commerce-operations.service.js';
import { OperatorRoleGuard } from './commerce/operator-role.guard.js';

@Module({
  controllers: [BootstrapController, LegalDocumentController, CommerceOperationsController],
  providers: [BootstrapService, LegalDocumentService, CommerceOperationsService, OperatorRoleGuard],
  exports: [LegalDocumentService, CommerceOperationsService],
})
export class OperationsModule {}
