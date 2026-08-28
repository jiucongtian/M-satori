import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
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
  seedAccounts,
  seedEntries,
} from '@satori/infrastructure';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';

type EntryType = 'GRANT' | 'RESERVE' | 'CONSUME' | 'RELEASE' | 'REFUND' | 'ADJUSTMENT';
type BusinessType = 'REGISTRATION_REWARD' | 'DAILY_INSIGHT';
export type SeedLedgerTransaction = Parameters<
  Parameters<RuntimeInfrastructure['database']['transaction']>[0]
>[0];

export interface SeedSettlement {
  currency: 'WISDOM_SEED';
  amount: number;
  status: 'RESERVED' | 'CONSUMED' | 'RELEASED' | 'REFUNDED';
  transactionId: string;
}

interface ApplyCommand {
  userId: string;
  type: EntryType;
  amount: number;
  businessKey: string;
  businessType: BusinessType;
  resourceId?: string | null;
  originalEntryId?: string | null;
  title?: string;
}

@Injectable()
export class SeedLedgerService {
  private readonly cursors: CursorCodec;

  constructor(
    private readonly infrastructure: RuntimeInfrastructure,
    @Optional()
    @Inject(SEED_BATCH_PROJECTION_QUERY_PORT)
    private readonly batchProjection?: SeedBatchProjectionQueryPort,
  ) {
    this.cursors = new CursorCodec(infrastructure.environment.CURSOR_SIGNING_SECRET);
  }

  async getAccount(userId: string) {
    const [account] = await this.infrastructure.database
      .select()
      .from(seedAccounts)
      .where(eq(seedAccounts.userId, userId))
      .limit(1);
    const batch = await this.batchProjection?.getAccount(userId);
    if (this.infrastructure.environment.SEED_BATCH_READ_MODE === 'BATCH') {
      if (!batch)
        throw new NotFoundException({ code: 'SEED_ACCOUNT_NOT_FOUND', message: 'Seed account not found' });
      return batch;
    }
    if (!account)
      throw new NotFoundException({ code: 'SEED_ACCOUNT_NOT_FOUND', message: 'Seed account not found' });
    if (
      this.infrastructure.environment.SEED_BATCH_READ_MODE === 'SHADOW' &&
      batch &&
      (batch.available !== account.available || batch.reserved !== account.reserved)
    ) {
      console.error('seed_batch_shadow_mismatch', {
        userId,
        legacy: { available: account.available, reserved: account.reserved },
        batch: { available: batch.available, reserved: batch.reserved },
      });
    }
    return this.accountDto(account);
  }

