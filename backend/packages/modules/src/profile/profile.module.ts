import { Global, Module } from '@nestjs/common';
import { SelfProfileController } from './self-profile.controller.js';
import { SelfProfileService } from './self-profile.service.js';
import { CardCatalogService } from './card-catalog.service.js';
import { ProfileFirstLookService } from './profile-first-look.service.js';

@Global()
@Module({
  controllers: [SelfProfileController],
  providers: [CardCatalogService, SelfProfileService, ProfileFirstLookService],
  exports: [CardCatalogService, SelfProfileService, ProfileFirstLookService],
})
export class ProfileModule {}
