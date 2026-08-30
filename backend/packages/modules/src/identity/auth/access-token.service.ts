import { Injectable, UnauthorizedException } from '@nestjs/common';
import { RuntimeInfrastructure } from '@satori/infrastructure';
import { jwtVerify, SignJWT } from 'jose';

export interface AccessTokenClaims {
  userId: string;
  sessionId: string;
}

@Injectable()
export class AccessTokenService {
  private readonly key: Uint8Array;

  constructor(private readonly infrastructure: RuntimeInfrastructure) {
    this.key = new TextEncoder().encode(infrastructure.environment.ACCESS_TOKEN_SECRET);
  }

  async issue(claims: AccessTokenClaims): Promise<{ token: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + this.infrastructure.policy.auth.accessTokenTtlSeconds * 1000);
    const token = await new SignJWT({ sid: claims.sessionId })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.userId)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.key);
    return { token, expiresAt };
  }

  async verify(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ['HS256'] });
      if (!payload.sub || typeof payload.sid !== 'string') throw new Error('claims');
      return { userId: payload.sub, sessionId: payload.sid };
    } catch {
      throw new UnauthorizedException({ code: 'ACCESS_TOKEN_INVALID', message: 'Access token is invalid' });
    }
  }
}
