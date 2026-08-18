import { AquaAIError } from '@aqua-ai/sdk';
import type { ProfileFirstLookGenerationInput } from '@satori/application';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AquaProfileFirstLookGenerator,
  PROFILE_FIRST_LOOK_NOTICE,
  PROFILE_FIRST_LOOK_SKILL_VERSION,
  PROFILE_FIRST_LOOK_WORKFLOW_ID,
  PROFILE_FIRST_LOOK_WORKFLOW_VERSION,
} from './aqua-profile-first-look.generator.js';

const input: ProfileFirstLookGenerationInput = {
  idempotencyKey: '00000000-0000-7000-8000-000000000001',
  runReference: 'profile-11-00000000-0000-7000-8000-000000000001',
  name: '小满',
  pronoun: '你',
  cards: { year: '甲子', month: '乙丑', day: '丙寅', hour: '丁卯' },
};

const result = {
  schema_version: '1.0.0',
  status: 'complete',
  profile_summary: {
    title: '春生夏暖，外放内藏',
    description: '你的生命底色以春的生发为主调，也保留向内蓄力的冷静。',
    keywords: ['生发向上', '外热内静', '先谋后动'],
    outer_trait: '生机热情，敢想敢闯',
    inner_trait: '收敛蓄藏，先谋后动',
  },
  cards: [
    aquaCard('hour', '思想', '丁卯'),
    aquaCard('day', '行为', '丙寅'),
    aquaCard('month', '事业', '乙丑'),
    aquaCard('year', '梦想目标', '甲子'),
  ],
  knowledge_release: 'unknown',
  notice: PROFILE_FIRST_LOOK_NOTICE,
} as const;

const manifest = {
  workflowVersion: PROFILE_FIRST_LOOK_WORKFLOW_VERSION,
  skillName: PROFILE_FIRST_LOOK_WORKFLOW_ID,
  skillVersion: PROFILE_FIRST_LOOK_SKILL_VERSION,
  resourceHashes: {},
  promptVersion: 'stateless-runtime/1.0.0',
  model: 'deepseek-v4-flash',
  outputSchemaVersion: 'output@sha256:test',
  contentPolicyVersion: 'stateless-baseline/1.0.0',
  knowledgeSources: [],
  reproducibilityLimitations: [],
};

describe('AquaProfileFirstLookGenerator', () => {
  afterEach(() => vi.restoreAllMocks());

  it('calls the frozen stateless workflow once and maps the accepted contract', async () => {
    const run = vi.fn().mockResolvedValue({ requestId: 'aqua-profile-request-1', result, manifest });
    const generator = new AquaProfileFirstLookGenerator({ workflows: { run } }, 300_000);

    const generated = await generator.generate(input);

    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(
      PROFILE_FIRST_LOOK_WORKFLOW_ID,
      {
        workflowVersion: PROFILE_FIRST_LOOK_WORKFLOW_VERSION,
        idempotencyKey: input.idempotencyKey,
        runReference: input.runReference,
        input: { name: '小满', pronoun: '你', cards: input.cards },
      },
      { timeoutMs: 300_000 },
    );
    expect(generated).toMatchObject({
      providerRequestId: 'aqua-profile-request-1',
      providerExecutionId: null,
      content: {
        schemaVersion: '1.0.0',
        status: 'complete',
        notice: PROFILE_FIRST_LOOK_NOTICE,
      },
      manifest: {
        workflowVersion: PROFILE_FIRST_LOOK_WORKFLOW_VERSION,
        skillVersion: PROFILE_FIRST_LOOK_SKILL_VERSION,
        model: 'deepseek-v4-flash',
      },
    });
    expect(generated.content.cards.map((card) => card.position)).toEqual([
      'hour',
      'day',
      'month',
      'year',
    ]);
    expect(generated.content.cards.map((card) => card.dimension)).toEqual([
      '思想',
      '行为',
      '事业',
      '梦想目标',
    ]);
  });

  it('rejects reordered or factually mismatched cards without retrying', async () => {
    const run = vi.fn().mockResolvedValue({
      requestId: 'aqua-profile-mismatch',
      result: { ...result, cards: [result.cards[1], result.cards[0], result.cards[2], result.cards[3]] },
      manifest,
    });
    const generator = new AquaProfileFirstLookGenerator({ workflows: { run } }, 300_000);

    await expect(generator.generate(input)).rejects.toMatchObject({
      code: 'AQUA_PROFILE_FIRST_LOOK_RESPONSE_INVALID',
      retryable: false,
      providerRequestId: 'aqua-profile-mismatch',
    });
    expect(run).toHaveBeenCalledOnce();
  });

  it('rejects response and manifest version drift', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({
        requestId: 'aqua-schema-drift',
        result: { ...result, schema_version: '2.0.0' },
        manifest,
      })
      .mockResolvedValueOnce({
        requestId: 'aqua-skill-drift',
        result,
        manifest: { ...manifest, skillVersion: '1.0.0-aqua.3' },
      });
    const generator = new AquaProfileFirstLookGenerator({ workflows: { run } }, 300_000);

    await expect(generator.generate(input)).rejects.toMatchObject({
      code: 'AQUA_PROFILE_FIRST_LOOK_RESPONSE_INVALID',
    });
    await expect(generator.generate(input)).rejects.toMatchObject({
      code: 'AQUA_PROFILE_FIRST_LOOK_RESPONSE_INVALID',
    });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('records safe Aqua failure metadata and never retries automatically', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const run = vi.fn().mockRejectedValue(
      new AquaAIError('http', 'rate limited', {
        code: 'RATE_LIMIT_EXCEEDED',
        requestId: 'aqua-rate-request',
        retryable: true,
        details: { retryAfter: 12 },
      }),
    );
    const generator = new AquaProfileFirstLookGenerator({ workflows: { run } }, 300_000);

    await expect(generator.generate(input)).rejects.toMatchObject({
      code: 'RATE_LIMIT_EXCEEDED',
      retryable: true,
      providerRequestId: 'aqua-rate-request',
      retryAfter: '12',
    });
    expect(run).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledWith(
      'aqua_profile_first_look_failed',
      expect.objectContaining({
        errorCode: 'RATE_LIMIT_EXCEEDED',
        requestId: 'aqua-rate-request',
        retryable: true,
        retryAfter: '12',
      }),
    );
  });

  it('rejects incomplete input before calling Aqua', async () => {
    const run = vi.fn();
    const generator = new AquaProfileFirstLookGenerator({ workflows: { run } }, 300_000);

    await expect(
      generator.generate({ ...input, cards: { ...input.cards, hour: 'UNKNOWN' } }),
    ).rejects.toMatchObject({ code: 'AQUA_PROFILE_FIRST_LOOK_INPUT_INVALID', retryable: false });
    expect(run).not.toHaveBeenCalled();
  });
});

function aquaCard(
  position: 'hour' | 'day' | 'month' | 'year',
  dimension: '思想' | '行为' | '事业' | '梦想目标',
  card: string,
) {
  return {
    position,
    dimension,
    card,
    title: `${dimension}画像`,
    summary: `${dimension}维度的真实初识内容。`,
    inner_trait: '内在特质',
    outer_trait: '外在特质',
    status: 'complete',
    evidence: { season_mark: `${card}季节印记` },
    missing_fields: [] as string[],
  };
}
