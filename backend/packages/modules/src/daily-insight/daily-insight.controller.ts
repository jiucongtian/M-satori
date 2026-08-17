import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import type { AuthenticatedRequest } from '../identity/auth/authenticated-request.js';
import { DailyInsightService } from './daily-insight.service.js';
import { HomeEnergySummaryService } from './home-energy-summary.service.js';

class DailyListQuery {
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}
@Controller('daily-insights')
export class DailyInsightController {
  constructor(private readonly insights: DailyInsightService) {}
  @Post('today')
  @HttpCode(202)
  async today(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (!key || key.length < 16 || key.length > 128)
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'A 16-128 character Idempotency-Key is required',
      });
    const result = await this.insights.createToday(request.auth.userId);
    void reply.status(result.status);
    return result.body;
  }
  @Get() list(@Req() request: AuthenticatedRequest, @Query() query: DailyListQuery) {
    return this.insights.list(request.auth.userId, query);
  }
  @Get(':localDate') get(@Req() request: AuthenticatedRequest, @Param('localDate') localDate: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate))
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'localDate must use YYYY-MM-DD' });
    return this.insights.getByDate(request.auth.userId, localDate);
  }
}

@Controller('me/home-overview')
export class HomeOverviewController {
  constructor(
    private readonly insights: DailyInsightService,
    private readonly energySummary: HomeEnergySummaryService,
  ) {}
  @Get() async get(@Req() request: AuthenticatedRequest) {
    const overview = await this.insights.homeOverview(request.auth.userId);
    const dailyEnergySummary = await this.energySummary.get({
      userId: request.auth.userId,
      userName: overview.profile.displayName,
      profileRevisionId: overview.profile.currentRevisionId ?? null,
      localDate: overview.dailyInsight.localDate,
      cards: overview.cards,
    });
    return { ...overview, dailyEnergySummary };
  }
}
