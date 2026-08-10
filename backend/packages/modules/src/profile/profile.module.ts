import { Global, Module } from '@nestjs/common';
import { SelfProfileController } from './self-profile.controller.js';
import { SelfProfileService } from './self-profile.service.js';

@Global()
@Module({
  controllers: [SelfProfileController],
  providers: [SelfProfileService],
  exports: [SelfProfileService],
})
export class ProfileModule {}
