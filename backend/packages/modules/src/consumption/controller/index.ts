import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { AuthenticatedRequest } from '../../identity/auth/authenticated-request.js';
import { ConsumptionApplicationService } from '../application/index.js';
import type { ConsumptionIntentDetail, EntitlementResolutionView } from '../domain/index.js';

class BusinessContextDto {
  @IsString() @MinLength(1) @MaxLength(64) type!: string;
  @IsString() @MinLength(1) @MaxLength(128) id!: string;
}

class CreateResolutionDto {
  @IsIn(['DAILY_ENERGY', 'CARD_READING']) serviceType!: 'DAILY_ENERGY' | 'CARD_READING';
  @Type(() => Number) @IsInt() @Min(1) quantity!: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) cardCount?: number | null;
  @ValidateNested() @Type(() => BusinessContextDto) businessContext!: BusinessContextDto;
}

class CreateIntentDto {
  @IsString() resolutionId!: string;
}

@Controller()
export class ConsumptionController {
  constructor(private readonly consumption: ConsumptionApplicationService) {}

  @Post('entitlement-resolutions')
  async resolve(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: CreateResolutionDto,
  ) {
    const resolution = await this.consumption.createResolution(
      {
        userId: request.auth.userId,
        businessSpace: 'SATORI',
        serviceType: body.serviceType === 'DAILY_ENERGY' ? 'DAILY_INSIGHT' : 'CARD_READING',
        quantity: body.quantity,
        unit: body.serviceType === 'CARD_READING' ? 'READING_CREDIT' : 'DAILY_INSIGHT_CREDIT',
        businessContext: body.businessContext,
        ...(body.cardCount ? { attributes: { cardCount: body.cardCount } } : {}),
      },
      requireKey(key),
    );
    return { data: resolutionResponse(resolution) };
  }

  @Post('consumption-intents')
  async reserve(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: CreateIntentDto,
  ) {
    return {
      data: intentResponse(
        await this.consumption.createIntent(request.auth.userId, body.resolutionId, requireKey(key)),
      ),
    };
  }

  @Get('consumption-intents/:intentId')
  async get(@Req() request: AuthenticatedRequest, @Param('intentId') intentId: string) {
    const intent = await this.consumption.getIntent(intentId);
    if (!intent || intent.ownerUserId !== request.auth.userId) {
      throw new NotFoundException({ code: 'CONSUMPTION_INTENT_NOT_FOUND' });
    }
    return { data: intentResponse(intent) };
  }

  @Post('consumption-intents/:intentId/start')
  async start(
    @Req() request: AuthenticatedRequest,
    @Param('intentId') intentId: string,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const existing = await this.consumption.getIntent(intentId);
    if (!existing || existing.ownerUserId !== request.auth.userId) {
      throw new NotFoundException({ code: 'CONSUMPTION_INTENT_NOT_FOUND' });
    }
    await this.consumption.start(intentId, requireKey(key));
    return { data: intentResponse((await this.consumption.getIntent(intentId))!) };
  }
}

function requireKey(value: string | undefined) {
  if (!value || value.length < 16 || value.length > 128) {
    throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
  }
  return value;
}

function resolutionResponse(value: EntitlementResolutionView) {
  return {
    resolutionId: value.resolutionId,
    status: value.status === 'NO_SOURCE' ? 'NO_SOURCE' : 'RESOLVED',
    selectionMode: value.selectionMode,
    candidates: value.candidates.map(candidateResponse),
    selectedSource: value.selectedSource ? candidateResponse(value.selectedSource) : null,
    reason: value.reasonCode,
    ruleVersion: value.ruleVersion,
    resolvedAt: value.resolvedAt.toISOString(),
    expiresAt: value.expiresAt.toISOString(),
  };
}

function intentResponse(value: ConsumptionIntentDetail) {
  return {
    intentId: value.intentId,
    resolutionId: value.resolutionId,
    status: value.status,
    selectedSource: candidateResponse(value.selectedSource),
    reservedAt: value.reservedAt?.toISOString() ?? null,
    reservationExpiresAt: value.reservationExpiresAt?.toISOString() ?? null,
    startedAt: value.startedAt?.toISOString() ?? null,
    settledAt: value.settledAt?.toISOString() ?? null,
  };
}

function candidateResponse(value: EntitlementResolutionView['candidates'][number]) {
  return {
    sourceType:
      value.sourceType === 'MEMBERSHIP_ENTITLEMENT'
        ? 'MEMBERSHIP'
        : value.sourceType === 'PURCHASED_ENTITLEMENT'
          ? 'PURCHASE'
          : 'COMPLIMENTARY_SEED',
    sourceId: value.sourceId,
    eligible: value.eligible,
    cost: value.cost,
    unit: value.unit,
    expiresAt: value.expiresAt?.toISOString() ?? null,
    rank: value.rank,
  };
}
