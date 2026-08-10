import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { IdempotencyService, type IdempotentResult } from '@satori/application';
import {
  newId,
  FieldCipher,
  PostgresIdempotencyStore,
  RuntimeInfrastructure,
  smsChallenges,
} from '@satori/infrastructure';
import { eq } from 'drizzle-orm';
import { randomInt } from 'node:crypto';
import { AuthCrypto } from './auth.crypto.js';
import { SMS_GATEWAY, type SmsGateway } from './sms.gateway.js';
import { SmsRateLimiter, type RateLimitSnapshot } from './sms-rate-limiter.js';

export interface SmsChallengeCommand {
  countryCode: string;
  nationalNumber: string;
  purpose: 'LOGIN' | 'ACCOUNT_DELETION' | 'SECURITY_CONFIRMATION';
  deviceId: string;
  deviceTimezone: string;
  ip: string;
  idempotencyKey: string;
}

export interface SmsChallengeResult {
  data: {
    challengeId: string;
    expiresAt: string;
    resendAvailableAt: string;
    phoneMasked: string;
  };
  rateLimit: RateLimitSnapshot;
}

@Injectable()
export class SmsChallengeService {
  private readonly idempotency: IdempotencyService;

  constructor(
    private readonly infrastructure: RuntimeInfrastructure,
    private readonly crypto: AuthCrypto,
    cipher: FieldCipher,
    private readonly limiter: SmsRateLimiter,
    @Inject(SMS_GATEWAY) private readonly gateway: SmsGateway,
  ) {
    this.idempotency = new IdempotencyService(
      new PostgresIdempotencyStore(infrastructure.database, cipher),
      infrastructure.environment.IDEMPOTENCY_TTL_SECONDS * 1000,
    );
  }

  async issue(command: SmsChallengeCommand): Promise<IdempotentResult<SmsChallengeResult>> {
    const phone = normalizePhone(command.countryCode, command.nationalNumber);
    const phoneHash = this.crypto.hash(`phone:${phone}`);
    return this.idempotency.execute(
      { actorKey: `phone:${phoneHash}`, operation: 'createSmsChallenge', key: command.idempotencyKey },
      command,
      async () => {
        const deviceHash = this.crypto.hash(`device:${command.deviceId}`);
        const ipHash = this.crypto.hash(`ip:${command.ip}`);
        const limits = this.infrastructure.environment;
        const snapshots = await Promise.all([
          this.limiter.consume('phone', phoneHash, limits.SMS_PHONE_RATE_PER_HOUR),
          this.limiter.consume('device', deviceHash, limits.SMS_DEVICE_RATE_PER_HOUR),
          this.limiter.consume('ip', ipHash, limits.SMS_IP_RATE_PER_HOUR),
        ]);
        const rateLimit = snapshots.reduce((lowest, current) =>
          current.remaining < lowest.remaining ? current : lowest,
        );
        const challengeId = newId();
        const code =
          limits.NODE_ENV === 'production' ? String(randomInt(0, 1_000_000)).padStart(6, '0') : '123456';
        const now = Date.now();
        const expiresAt = new Date(now + limits.OTP_TTL_SECONDS * 1000);
        const resendAvailableAt = new Date(now + limits.OTP_RESEND_SECONDS * 1000);
        const phoneMasked = maskPhone(command.countryCode, command.nationalNumber);
        await this.infrastructure.database.insert(smsChallenges).values({
          id: challengeId,
          phoneHash,
          phoneCiphertext: this.crypto.encrypt(phone),
          phoneMasked,
          deviceHash,
          ipHash,
          purpose: command.purpose,
          codeHash: this.crypto.hashVerificationCode(challengeId, code),
          maxAttempts: limits.OTP_MAX_ATTEMPTS,
          expiresAt,
        });
        try {
          await this.gateway.sendVerificationCode({
            phone,
            code,
            expiresInSeconds: limits.OTP_TTL_SECONDS,
          });
        } catch {
          await this.infrastructure.database.delete(smsChallenges).where(eq(smsChallenges.id, challengeId));
          throw new ServiceUnavailableException({
            code: 'SMS_PROVIDER_UNAVAILABLE',
            message: 'SMS provider is temporarily unavailable',
          });
        }
        return {
          status: 202,
          body: {
            data: {
              challengeId,
              expiresAt: expiresAt.toISOString(),
              resendAvailableAt: resendAvailableAt.toISOString(),
              phoneMasked,
            },
            rateLimit,
          },
        };
      },
    );
  }
}

function normalizePhone(countryCode: string, nationalNumber: string): string {
  if (!/^\+[1-9]\d{0,2}$/.test(countryCode) || !/^\d{6,15}$/.test(nationalNumber)) {
    throw new BadRequestException({ code: 'PHONE_INVALID', message: 'Phone number is invalid' });
  }
  if (countryCode === '+86' && !/^1\d{10}$/.test(nationalNumber)) {
    throw new BadRequestException({ code: 'PHONE_INVALID', message: 'Phone number is invalid' });
  }
  return `${countryCode}${nationalNumber}`;
}

function maskPhone(countryCode: string, nationalNumber: string): string {
  const visibleStart = nationalNumber.slice(0, 3);
  const visibleEnd = nationalNumber.slice(-4);
  return `${countryCode} ${visibleStart}****${visibleEnd}`;
}
