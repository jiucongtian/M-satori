import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { IdempotencyService } from '@satori/application';
import {
  dailyInsights,
  feedback,
  FieldCipher,
  newId,
  PostgresIdempotencyStore,
  RuntimeInfrastructure,
} from '@satori/infrastructure';
import { and, eq } from 'drizzle-orm';

type Rating = 'HELPFUL' | 'NOT_RESONANT' | 'UNCOMFORTABLE';

@Injectable()
export class FeedbackService {
  private readonly idempotency: IdempotencyService;

  constructor(
    private readonly infrastructure: RuntimeInfrastructure,
    private readonly cipher: FieldCipher,
  ) {
    this.idempotency = new IdempotencyService(
      new PostgresIdempotencyStore(infrastructure.database, cipher),
      infrastructure.policy.idempotency.ttlSeconds * 1000,
    );
  }

  async create(input: {
    userId: string;
    target: { type: 'LIFE_REPORT' | 'DAILY_INSIGHT'; id: string; sectionCode?: string | null };
    rating: Rating;
    reasons: string[];
    comment?: string | null;
    idempotencyKey: string;
  }) {
    const comment = normalizeComment(input.comment);
    const result = await this.idempotency.execute(
      { actorKey: `user:${input.userId}`, operation: 'createFeedback', key: input.idempotencyKey },
      { target: input.target, rating: input.rating, reasons: input.reasons, comment },
      async () => {
        if (input.target.type === 'DAILY_INSIGHT') {
          const [owned] = await this.infrastructure.database
            .select({ id: dailyInsights.id })
            .from(dailyInsights)
            .where(and(eq(dailyInsights.id, input.target.id), eq(dailyInsights.ownerUserId, input.userId)))
            .limit(1);
          if (!owned) this.targetNotFound();
        } else {
          // LIFE_REPORT is contract-defined but not generated in R1.0 yet; never accept an unverifiable target.
          this.targetNotFound();
        }
        const id = newId();
        const createdAt = new Date();
        await this.infrastructure.database.insert(feedback).values({
          id,
          userId: input.userId,
          targetType: input.target.type,
          targetId: input.target.id,
          rating: { HELPFUL: 5, NOT_RESONANT: 2, UNCOMFORTABLE: 1 }[input.rating],
          reason: input.reasons[0] ?? null,
          commentCiphertext: this.cipher.encrypt(
            JSON.stringify({
              reasons: input.reasons,
              comment,
              sectionCode: input.target.sectionCode ?? null,
            }),
          ),
          createdAt,
        });
        return {
          status: 201,
          body: {
            feedbackId: id,
            target: input.target,
            rating: input.rating,
            createdAt: createdAt.toISOString(),
          },
        };
      },
    );
    return result.body;
  }

  private targetNotFound(): never {
    throw new NotFoundException({ code: 'FEEDBACK_TARGET_NOT_FOUND', message: 'Feedback target not found' });
  }
}

function normalizeComment(value?: string | null): string | null {
  if (value == null) return null;
  const normalized = value.trim();
  if (/\p{Cc}/u.test(normalized)) {
    throw new BadRequestException({
      code: 'FEEDBACK_COMMENT_UNSAFE',
      message: 'Feedback comment contains unsafe control characters',
    });
  }
  return normalized || null;
}
