import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  GatewayTimeoutException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AquaAIError, AquaAIHttpError, AquaAITimeoutError, type AquaAIClient } from '@aqua-ai/sdk';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { CardReadingInput, CardReadingMode, CardReadingResult } from './card-reading-workflow.types.js';

const WORKFLOW_TIMEOUT_MS = 300_000;

const contextValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(contextValueSchema),
    z.record(z.string(), contextValueSchema),
  ]),
);

const inputBaseSchema = z.object({
  audience: z.enum(['B', 'C']),
  question: z.string().trim().min(1).max(2_000),
  context: z.record(z.string(), contextValueSchema).optional(),
});

const cardReadingInputSchema = inputBaseSchema
  .extend({
    cards: z.array(z.number().int().min(1).max(60)).min(1).max(5).optional(),
    random_count: z.number().int().min(1).max(5).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if ((input.cards === undefined) === (input.random_count === undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['cards'],
        message: 'Exactly one of cards or random_count is required',
      });
    }
    if (input.cards && new Set(input.cards).size !== input.cards.length) {
      context.addIssue({ code: 'custom', path: ['cards'], message: 'Card numbers must not repeat' });
    }
  });

const cardReadingResultSchema = z.object({ mode: z.enum(['single', 'dual', 'multi']) }).loose();

interface AquaWorkflowClient {
  workflows: Pick<AquaAIClient['workflows'], 'run'>;
}

interface SafeWorkflowFailure {
  kind: string;
  status?: number;
  code?: string;
  requestId?: string;
  executionId?: string;
  retryable: boolean;
}

@Injectable()
export class CardReadingWorkflowService {
  constructor(
    private readonly aqua: AquaWorkflowClient,
    private readonly options: { workflowId: string },
  ) {}

  async run(rawInput: unknown, traceId: string = randomUUID()): Promise<CardReadingResult> {
    const input = parseCardReadingInput(rawInput);
    try {
      const response = await this.aqua.workflows.run<CardReadingInput, CardReadingResult>(
        this.options.workflowId,
        {
          idempotencyKey: `card-reading:${traceId}`,
          runReference: `card-reading:${traceId}`,
          input,
        },
        { timeoutMs: WORKFLOW_TIMEOUT_MS },
      );
      const result = cardReadingResultSchema.parse(response.result) as CardReadingResult;
      assertExpectedMode(input, result.mode);
      return result;
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof InvalidCardReadingResponseError) {
        console.error('aqua_card_reading_failed', {
          kind: 'protocol',
          code: 'AQUA_CARD_READING_RESPONSE_INVALID',
          retryable: false,
        } satisfies SafeWorkflowFailure);
        throw new BadGatewayException({
          code: 'AQUA_CARD_READING_RESPONSE_INVALID',
          message: 'Aqua card reading response is invalid',
        });
      }
      throw mapAquaError(error);
    }
  }
}

export function parseCardReadingInput(rawInput: unknown): CardReadingInput {
  const parsed = cardReadingInputSchema.safeParse(rawInput);
  if (parsed.success) return parsed.data as CardReadingInput;
  throw new BadRequestException({
    code: 'CARD_READING_INPUT_INVALID',
    message: 'Card reading input is invalid',
    details: {
      violations: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    },
  });
}

function assertExpectedMode(input: CardReadingInput, actual: CardReadingMode): void {
  const count = 'cards' in input && input.cards ? input.cards.length : input.random_count;
  const expected: CardReadingMode = count === 1 ? 'single' : count === 2 ? 'dual' : 'multi';
  if (actual !== expected) {
    throw new InvalidCardReadingResponseError();
  }
}

class InvalidCardReadingResponseError extends Error {}

function mapAquaError(error: unknown): Error {
  if (error instanceof AquaAIHttpError) {
    logAquaFailure(error);
    const body = errorBody(error);
    if (error.status === 401) return new UnauthorizedException(body);
    if (error.status === 403) return new ForbiddenException(body);
    if (error.status === 429) return new HttpException(body, 429);
    return new ServiceUnavailableException(body);
  }
  if (error instanceof AquaAITimeoutError) {
    logAquaFailure(error);
    return new GatewayTimeoutException(errorBody(error));
  }
  if (error instanceof AquaAIError) {
    logAquaFailure(error);
    return new ServiceUnavailableException(errorBody(error));
  }
  console.error('aqua_card_reading_failed', {
    kind: 'unknown',
    code: 'AQUA_CARD_READING_SERVICE_ERROR',
    retryable: false,
  } satisfies SafeWorkflowFailure);
  return new ServiceUnavailableException({
    code: 'AQUA_CARD_READING_SERVICE_ERROR',
    message: 'Aqua card reading service is unavailable',
  });
}

function logAquaFailure(error: AquaAIError): void {
  const executionId = readExecutionId(error.details);
  console.error('aqua_card_reading_failed', {
    kind: error.kind,
    ...(error instanceof AquaAIHttpError ? { status: error.status } : {}),
    ...(error.code ? { code: error.code } : {}),
    ...(error.requestId ? { requestId: error.requestId } : {}),
    ...(executionId ? { executionId } : {}),
    retryable: error.retryable,
  } satisfies SafeWorkflowFailure);
}

function errorBody(error: AquaAIError) {
  return {
    code: error.code ?? `AQUA_CARD_READING_${error.kind.toUpperCase()}`,
    message:
      error instanceof AquaAITimeoutError
        ? 'Aqua card reading request timed out'
        : 'Aqua card reading service request failed',
    details: {
      ...(error.requestId ? { providerRequestId: error.requestId } : {}),
      retryable: error.retryable,
    },
  };
}

function readExecutionId(details: unknown): string | undefined {
  if (typeof details !== 'object' || details === null || !('executionId' in details)) return undefined;
  const executionId = (details as { executionId?: unknown }).executionId;
  return typeof executionId === 'string' ? executionId : undefined;
}

export { WORKFLOW_TIMEOUT_MS as CARD_READING_WORKFLOW_TIMEOUT_MS };
