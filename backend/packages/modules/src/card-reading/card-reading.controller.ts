import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { AuthenticatedRequest } from '../identity/auth/authenticated-request.js';
import { CardReadingService } from './card-reading.service.js';

class CreateCardDrawDto {
  @IsString() @MinLength(6) @MaxLength(120) question!: string;
  @IsString() @MaxLength(32) category!: string;
  @IsInt() @Min(1) @Max(5) cardCount!: number;
  @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) positionLabels!: string[];
  @IsOptional() @IsIn(['SYSTEM_RANDOM']) drawMethod?: 'SYSTEM_RANDOM';
}

@Controller('card-readings')
export class CardReadingController {
  constructor(private readonly readings: CardReadingService) {}

  @Post('draws')
  async createDraw(@Req() request: AuthenticatedRequest, @Body() body: CreateCardDrawDto) {
    return { data: await this.readings.createDraw({ ownerUserId: request.auth.userId, ...body }) };
  }

  @Get()
  async list(
    @Req() request: AuthenticatedRequest,
    @Query('limit') rawLimit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const limit = Math.min(50, Math.max(1, Number(rawLimit) || 20));
    return { data: await this.readings.list(request.auth.userId, limit, cursor) };
  }

  @Get(':readingId')
  async get(@Req() request: AuthenticatedRequest, @Param('readingId') readingId: string) {
    return { data: await this.readings.get(request.auth.userId, readingId) };
  }

  @Post(':readingId/complete')
  async complete(@Req() request: AuthenticatedRequest, @Param('readingId') readingId: string) {
    return { data: await this.readings.complete(request.auth.userId, readingId) };
  }

  @Post(':readingId/retry')
  async retry(@Req() request: AuthenticatedRequest, @Param('readingId') readingId: string) {
    return { data: await this.readings.retry(request.auth.userId, readingId) };
  }
}
