import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { RedisCache } from '../cache/redis-cache';
import { PaginationQueryDto } from '../common/http/pagination';
import { DealershipsPageDto } from './directory.dto';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isPage(
  value: unknown,
  query: PaginationQueryDto,
): value is Record<string, unknown> & { items: unknown[] } {
  return (
    isRecord(value) &&
    Object.keys(value).length === 4 &&
    value.page === query.page &&
    value.limit === query.limit &&
    typeof value.hasNext === 'boolean' &&
    Array.isArray(value.items) &&
    value.items.length <= query.limit &&
    // A next page is reported only after the repository fills the current page.
    (!value.hasNext || value.items.length === query.limit)
  );
}

@Injectable()
export class DirectoryCache {
  constructor(private readonly cache: RedisCache) {}

  private dealershipsPrefix() {
    return this.cache.key('dealerships:v1:');
  }
  private pageKey(prefix: string, query: PaginationQueryDto) {
    return `${prefix}page:${query.page}:limit:${query.limit}`;
  }

  getDealerships(query: PaginationQueryDto, requestId?: string) {
    return this.cache.get(
      this.pageKey(this.dealershipsPrefix(), query),
      (value): value is DealershipsPageDto =>
        isPage(value, query) &&
        value.items.every(
          (item) =>
            isRecord(item) &&
            Object.keys(item).length === 3 &&
            typeof item.id === 'string' &&
            isUUID(item.id) &&
            typeof item.name === 'string' &&
            typeof item.timeZone === 'string',
        ),
      requestId,
    );
  }
  setDealerships(query: PaginationQueryDto, page: DealershipsPageDto, requestId?: string) {
    return this.cache.set(this.pageKey(this.dealershipsPrefix(), query), page, requestId);
  }
  invalidateDealerships() {
    return this.cache.invalidatePrefix(this.dealershipsPrefix());
  }
}
