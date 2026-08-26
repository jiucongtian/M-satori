import { NotFoundException } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { LOCATION_PROVIDER } from '../../packages/application/src/locations/location-provider.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureApi, createFastifyAdapter } from '../../apps/api/src/configure-api.js';
import { validateEnvironment } from '../../packages/infrastructure/src/config/environment.js';
import { LocationController } from '../../packages/modules/src/integrations/locations/location.controller.js';
import { LocalLocationProvider } from '../../packages/modules/src/integrations/locations/location.provider.js';
import { BootstrapController } from '../../packages/modules/src/operations/foundation/bootstrap.controller.js';
import { BootstrapService } from '../../packages/modules/src/operations/foundation/bootstrap.service.js';
import { LegalDocumentController } from '../../packages/modules/src/operations/foundation/legal-document.controller.js';
import {
  LegalDocumentService,
  type LegalDocument,
  type LegalDocumentSummary,
} from '../../packages/modules/src/operations/foundation/legal-document.service.js';

const legalSummaries: LegalDocumentSummary[] = [
  {
    documentId: 'legal_privacy_20260809',
    type: 'PRIVACY_POLICY',
    version: '1.0',
    title: '隐私政策',
    required: true,
    publishedAt: '2026-08-09T00:00:00.000Z',
  },
  {
    documentId: 'legal_terms_20260809',
    type: 'TERMS_OF_SERVICE',
    version: '1.0',
    title: '用户协议',
    required: true,
    publishedAt: '2026-08-09T00:00:00.000Z',
  },
  {
    documentId: 'legal_ai_notice_20260809',
    type: 'AI_CONTENT_NOTICE',
    version: '1.0',
    title: 'AI 内容说明',
    required: true,
    publishedAt: '2026-08-09T00:00:00.000Z',
  },
];

const legalService = {
  listRequired: () => Promise.resolve(legalSummaries),
  get: (documentId: string): Promise<LegalDocument> => {
    const summary = legalSummaries.find((candidate) => candidate.documentId === documentId);
    if (!summary) {
      throw new NotFoundException({
        code: 'LEGAL_DOCUMENT_NOT_FOUND',
        message: 'Legal document not found',
      });
    }
    return Promise.resolve({ ...summary, contentFormat: 'MARKDOWN', content: '# 正文' });
  },
};

describe('foundation API integration', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [BootstrapController, LegalDocumentController, LocationController],
      providers: [
        BootstrapService,
        { provide: LegalDocumentService, useValue: legalService },
        { provide: LOCATION_PROVIDER, useClass: LocalLocationProvider },
      ],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(createFastifyAdapter());
    await configureApi(
      app,
      validateEnvironment({
        SMS_DELIVERY_MODE: 'FIXED_CODE',
        AQUA_BASE_URL: 'https://aqua.example.com',
        AQUA_SERVICE_KEY: 'test-service-key-with-safe-length',
      }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => app.close());

  it('returns bootstrap in the success envelope', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/app/bootstrap' });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      data: { requiredLegalDocuments: unknown[]; features: Record<string, boolean> };
    }>();
    expect(body.data.requiredLegalDocuments).toHaveLength(3);
    expect(body.data.features.lifeReport).toBe(false);
  });

  it('echoes a valid request id and wraps errors', async () => {
    const requestId = '019fea58-1511-7363-aa03-207c34426ed3';
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/legal-documents/missing',
      headers: { 'x-request-id': requestId },
    });
    expect(response.statusCode).toBe(404);
    expect(response.headers['x-request-id']).toBe(requestId);
    expect(response.json<{ error: { code: string; message: string; requestId: string } }>()).toEqual({
      error: { code: 'LEGAL_DOCUMENT_NOT_FOUND', message: 'Legal document not found', requestId },
    });
  });

  it('returns a published legal document', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/legal-documents/legal_privacy_20260809',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: LegalDocument }>().data.contentFormat).toBe('MARKDOWN');
  });

  it('validates and normalizes location search', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/locations?query=%20杭州%20&limit=10',
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      data: { locationId: string }[];
      meta: { nextCursor: string | null; hasMore: boolean };
    }>();
    expect(body.data[0]?.locationId).toBe('geonames:1808926');
    expect(body.meta).toEqual({ nextCursor: null, hasMore: false });

    const invalid = await app.inject({
      method: 'GET',
      url: '/api/v1/locations?query=杭州&limit=21',
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_FAILED');
  });
});
