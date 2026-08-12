import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { BirthInput, HourBranch } from '@satori/application';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import type { AuthenticatedRequest } from '../identity/auth/authenticated-request.js';
import { SelfProfileService } from './self-profile.service.js';

export class BirthDateDto {
  @IsInt()
  @Min(1900)
  @Max(2100)
  year!: number;

  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;

  @IsInt()
  @Min(1)
  @Max(31)
  day!: number;

  @IsBoolean()
  isLeapMonth!: boolean;
}

export class BirthTimeDto {
  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/)
  localTime!: string | null;

  @IsOptional()
  @IsIn(['ZI', 'CHOU', 'YIN', 'MAO', 'CHEN', 'SI', 'WU', 'WEI', 'SHEN', 'YOU', 'XU', 'HAI'])
  hourBranchCode!: HourBranch | null;
}

export class BirthInputDto implements BirthInput {
  @IsIn(['SOLAR', 'LUNAR'])
  calendarType!: 'SOLAR' | 'LUNAR';

  @ValidateNested()
  @Type(() => BirthDateDto)
  date!: BirthDateDto;

  @IsIn(['EXACT_MINUTE', 'APPROXIMATE', 'HOUR_RANGE', 'DATE_ONLY'])
  timePrecision!: 'EXACT_MINUTE' | 'APPROXIMATE' | 'HOUR_RANGE' | 'DATE_ONLY';

  @ValidateNested()
  @Type(() => BirthTimeDto)
  time!: BirthTimeDto;

  @IsString()
  locationId!: string;

  @IsIn(['MALE', 'FEMALE'])
  calculationGender!: 'MALE' | 'FEMALE';
}

export class PreviewProfileDto {
  @ValidateNested()
  @Type(() => BirthInputDto)
  birthInput!: BirthInputDto;
}

export class ConfirmProfileDto {
  @IsString()
  fingerprint!: string;

  @IsBoolean()
  enhancedConfirmationAccepted!: boolean;
}

export class PatchSelfProfileDto {
  @IsString()
  @MinLength(1)
  @MaxLength(16)
  displayName!: string;
}

export class RevisionListQuery {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

@Controller('me/life-profile')
export class SelfProfileController {
  constructor(private readonly profiles: SelfProfileService) {}

  @Get()
  getCurrent(@Req() request: AuthenticatedRequest) {
    return this.profiles.getCurrent(request.auth.userId);
  }

  @Patch()
  patchCurrent(@Req() request: AuthenticatedRequest, @Body() body: PatchSelfProfileDto) {
    return this.profiles.updateDisplayName(request.auth.userId, body.displayName);
  }

  @Get('revisions')
  listRevisions(@Req() request: AuthenticatedRequest, @Query() query: RevisionListQuery) {
    return this.profiles.listRevisions(request.auth.userId, query);
  }

  @Post('revisions/preview')
  preview(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: PreviewProfileDto,
  ) {
    return this.profiles.preview({
      userId: request.auth.userId,
      birthInput: body.birthInput,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
    });
  }

  @Get('revisions/:revisionId')
  getRevision(@Req() request: AuthenticatedRequest, @Param('revisionId') revisionId: string) {
    return this.profiles.getRevision(request.auth.userId, revisionId);
  }

  @Post('revisions/:revisionId/confirm')
  @HttpCode(200)
  confirm(
    @Req() request: AuthenticatedRequest,
    @Param('revisionId') revisionId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: ConfirmProfileDto,
  ) {
    return this.profiles.confirm({
      userId: request.auth.userId,
      revisionId,
      fingerprint: body.fingerprint,
      enhancedConfirmationAccepted: body.enhancedConfirmationAccepted,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
    });
  }
}

export function requireIdempotencyKey(value: string | undefined): string {
  if (!value || value.length < 16 || value.length > 128) {
    throw new BadRequestException({
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      message: 'A 16-128 character Idempotency-Key is required',
    });
  }
  return value;
}
