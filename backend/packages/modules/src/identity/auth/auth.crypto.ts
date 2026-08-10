import { Injectable } from '@nestjs/common';
import { FieldCipher, RuntimeInfrastructure } from '@satori/infrastructure';
import { createHmac, createHash, randomBytes } from 'node:crypto';

@Injectable()
export class AuthCrypto {
  constructor(
    private readonly infrastructure: RuntimeInfrastructure,
    private readonly cipher: FieldCipher,
  ) {}

  hash(value: string): string {
    return createHmac('sha256', this.infrastructure.environment.AUTH_HMAC_SECRET).update(value).digest('hex');
  }

  hashVerificationCode(challengeId: string, code: string): string {
    return this.hash(`otp:${challengeId}:${code}`);
  }

  encrypt(value: string): string {
    return this.cipher.encrypt(value);
  }

  decrypt(value: string): string {
    return this.cipher.decrypt(value);
  }

  generateRefreshToken(): string {
    return randomBytes(32).toString('base64url');
  }

  deriveRefreshToken(sessionId: string): string {
    return createHmac('sha256', this.infrastructure.environment.AUTH_HMAC_SECRET)
      .update(`refresh:${sessionId}`)
      .digest('base64url');
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
