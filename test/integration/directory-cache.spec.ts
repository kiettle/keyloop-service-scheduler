import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../src/database/prisma.service';
import { DirectoryCache } from '../../src/directory/directory-cache';
import { DirectoryRepository } from '../../src/directory/directory.repository';
import { DealershipsPageDto } from '../../src/directory/directory.dto';
import { fixtureIds as id } from '../../prisma/seed-data';
import { createBookingApp, resetBookingFixtures } from '../helpers/booking-app';
import { createTestDatabase } from '../helpers/test-database';
import { createTestRedis } from '../helpers/test-redis';

const dealers = '/api/v1/dealerships';

describe('cached dealership pages with PostgreSQL and Redis', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let redis: Awaited<ReturnType<typeof createTestRedis>>;
  const apps: Awaited<ReturnType<typeof createBookingApp>>[] = [];
  const dealerKey = (page = 1, limit = 20) =>
    `${redis.namespace}:dealerships:v1:page:${page}:limit:${limit}`;
  beforeAll(async () => {
    database = await createTestDatabase();
    redis = await createTestRedis();
    for (let i = 0; i < 2; i++) {
      const app = await createBookingApp(database.url, redis.config);
      apps.push(app);
      const deadline = Date.now() + 3000;
      while (!(await app.app.get(DirectoryCache).invalidateDealerships())) {
        if (Date.now() >= deadline) throw new Error('Redis connection not ready.');
        await redis.client.ping();
      }
    }
  });
  beforeEach(async () => {
    await resetBookingFixtures(database.prisma);
    await redis.clear();
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    try {
      await Promise.all(apps.map((app) => app.close()));
    } finally {
      try {
        await redis?.close();
      } finally {
        await database?.close();
      }
    }
  });

  it('shares dealership hits across instances, isolates pagination, and keeps fixed expiry', async () => {
    const reads = apps.map((app) => vi.spyOn(app.app.get(DirectoryRepository), 'dealerships'));
    const first = await apps[0].http.get(dealers).expect(200);
    await apps[1].http
      .get(dealers)
      .expect(200)
      .expect(first.body as DealershipsPageDto);
    expect(reads[0]).toHaveBeenCalledTimes(1);
    expect(reads[1]).not.toHaveBeenCalled();
    expect(await redis.client.ttl(dealerKey())).toBeGreaterThanOrEqual(299);
    await redis.client.expire(dealerKey(), 60);
    await apps[1].http.get(dealers).expect(200);
    expect(await redis.client.ttl(dealerKey())).toBeLessThanOrEqual(60);
    const small = await apps[1].http.get(`${dealers}?limit=1`).expect(200);
    const next = await apps[1].http.get(`${dealers}?page=2&limit=1`).expect(200);
    expect((small.body as DealershipsPageDto).items[0].id).toBe(id.dealershipA);
    expect((next.body as DealershipsPageDto).items[0].id).toBe(id.dealershipB);
    expect(await redis.client.exists(dealerKey(1, 1), dealerKey(2, 1))).toBe(2);
  });

  it('invalidates all dealership pages while preserving unrelated keys, and refills after expiry', async () => {
    await apps[0].http.get(`${dealers}?limit=1`).expect(200);
    await apps[0].http.get(`${dealers}?limit=1&page=2`).expect(200);
    await apps[0].http.get(`${dealers}?limit=2`).expect(200);
    await apps[0].http.get('/api/v1/service-types').expect(200);
    const catalogSnapshot = await redis.client.get(redis.key);
    expect(catalogSnapshot).not.toBeNull();
    const original = await database.prisma.dealership.findUniqueOrThrow({
      where: { id: id.dealershipA },
    });
    try {
      await database.prisma.dealership.update({
        where: { id: id.dealershipA },
        data: { name: 'Changed Dealership' },
      });
      expect(await apps[1].app.get(DirectoryCache).invalidateDealerships()).toBe(true);
      expect(await redis.client.exists(dealerKey(1, 1), dealerKey(2, 1), dealerKey(1, 2))).toBe(0);
      expect(await redis.client.get(redis.key)).toBe(catalogSnapshot);
      const fresh = await apps[0].http.get(dealers).expect(200);
      expect((fresh.body as DealershipsPageDto).items[0].name).toBe('Changed Dealership');
      await redis.client.expire(dealerKey(), 0);
      const read = vi.spyOn(apps[1].app.get(DirectoryRepository), 'dealerships');
      await apps[1].http.get(dealers).expect(200);
      expect(read).toHaveBeenCalledTimes(1);
    } finally {
      await database.prisma.dealership.update({
        where: { id: id.dealershipA },
        data: { name: original.name },
      });
    }
  });

  it('caches valid empty pages without another database read', async () => {
    const path = `${dealers}?page=99&limit=20`;
    const empty = { items: [], page: 99, limit: 20, hasNext: false };
    await apps[0].http.get(path).expect(200).expect(empty);
    expect(JSON.parse((await redis.client.get(dealerKey(99)))!)).toEqual(empty);
    const read = vi.spyOn(apps[1].app.get(DirectoryRepository), 'dealerships');
    await apps[1].http.get(path).expect(200).expect(empty);
    expect(read).not.toHaveBeenCalled();
  });

  it('rejects malformed or mismatched cached pages and replaces them from PostgreSQL', async () => {
    for (const [path, key, raw] of [
      [dealers, dealerKey(), 'not JSON'],
      [dealers, dealerKey(), JSON.stringify({ items: [], page: 1, limit: 20, hasNext: true })],
      [dealers, dealerKey(), JSON.stringify({ items: [], page: 2, limit: 20, hasNext: false })],
    ]) {
      await redis.client.set(key, raw, 'EX', 300);
      const response = await apps[0].http.get(path).expect(200);
      expect(JSON.parse((await redis.client.get(key))!)).toEqual(response.body);
      expect((response.body as { items: unknown[] }).items.length).toBeGreaterThan(0);
    }
  });

  it('does not cache database failures', async () => {
    const unavailable = new PrismaService(
      new ConfigService({ DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/unreachable' }),
    );
    const broken = new DirectoryRepository(unavailable);
    vi.spyOn(apps[0].app.get(DirectoryRepository), 'dealerships').mockImplementationOnce((query) =>
      broken.dealerships(query),
    );
    try {
      await apps[0].http.get(dealers).expect(503);
      expect(await redis.client.exists(dealerKey())).toBe(0);
    } finally {
      await unavailable.$disconnect();
    }
  });

  it('serves dealerships with Redis unavailable at startup', async () => {
    const offline = await createBookingApp(database.url, {
      REDIS_URL: 'redis://127.0.0.1:1',
      CATALOG_CACHE_NAMESPACE: 'offline-test',
    });
    try {
      expect(
        ((await offline.http.get(dealers).expect(200)).body as DealershipsPageDto).items,
      ).toHaveLength(2);
    } finally {
      await offline.close();
    }
  });
});
