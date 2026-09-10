import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  CursorCodec,
  normalizePageLimit,
  SEED_BATCH_PROJECTION_QUERY_PORT,
  type SeedBatchProjectionQueryPort,
} from '@satori/application';
import {
  newId,
  registrationRewards,
  RuntimeInfrastructure,
  complimentarySeedAccountProjections,
  complimentarySeedEntries,
  complimentarySeedGrants,
} from '@satori/infrastructure';
import { and, eq, sql } from 'drizzle-orm';

export type SeedLedgerTransaction = Parameters<
  Parameters<RuntimeInfrastructure['database']['transaction']>[0]
>[0];

@Injectable()
export class SeedLedgerService {
  private readonly cursors: CursorCodec;

  constructor(
    private readonly infrastructure: RuntimeInfrastructure,
    @Inject(SEED_BATCH_PROJECTION_QUERY_PORT)
    private readonly batchProjection: SeedBatchProjectionQueryPort,
  ) {
    this.cursors = new CursorCodec(infrastructure.environment.CURSOR_SIGNING_SECRET);
  }

  async getAccount(userId: string) {
    const account = await this.batchProjection.getAccount(userId);
    if (!account)
      throw new NotFoundException({ code: 'SEED_ACCOUNT_NOT_FOUND', message: 'Seed account not found' });
    return account;
  }

  async listTransactions(userId: string, input: { cursor?: string; limit?: number }) {
    const limit = normalizePageLimit(input.limit);
    const cursor = input.cursor ? this.cursors.decode(input.cursor) : null;
    const page = await this.batchProjection.listTransactions(
      userId,
      cursor ? { createdAt: new Date(cursor.createdAt), id: cursor.id } : null,
      limit,
    );
    const last = page.rows.at(-1);
    return {
      data: page.rows,
      meta: {
        hasMore: page.hasMore,
        nextCursor:
          page.hasMore && last
            ? this.cursors.encode({ createdAt: last.createdAt, id: last.transactionId })
            : null,
      },
    };
  }

  async getRegistrationReward(userId: string) {
    const [reward] = await this.infrastructure.database
      .select()
      .from(registrationRewards)
      .where(
        and(
          eq(registrationRewards.userId, userId),
          eq(registrationRewards.rewardType, 'NEW_USER_ONBOARDING'),
        ),
      )
      .limit(1);
    if (!reward) {
      return {
        rewardId: `ineligible:${userId}`,
        rewardType: 'NEW_USER_ONBOARDING' as const,
        status: 'INELIGIBLE' as const,
        wisdomSeedAmount: this.infrastructure.policy.registration.rewardAmount,
        claimedAt: null,
        expiresAt: null,
      };
    }
    return this.rewardDto(reward);
  }

  async claimRegistrationReward(userId: string) {
    return this.infrastructure.database.transaction(async (tx) => {
      const [reward] = await tx
        .select()
        .from(registrationRewards)
        .where(
          and(
            eq(registrationRewards.userId, userId),
            eq(registrationRewards.rewardType, 'NEW_USER_ONBOARDING'),
          ),
        )
        .for('update')
        .limit(1);
      if (!reward)
        throw new ConflictException({
          code: 'REGISTRATION_REWARD_INELIGIBLE',
          message: 'Registration reward is not available',
        });

      // Claimed historical rewards are already included in the migrated opening balance.
      // Never re-grant them when a client replays the claim endpoint.
      let claimed = reward;
      if (reward.status === 'AVAILABLE') {
        await ensureRegistrationRewardBatch(tx, reward);
        [claimed] = (await tx
          .update(registrationRewards)
          .set({ status: 'CLAIMED', claimedAt: new Date() })
          .where(eq(registrationRewards.id, reward.id))
          .returning()) as [typeof reward];
      } else if (reward.status !== 'CLAIMED') {
        throw new ConflictException({
          code: 'REGISTRATION_REWARD_INELIGIBLE',
          message: 'Registration reward is not available',
        });
      }
      const [account] = await tx
        .select()
        .from(complimentarySeedAccountProjections)
        .where(eq(complimentarySeedAccountProjections.ownerUserId, userId))
        .limit(1);
      if (!account) throw new Error('Registration reward account migration required');
      const [entry] = await tx
        .select()
        .from(complimentarySeedEntries)
        .where(
          and(
            eq(complimentarySeedEntries.ownerUserId, userId),
            eq(complimentarySeedEntries.businessKey, `registration-reward:${reward.id}:GRANT`),
          ),
        )
        .limit(1);
      return {
        reward: this.rewardDto(claimed),
        account: {
          accountId: `seed-batch:${userId}`,
          available: account.availableQuantity,
          reserved: account.reservedQuantity,
          totalEarned: account.totalGranted,
          totalSpent: account.totalConsumed,
          updatedAt: account.updatedAt.toISOString(),
        },
        transaction: entry
          ? {
              transactionId: entry.id,
              type: 'GRANT' as const,
              amount: entry.quantity,
              balanceAfter: entry.availableAfter,
              businessType: 'REGISTRATION_REWARD',
              resourceId: reward.id,
              originalTransactionId: null,
              title: '新用户注册赠礼',
              createdAt: entry.createdAt.toISOString(),
            }
          : null,
      };
    });
  }

