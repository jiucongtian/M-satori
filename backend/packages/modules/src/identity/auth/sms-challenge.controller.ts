import { BadRequestException, Body, Controller, Headers, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Public } from '@satori/contracts';
import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SmsChallengeService } from './sms-challenge.service.js';

class PhoneDto {
  @IsString()
  countryCode!: string;

  @IsString()
  nationalNumber!: string;
}

class DeviceDto {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  deviceId!: string;

  @IsString()
  timezone!: string;

  @IsOptional()
  @IsString()
  appVersion?: string;
}

class CreateSmsChallengeDto {
  @ValidateNested()
  @Type(() => PhoneDto)
  phone!: PhoneDto;

  @IsIn(['LOGIN', 'ACCOUNT_DELETION', 'SECURITY_CONFIRMATION'])
  purpose!: 'LOGIN' | 'ACCOUNT_DELETION' | 'SECURITY_CONFIRMATION';

  @ValidateNested()
  @Type(() => DeviceDto)
  device!: DeviceDto;
}

@Controller('auth/sms-challenges')
export class SmsChallengeController {
  constructor(private readonly challenges: SmsChallengeService) {}

  @Public()
  @Post()
  @HttpCode(202)
  async create(
    @Body() body: CreateSmsChallengeDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SmsChallengeResultBody> {
    if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 128) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'A 16-128 character Idempotency-Key is required',
      });
    }
    if (body.purpose !== 'LOGIN') {
      throw new BadRequestException({
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authenticated purpose is not available on the public challenge route',
      });
    }
    const result = await this.challenges.issue({
      countryCode: body.phone.countryCode,
      nationalNumber: body.phone.nationalNumber,
      purpose: body.purpose,
      deviceId: body.device.deviceId,
      deviceTimezone: body.device.timezone,
      ip: request.ip,
      idempotencyKey,
    });
    reply.header('X-RateLimit-Limit', result.body.rateLimit.limit);
    reply.header('X-RateLimit-Remaining', result.body.rateLimit.remaining);
    reply.header('X-RateLimit-Reset', result.body.rateLimit.resetAt);
    return result.body.data;
  }
}

type SmsChallengeResultBody = {
  challengeId: string;
  expiresAt: string;
  resendAvailableAt: string;
  phoneMasked: string;
};
