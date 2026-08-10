import { Global, Module } from '@nestjs/common';
import { DAILY_INSIGHT_GENERATOR, LOCATION_PROVIDER } from '@satori/application';
import { DeterministicDailyInsightGenerator } from './daily-insight/deterministic-daily-insight.generator.js';
import { LocationController } from './locations/location.controller.js';
import { LocalLocationProvider } from './locations/location.provider.js';

@Global()
@Module({
  controllers: [LocationController],
  providers: [
    { provide: LOCATION_PROVIDER, useClass: LocalLocationProvider },
    { provide: DAILY_INSIGHT_GENERATOR, useClass: DeterministicDailyInsightGenerator },
  ],
  exports: [LOCATION_PROVIDER, DAILY_INSIGHT_GENERATOR],
})
export class IntegrationsModule {}
