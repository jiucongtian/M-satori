import { Module } from '@nestjs/common';
import { ProfileGroupController, ProfileLibraryController } from './profile-library.controller.js';
import { ProfileLibraryService } from './profile-library.service.js';

@Module({
  controllers: [ProfileLibraryController, ProfileGroupController],
  providers: [ProfileLibraryService],
})
export class ProfileLibraryModule {}
