import { generateKeyPairSync, sign, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DeterministicFakePaymentProvider,
  parseWechatWebhook,
  verifyWechatSignature,
  WechatPayAdapter,
} from './index.js';

describe('payment providers', () => {
  it('supports deterministic pending, injected success and refund', async () => {
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
        currency: 'CNY',
        reasonCode: 'TEST',
      }),
    ).toEqual({ providerRefundId: 'fake-refund-refund-1' });
  });

  it('verifies WeChat RSA signature and merchant before returning a minimal fact', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const adapter = new WechatPayAdapter({ merchantId: 'merchant-1', publicKey });
    const body = JSON.stringify({
      eventId: 'event-1',
      providerAttemptId: 'provider-1',
      orderId: 'order-1',
      merchantId: 'merchant-1',
      state: 'SUCCEEDED',
      amountMinor: 9900,
      occurredAt: '2026-08-29T00:00:00.000Z',
      sensitiveCustomerName: 'must-not-persist',
    });
    const timestamp = '1787961600';
    const nonce = 'nonce-1';
    const signature = sign(
      'RSA-SHA256',
      Buffer.from(`${timestamp}\n${nonce}\n${body}\n`),
      privateKey,
    ).toString('base64');
    expect(
      verify(
        'RSA-SHA256',
        Buffer.from(`${timestamp}\n${nonce}\n${body}\n`),
        publicKey,
        Buffer.from(signature, 'base64'),
      ),
    ).toBe(true);
    expect(verifyWechatSignature(publicKey, timestamp, nonce, body, signature)).toBe(true);
    const event = await parseWechatWebhook(
      { merchantId: 'merchant-1', publicKey },
      { 'wechatpay-timestamp': timestamp, 'wechatpay-nonce': nonce, 'wechatpay-signature': signature },
      body,
    );
    expect(event.minimalPayload).not.toContain('sensitiveCustomerName');
    await expect(
      Promise.resolve().then(() =>
        adapter.verifyWebhook(
          { 'wechatpay-timestamp': timestamp, 'wechatpay-nonce': nonce, 'wechatpay-signature': 'invalid' },
          body,
        ),
      ),
    ).rejects.toMatchObject({ code: 'WECHAT_SIGNATURE_INVALID' });
  });
});
