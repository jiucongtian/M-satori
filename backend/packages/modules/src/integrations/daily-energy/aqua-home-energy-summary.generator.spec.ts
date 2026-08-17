import { AquaAIError } from '@aqua-ai/sdk';
import { HOME_ENERGY_WORKFLOW_VERSION, type HomeEnergySummaryInput } from '@satori/application';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AquaHomeEnergySummaryGenerator } from './aqua-home-energy-summary.generator.js';

const input: HomeEnergySummaryInput = {
  runReference: '00000000-0000-7000-8000-000000000001',
  userName: '小满',
  dayCard: '癸丑',
  heavenCard: '丙辰',
  date: '2026-08-13',
};

const result = {
  greeting: '小满，你好',
  guidance: '先稳住自己的节奏，再清醒回应外界的变化。',
  energy_level: '中',
  suitable_actions: ['梳理重点', '确认后再行动'],
  cautions: ['别急着回应', '避免情绪消耗'],
  date: '2026年8月13日',
  day_card: '癸丑',
  heaven_card: '丙辰',
  score: 1,
  signals: ['STEM_SAME_ELEMENT'],
  rule_version: 'daily-energy-core-v1.0.0',
  copy_version: 'daily-energy-home-copy-v1.0.0',
};

describe('AquaHomeEnergySummaryGenerator', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));
  afterEach(() => vi.restoreAllMocks());

  it('runs the frozen stateless workflow request and maps all result fields', async () => {
    const run = vi.fn().mockResolvedValue({ requestId: 'aqua-home-request-1', result, manifest: {} });
    const generator = new AquaHomeEnergySummaryGenerator(
      { workflows: { run } },
      { maxAttempts: 2, retryBackoffMs: 0 },
    );

    await expect(generator.generate(input)).resolves.toEqual({
      providerRequestId: 'aqua-home-request-1',
      summary: {
        greeting: result.greeting,
        guidance: result.guidance,
        energyLevel: result.energy_level,
        suitableActions: result.suitable_actions,
        cautions: result.cautions,
        date: result.date,
        dayCard: result.day_card,
        heavenCard: result.heaven_card,
        score: result.score,
        signals: result.signals,
        ruleVersion: result.rule_version,
        copyVersion: result.copy_version,
      },
    });
    expect(run).toHaveBeenCalledWith('daily-energy-home-summary', {
      workflowVersion: HOME_ENERGY_WORKFLOW_VERSION,
      idempotencyKey: `daily-energy-${input.date}-${input.runReference}`,
      runReference: input.runReference,
      input: {
        name: input.userName,
        day_card: input.dayCard,
        heaven_card: input.heavenCard,
        date: input.date,
      },
    });
  });

  it('supports a shared prewarm request without sending a user name', async () => {
    const run = vi.fn().mockResolvedValue({ requestId: 'aqua-shared-request', result, manifest: {} });
    const generator = new AquaHomeEnergySummaryGenerator(
      { workflows: { run } },
      { maxAttempts: 2, retryBackoffMs: 0 },
    );

    await generator.generate({
      runReference: 'shared-00',
      dayCard: input.dayCard,
      heavenCard: input.heavenCard,
      date: input.date,
    });

    expect(run).toHaveBeenCalledWith(
      'daily-energy-home-summary',
      expect.objectContaining({
        idempotencyKey: `daily-energy-${input.date}-shared-00`,
        runReference: 'shared-00',
        input: {
          day_card: input.dayCard,
          heaven_card: input.heavenCard,
          date: input.date,
        },
      }),
    );
  });

  it('retries only retryable Aqua failures', async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(
        new AquaAIError('http', 'temporary', {
          code: 'AQUA_TEMPORARY',
          requestId: 'request-retryable',
          retryable: true,
        }),
      )
      .mockResolvedValueOnce({ requestId: 'request-success', result, manifest: {} });
    const generator = new AquaHomeEnergySummaryGenerator(
      { workflows: { run } },
      { maxAttempts: 2, retryBackoffMs: 0 },
    );

    await expect(generator.generate(input)).resolves.toMatchObject({ providerRequestId: 'request-success' });
    expect(run).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith(
      'aqua_home_energy_summary_failed',
      expect.objectContaining({
        errorCode: 'AQUA_TEMPORARY',
        message: 'temporary',
        requestId: 'request-retryable',
        retryable: true,
      }),
    );
  });

  it('does not retry non-retryable Aqua failures', async () => {
    const run = vi.fn().mockRejectedValue(
      new AquaAIError('http', 'invalid input', {
        code: 'INVALID_INPUT',
        requestId: 'request-invalid',
        retryable: false,
      }),
    );
    const generator = new AquaHomeEnergySummaryGenerator(
      { workflows: { run } },
      { maxAttempts: 3, retryBackoffMs: 0 },
    );

    await expect(generator.generate(input)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      retryable: false,
      providerRequestId: 'request-invalid',
    });
    expect(run).toHaveBeenCalledOnce();
  });

  it('rejects responses whose card facts differ from the request', async () => {
    const run = vi.fn().mockResolvedValue({
      requestId: 'request-mismatch',
      result: { ...result, heaven_card: '丁巳' },
      manifest: {},
    });
    const generator = new AquaHomeEnergySummaryGenerator(
      { workflows: { run } },
      { maxAttempts: 2, retryBackoffMs: 0 },
    );

    await expect(generator.generate(input)).rejects.toMatchObject({
      code: 'AQUA_HOME_ENERGY_RESPONSE_INVALID',
      retryable: false,
    });
    expect(run).toHaveBeenCalledOnce();
  });

  it('rejects invalid dates and cards before calling Aqua', async () => {
    const run = vi.fn();
    const generator = new AquaHomeEnergySummaryGenerator(
      { workflows: { run } },
      { maxAttempts: 2, retryBackoffMs: 0 },
    );

    await expect(generator.generate({ ...input, date: '2026-02-31' })).rejects.toMatchObject({
      code: 'AQUA_HOME_ENERGY_INPUT_INVALID',
      retryable: false,
    });
    await expect(generator.generate({ ...input, dayCard: '未知' })).rejects.toMatchObject({
      code: 'AQUA_HOME_ENERGY_INPUT_INVALID',
      retryable: false,
    });
    expect(run).not.toHaveBeenCalled();
  });
});
