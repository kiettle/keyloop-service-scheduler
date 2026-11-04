import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { request, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { fixtureIds as id } from '../../prisma/seed-data';
import { AppointmentRepository } from '../../src/appointments/appointment.repository';
import { BookingRequestRepository } from '../../src/appointments/booking-request.repository';
import { bookingFingerprint } from '../../src/appointments/booking-idempotency';
import { BookingCapacity } from '../../src/appointments/booking-capacity';
import { Clock } from '../../src/common/time/clock';
import { postgresState } from '../../src/appointments/database-error';
import { createTestDatabase } from '../helpers/test-database';
import {
  AppointmentJson,
  ErrorJson,
  at,
  bookingInput,
  createBookingApp,
  resetBookingFixtures,
} from '../helpers/booking-app';

const appointmentBody = (response: { body: unknown }) => response.body as AppointmentJson;
const errorCode = (response: { body: unknown }) => (response.body as ErrorJson).error.code;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('durable booking idempotency across app instances', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let apps: Awaited<ReturnType<typeof createBookingApp>>[];
  const fingerprint = bookingFingerprint({
    ...bookingInput,
    startAt: new Date(bookingInput.startAt),
  });
  beforeAll(async () => {
    database = await createTestDatabase();
    apps = await Promise.all([createBookingApp(database.url), createBookingApp(database.url)]);
    await Promise.all(apps.map((app) => app.app.listen(0, '127.0.0.1')));
  });
  beforeEach(async () => {
    await resetBookingFixtures(database.prisma);
    for (const app of apps) {
      app.app.get(ConfigService).set('BOOKING_TIMEOUT_MS', 5000);
      app.app.get(ConfigService).set('BOOKING_MAX_ATTEMPTS', 4);
      app.app.get(ConfigService).set('BOOKING_MAX_CONCURRENT', 8);
    }
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    try {
      await Promise.all((apps ?? []).map((app) => app.close()));
    } finally {
      await database?.close();
    }
  });

  const post = (
    key: string,
    input: Record<keyof typeof bookingInput, string> = bookingInput,
    app = apps[0],
  ) => app.http.post('/api/v1/appointments').set('Idempotency-Key', key).send(input);

  async function assertState(count: number) {
    const rows = await database.prisma.appointmentBookingRequest.findMany();
    expect(rows).toHaveLength(count);
    expect(await database.prisma.appointment.count()).toBe(count);
    for (const row of rows) {
      expect(row.appointmentId).not.toBeNull();
      expect(row.responseBody).toMatchObject({ id: row.appointmentId, status: 'CONFIRMED' });
    }
    const [overlap] = await database.prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count FROM appointments a JOIN appointments b ON a.id < b.id
      WHERE a.status = 'CONFIRMED' AND b.status = 'CONFIRMED'
        AND (a.technician_id = b.technician_id OR a.service_bay_id = b.service_bay_id)
        AND tstzrange(a.start_at,a.end_at,'[)') && tstzrange(b.start_at,b.end_at,'[)')
    `;
    expect(overlap.count).toBe(0);
  }

  it('replays the exact saved response from another instance with a fresh request ID', async () => {
    const key = randomUUID();
    const first = await post(key).expect(201);
    const replay = await post(key, bookingInput, apps[1]).expect(201);
    expect(first.headers['idempotency-replayed']).toBe('false');
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.headers['x-request-id']).not.toBe(first.headers['x-request-id']);
    expect(replay.body).toEqual(first.body);
    expect(replay.text).toBe(first.text);
    expect(
      (await database.prisma.appointmentBookingRequest.findUniqueOrThrow({ where: { key } }))
        .responseBody,
    ).toEqual(first.body);
    await assertState(1);
  });

  it('canonicalizes header/UUID casing, equivalent offsets, and property order', async () => {
    const key = randomUUID();
    const first = await post(key).expect(201);
    const replay = await post(key.toUpperCase(), {
      startAt: '2035-01-15T17:00:00+07:00',
      serviceTypeId: bookingInput.serviceTypeId.toUpperCase(),
      dealershipId: bookingInput.dealershipId.toUpperCase(),
      vehicleId: bookingInput.vehicleId.toUpperCase(),
      customerId: bookingInput.customerId.toUpperCase(),
    }).expect(201);
    expect(replay.body).toEqual(first.body);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    await assertState(1);
  });

  it.each(['customerId', 'vehicleId', 'dealershipId', 'serviceTypeId', 'startAt'] as const)(
    'rejects changed %s before dynamic validation',
    async (field) => {
      const key = randomUUID();
      await post(key).expect(201);
      const changed = {
        ...bookingInput,
        [field]: field === 'startAt' ? at('11:00').toISOString() : randomUUID(),
      };
      const result = await post(key, changed).expect(409);
      expect(errorCode(result)).toBe('IDEMPOTENCY_KEY_REUSED');
      await assertState(1);
    },
  );

  it('100 concurrent same-key requests across two instances produce one saved appointment', async () => {
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) => post(key, bookingInput, apps[i % 2]).expect(201)),
    );
    expect(results.filter((r) => r.headers['idempotency-replayed'] === 'false')).toHaveLength(1);
    expect(results.filter((r) => r.headers['idempotency-replayed'] === 'true')).toHaveLength(99);
    for (const response of results) expect(response.body).toEqual(results[0].body);
    await assertState(1);
  });

  it('treats different keys as independent booking intents', async () => {
    const first = await post(randomUUID()).expect(201);
    const second = await post(randomUUID()).expect(201);
    expect(appointmentBody(second).id).not.toBe(appointmentBody(first).id);
    expect(second.headers['idempotency-replayed']).toBe('false');
    await assertState(2);
  });

  it('does not retain a cancelled queued request', async () => {
    const app = apps[0];
    app.app.get(ConfigService).set('BOOKING_MAX_CONCURRENT', 1);
    const capacity = app.app.get(BookingCapacity);
    const release = await capacity.acquire(performance.now() + 5000);
    const queued = deferred(),
      cancelled = deferred();
    const acquire = capacity.acquire.bind(capacity);
    vi.spyOn(capacity, 'acquire').mockImplementationOnce((deadline, signal) => {
      const result = acquire(deadline, signal);
      signal?.addEventListener('abort', cancelled.resolve, { once: true });
      queued.resolve();
      return result;
    });
    const key = randomUUID();
    const server = app.app.getHttpServer() as Server;
    const client = request({
      host: '127.0.0.1',
      port: (server.address() as AddressInfo).port,
      path: '/api/v1/appointments',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
    });
    client.on('error', () => {
      /* Expected disconnect while queued. */
    });
    client.end(JSON.stringify(bookingInput));
    try {
      await queued.promise;
      expect(capacity.counts.pending).toBe(1);
      client.destroy();
      await cancelled.promise;
      expect(capacity.counts.pending).toBe(0);
      await assertState(0);
    } finally {
      client.destroy();
      release();
    }
    await post(key).expect(201);
    await assertState(1);
  });

  it.each(['commit', 'rollback'] as const)(
    'resolves a waiting same-key request after the owner %s',
    async (outcome) => {
      const key = randomUUID(),
        claimed = deferred(),
        release = deferred(),
        competitor = deferred();
      const ownerRepo = apps[0].app.get(BookingRequestRepository);
      const ownerClaim = ownerRepo.claim.bind(ownerRepo);
      vi.spyOn(ownerRepo, 'claim').mockImplementationOnce(async (...args) => {
        const result = await ownerClaim(...args);
        claimed.resolve();
        await release.promise;
        if (outcome === 'rollback') throw new Error('Injected owner rollback');
        return result;
      });
      const otherRepo = apps[1].app.get(BookingRequestRepository);
      const otherClaim = otherRepo.claim.bind(otherRepo);
      vi.spyOn(otherRepo, 'claim').mockImplementation(async (...args) => {
        competitor.resolve();
        return otherClaim(...args);
      });
      const owner = post(key).then((r) => r);
      try {
        await claimed.promise;
        const other = post(
          key,
          { ...bookingInput, startAt: at('11:00').toISOString() },
          apps[1],
        ).then((r) => r);
        await competitor.promise;
        release.resolve();
        const ownerResponse = await owner;
        const waitingResponse = await other;
        if (outcome === 'commit') {
          expect(ownerResponse.status).toBe(201);
          expect(waitingResponse.status).toBe(409);
          expect(errorCode(waitingResponse)).toBe('IDEMPOTENCY_KEY_REUSED');
        } else {
          expect(ownerResponse.status).toBe(500);
          expect(waitingResponse.status).toBe(201);
          expect(waitingResponse.headers['idempotency-replayed']).toBe('false');
          const replay = await post(key, {
            ...bookingInput,
            startAt: at('11:00').toISOString(),
          }).expect(201);
          expect(replay.headers['idempotency-replayed']).toBe('true');
          expect(replay.body).toEqual(waitingResponse.body);
        }
        await assertState(1);
      } finally {
        release.resolve();
        await owner;
      }
    },
  );

  it('preserves retrieval and resource allocation for an older appointment without a key record', async () => {
    const repository = apps[0].app.get(AppointmentRepository);
    const legacy = await repository.transaction((tx) =>
      repository.create(
        {
          ...bookingInput,
          startAt: at('10:00'),
          endAt: at('10:30'),
          technicianId: id.technicianA1,
          serviceBayId: id.bayA1,
          status: 'CONFIRMED',
        },
        tx,
      ),
    );
    const before = await database.prisma.appointment.findUniqueOrThrow({
      where: { id: legacy.id },
    });
    expect(await database.prisma.appointmentBookingRequest.count()).toBe(0);
    const oldResponse = await apps[0].http.get(`/api/v1/appointments/${legacy.id}`).expect(200);
    expect(oldResponse.body).toMatchObject({
      ...bookingInput,
      id: legacy.id,
      endAt: at('10:30').toISOString(),
      status: 'CONFIRMED',
    });
    const current = await post(randomUUID()).expect(201);
    expect(appointmentBody(current).technicianId).not.toBe(legacy.technicianId);
    expect(appointmentBody(current).serviceBayId).not.toBe(legacy.serviceBayId);
    expect(await database.prisma.appointment.count()).toBe(2);
    expect(await database.prisma.appointmentBookingRequest.count()).toBe(1);
    expect(
      await database.prisma.appointment.findUniqueOrThrow({ where: { id: legacy.id } }),
    ).toEqual(before);
    const afterResponse = await apps[1].http.get(`/api/v1/appointments/${legacy.id}`).expect(200);
    expect(afterResponse.body).toEqual(oldResponse.body);
  });

  it.each(['after claim', 'after appointment', 'after snapshot'])(
    'rolls back %s and allows a same-key retry',
    async (point) => {
      const key = randomUUID();
      const requests = apps[0].app.get(BookingRequestRepository);
      if (point === 'after claim') {
        const claim = requests.claim.bind(requests);
        vi.spyOn(requests, 'claim').mockImplementationOnce(async (...args) => {
          await claim(...args);
          throw new Error('Injected rollback');
        });
      } else {
        const complete = requests.complete.bind(requests);
        vi.spyOn(requests, 'complete').mockImplementationOnce(async (...args) => {
          if (point === 'after snapshot') await complete(...args);
          throw new Error('Injected rollback');
        });
      }
      const failed = await post(key).expect(500);
      expect(JSON.stringify(failed.body)).not.toContain('Injected rollback');
      await assertState(0);
      await post(key).expect(201);
      await assertState(1);
    },
  );

  it('does not retain validation or availability failures', async () => {
    const key = randomUUID();
    await post(key, { ...bookingInput, startAt: at('00:00').toISOString() }).expect(422);
    await assertState(0);
    await database.prisma.technician.updateMany({ data: { isActive: false } });
    await post(key).expect(409);
    await assertState(0);
    await database.prisma.technician.updateMany({ data: { isActive: true } });
    await post(key).expect(201);
    await assertState(1);
  });

  it('replays past appointments despite changed resources and catalog', async () => {
    const key = randomUUID();
    const first = await post(key).expect(201);
    vi.spyOn(apps[1].app.get(Clock), 'now').mockReturnValue(at('23:00'));
    await database.prisma.serviceType.updateMany({
      data: { isActive: false, durationMinutes: 45 },
    });
    await database.prisma.technician.updateMany({ data: { isActive: false } });
    await database.prisma.serviceBay.updateMany({ data: { isActive: false } });
    const replay = await post(key, bookingInput, apps[1]).expect(201);
    expect(replay.body).toEqual(first.body);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    await assertState(1);
  });

  it('recovers a response dropped after commit, including after app restart', async () => {
    const key = randomUUID();
    const repository = apps[0].app.get(AppointmentRepository);
    const transaction = repository.transaction.bind(repository);
    const committed = deferred(),
      finish = deferred();
    vi.spyOn(repository, 'transaction').mockImplementationOnce(async (...args) => {
      const result = await transaction(...args);
      committed.resolve();
      await finish.promise;
      return result;
    });
    const server = apps[0].app.getHttpServer() as Server;
    const client = request({
      host: '127.0.0.1',
      port: (server.address() as AddressInfo).port,
      path: '/api/v1/appointments',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
    });
    client.on('error', () => {
      /* Deliberate lost acknowledgement. */
    });
    const closed = new Promise<void>((resolve) => client.once('close', resolve));
    client.end(JSON.stringify(bookingInput));
    try {
      await committed.promise;
      await assertState(1);
      client.destroy();
      await closed;
    } finally {
      finish.resolve();
      client.destroy();
    }
    await apps[0].close();
    apps[0] = await createBookingApp(database.url);
    await apps[0].app.listen(0, '127.0.0.1');
    const recovered = await post(key).expect(201);
    expect(recovered.headers['idempotency-replayed']).toBe('true');
    const saved = await database.prisma.appointmentBookingRequest.findUniqueOrThrow({
      where: { key },
    });
    expect(recovered.body).toEqual(saved.responseBody);
    await assertState(1);
  });

  it('bounds real unique-key lock waits and can recover after owner rollback', async () => {
    const key = randomUUID(),
      locked = deferred(),
      release = deferred();
    const holder = database.prisma
      .$transaction(async (tx) => {
        await tx.appointmentBookingRequest.create({
          data: { key, requestFingerprint: fingerprint },
        });
        locked.resolve();
        await release.promise;
        throw new Error('Release claim by rollback');
      })
      .catch((error: unknown) => {
        expect(error).toMatchObject({ message: 'Release claim by rollback' });
      });
    await Promise.race([locked.promise, holder]);
    apps[0].app.get(ConfigService).set('BOOKING_TIMEOUT_MS', 750);
    apps[0].app.get(ConfigService).set('BOOKING_MAX_ATTEMPTS', 1);
    const repository = apps[0].app.get(BookingRequestRepository);
    const attempts = vi.spyOn(repository, 'claim');
    try {
      const result = await post(key).expect(503);
      expect(errorCode(result)).toBe('BOOKING_TIMEOUT');
      expect(result.headers['retry-after']).toBe('1');
      expect(attempts.mock.calls.length).toBeGreaterThan(1);
      expect(apps[0].app.get(BookingCapacity).counts).toEqual({ active: 0, pending: 0 });
      await assertState(0);
    } finally {
      release.resolve();
      await holder;
    }
    apps[0].app.get(ConfigService).set('BOOKING_TIMEOUT_MS', 5000);
    await post(key).expect(201);
    await assertState(1);
  });

  it.each([undefined, '', 'bad', '12345678-1234-1123-8123-123456789abc'])(
    'rejects missing or invalid key %s',
    async (key) => {
      const call = apps[0].http.post('/api/v1/appointments');
      if (key !== undefined) call.set('Idempotency-Key', key);
      const result = await call.send(bookingInput).expect(400);
      expect(errorCode(result)).toBe('VALIDATION_ERROR');
      await assertState(0);
    },
  );

  it('rejects repeated physical headers, even with identical values', async () => {
    const key = randomUUID();
    const server = apps[0].app.getHttpServer() as Server;
    const status = await new Promise<number>((resolve, reject) => {
      const call = request(
        {
          host: '127.0.0.1',
          port: (server.address() as AddressInfo).port,
          path: '/api/v1/appointments',
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': [key, key] },
        },
        (response) => {
          response.resume();
          response.on('end', () => resolve(response.statusCode!));
        },
      );
      call.on('error', reject);
      call.end(JSON.stringify(bookingInput));
    });
    expect(status).toBe(400);
    await assertState(0);
  });

  it('rejects malformed body syntax before replay', async () => {
    const key = randomUUID();
    await post(key).expect(201);
    await post(key, { ...bookingInput, startAt: 'invalid' }).expect(400);
    await assertState(1);
  });

  it('does not silently recover incomplete or corrupt committed records', async () => {
    const key = randomUUID();
    await database.prisma.appointmentBookingRequest.create({
      data: { key, requestFingerprint: fingerprint },
    });
    const response = await post(key).expect(500);
    expect(errorCode(response)).toBe('INTERNAL_ERROR');
    expect(await database.prisma.appointment.count()).toBe(0);
    expect(await database.prisma.appointmentBookingRequest.count()).toBe(1);
    await database.prisma.appointmentBookingRequest.delete({ where: { key } });
    await post(key).expect(201);
    await database.prisma.appointmentBookingRequest.update({
      where: { key },
      data: { responseBody: { privateField: 'must not leak' } },
    });
    const corrupt = await post(key).expect(500);
    expect(JSON.stringify(corrupt.body)).not.toContain('must not leak');
    expect(await database.prisma.appointment.count()).toBe(1);
  });

  it('enforces pairing, JSON object, fingerprint, foreign key, and appointment uniqueness in PostgreSQL', async () => {
    const key = randomUUID();
    const response = await post(key).expect(201);
    const invalid: Array<[Prisma.AppointmentBookingRequestUncheckedCreateInput, string]> = [
      [
        {
          key: randomUUID(),
          requestFingerprint: fingerprint,
          appointmentId: appointmentBody(response).id,
        },
        '23514',
      ],
      [
        {
          key: randomUUID(),
          requestFingerprint: fingerprint,
          responseBody: { ...appointmentBody(response) },
        },
        '23514',
      ],
      [{ key: randomUUID(), requestFingerprint: 'bad' }, '23514'],
      [
        {
          key: randomUUID(),
          requestFingerprint: fingerprint,
          appointmentId: randomUUID(),
          responseBody: {},
        },
        '23503',
      ],
      [
        {
          key: randomUUID(),
          requestFingerprint: fingerprint,
          appointmentId: appointmentBody(response).id,
          responseBody: [],
        },
        '23514',
      ],
      [
        {
          key: randomUUID(),
          requestFingerprint: fingerprint,
          appointmentId: appointmentBody(response).id,
          responseBody: { ...appointmentBody(response) },
        },
        '23505',
      ],
    ];
    for (const [data, state] of invalid) {
      let failure: unknown;
      try {
        await database.prisma.appointmentBookingRequest.create({ data });
      } catch (error) {
        failure = error;
      }
      expect(postgresState(failure)).toBe(state);
    }
    await expect(
      database.prisma.appointment.delete({ where: { id: appointmentBody(response).id } }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await assertState(1);
  });
});
