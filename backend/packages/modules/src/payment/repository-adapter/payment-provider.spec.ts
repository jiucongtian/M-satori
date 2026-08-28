import { createCipheriv, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  buildWechatAuthorization,
  DeterministicFakePaymentProvider,
  merchantReference,
  parseWechatWebhook,
  verifyWechatSignature,
  WechatPayAdapter,
} from './index.js';
import type { WechatPayConfig } from './wechat-pay.js';

describe('payment providers', () => {
  it('supports deterministic pending, injected success and synchronous fake refund', async () => {
    const provider = new DeterministicFakePaymentProvider();
    const created = await provider.createPayment({
      attemptId: 'attempt-1',
      orderId: 'order-1',
      amountMinor: 9900,
      currency: 'CNY',
      description: 'test',
      expiresAt: new Date('2026-08-29T01:00:00.000Z'),
    });
    expect(created).toMatchObject({ state: 'PENDING', amountMinor: 9900, orderId: 'order-1' });
    provider.setResult(created.providerAttemptId, 'SUCCEEDED');
    expect(await provider.queryPayment(created.providerAttemptId)).toMatchObject({ state: 'SUCCEEDED' });
    expect(
      await provider.refund({
        refundId: 'refund-1',
        orderId: 'order-1',
        providerAttemptId: created.providerAttemptId,
        amountMinor: 9900,
        originalAmountMinor: 9900,
        currency: 'CNY',
        reasonCode: 'TEST',
      }),
    ).toEqual({ providerRefundId: 'fake-refund-refund-1', state: 'SUCCEEDED' });
  });

  it('builds an API v3 merchant authorization over the canonical request', () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const authorization = buildWechatAuthorization(
      { merchantId: '1900000001', merchantPrivateKey: privateKey, merchantSerialNo: 'SERIAL001' },
      'POST',
      '/v3/refund/domestic/refunds',
      '{"amount":1}',
      '1787961600',
      'nonce-1',
    );
    const signature = authorization.match(/signature="([^"]+)"/)?.[1];
    expect(authorization).toContain('mchid="1900000001"');
    expect(authorization).toContain('serial_no="SERIAL001"');
    expect(
      verify(
        'RSA-SHA256',
        Buffer.from('POST\n/v3/refund/domestic/refunds\n1787961600\nnonce-1\n{"amount":1}\n'),
        publicKey,
        Buffer.from(signature!, 'base64'),
      ),
    ).toBe(true);
  });

  it('verifies and decrypts an API v3 transaction notification into minimal facts', async () => {
    const fixture = wechatFixture();
    const transaction = {
      mchid: fixture.config.merchantId,
      appid: fixture.config.appId,
      out_trade_no: '12345678901234567890123456789012',
      transaction_id: '4200000000202608290000000001',
      trade_state: 'SUCCESS',
      success_time: '2026-08-29T08:00:00+08:00',
      attach: '00000000-0000-4000-8000-000000000001',
      amount: { total: 9900, payer_total: 9900, currency: 'CNY', payer_currency: 'CNY' },
      payer: { openid: 'must-not-persist' },
    };
    const body = JSON.stringify({
      id: 'EV-20260829-0001',
      event_type: 'TRANSACTION.SUCCESS',
      resource: encryptResource(fixture.config.apiV3Key, transaction),
      summary: '支付成功',
    });
    const headers = fixture.signedHeaders(body);
    expect(
      verifyWechatSignature(
        fixture.platformPublicKey,
        headers['wechatpay-timestamp'],
        headers['wechatpay-nonce'],
        body,
        headers['wechatpay-signature'],
      ),
    ).toBe(true);
    const event = await parseWechatWebhook(fixture.config, headers, body);
    expect(event).toMatchObject({
      providerEventId: 'EV-20260829-0001',
      providerAttemptId: transaction.out_trade_no,
      orderId: transaction.attach,
      state: 'SUCCEEDED',
      amountMinor: 9900,
      currency: 'CNY',
    });
    expect(event.minimalPayload).not.toContain('openid');
    expect(event.verificationSnapshot).toMatchObject({
      publicKeyId: fixture.config.publicKeyId,
      merchantId: fixture.config.merchantId,
    });
    await expect(
      Promise.resolve().then(() =>
        parseWechatWebhook(fixture.config, { ...headers, 'wechatpay-signature': 'invalid' }, body),
      ),
    ).rejects.toMatchObject({ code: 'WECHAT_SIGNATURE_INVALID' });
    await expect(
      Promise.resolve().then(() =>
        parseWechatWebhook({ ...fixture.config, apiV3Key: 'x'.repeat(32) }, headers, body),
      ),
    ).rejects.toMatchObject({ code: 'WECHAT_RESOURCE_DECRYPTION_FAILED' });
  });

  it('signs, verifies and maps active order and asynchronous refund API responses', async () => {
    const fixture = wechatFixture();
    const calls: Array<{ url: URL; method: string; body: string }> = [];
    const outTradeNo = merchantReference('00000000-0000-4000-8000-000000000010');
    const outRefundNo = merchantReference('00000000-0000-4000-8000-000000000020');
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? init.body : '';
      const headers = new Headers(init?.headers);
      calls.push({ url, method, body });
      expect(headers.get('wechatpay-serial')).toBe(fixture.config.publicKeyId);
      verifyMerchantAuthorization(
        fixture.merchantPublicKey,
        headers.get('authorization') ?? '',
        method,
        `${url.pathname}${url.search}`,
        body,
      );

      let payload: Record<string, unknown>;
      if (url.pathname.includes('/pay/transactions/out-trade-no/')) {
        payload = {
          mchid: fixture.config.merchantId,
          out_trade_no: outTradeNo,
          trade_state: 'SUCCESS',
          success_time: '2026-08-29T08:00:00+08:00',
          attach: '00000000-0000-4000-8000-000000000011',
          amount: { total: 1290, payer_total: 1290, currency: 'CNY' },
        };
      } else if (method === 'POST') {
        const submitted = JSON.parse(body) as Record<string, unknown>;
        expect(submitted).toMatchObject({
          out_trade_no: outTradeNo,
          out_refund_no: outRefundNo,
          amount: { refund: 500, total: 1290, currency: 'CNY' },
        });
        payload = {
          refund_id: '5030000000202608290000000001',
          out_refund_no: outRefundNo,
          status: 'PROCESSING',
        };
      } else {
        payload = {
          refund_id: '5030000000202608290000000001',
          out_refund_no: outRefundNo,
          status: 'SUCCESS',
        };
      }
      const responseBody = JSON.stringify(payload);
      return Promise.resolve(
        new Response(responseBody, { status: 200, headers: fixture.signedHeaders(responseBody) }),
      );
    });
    const adapter = new WechatPayAdapter({ ...fixture.config, fetch: fetchMock });

    await expect(adapter.queryPayment(outTradeNo)).resolves.toMatchObject({
      providerAttemptId: outTradeNo,
      state: 'SUCCEEDED',
      amountMinor: 1290,
    });
    await expect(
      adapter.refund({
        refundId: '00000000-0000-4000-8000-000000000020',
        orderId: '00000000-0000-4000-8000-000000000011',
        providerAttemptId: outTradeNo,
        amountMinor: 500,
        originalAmountMinor: 1290,
        currency: 'CNY',
        reasonCode: 'CUSTOMER_REQUEST_UNUSED',
      }),
    ).resolves.toEqual({ providerRefundId: outRefundNo, state: 'PROCESSING' });
    await expect(adapter.queryRefund(outRefundNo)).resolves.toEqual({
      providerRefundId: outRefundNo,
      state: 'SUCCEEDED',
    });
    expect(calls).toHaveLength(3);
  });
});

