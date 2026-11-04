import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { RedisCache } from '../cache/redis-cache';
import { ServiceTypeDto } from './service-type.dto';

export const catalogCacheKey = (namespace: string) => `${namespace}:service-types:v1:active`;

function isCatalog(value: unknown): value is ServiceTypeDto[] {
  return (
    Array.isArray(value) &&
    value.every((item: unknown) => {
      if (typeof item !== 'object' || item === null) return false;
      return (
        Object.keys(item).length === 3 &&
        'id' in item &&
        typeof item.id === 'string' &&
        isUUID(item.id) &&
        'name' in item &&
        typeof item.name === 'string' &&
        'durationMinutes' in item &&
        typeof item.durationMinutes === 'number' &&
        Number.isSafeInteger(item.durationMinutes) &&
        item.durationMinutes > 0
      );
    })
  );
}

@Injectable()
export class ServiceCatalogCache {
  private readonly key: string;
  constructor(private readonly cache: RedisCache) {
    this.key = cache.key('service-types:v1:active');
  }
  get(requestId?: string) {
    return this.cache.get(this.key, isCatalog, requestId);
  }
  set(items: ServiceTypeDto[], requestId?: string) {
    return this.cache.set(this.key, items, requestId);
  }
  invalidate() {
    return this.cache.invalidate(this.key);
  }
}
