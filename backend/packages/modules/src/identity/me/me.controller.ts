import { BadRequestException, Body, Controller, Get, Headers, Patch, Post, Req } from '@nestjs/common';
import { ConsentExempt } from '@satori/contracts';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsOptional, IsString, Matches, ValidateNested } from 'class-validator';
import type { AuthenticatedRequest } from '../auth/authenticated-request.js';
import type { ConsentAcceptanceInput } from '../auth/session.service.js';
import { MeService, type MeProjection } from './me.service.js';

class PatchPreferencesDto {
  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @Matches(/^[a-z]{2}(?:-[A-Z]{2})?$/)
  locale?: string;
}

class AcceptanceDto implements ConsentAcceptanceInput {
  @IsString()
  documentId!: string;

  @IsString()
  version!: string;
}

class AcceptConsentsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AcceptanceDto)
  acceptances!: AcceptanceDto[];
}

@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  @ConsentExempt()
  @Get()
  get(@Req() request: AuthenticatedRequest): Promise<MeProjection> {
    return this.me.get(request.auth.userId);
  }

  @Patch('preferences')
  updatePreferences(
    @Req() request: AuthenticatedRequest,
    @Body() body: PatchPreferencesDto,
  ): Promise<MeProjection['preferences']> {
    return this.me.updatePreferences(request.auth.userId, body);
  }

  @ConsentExempt()
  @Post('consents')
  acceptConsents(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: AcceptConsentsDto,
  ): ReturnType<MeService['acceptConsents']> {
    if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 128) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'A 16-128 character Idempotency-Key is required',
      });
    }
    return this.me.acceptConsents({
      userId: request.auth.userId,
      sessionId: request.auth.sessionId,
      requestId: request.id,
      idempotencyKey,
      acceptances: body.acceptances,
    });
  }
}
