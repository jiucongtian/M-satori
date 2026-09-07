import type { RuntimeInfrastructure } from '@satori/infrastructure';
import { describe, expect, it, vi } from 'vitest';
import { TencentCloudSmsGateway, type TencentCloudSmsClient } from './sms.gateway.js';

function fixture(templateParamMode: 'CODE_ONLY' | 'CODE_AND_EXPIRY_MINUTES' = 'CODE_AND_EXPIRY_MINUTES') {
  const infrastructure = {
    environment: {
      TENCENTCLOUD_SECRET_ID: 'test-secret-id',
      TENCENTCLOUD_SECRET_KEY: 'test-secret-key-safe-length',
      TENCENT_SMS_SDK_APP_ID: '1400000000',
      TENCENT_SMS_SIGN_NAME: '测试签名',
      TENCENT_SMS_TEMPLATE_ID: '1234567',
      TENCENT_SMS_REGION: 'ap-guangzhou',
      TENCENT_SMS_TEMPLATE_PARAM_MODE: templateParamMode,
      SMS_GATEWAY_TIMEOUT_MS: 5000,
    },
  } as RuntimeInfrastructure;
  const sendSms = vi.fn<TencentCloudSmsClient['SendSms']>().mockResolvedValue({
    SendStatusSet: [{ Code: 'Ok', Message: 'send success' }],
    RequestId: 'request-1',
  });
  return { gateway: new TencentCloudSmsGateway(infrastructure, { SendSms: sendSms }), sendSms };
}

describe('TencentCloudSmsGateway', () => {
  it('sends an E.164 phone number with the approved template parameters', async () => {
    const { gateway, sendSms } = fixture();

    await gateway.sendVerificationCode({
      phone: '+8613800000000',
      code: '123456',
      expiresInSeconds: 301,
    });

    expect(sendSms).toHaveBeenCalledWith({
      PhoneNumberSet: ['+8613800000000'],
      SmsSdkAppId: '1400000000',
      SignName: '测试签名',
      TemplateId: '1234567',
      TemplateParamSet: ['123456', '6'],
    });
  });

  it('supports templates containing only the verification code', async () => {
    const { gateway, sendSms } = fixture('CODE_ONLY');

    await gateway.sendVerificationCode({
      phone: '+8613800000000',
      code: '654321',
      expiresInSeconds: 300,
    });

    expect(sendSms).toHaveBeenCalledWith(expect.objectContaining({ TemplateParamSet: ['654321'] }));
  });

  it('rejects a provider-level failure even when the API request resolves', async () => {
    const infrastructure = {
      environment: {
        TENCENTCLOUD_SECRET_ID: 'test-secret-id',
        TENCENTCLOUD_SECRET_KEY: 'test-secret-key-safe-length',
        TENCENT_SMS_SDK_APP_ID: '1400000000',
        TENCENT_SMS_SIGN_NAME: '测试签名',
        TENCENT_SMS_TEMPLATE_ID: '1234567',
        TENCENT_SMS_REGION: 'ap-guangzhou',
        TENCENT_SMS_TEMPLATE_PARAM_MODE: 'CODE_ONLY',
        SMS_GATEWAY_TIMEOUT_MS: 5000,
      },
    } as RuntimeInfrastructure;
    const client: TencentCloudSmsClient = {
      SendSms: vi.fn().mockResolvedValue({
        SendStatusSet: [{ Code: 'FailedOperation.TemplateIncorrectOrUnapproved' }],
        RequestId: 'request-failed',
      }),
    };

    await expect(
      new TencentCloudSmsGateway(infrastructure, client).sendVerificationCode({
        phone: '+8613800000000',
        code: '123456',
        expiresInSeconds: 300,
      }),
    ).rejects.toThrow('FailedOperation.TemplateIncorrectOrUnapproved');
  });
});
