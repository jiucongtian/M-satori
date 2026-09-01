import { Injectable } from '@nestjs/common';
import { RuntimeInfrastructure } from '@satori/infrastructure';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PaymentPayerAuthorizer } from '../application/index.js';
import { PaymentError } from '../domain/index.js';

type StatePayload = { userId: string; returnPath: string; expiresAt: number };

@Injectable()
export class WechatPayerAuthorizer implements PaymentPayerAuthorizer {
  constructor(private readonly infrastructure: RuntimeInfrastructure) {}

  prepare(ownerUserId: string, returnPath: string) {
    const env = this.infrastructure.environment;
    if (env.PAYMENT_PROVIDER_MODE !== 'WECHAT_PAY')
      return Promise.resolve({ required: false, authorizationUrl: null });
    const safePath = this.safeReturnPath(returnPath);
    const state = this.signState({
      userId: ownerUserId,
      returnPath: safePath,
      expiresAt: Date.now() + 10 * 60_000,
    });
    const callback = `${env.WECHAT_OAUTH_REDIRECT_ORIGIN}/api/v1/payment-payer/wechat/callback`;
    const query = new URLSearchParams({
      appid: env.WECHAT_APP_ID!,
      redirect_uri: callback,
      response_type: 'code',
      scope: 'snsapi_base',
      state,
    });
    return Promise.resolve({
      required: true,
      authorizationUrl: `https://open.weixin.qq.com/connect/oauth2/authorize?${query.toString()}#wechat_redirect`,
    });
  }

  provider(): 'FAKE' | 'WECHAT_PAY' {
    return this.infrastructure.environment.PAYMENT_PROVIDER_MODE;
  }

  async complete(code: string, state: string) {
    const payload = this.verifyState(state);
    if (!/^[0-9A-Za-z_-]{8,256}$/.test(code))
      throw new PaymentError('WECHAT_OAUTH_CODE_INVALID', 'WeChat OAuth code is invalid');
    const env = this.infrastructure.environment;
    const query = new URLSearchParams({
      appid: env.WECHAT_APP_ID!,
      secret: env.WECHAT_APP_SECRET!,
      code,
      grant_type: 'authorization_code',
    });
    let response: Response;
    try {
      response = await fetch(`https://api.weixin.qq.com/sns/oauth2/access_token?${query.toString()}`, {
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new PaymentError('WECHAT_OAUTH_UNAVAILABLE', 'WeChat OAuth request failed');
    }
    const result = (await response.json()) as { openid?: unknown; errcode?: unknown };
    if (!response.ok || typeof result.openid !== 'string' || !result.openid) {
      const providerCode =
        typeof result.errcode === 'number' || typeof result.errcode === 'string'
          ? result.errcode
          : response.status;
      throw new PaymentError('WECHAT_OAUTH_REJECTED', `WeChat OAuth rejected the request (${providerCode})`);
    }
    const ticket = randomBytes(32).toString('base64url');
    await this.infrastructure.redis.set(
      `payment:payer:${ticket}`,
      JSON.stringify({ userId: payload.userId, openid: result.openid }),
      'EX',
      600,
      'NX',
    );
    const url = new URL(payload.returnPath, env.WECHAT_OAUTH_REDIRECT_ORIGIN);
    url.searchParams.set('wechatPaymentTicket', ticket);
    return url.toString();
  }

  async resolve(ownerUserId: string, ticket: string | undefined) {
    if (this.infrastructure.environment.PAYMENT_PROVIDER_MODE !== 'WECHAT_PAY') return null;
    if (!ticket) throw new PaymentError('WECHAT_PAYER_REQUIRED', 'WeChat payer authorization is required');
    const key = `payment:payer:${ticket}`;
    const encoded = await this.infrastructure.redis.getdel(key);
    if (!encoded)
      throw new PaymentError('WECHAT_PAYER_TICKET_INVALID', 'WeChat payer authorization expired or was used');
    const value = JSON.parse(encoded) as { userId?: unknown; openid?: unknown };
    if (value.userId !== ownerUserId || typeof value.openid !== 'string')
      throw new PaymentError('WECHAT_PAYER_TICKET_INVALID', 'WeChat payer authorization does not match');
    return value.openid;
  }

  private safeReturnPath(value: string) {
    const url = new URL(value, 'https://satori.invalid');
    if (url.origin !== 'https://satori.invalid' || url.pathname !== '/checkout')
      throw new PaymentError('WECHAT_RETURN_PATH_INVALID', 'WeChat return path is invalid');
    url.searchParams.delete('code');
    url.searchParams.delete('state');
    url.searchParams.delete('wechatPaymentTicket');
    return `${url.pathname}${url.search}`;
  }

  private signState(payload: StatePayload) {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${encoded}.${this.mac(encoded)}`;
  }

  private verifyState(state: string): StatePayload {
    const [encoded, signature] = state.split('.');
    if (!encoded || !signature)
      throw new PaymentError('WECHAT_OAUTH_STATE_INVALID', 'WeChat OAuth state is invalid');
    const expected = Buffer.from(this.mac(encoded));
    const actual = Buffer.from(signature);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new PaymentError('WECHAT_OAUTH_STATE_INVALID', 'WeChat OAuth state is invalid');
    let payload: StatePayload;
    try {
      payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as StatePayload;
    } catch {
      throw new PaymentError('WECHAT_OAUTH_STATE_INVALID', 'WeChat OAuth state is invalid');
    }
    if (!payload.userId || !payload.returnPath || payload.expiresAt < Date.now())
      throw new PaymentError('WECHAT_OAUTH_STATE_EXPIRED', 'WeChat OAuth state expired');
    return payload;
  }

  private mac(value: string) {
    return createHmac('sha256', this.infrastructure.environment.AUTH_HMAC_SECRET)
      .update(`wechat-oauth:${value}`)
      .digest('base64url');
  }
}
