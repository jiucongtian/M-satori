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
    const service = createService('BATCH', null, {
      getAccount: vi.fn().mockResolvedValue(batchAccount),
      listTransactions: vi.fn(),
    });

    await expect(service.getAccount('user-1')).resolves.toEqual(batchAccount);
  });

  it('keeps legacy reads authoritative in shadow mode and reports a projection mismatch', async () => {
    const legacy = legacyAccount({ available: 9, reserved: 1 });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const service = createService('SHADOW', legacy, {
      getAccount: vi.fn().mockResolvedValue(batchAccount),
      listTransactions: vi.fn(),
    });

    await expect(service.getAccount('user-1')).resolves.toMatchObject({ available: 9, reserved: 1 });
    expect(error).toHaveBeenCalledWith(
      'seed_batch_shadow_mismatch',
      expect.objectContaining({ userId: 'user-1' }),
    );
    error.mockRestore();
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
    const service = createService('BATCH', null, {
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

function createService(
  mode: 'LEGACY' | 'SHADOW' | 'BATCH',
  account: ReturnType<typeof legacyAccount> | null,
  projection: SeedBatchProjectionQueryPort,
) {
  const database = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(account ? [account] : []) }),
      }),
    }),
  };
  return new SeedLedgerService(
    {
      database,
      environment: {
        CURSOR_SIGNING_SECRET: 'test-cursor-secret',
        SEED_BATCH_READ_MODE: mode,
      },
    } as never,
    projection,
  );
}

function legacyAccount(overrides: { available: number; reserved: number }) {
  return {
    id: 'legacy-account-1',
    userId: 'user-1',
    available: overrides.available,
    reserved: overrides.reserved,
    totalEarned: 20,
    totalSpent: 10,
    version: 1,
    updatedAt: new Date('2026-08-28T00:00:00.000Z'),
  };
}
