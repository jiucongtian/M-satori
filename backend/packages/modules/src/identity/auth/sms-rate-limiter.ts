import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { RuntimeInfrastructure } from '@satori/infrastructure';
import { randomUUID } from 'node:crypto';

export interface RateLimitSnapshot {
  limit: number;
  remaining: number;
  resetAt: number;
}

export interface SmsCooldownLease {
  release(): Promise<void>;
}

@Injectable()
export class SmsRateLimiter {
  constructor(private readonly infrastructure: RuntimeInfrastructure) {}

  async acquireCooldown(subjectHash: string, seconds: number): Promise<SmsCooldownLease> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const key = `${this.infrastructure.environment.QUEUE_PREFIX}:rate:sms:phone_cooldown:${subjectHash}`;
    const token = randomUUID();
    const acquired = await this.infrastructure.redis.set(key, token, 'EX', seconds, 'NX');
    if (acquired !== 'OK') {
      const ttl = await this.infrastructure.redis.ttl(key);
      const retryAfterSeconds = ttl > 0 ? ttl : seconds;
      throw new HttpException(
        {
          code: 'SMS_RATE_LIMITED',
          message: 'Please wait before requesting another verification code',
          details: {
            retryAfterSeconds,
            dimension: 'phone_cooldown',
            limit: 1,
            resetAt: nowSeconds + retryAfterSeconds,
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return {
      release: async () => {
        await this.infrastructure.redis.eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          1,
          key,
          token,
        );
      },
    };
  }

  async consume(dimension: string, subjectHash: string, limit: number): Promise<RateLimitSnapshot> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const bucket = Math.floor(nowSeconds / 3600);
    const resetAt = (bucket + 1) * 3600;
    const key = `${this.infrastructure.environment.QUEUE_PREFIX}:rate:sms:${dimension}:${subjectHash}:${bucket}`;
    const count = await this.infrastructure.redis.incr(key);
    if (count === 1) await this.infrastructure.redis.expire(key, resetAt - nowSeconds);
    if (count > limit) {
      throw new HttpException(
        {
          code: 'SMS_RATE_LIMITED',
          message: 'SMS request rate limit exceeded',
          details: { retryAfterSeconds: resetAt - nowSeconds, dimension, limit, resetAt },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return { limit, remaining: Math.max(0, limit - count), resetAt };
  }
}
