import { AquaAIError, type AquaAIClient, type WorkflowRunResponse } from '@aqua-ai/sdk';
import type {
  DailyInsightGenerator,
  DailyInsightGenerationInput,
  DailyInsightGenerationResult,
} from '@satori/application';
import { Solar } from 'lunar-typescript';
import { z } from 'zod';

const AQUA_NOTICE = '本内容仅供自我觉察与日常参考，不构成医疗、心理、法律或投资建议。';
const SATORI_NOTICE = '内容用于自我观察与成长参考。';

const cardSchema = z.object({
  dimension: z.string(),
  snapshotPillar: z.string().min(2),
});

const aquaResultSchema = z.object({
  theme: z.string().min(4).max(16),
  insight: z.string().min(80).max(800),
  action: z.string().min(8).max(200),
  reflectionQuestion: z.string().min(8).max(120),
  notice: z.literal(AQUA_NOTICE),
});

const aquaManifestSchema = z.object({
  workflowVersion: z.string().min(1),
  skillName: z.string().min(1),
  skillVersion: z.string().min(1),
  promptVersion: z.string().min(1),
  model: z.string().min(1),
  outputSchemaVersion: z.string().min(1),
  contentPolicyVersion: z.string().min(1),
});

interface AquaWorkflowClient {
  workflows: Pick<AquaAIClient['workflows'], 'run'>;
}

interface AquaGeneratorOptions {
  workflowId: string;
  workflowVersion?: string;
}

interface AquaDailyInsightInput extends Record<string, unknown> {
  reportDate: string;
  timezone: string;
  locale: 'zh-CN';
  heavenDayGanzhi: string;
  season: '春' | '夏' | '秋' | '冬';
  lunarMonth: number;
  monthCard: { ganzhi: string };
  dayCard: { ganzhi: string };
}

type AquaDailyInsightOutput = z.infer<typeof aquaResultSchema>;

export class AquaDailyInsightGenerator implements DailyInsightGenerator {
  constructor(
    private readonly client: AquaWorkflowClient,
    private readonly options: AquaGeneratorOptions,
  ) {}

  async generate(input: DailyInsightGenerationInput): Promise<DailyInsightGenerationResult> {
    try {
      const response = await this.client.workflows.run<AquaDailyInsightInput, AquaDailyInsightOutput>(
        this.options.workflowId,
        {
          ...(this.options.workflowVersion === undefined
            ? {}
            : { workflowVersion: this.options.workflowVersion }),
          idempotencyKey: `daily-insight:${input.dailyInsightId}`,
          runReference: input.dailyInsightId,
          input: toAquaInput(input),
        },
      );
      return toGenerationResult(response, this.options.workflowId);
    } catch (error) {
      if (error instanceof AquaAIError) {
        const retryable = error.retryable || error.code === 'OUTPUT_SCHEMA_INVALID';
        throw Object.assign(new Error('Aqua AI daily-insight generation failed', { cause: error }), {
          code: error.code ?? `AQUA_AI_${error.kind.toUpperCase()}`,
          retryable,
          providerRequestId: error.requestId,
        });
      }
      if (error instanceof z.ZodError) {
        throw Object.assign(new Error('Aqua AI daily-insight response is invalid', { cause: error }), {
          code: 'AQUA_AI_RESPONSE_INVALID',
          retryable: false,
        });
      }
      throw error;
    }
  }
}

export function toAquaInput(input: DailyInsightGenerationInput): AquaDailyInsightInput {
  const [year, month, day] = input.localDate.split('-').map(Number);
  if (!year || !month || !day) {
    throw nonRetryable('AQUA_AI_INPUT_INVALID', 'Daily insight local date is invalid');
  }
  const lunar = Solar.fromYmd(year, month, day).getLunar();
  const lunarMonth = Math.abs(lunar.getMonth());
  const parsedCards = z.array(cardSchema).safeParse(input.cards);
  if (!parsedCards.success) {
    throw nonRetryable('AQUA_AI_INPUT_INVALID', 'Daily insight cards are invalid');
  }
  const cards = parsedCards.data;
  const monthCard = cards.find((card) => card.dimension === 'CAREER');
  const dayCard = cards.find((card) => card.dimension === 'FAMILY');
  if (!monthCard || !dayCard) {
    throw nonRetryable('AQUA_AI_INPUT_INVALID', 'Daily insight month/day cards are missing');
  }
  return {
    reportDate: input.localDate,
    timezone: input.timezone,
    locale: 'zh-CN',
    heavenDayGanzhi: lunar.getDayInGanZhi(),
    season: seasonFor(lunarMonth),
    lunarMonth,
    monthCard: { ganzhi: monthCard.snapshotPillar },
    dayCard: { ganzhi: dayCard.snapshotPillar },
  };
}

function toGenerationResult(
  response: WorkflowRunResponse<AquaDailyInsightOutput>,
  workflowId: string,
): DailyInsightGenerationResult {
  const content = aquaResultSchema.parse(response.result);
  const manifest = aquaManifestSchema.parse(response.manifest);
  return {
    content: {
      theme: content.theme,
      insight: content.insight,
      action: content.action,
      reflectionQuestion: content.reflectionQuestion,
      notice: SATORI_NOTICE,
    },
    manifest: {
      generator: 'AQUA_AI',
      modelVersion: manifest.model,
      promptVersion: manifest.promptVersion,
      knowledgeVersion: `${manifest.skillName}@${manifest.skillVersion}`,
      schemaVersion: manifest.outputSchemaVersion,
      contentPolicyVersion: manifest.contentPolicyVersion,
      generatedAt: new Date().toISOString(),
      providerRequestId: response.requestId,
      workflowId,
      workflowVersion: manifest.workflowVersion,
      skillVersion: manifest.skillVersion,
    },
  };
}

function seasonFor(lunarMonth: number): '春' | '夏' | '秋' | '冬' {
  if (lunarMonth <= 3) return '春';
  if (lunarMonth <= 6) return '夏';
  if (lunarMonth <= 9) return '秋';
  return '冬';
}

function nonRetryable(code: string, message: string): Error {
  return Object.assign(new Error(message), { code, retryable: false });
}
