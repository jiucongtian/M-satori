import { afterEach, describe, expect, it, vi } from 'vitest';
import { WechatPayerAuthorizer } from './wechat-payer-authorizer.js';

describe('WechatPayerAuthorizer', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('creates a server callback URL, exchanges code, and issues a one-time user-bound ticket', async () => {
    const values = new Map<string, string>();
    const infrastructure = {
      environment: {
        PAYMENT_PROVIDER_MODE: 'WECHAT_PAY',
        WECHAT_APP_ID: 'wx1234567890abcdef',
        WECHAT_APP_SECRET: 'server-only-app-secret',
        WECHAT_OAUTH_REDIRECT_ORIGIN: 'https://test.example.com',
        AUTH_HMAC_SECRET: 'test-auth-hmac-secret-at-least-32-characters',
      },
      redis: {
        set: vi.fn((key: string, value: string) => {
          values.set(key, value);
          return Promise.resolve('OK');
        }),
        getdel: vi.fn((key: string) => {
          const value = values.get(key) ?? null;
          values.delete(key);
          return Promise.resolve(value);
        }),
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        expect(url).toContain('api.weixin.qq.com/sns/oauth2/access_token');
        expect(url).toContain('secret=server-only-app-secret');
        return Promise.resolve(new Response(JSON.stringify({ openid: 'openid-private' }), { status: 200 }));
      }),
    );
    const service = new WechatPayerAuthorizer(infrastructure as never);
    const prepared = await service.prepare('user-1', '/checkout?offeringId=offer-1');
    expect(prepared.authorizationUrl).toContain('scope=snsapi_base');
    expect(prepared.authorizationUrl).not.toContain('server-only-app-secret');
    const state = new URL(prepared.authorizationUrl!).searchParams.get('state')!;
    const redirect = await service.complete('oauth-code-123456', state);
    const ticket = new URL(redirect).searchParams.get('wechatPaymentTicket')!;
    await expect(service.resolve('user-1', ticket)).resolves.toBe('openid-private');
    await expect(service.resolve('user-1', ticket)).rejects.toMatchObject({
      code: 'WECHAT_PAYER_TICKET_INVALID',
    });
  });

  it('rejects an external return URL', () => {
    const service = new WechatPayerAuthorizer({
      environment: { PAYMENT_PROVIDER_MODE: 'WECHAT_PAY' },
    } as never);
    expect(() => service.prepare('user-1', 'https://evil.example/checkout')).toThrowError(
      expect.objectContaining({
        code: 'WECHAT_RETURN_PATH_INVALID',
      }),
    );
  });
});
