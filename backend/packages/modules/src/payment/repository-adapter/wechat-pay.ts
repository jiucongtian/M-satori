import type {
  ProviderPaymentResult,
  ProviderRefundRequest,
  ProviderRefundResult,
  ProviderWebhookEvent,
} from '@satori/application';
import { createDecipheriv, randomBytes, sign, verify, type KeyObject } from 'node:crypto';
import { PaymentError } from '../domain/index.js';

type CryptoKey = string | KeyObject;
type FetchLike = typeof fetch;

export interface WechatPayConfig {
  merchantId: string;
  appId: string;
  apiV3Key: string;
  merchantPrivateKey: CryptoKey;
  merchantSerialNo: string;
  publicKey: CryptoKey;
  publicKeyId: string;
  notifyUrl: string;
  apiBaseUrl?: string;
  fetch?: FetchLike;
  now?: () => Date;
  nonce?: () => string;
  requestTimeoutMs?: number;
}

interface WechatTransaction {
  appid?: string;
  mchid?: string;
  out_trade_no?: string;
  transaction_id?: string;
  trade_state?: string;
  trade_state_desc?: string;
  success_time?: string;
  attach?: string;
  amount?: { total?: number; payer_total?: number; currency?: string; payer_currency?: string };
}

interface WechatRefund {
  refund_id?: string;
  out_refund_no?: string;
  status?: string;
}

interface WechatNotification {
  id?: string;
  event_type?: string;
  resource?: {
    algorithm?: string;
    ciphertext?: string;
    nonce?: string;
    associated_data?: string;
  };
}

export function merchantReference(id: string) {
  const value = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ? id.replaceAll('-', '')
    : id.replace(/[^0-9A-Za-z_\-|*]/g, '');
  if (value.length < 6 || value.length > 32)
    throw new PaymentError('WECHAT_MERCHANT_REFERENCE_INVALID', 'Merchant reference must be 6-32 characters');
  return value;
}

export function buildWechatAuthorization(
  config: Pick<WechatPayConfig, 'merchantId' | 'merchantPrivateKey' | 'merchantSerialNo'>,
  method: string,
  canonicalUrl: string,
  body: string,
  timestamp: string,
  nonce: string,
) {
  const message = `${method.toUpperCase()}\n${canonicalUrl}\n${timestamp}\n${nonce}\n${body}\n`;
  const signature = sign('RSA-SHA256', Buffer.from(message), config.merchantPrivateKey).toString('base64');
  return `WECHATPAY2-SHA256-RSA2048 mchid="${config.merchantId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${config.merchantSerialNo}",signature="${signature}"`;
}

export function verifyWechatSignature(
  publicKey: CryptoKey,
  timestamp: string,
  nonce: string,
  body: string,
  signature: string,
) {
  return verify(
    'RSA-SHA256',
    Buffer.from(`${timestamp}\n${nonce}\n${body}\n`),
    publicKey,
    Buffer.from(signature, 'base64'),
  );
}

export function decryptWechatResource(
  apiV3Key: string,
  resource: NonNullable<WechatNotification['resource']>,
) {
  if (resource.algorithm !== 'AEAD_AES_256_GCM' || !resource.ciphertext || !resource.nonce)
    throw new PaymentError('WECHAT_RESOURCE_INVALID', 'WeChat encrypted resource is incomplete');
  const encrypted = Buffer.from(resource.ciphertext, 'base64');
  if (encrypted.length <= 16)
    throw new PaymentError('WECHAT_RESOURCE_INVALID', 'WeChat encrypted resource is invalid');
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(apiV3Key, 'utf8'),
      Buffer.from(resource.nonce, 'utf8'),
    );
    decipher.setAuthTag(encrypted.subarray(encrypted.length - 16));
    decipher.setAAD(Buffer.from(resource.associated_data ?? '', 'utf8'));
    return JSON.parse(
      Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString('utf8'),
    ) as Record<string, unknown>;
  } catch {
    throw new PaymentError(
      'WECHAT_RESOURCE_DECRYPTION_FAILED',
      'WeChat encrypted resource failed authentication',
    );
  }
}

