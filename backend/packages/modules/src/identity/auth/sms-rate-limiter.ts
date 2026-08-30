import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { RuntimeInfrastructure } from '@satori/infrastructure';

export interface RateLimitSnapshot {
  limit: number;
  remaining: number;
  resetAt: number;
}

@Injectable()
export class SmsRateLimiter {
  constructor(private readonly infrastructure: RuntimeInfrastructure) {}

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