  async listTransactions(userId: string, input: { cursor?: string; limit?: number }) {
    const limit = normalizePageLimit(input.limit);
    const cursor = input.cursor ? this.cursors.decode(input.cursor) : null;
    if (this.infrastructure.environment.SEED_BATCH_READ_MODE === 'BATCH' && this.batchProjection) {
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
    const [account] = await this.infrastructure.database
      .select({ id: seedAccounts.id })
      .from(seedAccounts)
      .where(eq(seedAccounts.userId, userId))
      .limit(1);
    if (!account)
      throw new NotFoundException({ code: 'SEED_ACCOUNT_NOT_FOUND', message: 'Seed account not found' });
    const rows = await this.infrastructure.database
      .select()
      .from(seedEntries)
      .where(
        and(
          eq(seedEntries.accountId, account.id),
          cursor
            ? or(
                lt(seedEntries.createdAt, new Date(cursor.createdAt)),
                and(eq(seedEntries.createdAt, new Date(cursor.createdAt)), lt(seedEntries.id, cursor.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(seedEntries.createdAt), desc(seedEntries.id))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      data: page.map((entry) => this.entryDto(entry)),
      meta: {
        hasMore,
        nextCursor:
          hasMore && last
            ? this.cursors.encode({ createdAt: last.createdAt.toISOString(), id: last.id })
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

      if (reward.seedEntryId) {
        const [entry] = await tx
          .select()
          .from(seedEntries)
          .where(eq(seedEntries.id, reward.seedEntryId))
          .limit(1);
        const [account] = await tx
          .select()
          .from(seedAccounts)
          .where(eq(seedAccounts.userId, userId))
          .limit(1);
        if (!entry || !account) throw new Error('Registration reward ledger invariant violated');
        return {
          reward: this.rewardDto(reward),
          account: this.accountDto(account),
          transaction: this.entryDto(entry),
        };
      }

      const applied = await this.applyLocked(tx, {
        userId,
        type: 'GRANT',
        amount: reward.amount,
        businessKey: `registration-reward:${reward.id}`,
        businessType: 'REGISTRATION_REWARD',
        resourceId: reward.id,
        title: '新用户注册赠礼',
      });
      const claimedAt = new Date();
      const [claimed] = await tx
        .update(registrationRewards)
        .set({ status: 'CLAIMED', claimedAt, seedEntryId: applied.entry.id })
        .where(eq(registrationRewards.id, reward.id))
        .returning();
      return {
        reward: this.rewardDto(claimed!),
        account: this.accountDto(applied.account),
        transaction: this.entryDto(applied.entry),
      };
    });
  }

  reserve(command: Omit<ApplyCommand, 'type'>) {
    return this.apply({ ...command, type: 'RESERVE' });
  }

  async reserveInTransaction(tx: SeedLedgerTransaction, command: Omit<ApplyCommand, 'type'>) {
    const result = await this.applyLocked(tx, { ...command, type: 'RESERVE' });
    return { account: this.accountDto(result.account), transaction: this.entryDto(result.entry) };
  }

  async consumeInTransaction(tx: SeedLedgerTransaction, command: Omit<ApplyCommand, 'type'>) {
    const result = await this.applyLocked(tx, { ...command, type: 'CONSUME' });
    return { account: this.accountDto(result.account), transaction: this.entryDto(result.entry) };
  }

  async releaseInTransaction(tx: SeedLedgerTransaction, command: Omit<ApplyCommand, 'type'>) {
    const result = await this.applyLocked(tx, { ...command, type: 'RELEASE' });
    return { account: this.accountDto(result.account), transaction: this.entryDto(result.entry) };
  }

  async refundInTransaction(tx: SeedLedgerTransaction, command: Omit<ApplyCommand, 'type'>) {
    const result = await this.applyLocked(tx, { ...command, type: 'REFUND' });
    return { account: this.accountDto(result.account), transaction: this.entryDto(result.entry) };
  }

  consume(command: Omit<ApplyCommand, 'type'>) {
    return this.apply({ ...command, type: 'CONSUME' });
  }

  release(command: Omit<ApplyCommand, 'type'>) {
    return this.apply({ ...command, type: 'RELEASE' });
  }

  refund(command: Omit<ApplyCommand, 'type'>) {
    return this.apply({ ...command, type: 'REFUND' });
  }

  adjustment(command: Omit<ApplyCommand, 'type'>) {
    return this.apply({ ...command, type: 'ADJUSTMENT' });
  }

  toSettlement(
    transaction: { transactionId: string; amount: number },
    status: SeedSettlement['status'],
  ): SeedSettlement {
    return {
      currency: 'WISDOM_SEED',
      amount: Math.abs(transaction.amount),
      status,
      transactionId: transaction.transactionId,
    };
  }

  private async apply(command: ApplyCommand) {
    const result = await this.infrastructure.database.transaction((tx) => this.applyLocked(tx, command));
    return { account: this.accountDto(result.account), transaction: this.entryDto(result.entry) };
  }

  private async applyLocked(tx: SeedLedgerTransaction, command: ApplyCommand) {
    if (
      !Number.isInteger(command.amount) ||
      command.amount === 0 ||
      (command.type !== 'ADJUSTMENT' && command.amount < 0)
    ) {
      throw new BadRequestException({
        code: 'INVALID_SEED_AMOUNT',
        message: 'Seed amount must be a positive integer',
      });
    }
    const [account] = await tx
      .select()
      .from(seedAccounts)
      .where(eq(seedAccounts.userId, command.userId))
      .for('update')
      .limit(1);
    if (!account)
      throw new NotFoundException({ code: 'SEED_ACCOUNT_NOT_FOUND', message: 'Seed account not found' });
    const [replay] = await tx
      .select()
      .from(seedEntries)
      .where(
        and(
          eq(seedEntries.accountId, account.id),
          eq(seedEntries.type, command.type),
          eq(seedEntries.businessKey, command.businessKey),
        ),
      )
      .limit(1);
    if (replay) return { account, entry: replay };

    const original = command.originalEntryId
      ? (
          await tx
            .select()
            .from(seedEntries)
            .where(and(eq(seedEntries.id, command.originalEntryId), eq(seedEntries.accountId, account.id)))
            .limit(1)
        )[0]
      : undefined;
    if (['CONSUME', 'RELEASE'].includes(command.type) && (!original || original.type !== 'RESERVE')) {
      throw new ConflictException({
        code: 'SEED_RESERVATION_NOT_FOUND',
        message: 'A reservation entry is required',
      });
    }
    if (command.type === 'REFUND' && (!original || original.type !== 'CONSUME')) {
      throw new ConflictException({
        code: 'SEED_CONSUMPTION_NOT_FOUND',
        message: 'A consumption entry is required',
      });
    }
    if (original && original.amount !== -command.amount) {
      throw new ConflictException({
        code: 'SEED_SETTLEMENT_AMOUNT_MISMATCH',
        message: 'Settlement amount does not match original entry',
      });
    }
    if (original && ['CONSUME', 'RELEASE'].includes(command.type)) {
      const [settled] = await tx
        .select()
        .from(seedEntries)
        .where(
          and(
            eq(seedEntries.originalEntryId, original.id),
            or(eq(seedEntries.type, 'CONSUME'), eq(seedEntries.type, 'RELEASE')),
          ),
        )
        .limit(1);
      if (settled)
        throw new ConflictException({
          code: 'SEED_RESERVATION_ALREADY_SETTLED',
          message: 'Reservation has already been settled',
        });
    }
    if (original && command.type === 'REFUND') {
      const [refunded] = await tx
        .select()
        .from(seedEntries)
        .where(and(eq(seedEntries.originalEntryId, original.id), eq(seedEntries.type, 'REFUND')))
        .limit(1);
      if (refunded)
        throw new ConflictException({
          code: 'SEED_CONSUMPTION_ALREADY_REFUNDED',
          message: 'Consumption has already been refunded',
        });
    }

    const amount = Math.abs(command.amount);
    let available = account.available;
    let reserved = account.reserved;
    let totalEarned = account.totalEarned;
    let totalSpent = account.totalSpent;
    if (command.type === 'GRANT') {
      available += amount;
      totalEarned += amount;
    }
    if (command.type === 'RESERVE') {
      available -= amount;
      reserved += amount;
    }
    if (command.type === 'CONSUME') {
      reserved -= amount;
      totalSpent += amount;
    }
    if (command.type === 'RELEASE') {
      reserved -= amount;
      available += amount;
    }
    if (command.type === 'REFUND') {
      available += amount;
      totalSpent -= amount;
    }
    if (command.type === 'ADJUSTMENT') {
      available += command.amount;
      if (command.amount > 0) totalEarned += command.amount;
      else totalSpent += -command.amount;
    }
    if (available < 0)
      throw new ConflictException({
        code: 'INSUFFICIENT_WISDOM_SEEDS',
        message: 'Insufficient wisdom seeds',
      });
    if (reserved < 0 || totalSpent < 0)
      throw new ConflictException({
        code: 'SEED_LEDGER_INVARIANT_VIOLATION',
        message: 'Seed ledger invariant would be violated',
      });

    const now = new Date();
    const [updated] = await tx
      .update(seedAccounts)
      .set({ available, reserved, totalEarned, totalSpent, version: account.version + 1, updatedAt: now })
      .where(eq(seedAccounts.id, account.id))
      .returning();
    const signedAmount =
      command.type === 'RESERVE' || command.type === 'CONSUME'
        ? -amount
        : command.type === 'ADJUSTMENT'
          ? command.amount
          : amount;
    const [entry] = await tx
      .insert(seedEntries)
      .values({
        id: newId(),
        accountId: account.id,
        type: command.type,
        amount: signedAmount,
        availableAfter: available,
        reservedAfter: reserved,
        businessKey: command.businessKey,
        businessType: command.businessType,
        resourceId: command.resourceId ?? null,
        originalEntryId: command.originalEntryId ?? null,
        metadata: command.title ? { title: command.title } : {},
      })
      .returning();
    return { account: updated!, entry: entry! };
  }

  private accountDto(account: typeof seedAccounts.$inferSelect) {
    return {
      accountId: account.id,
      available: account.available,
      reserved: account.reserved,
      totalEarned: account.totalEarned,
      totalSpent: account.totalSpent,
      updatedAt: account.updatedAt.toISOString(),
    };
  }

  private entryDto(entry: typeof seedEntries.$inferSelect) {
    const metadata = entry.metadata as { title?: string };
    return {
      transactionId: entry.id,
      type: entry.type,
      amount: entry.amount,
      balanceAfter: entry.availableAfter,
      businessType: entry.businessType,
      resourceId: entry.resourceId ?? entry.businessKey,
      originalTransactionId: entry.originalEntryId,
      title: metadata.title ?? this.defaultTitle(entry.type),
      createdAt: entry.createdAt.toISOString(),
    };
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

  private defaultTitle(type: EntryType) {
    return {
      GRANT: '智慧种子入账',
      RESERVE: '智慧种子预留',
      CONSUME: '智慧种子消费',
      RELEASE: '智慧种子释放',
      REFUND: '智慧种子退款',
      ADJUSTMENT: '智慧种子调整',
    }[type];
  }

  async reconcile(userId: string) {
    const [account] = await this.infrastructure.database
      .select()
      .from(seedAccounts)
      .where(eq(seedAccounts.userId, userId))
      .limit(1);
    if (!account)
      throw new NotFoundException({ code: 'SEED_ACCOUNT_NOT_FOUND', message: 'Seed account not found' });
    const [sums] = await this.infrastructure.database
      .select({
        available: sql<number>`coalesce(sum(case when ${seedEntries.type} in ('GRANT','RESERVE','RELEASE','REFUND','ADJUSTMENT') then ${seedEntries.amount} else 0 end), 0)::int`,
        reserved: sql<number>`coalesce(sum(case when ${seedEntries.type} = 'RESERVE' then -${seedEntries.amount} when ${seedEntries.type} in ('CONSUME','RELEASE') then -abs(${seedEntries.amount}) else 0 end), 0)::int`,
      })
      .from(seedEntries)
      .where(eq(seedEntries.accountId, account.id));
    const consistent =
      sums!.available === account.available &&
      sums!.reserved === account.reserved &&
      account.available >= 0 &&
      account.reserved >= 0;
    if (!consistent)
      console.error('seed_ledger_reconciliation_failed', {
        userId,
        accountId: account.id,
        expected: sums,
        actual: { available: account.available, reserved: account.reserved },
      });
    return {
      consistent,
      expected: sums!,
      actual: { available: account.available, reserved: account.reserved },
    };
  }
}
