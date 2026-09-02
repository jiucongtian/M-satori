import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ConsentExempt, OptionalAuth } from '@satori/contracts';
import type { FastifyRequest } from 'fastify';
import type { AuthenticationContext } from '../identity/auth/authenticated-request.js';
import { AnalyticsService } from './analytics.service.js';

@OptionalAuth()
@ConsentExempt()
@Controller('analytics/events')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Post('batch')
  @HttpCode(202)
  ingest(@Req() request: FastifyRequest & { auth?: AuthenticationContext }, @Body() body: unknown) {
    return this.analytics.ingest(body, request.auth?.userId);
  }
}
