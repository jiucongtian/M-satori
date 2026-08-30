import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Headers,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConsentExempt, Public } from '@satori/contracts';
import { RuntimeInfrastructure } from '@satori/infrastructure';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthenticatedRequest } from './authenticated-request.js';
import { SessionService, type SessionResponse } from './session.service.js';

class ConsentAcceptanceDto {
  @IsString()
  documentId!: string;

  @IsString()
  version!: string;
}

class SessionDeviceDto {
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

class CreateSessionDto {
  @IsString()
  challengeId!: string;

  @Matches(/^\d{6}$/)
  verificationCode!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConsentAcceptanceDto)
  consentAcceptances!: ConsentAcceptanceDto[];

  @ValidateNested()
  @Type(() => SessionDeviceDto)
  device!: SessionDeviceDto;
}

@Controller('auth/sessions')
export class SessionController {
  constructor(
    private readonly sessions: SessionService,
    private readonly infrastructure: RuntimeInfrastructure,
  ) {}

  @Public()
  @Post()
  @HttpCode(201)
  async create(
    @Body() body: CreateSessionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionResponse> {
    this.requireIdempotencyKey(idempotencyKey);
    const result = await this.sessions.create({
      challengeId: body.challengeId,
      verificationCode: body.verificationCode,
      consentAcceptances: body.consentAcceptances,
      deviceId: body.device.deviceId,
      timezone: body.device.timezone,
      idempotencyKey,
    });
    this.setRefreshCookie(reply, result.refreshToken);
    return result.data;
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Pick<SessionResponse, 'accessToken' | 'accessTokenExpiresAt' | 'sessionId'>> {
    const refreshToken = request.cookies.satori_refresh;
    if (!refreshToken) {
      throw new UnauthorizedException({
        code: 'REFRESH_TOKEN_MISSING',
        message: 'Refresh token cookie is required',
      });
    }
    try {
      const result = await this.sessions.refresh(refreshToken);
      this.setRefreshCookie(reply, result.refreshToken);
      return {
        accessToken: result.data.accessToken,
        accessTokenExpiresAt: result.data.accessTokenExpiresAt,
        sessionId: result.data.sessionId,
      };
    } catch (error) {
      reply.clearCookie('satori_refresh', { path: '/api/v1/auth/sessions' });
      throw error;
    }
  }

  @ConsentExempt()
  @Delete('current')
  @HttpCode(204)
  async revoke(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.sessions.revoke(request.auth.sessionId);
    reply.clearCookie('satori_refresh', { path: '/api/v1/auth/sessions' });
  }

  private setRefreshCookie(reply: FastifyReply, refreshToken: string): void {
    reply.setCookie('satori_refresh', refreshToken, {
      path: '/api/v1/auth/sessions',
      httpOnly: true,
      secure: this.infrastructure.environment.COOKIE_SECURE,
      sameSite: 'lax',
      maxAge: this.infrastructure.policy.auth.refreshTokenTtlSeconds,
    });
  }

  private requireIdempotencyKey(value: string | undefined): asserts value is string {
    if (!value || value.length < 16 || value.length > 128) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'A 16-128 character Idempotency-Key is required',
      });
    }
  }
}
