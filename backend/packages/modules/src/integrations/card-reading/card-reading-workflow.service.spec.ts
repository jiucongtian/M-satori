import { HttpException } from '@nestjs/common';
import { AquaAIError, AquaAIHttpError, AquaAITimeoutError, type AquaAIClient } from '@aqua-ai/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CARD_READING_WORKFLOW_TIMEOUT_MS,
  CardReadingWorkflowService,
} from './card-reading-workflow.service.js';

const workflowId = 'ai-card-reading';

function aquaResult(overrides: Record<string, unknown> = {}) {
  return {
    audience: 'C',
    cards: [48, 23, 7],
    missing_fields: [],
    mode: 'multi',
    notice: '内容用于自我观察与成长参考。',
    question_type: 'relationship',
    report: '第一段\n\n第二段\n\n第三段\n\n第四段\n\n第五段',
    status: 'complete',
    title: '在变化中看见自己的选择',
    ...overrides,
  };
}

function service(run: AquaAIClient['workflows']['run']) {
  return new CardReadingWorkflowService({ workflows: { run } }, { workflowId });
}

function statusOf(error: unknown): number | undefined {
  return error instanceof HttpException ? error.getStatus() : undefined;
}

describe('CardReadingWorkflowService', () => {
  afterEach(() => vi.restoreAllMocks());

  it('runs existing cards with one trace-based idempotency identity and no workflowVersion', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const run = vi.fn().mockResolvedValue({
      requestId: 'aqua-request-success',
      result: aquaResult(),
      manifest: {},
    });
    const result = await service(run).run(
      {
        audience: 'C',
        question: '这段关系适合继续吗？',
        cards: [48, 23, 7],
        context: { relationship_stage: '了解阶段' },
      },
      'api-request-00000001',
    );

    expect(result).toEqual(aquaResult());
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(
      workflowId,
      {
        idempotencyKey: 'card-reading:api-request-00000001',
        runReference: 'card-reading:api-request-00000001',
        input: {
          audience: 'C',
          question: '这段关系适合继续吗？',
          cards: [48, 23, 7],
          context: { relationship_stage: '了解阶段' },
        },
      },
      { timeoutMs: CARD_READING_WORKFLOW_TIMEOUT_MS },
    );
  });

  it('supports a random card request and accepts the mode returned by Aqua', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const run = vi.fn().mockResolvedValue({
      requestId: 'aqua-request-random',
      result: aquaResult({ audience: 'B', mode: 'dual', cards: [12, 39] }),
      manifest: {},
    });

    await expect(
      service(run).run({ audience: 'B', question: '近期最值得关注什么？', random_count: 2 }),
    ).resolves.toMatchObject({ mode: 'dual', cards: [12, 39] });
  });

  it('keeps the run reference stable while isolating generation attempts', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const run = vi.fn().mockResolvedValue({
      requestId: 'aqua-request-attempt',
      result: aquaResult({ mode: 'dual', cards: [12, 39] }),
      manifest: {},
    });

    await service(run).execute(
      { audience: 'C', question: '这段关系适合继续吗？', cards: [12, 39] },
      'reading-00000001',
      'attempt-2',
    );

    expect(run).toHaveBeenCalledWith(
      workflowId,
      expect.objectContaining({
        idempotencyKey: 'card-reading:reading-00000001:attempt-2',
        runReference: 'card-reading:reading-00000001',
      }),
      { timeoutMs: CARD_READING_WORKFLOW_TIMEOUT_MS },
    );
  });

  it.each([
    [{ audience: 'C', question: '', random_count: 1 }, 'question'],
    [{ audience: 'C', question: 'x'.repeat(2_001), random_count: 1 }, 'question'],
    [{ audience: 'C', question: '问题' }, ''],
    [{ audience: 'C', question: '问题', cards: [1], random_count: 1 }, ''],
    [{ audience: 'C', question: '问题', cards: [] }, 'cards'],
    [{ audience: 'C', question: '问题', cards: [1, 2, 3, 4, 5, 6] }, 'cards'],
    [{ audience: 'C', question: '问题', cards: [0] }, 'cards.0'],
    [{ audience: 'C', question: '问题', cards: [61] }, 'cards.0'],
    [{ audience: 'C', question: '问题', cards: [1.5] }, 'cards.0'],
    [{ audience: 'C', question: '问题', cards: [7, 7] }, 'cards'],
    [{ audience: 'C', question: '问题', random_count: 0 }, 'random_count'],
    [{ audience: 'C', question: '问题', random_count: 6 }, 'random_count'],
    [{ audience: 'C', question: '问题', random_count: 1.5 }, 'random_count'],
    [{ audience: 'A', question: '问题', random_count: 1 }, 'audience'],
  ])('rejects invalid input before calling Aqua: %#', async (input, path) => {
    const run = vi.fn();
    try {
      await service(run).run(input);
      expect.unreachable('input should have failed validation');
    } catch (error) {
      expect(statusOf(error)).toBe(400);
      expect(JSON.stringify((error as HttpException).getResponse())).toContain(path);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'AQUA_AUTH_INVALID'],
    [403, 'AQUA_WORKFLOW_FORBIDDEN'],
    [429, 'AQUA_RATE_LIMITED'],
  ])('maps Aqua HTTP %i without retrying the workflow', async (status, code) => {
    const run = vi.fn().mockRejectedValue(
      new AquaAIHttpError(status, 'provider detail', {
        code,
        requestId: `request-${status}`,
        retryable: status === 429,
        details: { executionId: `execution-${status}` },
      }),
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      service(run).run({ audience: 'C', question: '不能出现在日志中的完整问题', random_count: 1 }),
    ).rejects.toSatisfy((error: unknown) => statusOf(error) === status);

    expect(run).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(
      'aqua_card_reading_failed',
      expect.objectContaining({
        status,
        code,
        requestId: `request-${status}`,
        executionId: `execution-${status}`,
      }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('不能出现在日志中的完整问题');
  });

  it('maps timeout to 504 without retrying', async () => {
    const run = vi.fn().mockRejectedValue(new AquaAITimeoutError());
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      service(run).run({ audience: 'C', question: '近期最值得关注什么？', random_count: 3 }),
    ).rejects.toSatisfy((error: unknown) => statusOf(error) === 504);
    expect(run).toHaveBeenCalledOnce();
  });

  it('maps SDK and unexpected service failures to 503', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const failure of [
      new AquaAIError('network', 'network unavailable', { code: 'AQUA_NETWORK', retryable: true }),
      new Error('unexpected upstream failure'),
    ]) {
      const run = vi.fn().mockRejectedValue(failure);
      await expect(
        service(run).run({ audience: 'C', question: '近期最值得关注什么？', random_count: 3 }),
      ).rejects.toSatisfy((error: unknown) => statusOf(error) === 503);
      expect(run).toHaveBeenCalledOnce();
    }
  });

  it('rejects an invalid or count-mismatched Aqua mode as a 502', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const result of [{ summary: 'missing mode' }, aquaResult({ mode: 'single' })]) {
      const run = vi.fn().mockResolvedValue({ requestId: 'request-invalid', result, manifest: {} });
      await expect(
        service(run).run({ audience: 'C', question: '近期最值得关注什么？', random_count: 3 }),
      ).rejects.toSatisfy((error: unknown) => statusOf(error) === 502);
    }
  });
});
