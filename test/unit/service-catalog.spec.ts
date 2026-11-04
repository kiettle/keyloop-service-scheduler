import { RedisCache } from '../../src/cache/redis-cache';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { ServiceCatalogCache, catalogCacheKey } from '../../src/catalog/service-catalog-cache';
import { ListServiceTypesUseCase } from '../../src/catalog/list-service-types.use-case';
import { CatalogRepository } from '../../src/catalog/catalog.repository';
import { validateEnvironment } from '../../src/config/environment';

const client = vi.hoisted(() => ({
  status: 'ready',
  get: vi.fn<() => Promise<string | null>>(),
  set: vi.fn(),
  del: vi.fn(),
  scan: vi.fn(),
  unlink: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  on: vi.fn(),
}));
vi.mock('ioredis', () => ({
  default: class {
    constructor() {
      return client;
    }
  },
}));

const items = [
  { id: '40000000-0000-4000-8000-000000000001', name: 'Oil Change', durationMinutes: 30 },
];

describe('service catalog cache-aside', () => {
  let cache: ServiceCatalogCache;
  let redis: RedisCache;
  const repository = { findActiveServiceTypes: vi.fn() };
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    client.status = 'ready';
    client.get.mockResolvedValue(null);
    client.set.mockResolvedValue('OK');
    client.del.mockResolvedValue(1);
    client.connect.mockResolvedValue(undefined);
    repository.findActiveServiceTypes.mockResolvedValue(items);
    redis = new RedisCache(
      new ConfigService(
        validateEnvironment({
          DATABASE_URL: 'postgresql://local/test',
          REDIS_URL: 'redis://local',
          CATALOG_CACHE_NAMESPACE: 'unit',
        }),
      ),
    );
    cache = new ServiceCatalogCache(redis);
  });
  const useCase = () =>
    new ListServiceTypesUseCase(repository as unknown as CatalogRepository, cache);

  it('populates only after a successful database read, using an atomic five-minute expiry', async () => {
    expect(await useCase().execute('request')).toEqual(items);
    expect(repository.findActiveServiceTypes).toHaveBeenCalledTimes(1);
    expect(client.set).toHaveBeenCalledWith(
      catalogCacheKey('unit'),
      JSON.stringify(items),
      'EX',
      300,
    );
  });

  it('does not query PostgreSQL or refresh TTL on a hit', async () => {
    client.get.mockResolvedValue(JSON.stringify(items));
    expect(await useCase().execute()).toEqual(items);
    expect(repository.findActiveServiceTypes).not.toHaveBeenCalled();
    expect(client.set).not.toHaveBeenCalled();
  });

  it('treats cached empty results as hits', async () => {
    client.get.mockResolvedValue('[]');
    expect(await useCase().execute()).toEqual([]);
    expect(repository.findActiveServiceTypes).not.toHaveBeenCalled();
  });

  it.each(['Command timed out', 'Connection closed'])(
    'falls back on a Redis read failure: %s',
    async (message) => {
      client.get.mockRejectedValue(new Error(message));
      expect(await useCase().execute()).toEqual(items);
      expect(repository.findActiveServiceTypes).toHaveBeenCalledTimes(1);
    },
  );

  it('returns successful database data when Redis SET fails', async () => {
    client.set.mockRejectedValue(new Error('Write failed'));
    expect(await useCase().execute()).toEqual(items);
  });

  it('does not swallow or cache a database error', async () => {
    const error = new Error('Database failed');
    repository.findActiveServiceTypes.mockRejectedValue(error);
    await expect(useCase().execute()).rejects.toBe(error);
    expect(client.set).not.toHaveBeenCalled();
  });

  it.each([
    'invalid json',
    '{}',
    '[null]',
    JSON.stringify([{ ...items[0], durationMinutes: 0 }]),
    JSON.stringify([{ ...items[0], privateField: 'secret' }]),
  ])('replaces malformed cached content: %s', async (raw) => {
    client.get.mockResolvedValue(raw);
    expect(await useCase().execute()).toEqual(items);
    expect(client.set).toHaveBeenCalledTimes(1);
  });

  it('bypasses a reconnecting client without queuing reads or writes', async () => {
    client.status = 'reconnecting';
    expect(await useCase().execute()).toEqual(items);
    expect(client.get).not.toHaveBeenCalled();
    expect(client.set).not.toHaveBeenCalled();
  });

  it('supports operation without Redis configured', async () => {
    redis = new RedisCache(
      new ConfigService(validateEnvironment({ DATABASE_URL: 'postgresql://local/test' })),
    );
    cache = new ServiceCatalogCache(redis);
    expect(await useCase().execute()).toEqual(items);
    expect(client.get).not.toHaveBeenCalled();
  });

  it('reports failed invalidation explicitly and only deletes its own key', async () => {
    expect(await cache.invalidate()).toBe(true);
    expect(client.del).toHaveBeenCalledWith(catalogCacheKey('unit'));
    client.del.mockRejectedValue(new Error('Unavailable'));
    expect(await cache.invalidate()).toBe(false);
    client.status = 'reconnecting';
    expect(await cache.invalidate()).toBe(false);
  });

  it('invalidates all pages in a trusted prefix using SCAN and UNLINK', async () => {
    client.scan
      .mockResolvedValueOnce(['7', ['unit:dealerships:v1:page:1:limit:20']])
      .mockResolvedValueOnce(['0', ['unit:dealerships:v1:page:2:limit:20']]);
    expect(await redis.invalidatePrefix(redis.key('dealerships:v1:'))).toBe(true);
    expect(client.scan).toHaveBeenNthCalledWith(
      1,
      '0',
      'MATCH',
      'unit:dealerships:v1:*',
      'COUNT',
      100,
    );
    expect(client.scan).toHaveBeenNthCalledWith(
      2,
      '7',
      'MATCH',
      'unit:dealerships:v1:*',
      'COUNT',
      100,
    );
    expect(client.unlink).toHaveBeenCalledTimes(2);
    expect(client.del).not.toHaveBeenCalled();
  });

  it('reports prefix invalidation failure and bypasses an unavailable client', async () => {
    client.scan.mockRejectedValue(new Error('Connection closed'));
    expect(await redis.invalidatePrefix(redis.key('dealerships:v1:'))).toBe(false);
    client.status = 'reconnecting';
    expect(await redis.invalidatePrefix(redis.key('dealerships:v1:'))).toBe(false);
    expect(client.scan).toHaveBeenCalledTimes(1);
  });

  it('handles background connection rejection and closes on shutdown', async () => {
    client.connect.mockRejectedValue(new Error('Unavailable'));
    expect(redis.onModuleInit()).toBeUndefined();
    await Promise.resolve();
    redis.onModuleDestroy();
    expect(client.disconnect).toHaveBeenCalledTimes(1);
  });
});
