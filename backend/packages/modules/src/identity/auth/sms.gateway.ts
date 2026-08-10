import { Injectable } from '@nestjs/common';
import { RuntimeInfrastructure } from '@satori/infrastructure';

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
