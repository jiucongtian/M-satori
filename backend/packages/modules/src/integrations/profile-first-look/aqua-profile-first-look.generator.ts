import { AquaAIError, type AquaAIClient, type WorkflowRunResponse } from '@aqua-ai/sdk';
import {
  SEXAGENARY_CYCLE,
  type ProfileFirstLookContent,
  type ProfileFirstLookGenerationInput,
  type ProfileFirstLookGenerationResult,
  type ProfileFirstLookGenerator,
} from '@satori/application';
import { z } from 'zod';

export const PROFILE_FIRST_LOOK_WORKFLOW_ID = 'profile-four-card-first-look';
export const PROFILE_FIRST_LOOK_WORKFLOW_VERSION = 'profile-four-card-first-look/1.0.7';
export const PROFILE_FIRST_LOOK_SKILL_VERSION = '1.0.0-aqua.3';
export const PROFILE_FIRST_LOOK_SCHEMA_VERSION = '1.0.0';
export const PROFILE_FIRST_LOOK_NOTICE = '这是一份基础认识，不是对你人生的定论。';

const jiaziSchema = z.enum(SEXAGENARY_CYCLE as [string, ...string[]]);
const statusSchema = z.enum(['complete', 'partial']);
const evidenceSchema = z.record(z.string(), z.string().min(1).max(2_000));
const aquaCardSchema = z
  .object({
    position: z.enum(['hour', 'day', 'month', 'year']),
    dimension: z.enum(['思想', '行为', '事业', '梦想目标']),
    card: jiaziSchema,
    title: z.string().min(1).max(128),
    summary: z.string().min(1).max(4_000),
    inner_trait: z.string().min(1).max(256),
    outer_trait: z.string().min(1).max(256),
    status: statusSchema,
    evidence: evidenceSchema,
    missing_fields: z.array(z.string().min(1).max(128)).max(32),
  })
  .strict();

const aquaResultSchema = z
  .object({
    schema_version: z.literal(PROFILE_FIRST_LOOK_SCHEMA_VERSION),
    status: statusSchema,
    profile_summary: z
      .object({
        title: z.string().min(1).max(256),
        description: z.string().min(1).max(4_000),
        keywords: z.array(z.string().min(1).max(64)).min(1).max(12),
        outer_trait: z.string().min(1).max(256),
        inner_trait: z.string().min(1).max(256),
      })
      .strict(),
    cards: z.array(aquaCardSchema).length(4),
    knowledge_release: z.string().min(1).max(256),
    notice: z.literal(PROFILE_FIRST_LOOK_NOTICE),
  })
  .strict();

const aquaManifestSchema = z
  .object({
    workflowVersion: z.literal(PROFILE_FIRST_LOOK_WORKFLOW_VERSION),
    skillVersion: z.literal(PROFILE_FIRST_LOOK_SKILL_VERSION),
    model: z.string().min(1),
    promptVersion: z.string().min(1),
    outputSchemaVersion: z.string().min(1),
    contentPolicyVersion: z.string().min(1),
  })
  .passthrough();

interface AquaWorkflowClient {
  workflows: Pick<AquaAIClient['workflows'], 'run'>;
}

interface AquaProfileFirstLookInput extends Record<string, unknown> {
  name?: string;
  pronoun: '你';
  cards: Record<'year' | 'month' | 'day' | 'hour', string>;
}

type AquaProfileFirstLookOutput = z.infer<typeof aquaResultSchema>;

interface AdapterFailure extends Error {
  code: string;
  retryable: boolean;
  providerRequestId?: string;
  upstreamStatus?: number;
  retryAfter?: string;
  elapsedMs: number;
}

export class AquaProfileFirstLookGenerator implements ProfileFirstLookGenerator {
  constructor(
    private readonly client: AquaWorkflowClient,
    private readonly timeoutMs: number,
  ) {}

  async generate(input: ProfileFirstLookGenerationInput): Promise<ProfileFirstLookGenerationResult> {
    const request = toRequest(input);
    const startedAt = Date.now();
    try {
      const response = await this.client.workflows.run<AquaProfileFirstLookInput, AquaProfileFirstLookOutput>(
        PROFILE_FIRST_LOOK_WORKFLOW_ID,
        request,
        { timeoutMs: this.timeoutMs },
      );
      return toResult(response, input, Date.now() - startedAt);
    } catch (error) {
      const failure = normalizeFailure(error, Date.now() - startedAt);
      console.error('aqua_profile_first_look_failed', {
        errorCode: failure.code,
        requestId: failure.providerRequestId,
        retryable: failure.retryable,
        upstreamStatus: failure.upstreamStatus,
        retryAfter: failure.retryAfter,
        elapsedMs: failure.elapsedMs,
      });
      throw failure;
    }
  }
}

