import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RuntimeInfrastructure } from '@satori/infrastructure';
import { AccessTokenGuard } from './auth/access-token.guard.js';
import { AccessTokenService } from './auth/access-token.service.js';
import { AuthCrypto } from './auth/auth.crypto.js';
import { DevelopmentSmsGateway, HttpSmsGateway, SMS_GATEWAY } from './auth/sms.gateway.js';
import { SmsChallengeController } from './auth/sms-challenge.controller.js';
import { SmsChallengeService } from './auth/sms-challenge.service.js';
import { SmsRateLimiter } from './auth/sms-rate-limiter.js';
import { SessionController } from './auth/session.controller.js';
import { SessionService } from './auth/session.service.js';
import { ConsentGuard } from './auth/consent.guard.js';
import { MeController } from './me/me.controller.js';
import { MeService } from './me/me.service.js';

@Global()
@Module({
  controllers: [SmsChallengeController, SessionController, MeController],
  providers: [
    AuthCrypto,
    AccessTokenService,
    SessionService,
    MeService,
    SmsRateLimiter,
    SmsChallengeService,
    {
      provide: SMS_GATEWAY,
      inject: [RuntimeInfrastructure],
      useFactory: (infrastructure: RuntimeInfrastructure) =>
        infrastructure.environment.SMS_DELIVERY_MODE === 'GATEWAY'
          ? new HttpSmsGateway(infrastructure)
          : new DevelopmentSmsGateway(),
    },
    { provide: APP_GUARD, useClass: AccessTokenGuard },
    { provide: APP_GUARD, useClass: ConsentGuard },
  ],
  exports: [AuthCrypto, AccessTokenService, SmsChallengeService],
})
export class IdentityModule {}