export function parseWechatWebhook(
  config: Pick<WechatPayConfig, 'merchantId' | 'appId' | 'publicKey' | 'publicKeyId' | 'apiV3Key' | 'now'>,
  headers: Readonly<Record<string, string>>,
  body: string,
): Promise<ProviderWebhookEvent> {
  verifyWechatEnvelope(config, headers, body);
  const envelope = parseJson<WechatNotification>(body, 'WECHAT_NOTIFICATION_INVALID');
  if (!envelope.id || !envelope.resource)
    throw new PaymentError('WECHAT_NOTIFICATION_INVALID', 'WeChat notification envelope is incomplete');
  if (envelope.event_type !== 'TRANSACTION.SUCCESS')
    throw new PaymentError('WECHAT_NOTIFICATION_UNSUPPORTED', 'WeChat notification type is unsupported');
  const transaction = decryptWechatResource(config.apiV3Key, envelope.resource) as WechatTransaction;
  assertTransaction(config.merchantId, transaction, true, config.appId);
  return Promise.resolve({
    providerEventId: envelope.id,
    providerAttemptId: transaction.out_trade_no!,
    orderId: transaction.attach!,
    state: mapWechatTradeState(transaction.trade_state),
    amountMinor: transaction.amount!.payer_total ?? transaction.amount!.total!,
    currency: 'CNY',
    occurredAt: new Date(transaction.success_time!),
    verificationSnapshot: {
      algorithm: 'WECHATPAY2-SHA256-RSA2048',
      publicKeyId: config.publicKeyId,
      merchantId: config.merchantId,
      eventType: envelope.event_type,
    },
    minimalPayload: JSON.stringify({
      eventId: envelope.id,
      outTradeNo: transaction.out_trade_no,
      transactionId: transaction.transaction_id,
      tradeState: transaction.trade_state,
    }),
  });
}

