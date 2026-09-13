import { Module } from '@nestjs/common';
import { RuntimeInfrastructureModule } from '@satori/infrastructure';
import { R1DomainModules } from '@satori/modules';
import { HealthController } from './health.controller.js';
import { SharePosterController } from './share-poster.controller.js';
import { SystemConfigController } from './system-config.controller.js';

@Module({ imports: [RuntimeInfrastructureModule, ...R1DomainModules], controllers: [HealthController, SharePosterController, SystemConfigController] })
export class ApiModule {}
