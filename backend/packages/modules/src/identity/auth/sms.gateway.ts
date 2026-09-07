import { Injectable, Logger } from '@nestjs/common';
import { RuntimeInfrastructure } from '@satori/infrastructure';
import { sms } from 'tencentcloud-sdk-nodejs-sms';

export interface SmsGateway {
  sendVerificationCode(input: { phone: string; code: string; expiresInSeconds: number }): Promise<void>;
}

export const SMS_GATEWAY = Symbol('SMS_GATEWAY');

@Injectable()
export class DevelopmentSmsGateway implements SmsGateway {
  sendVerificationCode(): Promise<void> {
    // The deterministic code is documented for local testing; never log phone numbers or codes.
    return Promise.resolve();
  }
}

export class HttpSmsGateway implements SmsGateway {
  constructor(private readonly infrastructure: RuntimeInfrastructure) {}

  async sendVerificationCode(input: {
    phone: string;
    code: string;
    expiresInSeconds: number;
  }): Promise<void> {
    const environment = this.infrastructure.environment;
    if (!environment.SMS_GATEWAY_URL || !environment.SMS_GATEWAY_API_KEY) {
      throw new Error('SMS gateway is not configured');
    }
    const response = await fetch(environment.SMS_GATEWAY_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${environment.SMS_GATEWAY_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(environment.SMS_GATEWAY_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`SMS provider returned ${response.status}`);
  }
}

export interface TencentCloudSmsClient {
  SendSms(input: {
    PhoneNumberSet: string[];
    SmsSdkAppId: string;
    SignName: string;
    TemplateId: string;
    TemplateParamSet: string[];
  }): Promise<{
    SendStatusSet?: Array<{ Code?: string; Message?: string }>;
    RequestId?: string;
  }>;
}

export class TencentCloudSmsGateway implements SmsGateway {
  private readonly client: TencentCloudSmsClient;
  private readonly logger = new Logger(TencentCloudSmsGateway.name);

  constructor(
    private readonly infrastructure: RuntimeInfrastructure,
    client?: TencentCloudSmsClient,
  ) {
    const environment = infrastructure.environment;
    if (!environment.TENCENTCLOUD_SECRET_ID || !environment.TENCENTCLOUD_SECRET_KEY) {
      throw new Error('Tencent Cloud SMS credentials are not configured');
    }
    this.client =
      client ??
      new sms.v20210111.Client({
        credential: {
          secretId: environment.TENCENTCLOUD_SECRET_ID,
          secretKey: environment.TENCENTCLOUD_SECRET_KEY,
        },
        region: environment.TENCENT_SMS_REGION,
        profile: {
          signMethod: 'TC3-HMAC-SHA256',
          httpProfile: {
            endpoint: 'sms.tencentcloudapi.com',
            reqMethod: 'POST',
            reqTimeout: Math.max(1, Math.ceil(environment.SMS_GATEWAY_TIMEOUT_MS / 1000)),
          },
        },
      });
  }

  async sendVerificationCode(input: {
    phone: string;
    code: string;
    expiresInSeconds: number;
  }): Promise<void> {
    const environment = this.infrastructure.environment;
    if (
      !environment.TENCENT_SMS_SDK_APP_ID ||
      !environment.TENCENT_SMS_SIGN_NAME ||
      !environment.TENCENT_SMS_TEMPLATE_ID
    ) {
      throw new Error('Tencent Cloud SMS application is not configured');
    }
    const templateParameters =
      environment.TENCENT_SMS_TEMPLATE_PARAM_MODE === 'CODE_ONLY'
        ? [input.code]
        : [input.code, String(Math.ceil(input.expiresInSeconds / 60))];
    let response: Awaited<ReturnType<TencentCloudSmsClient['SendSms']>>;
    try {
      response = await this.client.SendSms({
        PhoneNumberSet: [input.phone],
        SmsSdkAppId: environment.TENCENT_SMS_SDK_APP_ID,
        SignName: environment.TENCENT_SMS_SIGN_NAME,
        TemplateId: environment.TENCENT_SMS_TEMPLATE_ID,
        TemplateParamSet: templateParameters,
      });
    } catch (error) {
      this.logger.warn(
        `tencent_sms_api_failed providerCode=${safeProviderField(error, 'code')} providerRequestId=${safeProviderField(error, 'requestId')}`,
      );
      throw error;
    }
    const status = response.SendStatusSet?.[0];
    if (response.SendStatusSet?.length !== 1 || status?.Code !== 'Ok') {
      this.logger.warn(
        `tencent_sms_send_rejected providerCode=${safeProviderValue(status?.Code)} providerRequestId=${safeProviderValue(response.RequestId)}`,
      );
      throw new Error(
        `Tencent Cloud SMS delivery failed (${status?.Code ?? 'UNKNOWN'}, request ${response.RequestId ?? 'unknown'})`,
      );
    }
  }
}

function safeProviderField(error: unknown, field: 'code' | 'requestId'): string {
  if (!error || typeof error !== 'object' || !(field in error)) return 'UNKNOWN';
  return safeProviderValue((error as Record<string, unknown>)[field]);
}

function safeProviderValue(value: unknown): string {
  if (typeof value !== 'string') return 'UNKNOWN';
  return value.replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 128) || 'UNKNOWN';
}
