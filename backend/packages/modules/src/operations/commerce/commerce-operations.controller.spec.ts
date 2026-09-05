import { describe, expect, it, vi } from 'vitest';
import { CommerceOperationsController } from './commerce-operations.controller.js';

describe('CommerceOperationsController', () => {
  it('records a verified operations-service grant without inventing a consumer user actor', async () => {
    const grantManualSeeds = vi.fn().mockResolvedValue({ delivered: true });
    const controller = new CommerceOperationsController({ grantManualSeeds } as never);
    const request = {
      id: 'request-1',
      operationsService: true,
      auth: { userId: '00000000-0000-4000-8000-000000000001' },
    };
    await expect(
      controller.grantManualSeeds(request as never, {
        phoneHash: 'a'.repeat(64),
        actionId: '00000000-0000-4000-8000-000000000002',
        quantity: 1,
        reason: '测试赠送',
      }),
    ).resolves.toEqual({ data: { delivered: true } });
    expect(grantManualSeeds).toHaveBeenCalledWith(expect.objectContaining({ operatorUserId: null }));
  });
});
