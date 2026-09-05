import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { Reflector } from '@nestjs/core';
import { OPTIONAL_AUTH_ROUTE, PUBLIC_ROUTE } from '@satori/contracts';
import { RuntimeInfrastructure, sessions, users } from '@satori/infrastructure';
import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
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
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, targets);
    if (isPublic) return true;
    const isOptionalAuth = this.reflector.getAllAndOverride<boolean>(OPTIONAL_AUTH_ROUTE, targets);
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const serviceToken = request.headers['x-satori-operations-token'] ?? request.headers.authorization?.replace(/^Bearer\s+/, '');
    const expectedServiceToken = this.infrastructure.environment?.OPERATIONS_SERVICE_TOKEN;
    if (typeof serviceToken === 'string' && expectedServiceToken) {
      const actual = Buffer.from(serviceToken);
      const expected = Buffer.from(expectedServiceToken);
      if (actual.length === expected.length && timingSafeEqual(actual, expected)) {
        (request as AuthenticatedRequest).auth = {
          userId: this.infrastructure.environment.OPERATIONS_SERVICE_USER_ID,
          sessionId: 'operations-service',
        };
        (request as AuthenticatedRequest & { operationsService?: boolean }).operationsService = true;
        return true;
      }
    }
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
      if (isOptionalAuth) return true;
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
          inArray(users.status, ['ACTIVE', 'DELETION_PENDING']),
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
