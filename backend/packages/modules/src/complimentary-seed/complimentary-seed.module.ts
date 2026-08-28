import { Global, Module } from '@nestjs/common';
import { SEED_ELIGIBILITY_PORT } from '@satori/application';
import { DrizzleSeedEligibilityAdapter } from './repository-adapter/index.js';

@Global()
@Module({
  providers: [
    DrizzleSeedEligibilityAdapter,
    { provide: SEED_ELIGIBILITY_PORT, useExisting: DrizzleSeedEligibilityAdapter },
  ],
  exports: [SEED_ELIGIBILITY_PORT],
})
export class ComplimentarySeedModule {}
