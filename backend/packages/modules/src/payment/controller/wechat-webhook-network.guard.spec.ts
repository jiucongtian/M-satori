import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { WechatWebhookNetworkGuard } from './wechat-webhook-network.guard.js';

describe('WechatWebhookNetworkGuard', () => {
  const guard = new WechatWebhookNetworkGuard(new Set(['127.0.0.1', '10.0.0.8']));

  function context(ip: string) {
    return {
      switchToHttp: () => ({ getRequest: () => ({ ip }) }),
    } as unknown as ExecutionContext;
  }

  it('accepts only the configured reverse proxy addresses', () => {
    expect(guard.canActivate(context('127.0.0.1'))).toBe(true);
    expect(() => guard.canActivate(context('203.0.113.9'))).toThrow();
  });
});
