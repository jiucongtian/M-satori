import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PUBLIC_ROUTE } from '@satori/contracts';
import { RuntimeInfrastructure, sessions, users } from '@satori/infrastructure';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { AccessTokenService } from './access-token.service.js';
import type { AuthenticatedRequest } from './authenticated-request.js';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: AccessTokenService,
    private readonly infrastructure: RuntimeInfrastructure,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException({ code: 'ACCESS_TOKEN_MISSING', message: 'Access token is required' });
    }
    const claims = await this.tokens.verify(authorization.slice(7));
    const [active] = await this.infrastructure.database
      .select({ sessionId: sessions.id, userId: users.id })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.id, claims.sessionId),
          eq(sessions.userId, claims.userId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
          eq(users.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    if (!active) {
      throw new UnauthorizedException({ code: 'SESSION_REVOKED', message: 'Session is not active' });
    }
    (request as AuthenticatedRequest).auth = claims;
    return true;
  }
}
