import { Module } from '@nestjs/common';
import { DailyInsightController, HomeOverviewController } from './daily-insight.controller.js';
import { DailyInsightService } from './daily-insight.service.js';
import { HomeEnergySummaryService } from './home-energy-summary.service.js';

@Module({
  controllers: [DailyInsightController, HomeOverviewController],
  providers: [DailyInsightService, HomeEnergySummaryService],
  exports: [DailyInsightService],
})
export class DailyInsightModule {}
