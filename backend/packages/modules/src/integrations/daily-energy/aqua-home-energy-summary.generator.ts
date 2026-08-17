import { AquaAIError, type AquaAIClient, type WorkflowRunResponse } from '@aqua-ai/sdk';
import {
  HOME_ENERGY_WORKFLOW_VERSION,
  SEXAGENARY_CYCLE,
  type HomeEnergySummary,
  type HomeEnergySummaryGenerator,
  type HomeEnergySummaryInput,
} from '@satori/application';
import { z } from 'zod';

const WORKFLOW_ID = 'daily-energy-home-summary';
const IDEMPOTENCY_VALUE = /^[A-Za-z0-9:._/-]{1,128}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const jiaziSchema = z.enum(SEXAGENARY_CYCLE as [string, ...string[]]);

const aquaResultSchema = z
  .object({
    greeting: z.string().min(1).max(128),
    guidance: z.string().min(1).max(500),
    energy_level: z.enum(['高', '中', '低']),
    suitable_actions: z.array(z.string().min(1).max(128)).min(1).max(8),
    cautions: z.array(z.string().min(1).max(128)).min(1).max(8),
    date: z.string().min(1).max(32),
    day_card: jiaziSchema,
    heaven_card: jiaziSchema,
    score: z.number().finite(),
    signals: z.array(z.string().min(1).max(128)).max(16),
    rule_version: z.string().min(1).max(128),
    copy_version: z.string().min(1).max(128),
  })
  .strict();

interface AquaWorkflowClient {
  workflows: Pick<AquaAIClient['workflows'], 'run'>;
}

interface AquaInput extends Record<string, unknown> {
  name?: string;
  day_card: string;
  heaven_card: string;
  date: string;
}

type AquaOutput = z.infer<typeof aquaResultSchema>;

export class AquaHomeEnergySummaryGenerator implements HomeEnergySummaryGenerator {
  constructor(
    private readonly client: AquaWorkflowClient,
    private readonly options: { maxAttempts: number; retryBackoffMs: number },
  ) {}

  async generate(input: HomeEnergySummaryInput) {
    const request = toRequest(input);
    let attempt = 0;
    while (attempt < this.options.maxAttempts) {
      attempt += 1;
      try {
        const response = await this.client.workflows.run<AquaInput, AquaOutput>(WORKFLOW_ID, request);
        return toResult(response, input);
      } catch (error) {
        const failure = normalizeFailure(error);
        console.error('aqua_home_energy_summary_failed', {
          errorCode: failure.code,
          message: failure.message,
          requestId: failure.requestId,
          retryable: failure.retryable,
          attempt,
        });
        if (!failure.retryable || attempt >= this.options.maxAttempts) throw failure.error;
        await new Promise((resolve) => setTimeout(resolve, this.options.retryBackoffMs * attempt));
      }
    }
    throw new Error('Aqua home energy summary attempts exhausted');
  }
}

function toRequest(input: HomeEnergySummaryInput) {
  const name = input.userName?.trim();
  if (name && name.length > 64) throw inputError('name must not exceed 64 characters');
  if (!isValidDate(input.date)) {
    throw inputError('date must use YYYY-MM-DD');
  }
  if (!jiaziSchema.safeParse(input.dayCard).success || !jiaziSchema.safeParse(input.heavenCard).success) {
    throw inputError('dayCard and heavenCard must be valid sexagenary-cycle values');
  }
  const idempotencyKey = `daily-energy-${input.date}-${input.runReference}`;
  if (!IDEMPOTENCY_VALUE.test(idempotencyKey) || !IDEMPOTENCY_VALUE.test(input.runReference)) {
    throw inputError('idempotencyKey or runReference is invalid');
  }
  return {
    workflowVersion: HOME_ENERGY_WORKFLOW_VERSION,
    idempotencyKey,
    runReference: input.runReference,
    input: {
      ...(name ? { name } : {}),
      day_card: input.dayCard,
      heaven_card: input.heavenCard,
      date: input.date,
    },
  };
}

function toResult(
  response: WorkflowRunResponse<AquaOutput>,
  expected: HomeEnergySummaryInput,
): { summary: HomeEnergySummary; providerRequestId: string } {
  const result = aquaResultSchema.parse(response.result);
  if (result.day_card !== expected.dayCard || result.heaven_card !== expected.heavenCard) {
    throw Object.assign(new Error('Aqua home energy summary cards do not match the request'), {
      code: 'AQUA_HOME_ENERGY_RESPONSE_INVALID',
      retryable: false,
      providerRequestId: response.requestId,
    });
  }
  return {
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
    providerRequestId: response.requestId,
  };
}

function normalizeFailure(error: unknown) {
  if (error instanceof AquaAIError) {
    return {
      code: error.code ?? `AQUA_${error.kind.toUpperCase()}`,
      message: error.message,
      requestId: error.requestId,
      retryable: error.retryable,
      error: Object.assign(new Error('Aqua home energy summary generation failed', { cause: error }), {
        code: error.code ?? `AQUA_${error.kind.toUpperCase()}`,
        retryable: error.retryable,
        providerRequestId: error.requestId,
      }),
    };
  }
  if (error instanceof z.ZodError) {
    const mapped = Object.assign(
      new Error('Aqua home energy summary response is invalid', { cause: error }),
      {
        code: 'AQUA_HOME_ENERGY_RESPONSE_INVALID',
        retryable: false,
      },
    );
    return {
      code: mapped.code,
      message: mapped.message,
      requestId: undefined,
      retryable: false,
      error: mapped,
    };
  }
  const candidate = error as { code?: unknown; retryable?: unknown; providerRequestId?: unknown };
  return {
    code: typeof candidate?.code === 'string' ? candidate.code : 'AQUA_HOME_ENERGY_UNKNOWN',
    message: error instanceof Error ? error.message : String(error),
    requestId: typeof candidate?.providerRequestId === 'string' ? candidate.providerRequestId : undefined,
    retryable: candidate?.retryable === true,
    error: error instanceof Error ? error : new Error(String(error)),
  };
}

function inputError(message: string) {
  return Object.assign(new Error(message), { code: 'AQUA_HOME_ENERGY_INPUT_INVALID', retryable: false });
}

function isValidDate(value: string) {
  if (!DATE.test(value)) return false;
  const parts = value.split('-').map(Number);
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  if (year === undefined || month === undefined || day === undefined) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}
