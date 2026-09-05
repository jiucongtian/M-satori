import type { BenefitSourcePort, BusinessClock } from '@satori/application';
import { describe, expect, it, vi } from 'vitest';
import { ConsumptionApplicationService, type ConsumptionRepository } from './index.js';

describe('ConsumptionApplicationService', () => {
  it('returns a user-facing message when no eligible benefit source exists', async () => {
    const repository = {
      getResolution: vi.fn().mockResolvedValue({
        resolutionId: 'resolution-1',
        ownerUserId: 'user-1',
        selectedSource: null,
      }),
    } as unknown as ConsumptionRepository;
    const source = {} as BenefitSourcePort;
    const clock = { now: () => new Date('2026-09-05T00:00:00.000Z') } as BusinessClock;
    const service = new ConsumptionApplicationService(source, source, repository, clock);

    await expect(service.createIntent('user-1', 'resolution-1', 'intent-key')).rejects.toMatchObject({
      code: 'PURCHASE_REQUIRED',
      message: '当前没有可用的服务权益，请前往“我的权益”查看',
    });
  });
});
