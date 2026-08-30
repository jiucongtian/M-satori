import { Injectable, NotFoundException } from '@nestjs/common';
import { legalDocuments, RuntimeInfrastructure } from '@satori/infrastructure';
import { asc, eq } from 'drizzle-orm';

export type LegalDocumentType = 'PRIVACY_POLICY' | 'TERMS_OF_SERVICE' | 'AI_CONTENT_NOTICE';

export interface LegalDocumentSummary {
  documentId: string;
  type: LegalDocumentType;
  version: string;
  title: string;
  required: boolean;
  publishedAt: string;
}

export interface LegalDocument extends LegalDocumentSummary {
  contentFormat: 'MARKDOWN';
  content: string;
}

@Injectable()
export class LegalDocumentService {
  constructor(private readonly infrastructure: RuntimeInfrastructure) {}

  async listRequired(): Promise<LegalDocumentSummary[]> {
    const rows = await this.infrastructure.database
      .select()
      .from(legalDocuments)
      .where(eq(legalDocuments.required, true))
      .orderBy(asc(legalDocuments.type));
    return rows.map((row) => this.toSummary(row));
  }

  async get(documentId: string): Promise<LegalDocument> {
    const [row] = await this.infrastructure.database
      .select()
      .from(legalDocuments)
      .where(eq(legalDocuments.documentId, documentId))
      .limit(1);
    if (!row) {
      throw new NotFoundException({ code: 'LEGAL_DOCUMENT_NOT_FOUND', message: 'Legal document not found' });
    }
    return {
      ...this.toSummary(row),
      contentFormat: 'MARKDOWN',
      content: row.content,
    };
  }

  private toSummary(row: typeof legalDocuments.$inferSelect): LegalDocumentSummary {
    return {
      documentId: row.documentId,
      type: row.type as LegalDocumentType,
      version: row.version,
      title: row.title,
      required: row.required,
      publishedAt: row.publishedAt.toISOString(),
    };
  }
}
