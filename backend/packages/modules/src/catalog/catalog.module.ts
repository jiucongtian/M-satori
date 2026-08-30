import { Global, Module } from '@nestjs/common';
import { OFFERING_QUERY_PORT } from '@satori/application';
import { CATALOG_REPOSITORY, CatalogApplicationService } from './application/index.js';
import { CatalogController } from './controller/index.js';
import { DrizzleCatalogRepository } from './repository-adapter/index.js';

@Global()
@Module({
  controllers: [CatalogController],
  providers: [
    DrizzleCatalogRepository,
    { provide: CATALOG_REPOSITORY, useExisting: DrizzleCatalogRepository },
    { provide: OFFERING_QUERY_PORT, useExisting: DrizzleCatalogRepository },
    {
      provide: CatalogApplicationService,
      inject: [CATALOG_REPOSITORY],
      useFactory: (repository: DrizzleCatalogRepository) => new CatalogApplicationService(repository),
    },
  ],
  exports: [CatalogApplicationService, OFFERING_QUERY_PORT],
})
export class CatalogModule {}
