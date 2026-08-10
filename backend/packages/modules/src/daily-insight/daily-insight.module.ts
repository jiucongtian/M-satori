import { Module } from '@nestjs/common';
import { DailyInsightController, HomeOverviewController } from './daily-insight.controller.js';
import { DailyInsightService } from './daily-insight.service.js';

@Module({
  controllers: [DailyInsightController, HomeOverviewController],
  providers: [DailyInsightService],
  exports: [DailyInsightService],
})
export class DailyInsightModule {}
