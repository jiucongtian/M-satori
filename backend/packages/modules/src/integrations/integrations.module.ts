import { Global, Module } from '@nestjs/common';
import {
  DAILY_INSIGHT_GENERATOR,
  HOME_ENERGY_SUMMARY_GENERATOR,
  LOCATION_PROVIDER,
  PROFILE_FIRST_LOOK_GENERATOR,
} from '@satori/application';
import { RuntimeInfrastructure } from '@satori/infrastructure';
import { AquaClientFactory } from './aqua/aqua-client.factory.js';
import { AquaDailyInsightGenerator } from './daily-insight/aqua-daily-insight.generator.js';
import { AquaHomeEnergySummaryGenerator } from './daily-energy/aqua-home-energy-summary.generator.js';
import { LocationController } from './locations/location.controller.js';
import { LocalLocationProvider } from './locations/location.provider.js';
import { DeterministicProfileFirstLookGenerator } from './profile-first-look/deterministic-profile-first-look.generator.js';

@Global()
@Module({
  controllers: [LocationController],
  providers: [
    AquaClientFactory,
    { provide: LOCATION_PROVIDER, useClass: LocalLocationProvider },
    {
      provide: PROFILE_FIRST_LOOK_GENERATOR,
      useFactory: () => new DeterministicProfileFirstLookGenerator(),
    },
    {
      provide: HOME_ENERGY_SUMMARY_GENERATOR,
      inject: [RuntimeInfrastructure, AquaClientFactory],
      useFactory: (infrastructure: RuntimeInfrastructure, clients: AquaClientFactory) => {
        const policy = infrastructure.policy.aqua.homeEnergySummary;
        const client = clients.create({ timeoutMs: policy.requestTimeoutMs });
        return new AquaHomeEnergySummaryGenerator(client, {
          workflowId: policy.workflowId,
          workflowVersion: policy.workflowVersion,
          maxAttempts: policy.maxAttempts,
          retryBackoffMs: policy.retryBackoffMs,
        });
      },
    },
    {
      provide: DAILY_INSIGHT_GENERATOR,
      inject: [RuntimeInfrastructure, AquaClientFactory],
      useFactory: (infrastructure: RuntimeInfrastructure, clients: AquaClientFactory) => {
        const policy = infrastructure.policy.aqua.dailyInsight;
        const client = clients.create();
        return new AquaDailyInsightGenerator(client, {
          workflowId: policy.workflowId,
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
