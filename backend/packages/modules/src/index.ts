import type { Type } from '@nestjs/common';
import { AstrologyModule } from './astrology/astrology.module.js';
import { DailyInsightModule } from './daily-insight/daily-insight.module.js';
import { FeedbackModule } from './feedback/feedback.module.js';
import { GenerationTaskModule } from './generation-task/generation-task.module.js';
import { IdentityModule } from './identity/identity.module.js';
import { IntegrationsModule } from './integrations/integrations.module.js';
import { OperationsModule } from './operations/operations.module.js';
import { ProfileLibraryModule } from './profile-library/profile-library.module.js';
import { ProfileModule } from './profile/profile.module.js';
import { SeedLedgerModule } from './seed-ledger/seed-ledger.module.js';

export {
  AstrologyModule,
  DailyInsightModule,
  FeedbackModule,
  GenerationTaskModule,
  IdentityModule,
  IntegrationsModule,
  OperationsModule,
  ProfileLibraryModule,
  ProfileModule,
  SeedLedgerModule,
};

export const R1DomainModules: Type<unknown>[] = [
  IdentityModule,
  ProfileModule,
  AstrologyModule,
  ProfileLibraryModule,
  SeedLedgerModule,
  GenerationTaskModule,
  DailyInsightModule,
  FeedbackModule,
  OperationsModule,
  IntegrationsModule,
];