function wechatFixture() {
  const merchant = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const platform = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const config: WechatPayConfig = {
    merchantId: '1900000001',
    appId: 'wx1234567890abcdef',
    apiV3Key: '12345678901234567890123456789012',
    merchantPrivateKey: merchant.privateKey,
    merchantSerialNo: 'MERCHANTSERIAL001',
    publicKey: platform.publicKey,
    publicKeyId: 'PUB_KEY_ID_001',
    notifyUrl: 'https://pay.example.com/api/v1/internal/payment-webhooks/wechat',
    now: () => new Date('2026-08-29T00:00:00.000Z'),
    nonce: () => 'fixed-request-nonce',
  };
  return {
    config,
    merchantPublicKey: merchant.publicKey,
    platformPublicKey: platform.publicKey,
    signedHeaders(body: string) {
      const timestamp = '1787961600';
      const nonce = 'fixed-response-nonce';
      const signature = sign(
        'RSA-SHA256',
        Buffer.from(`${timestamp}\n${nonce}\n${body}\n`),
        platform.privateKey,
      ).toString('base64');
      return {
        'wechatpay-timestamp': timestamp,
        'wechatpay-nonce': nonce,
        'wechatpay-signature': signature,
        'wechatpay-serial': config.publicKeyId,
      };
    },
  };
}

function encryptResource(apiV3Key: string, value: unknown) {
  const nonce = '0123456789ab';
  const associatedData = 'transaction';
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(apiV3Key), Buffer.from(nonce));
  cipher.setAAD(Buffer.from(associatedData));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString('base64');
  return {
    algorithm: 'AEAD_AES_256_GCM',
    ciphertext,
    nonce,
    associated_data: associatedData,
  };
}

function verifyMerchantAuthorization(
  publicKey: KeyObject,
  authorization: string,
  method: string,
  canonicalUrl: string,
  body: string,
) {
  const fields = Object.fromEntries(
    [...authorization.matchAll(/([a-z_]+)="([^"]+)"/g)].map((match) => [match[1]!, match[2]!]),
  );
  expect(fields.mchid).toBe('1900000001');
  expect(fields.serial_no).toBe('MERCHANTSERIAL001');
  expect(
    verify(
      'RSA-SHA256',
      Buffer.from(`${method}\n${canonicalUrl}\n${fields.timestamp}\n${fields.nonce_str}\n${body}\n`),
      publicKey,
      Buffer.from(fields.signature!, 'base64'),
    ),
  ).toBe(true);
}
