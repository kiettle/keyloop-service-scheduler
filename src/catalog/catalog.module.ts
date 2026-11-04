import { Module } from '@nestjs/common';
import { RedisCacheModule } from '../cache/redis-cache.module';
import { DatabaseModule } from '../database/database.module';
import { CatalogRepository } from './catalog.repository';
import { ListServiceTypesUseCase } from './list-service-types.use-case';
import { ServiceCatalogCache } from './service-catalog-cache';
import { ServiceTypesController } from './service-types.controller';

@Module({
  imports: [DatabaseModule, RedisCacheModule],
  controllers: [ServiceTypesController],
  providers: [CatalogRepository, ServiceCatalogCache, ListServiceTypesUseCase],
})
export class CatalogModule {}