export async function queryWechatPayment(
  config: WechatPayConfig,
  providerAttemptId: string,
): Promise<ProviderPaymentResult> {
  const outTradeNo = merchantReference(providerAttemptId);
  const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}?mchid=${encodeURIComponent(config.merchantId)}`;
  const transaction = await requestWechatJson<WechatTransaction>(config, 'GET', path);
  assertTransaction(config.merchantId, transaction, false, config.appId);
  return {
    providerAttemptId: outTradeNo,
    state: mapWechatTradeState(transaction.trade_state),
    ...(transaction.attach ? { orderId: transaction.attach } : {}),
    ...(transaction.amount?.payer_total !== undefined
      ? { amountMinor: transaction.amount.payer_total }
      : transaction.amount?.total !== undefined
        ? { amountMinor: transaction.amount.total }
        : {}),
    currency: 'CNY',
    ...(transaction.success_time ? { providerOccurredAt: new Date(transaction.success_time) } : {}),
  };
}

export async function requestWechatRefund(
  config: WechatPayConfig,
  request: ProviderRefundRequest,
): Promise<ProviderRefundResult> {
  if (
    !Number.isInteger(request.amountMinor) ||
    !Number.isInteger(request.originalAmountMinor) ||
    request.amountMinor <= 0 ||
    request.originalAmountMinor < request.amountMinor
  )
    throw new PaymentError('WECHAT_REFUND_AMOUNT_INVALID', 'WeChat refund amount is invalid');
  const outRefundNo = merchantReference(request.refundId);
  const body = JSON.stringify({
    out_trade_no: merchantReference(request.providerAttemptId),
    out_refund_no: outRefundNo,
    reason: request.reasonCode.slice(0, 80),
    amount: {
      refund: request.amountMinor,
      total: request.originalAmountMinor,
      currency: request.currency,
    },
  });
  const refund = await requestWechatJson<WechatRefund>(config, 'POST', '/v3/refund/domestic/refunds', body);
  if (refund.out_refund_no !== outRefundNo)
    throw new PaymentError('WECHAT_REFUND_FACT_MISMATCH', 'WeChat refund reference does not match');
  return { providerRefundId: outRefundNo, state: mapWechatRefundState(refund.status) };
}

export async function queryWechatRefund(config: WechatPayConfig, providerRefundId: string) {
  const outRefundNo = merchantReference(providerRefundId);
  const refund = await requestWechatJson<WechatRefund>(
    config,
    'GET',
    `/v3/refund/domestic/refunds/${encodeURIComponent(outRefundNo)}`,
  );
  if (refund.out_refund_no !== outRefundNo)
    throw new PaymentError('WECHAT_REFUND_FACT_MISMATCH', 'WeChat refund reference does not match');
  return { providerRefundId: outRefundNo, state: mapWechatRefundState(refund.status) };
}

async function requestWechatJson<T>(
  config: WechatPayConfig,
  method: 'GET' | 'POST',
  canonicalUrl: string,
  body = '',
): Promise<T> {
  const timestamp = String(Math.floor((config.now?.() ?? new Date()).getTime() / 1000));
  const nonce = config.nonce?.() ?? randomBytes(16).toString('hex');
  let response: Response;
  try {
    response = await (config.fetch ?? fetch)(
      `${config.apiBaseUrl ?? 'https://api.mch.weixin.qq.com'}${canonicalUrl}`,
      {
        method,
        headers: {
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          Authorization: buildWechatAuthorization(config, method, canonicalUrl, body, timestamp, nonce),
          'Wechatpay-Serial': config.publicKeyId,
        },
        signal: AbortSignal.timeout(config.requestTimeoutMs ?? 10_000),
        ...(body ? { body } : {}),
      },
    );
  } catch {
    throw new PaymentError('WECHAT_API_UNAVAILABLE', 'WeChat API request failed');
  }
  const responseBody = await response.text();
  verifyWechatResponse(config, response.headers, responseBody);
  if (!response.ok) {
    const detail = safeRecord(responseBody);
    const providerCode = typeof detail.code === 'string' ? detail.code : null;
    throw new PaymentError(
      'WECHAT_API_ERROR',
      `WeChat API rejected the request (${response.status}${providerCode ? ` ${providerCode}` : ''})`,
    );
  }
  return parseJson<T>(responseBody, 'WECHAT_RESPONSE_INVALID');
}

function verifyWechatResponse(
  config: Pick<WechatPayConfig, 'publicKey' | 'publicKeyId' | 'now'>,
  headers: Headers,
  body: string,
) {
  verifyWechatEnvelope(
    config,
    {
      'wechatpay-timestamp': headers.get('wechatpay-timestamp') ?? '',
      'wechatpay-nonce': headers.get('wechatpay-nonce') ?? '',
      'wechatpay-signature': headers.get('wechatpay-signature') ?? '',
      'wechatpay-serial': headers.get('wechatpay-serial') ?? '',
    },
    body,
  );
}

function verifyWechatEnvelope(
  config: Pick<WechatPayConfig, 'publicKey' | 'publicKeyId' | 'now'>,
  headers: Readonly<Record<string, string>>,
  body: string,
) {
  const timestamp = headers['wechatpay-timestamp'];
  const nonce = headers['wechatpay-nonce'];
  const signature = headers['wechatpay-signature'];
  const serial = headers['wechatpay-serial'];
  if (!timestamp || !nonce || !signature || serial !== config.publicKeyId)
    throw new PaymentError('WECHAT_SIGNATURE_INVALID', 'WeChat signature headers are invalid');
  const signedAt = Number(timestamp);
  const current = Math.floor((config.now?.() ?? new Date()).getTime() / 1000);
  if (!Number.isInteger(signedAt) || Math.abs(current - signedAt) > 300)
    throw new PaymentError(
      'WECHAT_SIGNATURE_INVALID',
      'WeChat signature timestamp is outside the allowed window',
    );
  if (!verifyWechatSignature(config.publicKey, timestamp, nonce, body, signature))
    throw new PaymentError('WECHAT_SIGNATURE_INVALID', 'WeChat signature is invalid');
}

function assertTransaction(
  merchantId: string,
  transaction: WechatTransaction,
  requireSuccess = true,
  appId?: string,
) {
  if (transaction.mchid !== merchantId)
    throw new PaymentError('WECHAT_MERCHANT_MISMATCH', 'WeChat merchant does not match');
  if (appId && transaction.appid && transaction.appid !== appId)
    throw new PaymentError('WECHAT_APP_MISMATCH', 'WeChat application does not match');
  if (
    !transaction.out_trade_no ||
    !transaction.attach ||
    !transaction.amount ||
    transaction.amount.currency !== 'CNY' ||
    !Number.isInteger(transaction.amount.payer_total ?? transaction.amount.total)
  )
    throw new PaymentError('WECHAT_PAYMENT_FACT_INVALID', 'WeChat payment fact is incomplete');
  if (requireSuccess && (transaction.trade_state !== 'SUCCESS' || !transaction.success_time))
    throw new PaymentError('WECHAT_PAYMENT_FACT_INVALID', 'WeChat success notification is inconsistent');
}

function mapWechatTradeState(state: string | undefined): ProviderPaymentResult['state'] {
  if (state === 'SUCCESS' || state === 'REFUND') return 'SUCCEEDED';
  if (state === 'NOTPAY' || state === 'USERPAYING' || state === 'ACCEPT') return 'PENDING';
  if (state === 'CLOSED' || state === 'REVOKED') return 'CANCELLED';
  return 'FAILED';
}

function mapWechatRefundState(status: string | undefined): ProviderRefundResult['state'] {
  if (status === 'SUCCESS') return 'SUCCEEDED';
  if (status === 'PROCESSING') return 'PROCESSING';
  if (status === 'CLOSED') return 'CLOSED';
  if (status === 'ABNORMAL') return 'ABNORMAL';
  return 'FAILED';
}

function parseJson<T>(body: string, code: string): T {
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new PaymentError(code, 'WeChat returned invalid JSON');
  }
}

function safeRecord(body: string): Record<string, unknown> {
  try {
    const value = JSON.parse(body) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