function toRequest(input: ProfileFirstLookGenerationInput) {
  const name = input.name?.trim();
  if (name && name.length > 64) throw inputError('name must not exceed 64 characters');
  if (!/^[A-Za-z0-9:._/-]{1,128}$/.test(input.idempotencyKey)) {
    throw inputError('idempotencyKey is invalid');
  }
  if (!/^[A-Za-z0-9:._/-]{1,128}$/.test(input.runReference)) {
    throw inputError('runReference is invalid');
  }
  for (const card of Object.values(input.cards)) {
    if (!jiaziSchema.safeParse(card).success) throw inputError('cards must contain four valid ganzhi values');
  }
  return {
    workflowVersion: PROFILE_FIRST_LOOK_WORKFLOW_VERSION,
    idempotencyKey: input.idempotencyKey,
    runReference: input.runReference,
    input: {
      ...(name ? { name } : {}),
      pronoun: input.pronoun,
      cards: input.cards,
    },
  };
}

function toResult(
  response: WorkflowRunResponse<AquaProfileFirstLookOutput>,
  expected: ProfileFirstLookGenerationInput,
  durationMs: number,
): ProfileFirstLookGenerationResult {
  const result = aquaResultSchema.parse(response.result);
  const manifest = aquaManifestSchema.parse(response.manifest);
  const expectedOrder = ['hour', 'day', 'month', 'year'] as const;
  const expectedDimensions = ['思想', '行为', '事业', '梦想目标'] as const;
  expectedOrder.forEach((position, index) => {
    const card = result.cards[index];
    if (
      !card ||
      card.position !== position ||
      card.dimension !== expectedDimensions[index] ||
      card.card !== expected.cards[position]
    ) {
      throw responseError('Aqua PROFILE-11 cards do not match the requested facts or required order', response.requestId);
    }
  });
  const content: ProfileFirstLookContent = {
    schemaVersion: result.schema_version,
    status: result.status,
    profileSummary: {
      title: result.profile_summary.title,
      description: result.profile_summary.description,
      keywords: result.profile_summary.keywords,
      outerTrait: result.profile_summary.outer_trait,
      innerTrait: result.profile_summary.inner_trait,
    },
    cards: result.cards.map((card) => ({
      position: card.position,
      dimension: card.dimension,
      card: card.card,
      title: card.title,
      summary: card.summary,
      innerTrait: card.inner_trait,
      outerTrait: card.outer_trait,
      status: card.status,
      evidence: card.evidence,
      missingFields: card.missing_fields,
    })),
    knowledgeRelease: result.knowledge_release,
    notice: result.notice,
  };
  return {
    content,
    manifest: {
      workflowVersion: manifest.workflowVersion,
      skillVersion: manifest.skillVersion,
      model: manifest.model,
      promptVersion: manifest.promptVersion,
      outputSchemaVersion: manifest.outputSchemaVersion,
      contentPolicyVersion: manifest.contentPolicyVersion,
    },
    providerRequestId: response.requestId,
    // SDK 0.1.1 does not expose an execution ID in WorkflowRunResponse.
    providerExecutionId: null,
    durationMs,
  };
}

function normalizeFailure(error: unknown, elapsedMs: number): AdapterFailure {
  if (error instanceof z.ZodError) {
    return Object.assign(new Error('Aqua PROFILE-11 response is invalid', { cause: error }), {
      code: 'AQUA_PROFILE_FIRST_LOOK_RESPONSE_INVALID',
      retryable: false,
      elapsedMs,
    });
  }
  if (error instanceof AquaAIError) {
    const candidate = error as AquaAIError & { status?: number };
    const retryAfter = retryAfterFrom(error.details);
    return Object.assign(new Error('Aqua PROFILE-11 generation failed', { cause: error }), {
      code: error.code ?? `AQUA_${error.kind.toUpperCase()}`,
      retryable: error.retryable,
      ...(error.requestId ? { providerRequestId: error.requestId } : {}),
      ...(candidate.status === undefined ? {} : { upstreamStatus: candidate.status }),
      ...(retryAfter ? { retryAfter } : {}),
      elapsedMs,
    });
  }
  const candidate = error as {
    code?: unknown;
    retryable?: unknown;
    providerRequestId?: unknown;
    upstreamStatus?: unknown;
  };
  return Object.assign(error instanceof Error ? error : new Error(String(error)), {
    code: typeof candidate?.code === 'string' ? candidate.code : 'AQUA_PROFILE_FIRST_LOOK_UNKNOWN',
    retryable: candidate?.retryable === true,
    ...(typeof candidate?.providerRequestId === 'string'
      ? { providerRequestId: candidate.providerRequestId }
      : {}),
    ...(typeof candidate?.upstreamStatus === 'number'
      ? { upstreamStatus: candidate.upstreamStatus }
      : {}),
    elapsedMs,
  });
}

function retryAfterFrom(details: unknown): string | undefined {
  if (!details || typeof details !== 'object') return undefined;
  const value = (details as Record<string, unknown>).retryAfter;
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

function inputError(message: string) {
  return Object.assign(new Error(message), {
    code: 'AQUA_PROFILE_FIRST_LOOK_INPUT_INVALID',
    retryable: false,
  });
}

function responseError(message: string, providerRequestId: string) {
  return Object.assign(new Error(message), {
    code: 'AQUA_PROFILE_FIRST_LOOK_RESPONSE_INVALID',
    retryable: false,
    providerRequestId,
  });
}
