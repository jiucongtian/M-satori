import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '@satori/contracts';
import { LegalDocumentService, type LegalDocument } from './legal-document.service.js';

@Public()
@Controller('legal-documents')
export class LegalDocumentController {
  constructor(private readonly documents: LegalDocumentService) {}

  @Get(':documentId')
  get(@Param('documentId') documentId: string): Promise<LegalDocument> {
    return this.documents.get(documentId);
  }
}
