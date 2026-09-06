import type { BenefitSourcePort, BusinessClock } from '@satori/application';
import { describe, expect, it, vi } from 'vitest';
import { ConsumptionApplicationService, type ConsumptionRepository } from './index.js';

describe('ConsumptionApplicationService', () => {
  it('allows complimentary seeds for daily insight but never as direct card-reading payment', async () => {
    const entitlements = { listCandidates: vi.fn().mockResolvedValue([]) } as unknown as BenefitSourcePort;
    const seeds = { listCandidates: vi.fn().mockResolvedValue([]) } as unknown as BenefitSourcePort;
    const repository = { saveResolution: vi.fn().mockImplementation((value) => Promise.resolve(value)) } as unknown as ConsumptionRepository;
    const service = new ConsumptionApplicationService(entitlements, seeds, repository, { now: () => new Date('2026-09-05T00:00:00.000Z') });
    const base = { userId: 'user-1', businessSpace: 'SATORI', quantity: 1, unit: 'READING_CREDIT', businessContext: { type: 'TEST', id: 'test-1' }, attributes: { seedQuantity: 3 } } as const;

    await service.createResolution({ ...base, serviceType: 'CARD_READING' }, 'reading');
    expect(seeds.listCandidates).not.toHaveBeenCalled();

    await service.createResolution({ ...base, serviceType: 'DAILY_INSIGHT', unit: 'DAILY_INSIGHT_CREDIT' }, 'daily');
    expect(seeds.listCandidates).toHaveBeenCalledWith(expect.objectContaining({ serviceType: 'DAILY_INSIGHT', unit: 'SEED', quantity: 3 }));
  });

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
