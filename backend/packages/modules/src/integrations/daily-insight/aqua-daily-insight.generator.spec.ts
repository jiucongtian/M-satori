import { AquaAIClient, AquaAIError, AquaAINetworkError } from '@aqua-ai/sdk';
import type { DailyInsightGenerationInput } from '@satori/application';
import { describe, expect, it, vi } from 'vitest';
import { AquaDailyInsightGenerator, toAquaInput } from './aqua-daily-insight.generator.js';

const input: DailyInsightGenerationInput = {
  dailyInsightId: '00000000-0000-7000-8000-000000000001',
  localDate: '2026-08-13',
  timezone: 'Asia/Shanghai',
  profileRevisionId: '00000000-0000-7000-8000-000000000002',
  astrologySnapshot: {},
  cards: [
    { dimension: 'CAREER', snapshotPillar: '丁丑' },
    { dimension: 'FAMILY', snapshotPillar: '辛亥' },
  ],
};

const manifest = {
  workflowVersion: 'daily-insight/1.0.0',
  skillName: 'daily-energy-signature',
  skillVersion: '1.0.0-aqua.1',
  resourceHashes: {},
  promptVersion: 'daily-insight-runtime/1.0.0',
  model: 'glm-test',
  outputSchemaVersion: 'daily-insight/1.0',
  contentPolicyVersion: 'daily-insight-safe/1.0.0',
  knowledgeSources: [],
  reproducibilityLimitations: [],
};

describe('AquaDailyInsightGenerator', () => {
  it('uses the SDK 0.1.1 default request timeout', () => {
    const client = new AquaAIClient({
      baseUrl: 'https://aqua.example.com',
      auth: { type: 'serviceKey', serviceKey: 'test-service-key' },
    });
    expect(client.getSafeConfig()).toMatchObject({ timeoutMs: 300_000, maxRetries: 0 });
  });

  it('maps frozen Satori facts to the daily-insight workflow input', () => {
    expect(toAquaInput(input)).toEqual({
      reportDate: '2026-08-13',
      timezone: 'Asia/Shanghai',
      locale: 'zh-CN',
      heavenDayGanzhi: '己未',
      season: '秋',
      lunarMonth: 7,
      monthCard: { ganzhi: '丁丑' },
      dayCard: { ganzhi: '辛亥' },
    });
  });

  it('runs the configured workflow and maps its result to the Satori contract', async () => {
    const run = vi.fn().mockResolvedValue({
      requestId: 'aqua-request-1',
      result: {
        theme: '顺势而为稳中有进',
        insight:
          '今天更适合先看清事情的轻重缓急，再把注意力放回真正重要的选择。外部节奏可能略显繁杂，但你不必同时回应所有声音，保持稳定会让方向逐渐清楚。遇到临时变化时，可以先停下来确认自己的感受和目标，再决定下一步如何行动。',
        action: '留出十分钟整理今天最重要的一件事，并先完成它的第一步。',
        reflectionQuestion: '今天我最值得集中精力推进的一件事是什么？',
        notice: '本内容仅供自我觉察与日常参考，不构成医疗、心理、法律或投资建议。',
      },
      manifest,
    });
    const generator = new AquaDailyInsightGenerator(
      { workflows: { run } },
      { workflowId: 'daily-insight', workflowVersion: 'daily-insight/1.0.0' },
    );

    const result = await generator.generate(input);

    expect(run).toHaveBeenCalledWith(
      'daily-insight',
      expect.objectContaining({
        workflowVersion: 'daily-insight/1.0.0',
        idempotencyKey: `daily-insight:${input.dailyInsightId}`,
        runReference: input.dailyInsightId,
      }),
    );
    expect(result.content.notice).toBe('内容用于自我观察与成长参考。');
    expect(result.manifest).toMatchObject({
      generator: 'AQUA_AI',
      providerRequestId: 'aqua-request-1',
      workflowId: 'daily-insight',
      modelVersion: 'glm-test',
    });
  });

  it('uses the active Aqua workflow version when no version is configured', async () => {
    const run = vi.fn().mockResolvedValue({
      requestId: 'aqua-request-active',
      result: {
        theme: '顺势而为稳中有进',
        insight:
          '今天更适合先看清事情的轻重缓急，再把注意力放回真正重要的选择。外部节奏可能略显繁杂，但你不必同时回应所有声音，保持稳定会让方向逐渐清楚。遇到临时变化时，可以先停下来确认自己的感受和目标，再决定下一步如何行动。',
        action: '留出十分钟整理今天最重要的一件事，并先完成它的第一步。',
        reflectionQuestion: '今天我最值得集中精力推进的一件事是什么？',
        notice: '本内容仅供自我觉察与日常参考，不构成医疗、心理、法律或投资建议。',
      },
      manifest,
    });
    const generator = new AquaDailyInsightGenerator({ workflows: { run } }, { workflowId: 'daily-insight' });

    await generator.generate(input);

    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]?.[0]).toBe('daily-insight');
    expect(run.mock.calls[0]?.[1] as Record<string, unknown>).not.toHaveProperty('workflowVersion');
    expect(run.mock.calls[0]?.[2]).toBeUndefined();
  });

  it('marks SDK network failures as retryable without exposing credentials', async () => {
    const run = vi.fn().mockRejectedValue(new AquaAINetworkError());
    const generator = new AquaDailyInsightGenerator(
      { workflows: { run } },
      { workflowId: 'daily-insight', workflowVersion: 'daily-insight/1.0.0' },
    );

    await expect(generator.generate(input)).rejects.toMatchObject({
      message: 'Aqua AI daily-insight generation failed',
      code: 'AQUA_AI_NETWORK',
      retryable: true,
    });
  });

  it('retries Aqua output-schema failures because a new generation can recover', async () => {
    const run = vi
      .fn()
      .mockRejectedValue(
        new AquaAIError('http', 'Workflow output failed validation', {
          code: 'OUTPUT_SCHEMA_INVALID',
          retryable: false,
        }),
      );
    const generator = new AquaDailyInsightGenerator(
      { workflows: { run } },
      { workflowId: 'daily-insight' },
    );

    await expect(generator.generate(input)).rejects.toMatchObject({
      code: 'OUTPUT_SCHEMA_INVALID',
      retryable: true,
    });
  });
});