  private rewardDto(reward: typeof registrationRewards.$inferSelect) {
    return {
      rewardId: reward.id,
      rewardType: 'NEW_USER_ONBOARDING' as const,
      status: reward.status,
      wisdomSeedAmount: reward.amount,
      claimedAt: reward.claimedAt?.toISOString() ?? null,
      expiresAt: null,
    };
  }

}

async function ensureRegistrationRewardBatch(
  tx: SeedLedgerTransaction,
  reward: typeof registrationRewards.$inferSelect,
) {
  const grantId = newId();
  const requestId = newId();
  const [inserted] = await tx
    .insert(complimentarySeedGrants)
    .values({
      id: grantId,
      ownerUserId: reward.userId,
      businessSpace: 'SATORI',
      sourceType: 'REGISTRATION',
      sourceId: reward.id,
      applicableServices: ['DAILY_INSIGHT'],
      totalQuantity: reward.amount,
      availableQuantity: reward.amount,
      reservedQuantity: 0,
      status: 'ACTIVE',
      effectiveAt: reward.createdAt,
      expiresAt: null,
      grantedAt: reward.createdAt,
      expiryTimezone: null,
      ruleVersion: 'registration-reward-v1',
      requestId,
    })
    .onConflictDoNothing({
      target: [
        complimentarySeedGrants.ownerUserId,
        complimentarySeedGrants.sourceType,
        complimentarySeedGrants.sourceId,
      ],
    })
    .returning({ id: complimentarySeedGrants.id });
  if (!inserted) {
    const [existing] = await tx
      .select()
      .from(complimentarySeedGrants)
      .where(
        and(
          eq(complimentarySeedGrants.ownerUserId, reward.userId),
          eq(complimentarySeedGrants.sourceType, 'REGISTRATION'),
          eq(complimentarySeedGrants.sourceId, reward.id),
        ),
      )
      .limit(1);
    if (
      !existing ||
      existing.totalQuantity !== reward.amount ||
      existing.ruleVersion !== 'registration-reward-v1' ||
      !sameServices(existing.applicableServices as string[], ['DAILY_INSIGHT'])
    )
      throw new Error('Registration reward batch ledger invariant violated');
    return;
  }

  await tx
    .insert(complimentarySeedAccountProjections)
    .values({
      ownerUserId: reward.userId,
      businessSpace: 'SATORI',
      availableQuantity: reward.amount,
      reservedQuantity: 0,
      totalGranted: reward.amount,
      totalConsumed: 0,
      version: 1,
    })
    .onConflictDoUpdate({
      target: complimentarySeedAccountProjections.ownerUserId,
      set: {
        availableQuantity: sql`${complimentarySeedAccountProjections.availableQuantity} + ${reward.amount}`,
        totalGranted: sql`${complimentarySeedAccountProjections.totalGranted} + ${reward.amount}`,
        version: sql`${complimentarySeedAccountProjections.version} + 1`,
        updatedAt: new Date(),
      },
    });
  await tx.insert(complimentarySeedEntries).values({
    id: newId(),
    grantId,
    ownerUserId: reward.userId,
    businessSpace: 'SATORI',
    entryType: 'GRANT',
    quantity: reward.amount,
    availableAfter: reward.amount,
    reservedAfter: 0,
    businessKey: `registration-reward:${reward.id}:GRANT`,
    businessContextType: 'REGISTRATION',
    businessContextId: reward.id,
    requestId,
    metadata: {
      applicableServices: ['DAILY_INSIGHT'],
      ruleVersion: 'registration-reward-v1',
    },
  });
}

function sameServices(actual: string[], expected: string[]) {
  return actual.length === expected.length && expected.every((service) => actual.includes(service));
}
