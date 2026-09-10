import type { SeedBatchProjectionQueryPort } from '@satori/application';
import { describe, expect, it, vi } from 'vitest';
import { SeedLedgerService } from './seed-ledger.service.js';

const batchAccount = {
  accountId: 'seed-batch:user-1',
  available: 8,
  reserved: 2,
  totalEarned: 20,
  totalSpent: 10,
  updatedAt: '2026-08-28T00:00:00.000Z',
};

describe('SeedLedgerService batch read compatibility', () => {
  it('returns the batch account through the R1.0 account shape after cutover', async () => {
    const service = createService({
      getAccount: vi.fn().mockResolvedValue(batchAccount),
      listTransactions: vi.fn(),
    });

    await expect(service.getAccount('user-1')).resolves.toEqual(batchAccount);
  });

  it('does not fall back to an old balance when the new account is missing', async () => {
    const service = createService({ getAccount: vi.fn().mockResolvedValue(null), listTransactions: vi.fn() });
    await expect(service.getAccount('user-1')).rejects.toMatchObject({
      response: { code: 'SEED_ACCOUNT_NOT_FOUND' },
    });
  });

  it('preserves the R1.0 transaction envelope and stable cursor in batch mode', async () => {
    const listTransactions = vi.fn().mockResolvedValue({
      rows: [
        {
          transactionId: 'transaction-1',
          type: 'GRANT',
          amount: 5,
          balanceAfter: 5,
          businessType: 'REGISTRATION_REWARD',
          resourceId: 'registration-1',
          originalTransactionId: null,
          title: '智慧种子入账',
          createdAt: '2026-08-28T00:00:00.000Z',
        },
      ],
      hasMore: true,
    });
    const service = createService({
      getAccount: vi.fn(),
      listTransactions,
    });

    const result = await service.listTransactions('user-1', { limit: 1 });

    expect(result.data[0]).toMatchObject({ transactionId: 'transaction-1', type: 'GRANT' });
    expect(result.meta).toMatchObject({ hasMore: true });
    expect(result.meta.nextCursor).toEqual(expect.any(String));
    expect(listTransactions).toHaveBeenCalledWith('user-1', null, 1);
  });
});

function createService(projection: SeedBatchProjectionQueryPort) {
  return new SeedLedgerService(
    {
      database: {
        select: () => {
          throw new Error('Legacy reads are forbidden');
        },
      },
      environment: { CURSOR_SIGNING_SECRET: 'test-cursor-secret' },
    } as never,
    projection,
  );
}

describe('registration reward replay after cutover', () => {
  it('returns the migrated balance without reading or returning an old transaction', async () => {
    const now = new Date();
    const results = [
      [
        {
          id: 'reward',
          userId: 'user',
          amount: 18,
          status: 'CLAIMED',
          seedEntryId: 'old-entry',
          claimedAt: now,
        },
      ],
      [{ availableQuantity: 2, reservedQuantity: 0, totalGranted: 18, totalConsumed: 16, updatedAt: now }],
      [],
    ];
    const write = vi.fn(() => {
      throw new Error('Historical reward must not write either ledger');
    });
    const tx = {
      select: () => ({
        from: () => ({
          where: () => ({
            for: () => ({ limit: () => Promise.resolve(results.shift()) }),
            limit: () => Promise.resolve(results.shift()),
          }),
        }),
      }),
      insert: write,
      update: write,
    };
    const service = new SeedLedgerService(
      {
        environment: { CURSOR_SIGNING_SECRET: 'test-cursor-secret' },
        database: { transaction: (work: (value: typeof tx) => Promise<unknown>) => work(tx) },
      } as never,
      {} as never,
    );
    const result = await service.claimRegistrationReward('user');
    expect(result.account).toMatchObject({ available: 2, totalSpent: 16 });
    expect(result.transaction).toBeNull();
    expect(write).not.toHaveBeenCalled();
  });
});
