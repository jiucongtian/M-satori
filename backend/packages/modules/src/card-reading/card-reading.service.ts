import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { CONSUMPTION_PORT, hashPayload, type ConsumptionPort } from '@satori/application';
import { cardReadings, generationTasks, RuntimeInfrastructure } from '@satori/infrastructure';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { createHash, randomInt } from 'node:crypto';
import { buildReadingRequirement } from './application/index.js';
import { GenerationTaskRunner } from '../generation-task/generation-task.runner.js';
import { GenerationTaskService } from '../generation-task/generation-task.service.js';
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
export class CardReadingService implements OnModuleInit {
  constructor(
    private readonly infrastructure: RuntimeInfrastructure,
    private readonly workflow: CardReadingWorkflowService,
    @Inject(CONSUMPTION_PORT) private readonly consumption: ConsumptionPort,
    private readonly tasks: GenerationTaskService,
    private readonly runner: GenerationTaskRunner,
  ) {}

  onModuleInit() {
    this.runner.register(
      'CARD_READING',
      (task) => this.generate(task.id, task.targetId),
      (taskId, targetId) => this.finalFailure(taskId, targetId),
    );
  }

  async createDraw(
    command: {
      ownerUserId: string;
      question: string;
      category: string;
      cardCount: number;
      positionLabels: string[];
    },
    idempotencyKey: string,
  ) {
    const digest = createHash('sha256')
      .update(`${command.ownerUserId}:reading:${idempotencyKey}`)
      .digest('hex');
    const readingId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
    const requestHash = hashPayload(command);
    return this.infrastructure.database.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '2s'`);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${readingId}, 11))`);
      const [existing] = await tx.select().from(cardReadings).where(eq(cardReadings.id, readingId)).limit(1);
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new ConflictException({
            code: 'IDEMPOTENCY_KEY_REUSED',
            message: 'Reading inputs changed for this request',
          });
        return this.dto(existing);
      }
      const policy = this.infrastructure.policy.cardReading.seedCost;
      const requirement = buildReadingRequirement({
        ownerUserId: command.ownerUserId,
        readingIntentId: readingId,
        cardCount: command.cardCount,
        seedCostPolicy: policy,
      });
      const reserved = await this.consumption.reserve(requirement, `${readingId}:1:RESERVE`);
      const now = new Date();
      const [created] = await tx
        .insert(cardReadings)
        .values({
          id: readingId,
          requestHash,
          consumptionIntentId: reserved.intentId,
          consumptionAttempt: 1,
          seedQuantity: requirement.attributes!.seedQuantity as number,
          seedCostRuleVersion: policy.version,
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
    });
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
    if (!['DRAWN', 'GENERATING', 'SETTLING'].includes(reading.status)) {
      throw new ConflictException({
        code: 'CARD_READING_NOT_COMPLETABLE',
        message: 'Card reading cannot be completed',
      });
    }
    if (reading.status === 'GENERATING' || reading.status === 'SETTLING') return this.dto(reading);
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

  async recoverLegacy(ownerUserId: string, readingId: string) {
    const reading = await this.requireOwned(ownerUserId, readingId);
    return this.startGeneration(reading, true);
  }

  private async startGeneration(reading: ReadingRow, recover = false) {
    return this.infrastructure.database.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '2s'`);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${reading.id}, 11))`);
      const [locked] = await tx
        .select()
        .from(cardReadings)
        .where(eq(cardReadings.id, reading.id))
        .for('update')
        .limit(1);
      if (!locked) throw new NotFoundException({ code: 'CARD_READING_NOT_FOUND' });
      if (locked.status === 'READY') return this.dto(locked);
      if (['GENERATING', 'SETTLING'].includes(locked.status)) {
        const [existingTask] = await tx
          .select()
          .from(generationTasks)
          .where(
            and(
              eq(generationTasks.targetType, 'CARD_READING'),
              eq(generationTasks.targetId, locked.consumptionIntentId ?? locked.id),
            ),
          )
          .limit(1);
        if (!recover || existingTask) return this.dto(locked);
      }
      reading = locked;
      if (reading.status === 'FAILED' || !reading.consumptionIntentId) {
        const attempt =
          reading.status === 'FAILED' ? reading.consumptionAttempt + 1 : reading.consumptionAttempt;
        const policy = this.infrastructure.policy.cardReading.seedCost;
        const cost = reading.seedQuantity;
        const reserved = await this.consumption.reserve(
          buildReadingRequirement(
            {
              ownerUserId: reading.ownerUserId,
              readingIntentId: reading.id,
              cardCount: reading.cardCount,
              seedCostPolicy: cost
                ? {
                    version: reading.seedCostRuleVersion ?? policy.version,
                    costByCardCount: { 1: cost, 2: cost, 3: cost, 4: cost, 5: cost },
                  }
                : policy,
            },
            attempt,
          ),
          `${reading.id}:${attempt}:RESERVE`,
        );
        reading = { ...reading, consumptionIntentId: reserved.intentId, consumptionAttempt: attempt };
      }
      const startedAt = new Date();
      await this.consumption.start(reading.consumptionIntentId!, `${reading.consumptionIntentId}:START`);
      await this.tasks.createInTransaction(tx, {
        ownerUserId: reading.ownerUserId,
        targetType: 'CARD_READING',
        targetId: reading.consumptionIntentId!,
      });
      const [started] = await tx
        .update(cardReadings)
        .set({
          status: 'GENERATING',
          consumptionIntentId: reading.consumptionIntentId,
          consumptionAttempt: reading.consumptionAttempt,
          failure: null,
          generationStartedAt: startedAt,
          completedAt: null,
          updatedAt: startedAt,
        })
        .where(and(eq(cardReadings.id, reading.id), eq(cardReadings.ownerUserId, reading.ownerUserId)))
        .returning();
      return this.dto(started!);
    });
  }

  async generate(taskId: string, targetId: string) {
    const [reading] = await this.infrastructure.database
      .select()
      .from(cardReadings)
      .where(eq(cardReadings.consumptionIntentId, targetId))
      .limit(1);
    if (!reading || reading.consumptionIntentId !== targetId || reading.status === 'READY') return;
    if (!['GENERATING', 'SETTLING'].includes(reading.status)) return;
    const [claimed] = await this.infrastructure.database
      .select()
      .from(generationTasks)
      .where(eq(generationTasks.id, taskId))
      .limit(1);
    if (!claimed || claimed.status !== 'RUNNING') return;
    // One upstream idempotency key per consumption attempt, including worker retries.
    if (!isCardReadingResult(reading.content)) {
      const execution = await this.workflow
        .execute(
          {
            audience: 'C',
            question: reading.question,
            cards: cardNumbersFromCodes(reading.cardCodes as string[]),
            context: {
              category: reading.category,
              position_labels: reading.positionLabels as string[],
              presentation_requirements: {
                report_title:
                  '使用疗愈、具体且面向用户的中文标题，不罗列卡牌编号，不使用技术词或用户问题原句',
                section_count: '根据内容拆分为 5 至 9 个有逻辑关系的章节',
                section_titles:
                  '每个标题必须高度概括对应章节，并共同形成从看见自己、理解感受、读懂牌面到落地行动和温柔收束的完整故事；禁止使用“继续看见”“第X节”等占位标题',
              },
            },
          },
          reading.id,
          String(reading.consumptionAttempt),
        )
        .catch((error: unknown) => {
          throw Object.assign(new Error('Card reading generation failed'), readingFailure(error));
        });
      await this.infrastructure.database.transaction(async (tx) => {
        const [task] = await tx
          .select()
          .from(generationTasks)
          .where(eq(generationTasks.id, taskId))
          .for('update')
          .limit(1);
        if (!task || task.status !== 'RUNNING' || task.currentAttempt !== claimed.currentAttempt) return;
        await tx
          .update(cardReadings)
          .set({
            status: 'SETTLING',
            content: execution.result,
            generationManifest: execution.manifest,
            providerRequestId: execution.requestId,
            failure: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(cardReadings.id, reading.id),
              eq(cardReadings.consumptionAttempt, reading.consumptionAttempt),
              eq(cardReadings.status, 'GENERATING'),
            ),
          );
      });
    }
    await this.settleReading(reading.id, reading.consumptionAttempt);
  }

  private async settleReading(readingId: string, attempt: number) {
    await this.infrastructure.database.transaction(async (tx) => {
      const [reading] = await tx
        .select()
        .from(cardReadings)
        .where(eq(cardReadings.id, readingId))
        .for('update')
        .limit(1);
      if (!reading || reading.consumptionAttempt !== attempt || reading.status !== 'SETTLING') return;
      await this.consumption.commit(reading.consumptionIntentId!, `${reading.consumptionIntentId}:COMMIT`);
      await tx
        .update(cardReadings)
        .set({ status: 'READY', failure: null, completedAt: new Date(), updatedAt: new Date() })
        .where(eq(cardReadings.id, reading.id));
    });
  }

  async finalFailure(taskId: string, targetId: string) {
    const [candidate] = await this.infrastructure.database.select().from(cardReadings).where(eq(cardReadings.consumptionIntentId, targetId)).limit(1);
    if (!candidate) return;
    await this.settleReading(candidate.id, candidate.consumptionAttempt);
    await this.infrastructure.database.transaction(async (tx) => {
      const [reading] = await tx
        .select()
        .from(cardReadings)
        .where(eq(cardReadings.consumptionIntentId, targetId))
        .for('update')
        .limit(1);
      if (!reading || reading.consumptionIntentId !== targetId || reading.status === 'READY') return;
      const [task] = await tx.select().from(generationTasks).where(eq(generationTasks.id, taskId)).limit(1);
      if (task?.status !== 'FAILED') return;
      await this.consumption.release(targetId, `${targetId}:RELEASE`);
      await tx
        .update(cardReadings)
        .set({ status: 'FAILED', failure: task.failure, updatedAt: new Date() })
        .where(eq(cardReadings.id, reading.id));
    });
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
      status: row.status === 'SETTLING' ? 'GENERATING' : row.status,
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
