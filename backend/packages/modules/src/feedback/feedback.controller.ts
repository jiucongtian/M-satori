import { Body, Controller, Delete, Get, Headers, HttpCode, Post, Req } from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { AuthenticatedRequest } from '../identity/auth/authenticated-request.js';
import { requireIdempotencyKey } from '../profile/self-profile.controller.js';
import { AccountDeletionService } from './account-deletion.service.js';
import { FeedbackService } from './feedback.service.js';

class FeedbackTargetDto {
  @IsIn(['LIFE_REPORT', 'DAILY_INSIGHT']) type!: 'LIFE_REPORT' | 'DAILY_INSIGHT';
  @IsUUID() id!: string;
  @IsOptional() @IsString() @MaxLength(64) sectionCode?: string | null;
}

class CreateFeedbackDto {
  @ValidateNested() @Type(() => FeedbackTargetDto) target!: FeedbackTargetDto;
  @IsIn(['HELPFUL', 'NOT_RESONANT', 'UNCOMFORTABLE']) rating!: 'HELPFUL' | 'NOT_RESONANT' | 'UNCOMFORTABLE';
  @IsArray()
  @ArrayMaxSize(5)
  @IsIn(['TOO_ABSOLUTE', 'NOT_ACCURATE', 'TOO_GENERIC', 'HARMFUL_OR_OFFENSIVE', 'OTHER'], { each: true })
  reasons!: string[];
  @IsOptional() @IsString() @MaxLength(1000) comment?: string | null;
}

class CreateAccountDeletionDto {
  @IsUUID() smsChallengeId!: string;
  @Matches(/^\d{6}$/) verificationCode!: string;
  @IsIn(['NO_LONGER_NEEDED', 'PRIVACY_CONCERN', 'OTHER']) reason!: string;
}

@Controller('feedback')
export class FeedbackController {
  constructor(private readonly service: FeedbackService) {}

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: CreateFeedbackDto,
  ) {
    return this.service.create({
      userId: request.auth.userId,
      ...body,
      idempotencyKey: requireIdempotencyKey(key),
    });
  }
}

@Controller('me')
export class AccountDeletionController {
  constructor(private readonly service: AccountDeletionService) {}

  @Post('account-deletion-requests')
  @HttpCode(202)
  create(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: CreateAccountDeletionDto,
  ) {
    return this.service.create({
      userId: request.auth.userId,
      currentSessionId: request.auth.sessionId,
      ...body,
      idempotencyKey: requireIdempotencyKey(key),
    });
  }

  @Get('account-deletion-request')
  get(@Req() request: AuthenticatedRequest) {
    return this.service.get(request.auth.userId);
  }

  @Delete('account-deletion-request')
  @HttpCode(204)
  cancel(@Req() request: AuthenticatedRequest) {
    return this.service.cancel(request.auth.userId);
  }
}
