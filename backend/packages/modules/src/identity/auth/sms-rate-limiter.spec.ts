import { describe, expect, it, vi } from 'vitest';
import { SmsRateLimiter } from './sms-rate-limiter.js';

describe('SmsRateLimiter cooldown', () => {
  it('atomically blocks a second SMS request for the same phone', async () => {
    const redis = {
      set: vi.fn().mockResolvedValueOnce('OK').mockResolvedValueOnce(null),
      ttl: vi.fn().mockResolvedValue(41),
      eval: vi.fn().mockResolvedValue(1),
    };
    const limiter = new SmsRateLimiter({
      environment: { QUEUE_PREFIX: 'satori-test' },
      redis,
    } as never);

    const lease = await limiter.acquireCooldown('phone-hash', 60);
    await expect(limiter.acquireCooldown('phone-hash', 60)).rejects.toMatchObject({
      status: 429,
      response: {
        code: 'SMS_RATE_LIMITED',
        details: { dimension: 'phone_cooldown', retryAfterSeconds: 41 },
      },
    });
    expect(redis.set).toHaveBeenCalledWith(
      'satori-test:rate:sms:phone_cooldown:phone-hash',
      expect.any(String),
      'EX',
      60,
      'NX',
    );

    await lease.release();
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('del'"),
      1,
      'satori-test:rate:sms:phone_cooldown:phone-hash',
      expect.any(String),
    );
  });
});
