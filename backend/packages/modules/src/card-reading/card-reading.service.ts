import { ConflictException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { cardReadings, newId, RuntimeInfrastructure } from '@satori/infrastructure';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import { randomInt } from 'node:crypto';
import { CardReadingWorkflowService } from '../integrations/card-reading/card-reading-workflow.service.js';
import type { CardReadingResult } from '../integrations/card-reading/card-reading-workflow.types.js';

const STEMS = [
  ['甲', 'jia'],
  ['乙', 'yi'],
  ['丙', 'bing'],
  ['丁', 'ding'],
  ['戊', 'wu'],
  ['己', 'ji'],
  ['庚', 'geng'],
  ['辛', 'xin'],
  ['壬', 'ren'],
  ['癸', 'gui'],
] as const;
const BRANCHES = [
  ['子', 'zi'],
  ['丑', 'chou'],
  ['寅', 'yin'],
  ['卯', 'mao'],
  ['辰', 'chen'],
  ['巳', 'si'],
  ['午', 'wu'],
  ['未', 'wei'],
  ['申', 'shen'],
  ['酉', 'you'],
  ['戌', 'xu'],
  ['亥', 'hai'],
] as const;

export const CARD_DECK = Array.from({ length: 60 }, (_, index) => {
  const stem = STEMS[index % STEMS.length]!;
  const branch = BRANCHES[index % BRANCHES.length]!;
  return {
    code: `${String(index + 1).padStart(2, '0')}-${stem[1]}${branch[1]}`,
    displayName: `${stem[0]}${branch[0]}`,
  };
});

export function drawUniqueCardCodes(cardCount: number, nextInt: (max: number) => number = randomInt) {
  const deck = CARD_DECK.map((card) => card.code);
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = nextInt(index + 1);
    [deck[index], deck[swapIndex]] = [deck[swapIndex]!, deck[index]!];
  }
  return deck.slice(0, cardCount);
}

type ReadingRow = typeof cardReadings.$inferSelect;

@Injectable()
export class CardReadingService {
  constructor(
    private readonly infrastructure: RuntimeInfrastructure,
    private readonly workflow: CardReadingWorkflowService,
  ) {}

