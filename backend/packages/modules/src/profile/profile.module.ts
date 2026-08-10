import { Module } from '@nestjs/common';
import { SelfProfileController } from './self-profile.controller.js';
import { SelfProfileService } from './self-profile.service.js';

@Module({ controllers: [SelfProfileController], providers: [SelfProfileService] })
export class ProfileModule {}
