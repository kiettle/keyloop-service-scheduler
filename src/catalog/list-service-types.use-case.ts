import { Injectable } from '@nestjs/common';
import { CatalogRepository } from './catalog.repository';
import { ServiceCatalogCache } from './service-catalog-cache';
import { ServiceTypeDto } from './service-type.dto';

@Injectable()
export class ListServiceTypesUseCase {
  constructor(
    private readonly repository: CatalogRepository,
    private readonly cache: ServiceCatalogCache,
  ) {}

  async execute(requestId?: string): Promise<ServiceTypeDto[]> {
    const cached = await this.cache.get(requestId);
    if (cached !== null) return cached;
    // Database errors must escape; only Redis operations have fallback catches.
    const items = await this.repository.findActiveServiceTypes();
    await this.cache.set(items, requestId);
    return items;
  }
}
