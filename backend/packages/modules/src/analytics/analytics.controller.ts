import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Public } from '@satori/contracts';
import { AnalyticsService } from './analytics.service.js';

@Public()
@Controller('analytics/events')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Post('batch')
  @HttpCode(202)
  ingest(@Body() body: unknown) {
    return this.analytics.ingest(body);
  }
}
