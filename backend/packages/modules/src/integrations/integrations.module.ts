import { Global, Module } from '@nestjs/common';
import { AquaAIClient } from '@aqua-ai/sdk';
import {
  DAILY_INSIGHT_GENERATOR,
  HOME_ENERGY_SUMMARY_GENERATOR,
  LOCATION_PROVIDER,
  PROFILE_FIRST_LOOK_GENERATOR,
} from '@satori/application';
import { RuntimeInfrastructure } from '@satori/infrastructure';
import { AquaDailyInsightGenerator } from './daily-insight/aqua-daily-insight.generator.js';
import { AquaHomeEnergySummaryGenerator } from './daily-energy/aqua-home-energy-summary.generator.js';
import { LocationController } from './locations/location.controller.js';
import { LocalLocationProvider } from './locations/location.provider.js';
import { DeterministicProfileFirstLookGenerator } from './profile-first-look/deterministic-profile-first-look.generator.js';

@Global()
@Module({
  controllers: [LocationController],
  providers: [
    { provide: LOCATION_PROVIDER, useClass: LocalLocationProvider },
    {
      provide: PROFILE_FIRST_LOOK_GENERATOR,
      useFactory: () => new DeterministicProfileFirstLookGenerator(),
    },
    {
      provide: HOME_ENERGY_SUMMARY_GENERATOR,
      inject: [RuntimeInfrastructure],
      useFactory: (infrastructure: RuntimeInfrastructure) => {
        const environment = infrastructure.environment;
        if (!environment.HOME_ENERGY_SUMMARY_ENABLED) return null;
        const client = new AquaAIClient({
          baseUrl: environment.AQUA_BASE_URL!,
          auth: { type: 'serviceKey', serviceKey: environment.AQUA_TENANT_SERVICE_KEY! },
          timeoutMs: environment.HOME_ENERGY_SUMMARY_TIMEOUT_MS,
        });
        return new AquaHomeEnergySummaryGenerator(client, {
          maxAttempts: environment.HOME_ENERGY_SUMMARY_MAX_ATTEMPTS,
          retryBackoffMs: environment.HOME_ENERGY_SUMMARY_RETRY_BACKOFF_MS,
        });
      },
    },
    {
      provide: DAILY_INSIGHT_GENERATOR,
      inject: [RuntimeInfrastructure],
      useFactory: (infrastructure: RuntimeInfrastructure) => {
        const environment = infrastructure.environment;
        const client = new AquaAIClient({
          baseUrl: environment.AQUA_AI_BASE_URL!,
          auth: { type: 'serviceKey', serviceKey: environment.AQUA_AI_SERVICE_KEY! },
        });
        return new AquaDailyInsightGenerator(client, {
          workflowId: environment.AQUA_AI_WORKFLOW_ID,
          ...(environment.AQUA_AI_WORKFLOW_VERSION === undefined
            ? {}
            : { workflowVersion: environment.AQUA_AI_WORKFLOW_VERSION }),
        });
      },
    },
  ],
  exports: [
    LOCATION_PROVIDER,
    DAILY_INSIGHT_GENERATOR,
    HOME_ENERGY_SUMMARY_GENERATOR,
    PROFILE_FIRST_LOOK_GENERATOR,
  ],
})
export class IntegrationsModule {}
