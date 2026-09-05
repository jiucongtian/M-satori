import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { CardReadingWorkflowService } from '../integrations/card-reading/card-reading-workflow.service.js';
import { CardReadingController } from './card-reading.controller.js';
import type { CardReadingService } from './card-reading.service.js';
import type { AuthenticatedRequest } from '../identity/auth/authenticated-request.js';
const operations = { operationsService: true } as AuthenticatedRequest & { operationsService: boolean };

describe('CardReadingController interpretation endpoint', () => {
  it('passes the API idempotency key into the Aqua workflow service', async () => {
    const run = vi.fn().mockResolvedValue({ mode: 'single', summary: '一张牌的解读' });
    const controller = new CardReadingController(
      {} as CardReadingService,
      { run } as unknown as CardReadingWorkflowService,
    );
    const input = { audience: 'C', question: '近期最值得关注什么？', random_count: 1 };

    await expect(controller.createInterpretation('request-key-000001', input, operations)).resolves.toEqual({
      data: { mode: 'single', summary: '一张牌的解读' },
    });
    expect(run).toHaveBeenCalledWith(input, 'request-key-000001');
  });

  it.each([undefined, 'short', 'x'.repeat(129)])('rejects an invalid idempotency key', async (key) => {
    const controller = new CardReadingController(
      {} as CardReadingService,
      { run: vi.fn() } as unknown as CardReadingWorkflowService,
    );
    await expect(controller.createInterpretation(key, {}, operations)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not allow a consumer to bypass the draw and benefit flow', async () => {
    const run = vi.fn();
    const controller = new CardReadingController({} as CardReadingService, { run } as unknown as CardReadingWorkflowService);
    await expect(controller.createInterpretation('request-key-000001', {}, {} as AuthenticatedRequest)).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });
});