  async createDraw(command: {
    ownerUserId: string;
    question: string;
    category: string;
    cardCount: number;
    positionLabels: string[];
  }) {
    const now = new Date();
    const [created] = await this.infrastructure.database
      .insert(cardReadings)
      .values({
        id: newId(),
        ownerUserId: command.ownerUserId,
        question: command.question,
        category: command.category,
        cardCount: command.cardCount,
        positionLabels: command.positionLabels,
        cardCodes: drawUniqueCardCodes(command.cardCount),
        status: 'DRAWN',
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return this.dto(created!);
  }

  async list(ownerUserId: string, limit: number, cursor?: string) {
    const parsed = cursor ? decodeCursor(cursor) : null;
    const where = parsed
      ? and(
          eq(cardReadings.ownerUserId, ownerUserId),
          or(
            lt(cardReadings.createdAt, parsed.createdAt),
            and(eq(cardReadings.createdAt, parsed.createdAt), lt(cardReadings.id, parsed.id)),
          ),
        )
      : eq(cardReadings.ownerUserId, ownerUserId);
    const rows = await this.infrastructure.database
      .select()
      .from(cardReadings)
      .where(where)
      .orderBy(desc(cardReadings.createdAt), desc(cardReadings.id))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items: items.map((row) => this.dto(row)),
      nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  async get(ownerUserId: string, readingId: string) {
    return this.dto(await this.requireOwned(ownerUserId, readingId));
  }

  async complete(ownerUserId: string, readingId: string) {
    const reading = await this.requireOwned(ownerUserId, readingId);
    if (reading.status === 'READY') return this.dto(reading);
    if (!['DRAWN', 'GENERATING'].includes(reading.status)) {
      throw new ConflictException({
        code: 'CARD_READING_NOT_COMPLETABLE',
        message: 'Card reading cannot be completed',
      });
    }
    if (reading.status === 'GENERATING') return this.dto(reading);
    return this.startGeneration(reading);
  }

  async retry(ownerUserId: string, readingId: string) {
    const reading = await this.requireOwned(ownerUserId, readingId);
    if (reading.status !== 'FAILED') {
      throw new ConflictException({
        code: 'CARD_READING_NOT_RETRYABLE',
        message: 'Card reading is not retryable',
      });
    }
    return this.startGeneration(reading);
  }

  private async startGeneration(reading: ReadingRow) {
    const startedAt = new Date();
    const [started] = await this.infrastructure.database
      .update(cardReadings)
      .set({
        status: 'GENERATING',
        failure: null,
        generationStartedAt: startedAt,
        completedAt: null,
        updatedAt: startedAt,
      })
      .where(and(eq(cardReadings.id, reading.id), eq(cardReadings.ownerUserId, reading.ownerUserId)))
      .returning();
    void this.generate(started!, startedAt.getTime().toString(36)).catch((error: unknown) => {
      const failure = readingFailure(error);
      console.error('card_reading_background_generation_failed', {
        readingId: reading.id,
        code: failure.code,
        retryable: failure.retryable,
        ...('providerRequestId' in failure ? { providerRequestId: failure.providerRequestId } : {}),
      });
    });
    return this.dto(started!);
  }

  private async generate(reading: ReadingRow, attemptId: string) {
    try {
      const execution = await this.workflow.execute(
        {
          audience: 'C',
          question: reading.question,
          cards: cardNumbersFromCodes(reading.cardCodes as string[]),
          context: {
            category: reading.category,
            position_labels: reading.positionLabels as string[],
          },
        },
        reading.id,
        attemptId,
      );
      const completedAt = new Date();
      const [updated] = await this.infrastructure.database
        .update(cardReadings)
        .set({
          status: 'READY',
          content: execution.result,
          generationManifest: execution.manifest,
          providerRequestId: execution.requestId,
          failure: null,
          completedAt,
          updatedAt: completedAt,
        })
        .where(and(eq(cardReadings.id, reading.id), eq(cardReadings.ownerUserId, reading.ownerUserId)))
        .returning();
      return this.dto(updated!);
    } catch (error) {
      const failedAt = new Date();
      await this.infrastructure.database
        .update(cardReadings)
        .set({ status: 'FAILED', failure: readingFailure(error), updatedAt: failedAt })
        .where(and(eq(cardReadings.id, reading.id), eq(cardReadings.ownerUserId, reading.ownerUserId)));
      throw error;
    }
  }

  private async requireOwned(ownerUserId: string, readingId: string) {
    const [row] = await this.infrastructure.database
      .select()
      .from(cardReadings)
      .where(and(eq(cardReadings.id, readingId), eq(cardReadings.ownerUserId, ownerUserId)))
      .limit(1);
    if (!row)
      throw new NotFoundException({ code: 'CARD_READING_NOT_FOUND', message: 'Card reading was not found' });
    return row;
  }

  private dto(row: ReadingRow) {
    const codes = row.cardCodes as string[];
    const labels = row.positionLabels as string[];
    return {
      readingId: row.id,
      question: row.question,
      category: row.category,
      cardCount: row.cardCount,
      status: row.status,
      report: isCardReadingResult(row.content) ? row.content : null,
      cards: codes.map((code, index) => {
        const card = CARD_DECK.find((candidate) => candidate.code === code)!;
        return {
          position: index + 1,
          positionLabel: labels[index] ?? `第 ${index + 1} 张`,
          cardCode: code,
          displayName: card.displayName,
        };
      }),
      failure: row.failure,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    };
  }
}

export function cardNumbersFromCodes(codes: readonly string[]): number[] {
  return codes.map((code) => {
    const number = Number(/^([0-9]{2})-/.exec(code)?.[1]);
    if (!Number.isInteger(number) || number < 1 || number > 60) {
      throw new ConflictException({
        code: 'CARD_READING_CARD_INVALID',
        message: 'Frozen card code is invalid',
      });
    }
    return number;
  });
}

function isCardReadingResult(value: unknown): value is CardReadingResult {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Partial<CardReadingResult>;
  return (
    typeof result.title === 'string' &&
    typeof result.report === 'string' &&
    typeof result.mode === 'string' &&
    Array.isArray(result.cards)
  );
}

function readingFailure(error: unknown) {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    const body = typeof response === 'object' && response !== null ? response : {};
    const details =
      'details' in body && typeof body.details === 'object' && body.details !== null ? body.details : {};
    return {
      code: 'code' in body ? String(body.code) : 'CARD_READING_GENERATION_FAILED',
      message: 'Card reading generation failed',
      retryable: 'retryable' in details ? Boolean(details.retryable) : false,
      ...('providerRequestId' in details ? { providerRequestId: String(details.providerRequestId) } : {}),
    };
  }
  return {
    code: 'CARD_READING_GENERATION_FAILED',
    message: 'Card reading generation failed',
    retryable: false,
  };
}

function encodeCursor(createdAt: Date, id: string) {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string) {
  const [date, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const createdAt = new Date(date ?? '');
  if (!id || Number.isNaN(createdAt.getTime())) {
    throw new ConflictException({ code: 'INVALID_CURSOR', message: 'Reading cursor is invalid' });
  }
  return { createdAt, id };
}
