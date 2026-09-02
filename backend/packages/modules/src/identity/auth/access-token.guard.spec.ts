import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AccessTokenGuard } from './access-token.guard.js';

function contextFor(request: { headers: { authorization?: string }; auth?: unknown }) {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

describe('AccessTokenGuard optional authentication', () => {
  it('allows an anonymous request on an optional-auth route', async () => {
    const reflector = { getAllAndOverride: vi.fn((key: string) => key === 'satori.optionalAuthRoute') };
    const guard = new AccessTokenGuard(reflector as never, { verify: vi.fn() } as never, {} as never);
    await expect(guard.canActivate(contextFor({ headers: {} }))).resolves.toBe(true);
  });

  it('does not silently accept an invalid bearer token as anonymous', async () => {
    const reflector = { getAllAndOverride: vi.fn((key: string) => key === 'satori.optionalAuthRoute') };
    const tokens = { verify: vi.fn().mockRejectedValue(new UnauthorizedException()) };
    const guard = new AccessTokenGuard(reflector as never, tokens as never, {} as never);
    await expect(guard.canActivate(contextFor({ headers: { authorization: 'Bearer invalid' } })))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('attaches verified claims when the optional request is authenticated', async () => {
    const claims = { userId: '019a0000-0000-7000-8000-000000000099', sessionId: 'session-1' };
    const request: { headers: { authorization?: string }; auth?: unknown } = {
      headers: { authorization: 'Bearer valid' },
    };
    const reflector = { getAllAndOverride: vi.fn((key: string) => key === 'satori.optionalAuthRoute') };
    const limit = vi.fn().mockResolvedValue([{ sessionId: claims.sessionId, userId: claims.userId }]);
    const infrastructure = {
      database: {
        select: vi.fn(() => ({
          from: () => ({ innerJoin: () => ({ where: () => ({ limit }) }) }),
        })),
      },
    };
    const guard = new AccessTokenGuard(
      reflector as never,
      { verify: vi.fn().mockResolvedValue(claims) } as never,
      infrastructure as never,
    );

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.auth).toEqual(claims);
  });
});
