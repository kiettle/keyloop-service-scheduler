import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../src/database/prisma.service';
import { CatalogRepository } from '../../src/catalog/catalog.repository';
import { ServiceCatalogCache } from '../../src/catalog/service-catalog-cache';
import { ServiceTypeDto } from '../../src/catalog/service-type.dto';
import { fixtureIds as id } from '../../prisma/seed-data';
import { createTestRedis } from '../helpers/test-redis';
import { createTestDatabase } from '../helpers/test-database';
import { at, bookingInput, createBookingApp, resetBookingFixtures } from '../helpers/booking-app';

describe('service catalog with real Redis and PostgreSQL', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let redis: Awaited<ReturnType<typeof createTestRedis>>;
  let apps: Awaited<ReturnType<typeof createBookingApp>>[] = [];
  const endpoint = '/api/v1/service-types';

  beforeAll(async () => {
    database = await createTestDatabase();
    redis = await createTestRedis();
    apps = await Promise.all([
      createBookingApp(database.url, redis.config),
      createBookingApp(database.url, redis.config),
    ]);
    // Wait for real connections through a bounded Redis-side observation, not an arbitrary sleep.
    for (const app of apps) {
      const cache = app.app.get(ServiceCatalogCache);
      const deadline = Date.now() + 3000;
      while (!(await cache.invalidate())) {
        if (Date.now() >= deadline)
          throw new Error('Application cache connection did not become ready.');
        await redis.client.ping();
      }
    }
  });
  beforeEach(async () => {
    await resetBookingFixtures(database.prisma);
    await database.prisma.serviceType.update({
      where: { id: id.oilChange },
      data: { name: 'Oil Change' },
    });
    await redis.client.del(redis.key);
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

  it('misses once, shares the cached result across instances, and does not refresh the 300-second TTL', async () => {
    const reads = apps.map((app) =>
      vi.spyOn(app.app.get(CatalogRepository), 'findActiveServiceTypes'),
    );
    const first = await apps[0].http.get(endpoint).expect(200);
    const catalog = first.body as ServiceTypeDto[];
    expect(catalog.map((item) => item.name)).toEqual([
      'Brake Repair',
      'General Inspection',
      'Oil Change',
      'Tire Replacement',
    ]);
    expect(catalog.every((item) => Object.keys(item).length === 3)).toBe(true);
    expect(JSON.parse((await redis.client.get(redis.key))!)).toEqual(catalog);
    expect(await redis.client.ttl(redis.key)).toBeGreaterThanOrEqual(299);
    expect(await redis.client.ttl(redis.key)).toBeLessThanOrEqual(300);
    // Shorten expiry so a hit accidentally resetting it to 300 seconds is detectable.
    await redis.client.expire(redis.key, 60);
    await apps[1].http.get(endpoint).expect(200).expect(catalog);
    expect(await redis.client.ttl(redis.key)).toBeLessThanOrEqual(60);
    expect(reads[0]).toHaveBeenCalledTimes(1);
    expect(reads[1]).not.toHaveBeenCalled();
  });

  it('refreshes the existing catalog after commit without deletion, resetting expiry and sharing the result', async () => {
    const initial = await apps[0].http.get(endpoint).expect(200);
    const original = initial.body as ServiceTypeDto[];
    expect(JSON.parse((await redis.client.get(redis.key))!)).toEqual(original);
    await redis.client.expire(redis.key, 60);

    const repository = apps[0].app.get(CatalogRepository);
    const cache = apps[0].app.get(ServiceCatalogCache);
    const invalidation = vi.spyOn(cache, 'invalidate');
    // This maintenance example refreshes Redis only after the database transaction commits.
    await database.prisma.$transaction(async (tx) => {
      await tx.serviceType.update({ where: { id: id.oilChange }, data: { durationMinutes: 45 } });
    });
    const fresh = await repository.findActiveServiceTypes();
    await cache.set(fresh);

    const expected = original.map((service) =>
      service.id === id.oilChange ? { ...service, durationMinutes: 45 } : service,
    );
    expect(fresh).toEqual(expected);
    expect(JSON.parse((await redis.client.get(redis.key))!)).toEqual(expected);
    expect(invalidation).not.toHaveBeenCalled();
    expect(await redis.client.ttl(redis.key)).toBeGreaterThanOrEqual(299);
    expect(await redis.client.ttl(redis.key)).toBeLessThanOrEqual(300);

    // Make a GET accidentally extending expiry detectable without waiting.
    await redis.client.expire(redis.key, 60);
    const reads = vi.spyOn(apps[1].app.get(CatalogRepository), 'findActiveServiceTypes');
    await apps[1].http.get(endpoint).expect(200).expect(expected);
    expect(reads).not.toHaveBeenCalled();
    expect(await redis.client.ttl(redis.key)).toBeGreaterThan(0);
    expect(await redis.client.ttl(redis.key)).toBeLessThanOrEqual(60);
  });

  it('keeps the database and existing cache unchanged when a catalog update rolls back', async () => {
    const initial = await apps[0].http.get(endpoint).expect(200);
    const original = await redis.client.get(redis.key);
    const repository = apps[0].app.get(CatalogRepository);
    const reads = vi.spyOn(repository, 'findActiveServiceTypes');
    const cache = apps[0].app.get(ServiceCatalogCache);
    const writes = vi.spyOn(cache, 'set');
    const failure = new Error('Abort catalog update');

    const changeAndRefresh = async () => {
      await database.prisma.$transaction(async (tx) => {
        await tx.serviceType.update({ where: { id: id.oilChange }, data: { durationMinutes: 45 } });
        throw failure;
      });
      const fresh = await repository.findActiveServiceTypes();
      await cache.set(fresh);
    };
    await expect(changeAndRefresh()).rejects.toBe(failure);

    expect(
      await database.prisma.serviceType.findUniqueOrThrow({ where: { id: id.oilChange } }),
    ).toMatchObject({ durationMinutes: 30 });
    expect(await redis.client.get(redis.key)).toBe(original);
    expect(reads).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
    const otherReads = vi.spyOn(apps[1].app.get(CatalogRepository), 'findActiveServiceTypes');
    await apps[1].http
      .get(endpoint)
      .expect(200)
      .expect(initial.body as ServiceTypeDto[]);
    expect(otherReads).not.toHaveBeenCalled();
  });

  it('refetches after expiry and after committed changes followed by invalidation', async () => {
    await apps[0].http.get(endpoint).expect(200);
    await database.prisma.$transaction(async (tx) => {
      await tx.serviceType.update({ where: { id: id.oilChange }, data: { durationMinutes: 45 } });
    });
    expect(await apps[1].app.get(ServiceCatalogCache).invalidate()).toBe(true);
    const fresh = await apps[0].http.get(endpoint).expect(200);
    expect(fresh.body as ServiceTypeDto[]).toContainEqual({
      id: id.oilChange,
      name: 'Oil Change',
      durationMinutes: 45,
    });
    await database.prisma.serviceType.update({
      where: { id: id.oilChange },
      data: { name: 'Updated Oil Change' },
    });
    await redis.client.expire(redis.key, 0);
    const expired = await apps[1].http.get(endpoint).expect(200);
    expect(expired.body as ServiceTypeDto[]).toContainEqual({
      id: id.oilChange,
      name: 'Updated Oil Change',
      durationMinutes: 45,
    });
  });

  it('filters inactive services and caches an empty catalog', async () => {
    await database.prisma.serviceType.updateMany({ data: { isActive: false } });
    await apps[0].http.get(endpoint).expect(200).expect([]);
    expect(await redis.client.get(redis.key)).toBe('[]');
    const read = vi.spyOn(apps[1].app.get(CatalogRepository), 'findActiveServiceTypes');
    await apps[1].http.get(endpoint).expect(200).expect([]);
    expect(read).not.toHaveBeenCalled();
  });

  it.each(['not JSON', '{}', '[{"id":"invalid"}]'])(
    'replaces malformed cached data: %s',
    async (raw) => {
      await redis.client.set(redis.key, raw, 'EX', 300);
      const response = await apps[0].http.get(endpoint).expect(200);
      expect(response.body as ServiceTypeDto[]).toHaveLength(4);
      expect(JSON.parse((await redis.client.get(redis.key))!)).toEqual(response.body);
    },
  );

  it('starts and serves catalog and booking when Redis is unavailable', async () => {
    const offline = await createBookingApp(database.url, {
      REDIS_URL: 'redis://127.0.0.1:1',
      CATALOG_CACHE_NAMESPACE: 'offline-test',
    });
    try {
      await offline.http.get('/health').expect(200);
      await offline.http.get(endpoint).expect(200);
      await offline.http
        .post('/api/v1/appointments')
        .set('Idempotency-Key', randomUUID())
        .send(bookingInput)
        .expect(201);
    } finally {
      await offline.close();
    }
  });

  it('keeps namespaces isolated', async () => {
    await redis.client.set(redis.key, '[]', 'EX', 300);
    const isolated = await createTestRedis();
    const app = await createBookingApp(database.url, isolated.config);
    try {
      const response = await app.http.get(endpoint).expect(200);
      expect(response.body as ServiceTypeDto[]).toHaveLength(4);
      expect(await redis.client.get(redis.key)).toBe('[]');
    } finally {
      await app.close();
      await isolated.close();
    }
  });

  it('preserves database error classification on a miss and caches no failure', async () => {
    const unavailable = new PrismaService(
      new ConfigService({ DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/unreachable' }),
    );
    const broken = new CatalogRepository(unavailable);
    vi.spyOn(apps[0].app.get(CatalogRepository), 'findActiveServiceTypes').mockImplementationOnce(
      () => broken.findActiveServiceTypes(),
    );
    try {
      const response = await apps[0].http.get(endpoint).expect(503);
      expect(response.body).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } });
      expect(await redis.client.get(redis.key)).toBeNull();
    } finally {
      await unavailable.$disconnect();
    }
  });

  it('uses authoritative duration and active status for booking and availability despite a warm stale catalog', async () => {
    await apps[0].http.get(endpoint).expect(200);
    await database.prisma.serviceType.update({
      where: { id: id.oilChange },
      data: { durationMinutes: 45 },
    });
    const available = await apps[0].http
      .get(`/api/v1/dealerships/${id.dealershipA}/availability`)
      .query({ serviceTypeId: id.oilChange, startAt: bookingInput.startAt })
      .expect(200);
    expect(available.body).toMatchObject({ endAt: at('10:45').toISOString() });
    const created = await apps[0].http
      .post('/api/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .send(bookingInput)
      .expect(201);
    expect(created.body).toMatchObject({ endAt: at('10:45').toISOString() });
    await database.prisma.serviceType.update({
      where: { id: id.oilChange },
      data: { isActive: false },
    });
    await apps[1].http
      .post('/api/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .send({ ...bookingInput, startAt: at('12:00').toISOString() })
      .expect(422);
    await apps[1].http
      .get(`/api/v1/dealerships/${id.dealershipA}/availability`)
      .query({ serviceTypeId: id.oilChange, startAt: at('12:00').toISOString() })
      .expect(422);
    const stale = await apps[1].http.get(endpoint).expect(200);
    expect(stale.body as ServiceTypeDto[]).toContainEqual({
      id: id.oilChange,
      name: 'Oil Change',
      durationMinutes: 30,
    });
    expect(await database.prisma.appointment.count()).toBe(1);
  });
});
