import { Injectable } from '@nestjs/common';
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
      configVersion: 'r1.0-2026-08-10.1',
      maintenance: { enabled: false, message: null },
      clientPolicy: { minimumSupportedVersion: '1.0.0', latestVersion: '1.0.0', forceRefresh: false },
      features: {
        lifeProfile: process.env.FEATURE_LIFE_PROFILE !== 'false',
        profileLibrary: process.env.FEATURE_PROFILE_LIBRARY !== 'false',
        wisdomSeeds: process.env.FEATURE_WISDOM_SEEDS !== 'false',
        dailyInsight: process.env.FEATURE_DAILY_INSIGHT !== 'false',
        lifeReport: false,
        cardReading: false,
        payment: false,
        publicSharing: false,
      },
      requiredLegalDocuments: await this.documents.listRequired(),
    };
  }
}
