import { Injectable } from '@nestjs/common';
import { R1_RUNTIME_POLICY } from '@satori/infrastructure';
import { LegalDocumentService, type LegalDocumentSummary } from './legal-document.service.js';

export interface Bootstrap {
  serverTime: string;
  apiVersion: 'v1';
  configVersion: string;
  maintenance: { enabled: boolean; message: string | null };
  clientPolicy: { minimumSupportedVersion: string; latestVersion: string; forceRefresh: boolean };
  features: Record<string, boolean>;
  requiredLegalDocuments: LegalDocumentSummary[];
}

@Injectable()
export class BootstrapService {
  constructor(private readonly documents: LegalDocumentService) {}

  async get(): Promise<Bootstrap> {
    return {
      serverTime: new Date().toISOString(),
      apiVersion: 'v1',
      configVersion: R1_RUNTIME_POLICY.version,
      maintenance: { enabled: false, message: null },
      clientPolicy: { minimumSupportedVersion: '1.0.0', latestVersion: '1.0.0', forceRefresh: false },
      features: {
        lifeProfile: true,
        profileLibrary: true,
        wisdomSeeds: true,
        dailyInsight: true,
        lifeReport: false,
        cardReading: false,
        payment: false,
        publicSharing: false,
      },
      requiredLegalDocuments: await this.documents.listRequired(),
    };
  }
}
