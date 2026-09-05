import { describe, expect, it, vi } from 'vitest';
import { ConsentGuard } from './consent.guard.js';

describe('ConsentGuard', () => {
  it('does not apply end-user legal-consent checks to the restricted operations service identity', async () => {
    const request = { operationsService: true, auth: { userId: '00000000-0000-4000-8000-000000000001' } };
    const context = {
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
      switchToHttp: () => ({ getRequest: () => request }),
    } as never;
    const database = { select: vi.fn() };
    const guard = new ConsentGuard({ getAllAndOverride: vi.fn(() => false) } as never, { database } as never);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(database.select).not.toHaveBeenCalled();
  });
});
