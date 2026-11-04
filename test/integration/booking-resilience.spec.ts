import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { request } from 'node:http';
import { AddressInfo } from 'node:net';
import { fixtureIds as id } from '../../prisma/seed-data';
import { AppointmentRepository } from '../../src/appointments/appointment.repository';
import { BookingCapacity } from '../../src/appointments/booking-capacity';
import { BookingConflict, DatabaseUnavailable } from '../../src/appointments/booking.error';
import { postgresState } from '../../src/appointments/database-error';
import { validateEnvironment } from '../../src/config/environment';
import { createTestDatabase } from '../helpers/test-database';
import {
  at,
  bookingInput,
  createBookingApp,
  ErrorJson,
  resetBookingFixtures,
} from '../helpers/booking-app';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const data = () => ({
  ...bookingInput,
  startAt: at('10:00'),
  endAt: at('10:30'),
  technicianId: id.technicianA1,
  serviceBayId: id.bayA1,
});

describe('booking limits and conflict-aware persistence with PostgreSQL', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let application: Awaited<ReturnType<typeof createBookingApp>>;
  let repository: AppointmentRepository;
  let capacity: BookingCapacity;
  beforeAll(async () => {
    database = await createTestDatabase();
    application = await createBookingApp(database.url);
    await application.app.listen(0, '127.0.0.1');
    repository = application.app.get(AppointmentRepository);
    capacity = application.app.get(BookingCapacity);
  });
  beforeEach(async () => {
    await resetBookingFixtures(database.prisma);
    const config = application.app.get(ConfigService);
    for (const [key, value] of Object.entries(validateEnvironment({ DATABASE_URL: database.url })))
      config.set(key, value);
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    try {
      await application?.close();
    } finally {
      await database?.close();
    }
  });

  it('has only the expected skip-on-conflict arbiters', async () => {
    const arbiters = await database.prisma.$queryRaw<Array<{ name: string }>>`
      SELECT conname AS name FROM pg_constraint WHERE conrelid = 'appointments'::regclass AND contype IN ('p','u','x') ORDER BY conname`;
    expect(arbiters.map((a) => a.name)).toEqual([
      'appointments_pkey',
      'no_overlapping_bay_appointments',
      'no_overlapping_technician_appointments',
    ]);
  });

  it('does not classify an identifier collision at a free interval as resource contention', async () => {
    const original = await repository.transaction((tx) => repository.create(data(), tx));
    await expect(
      repository.transaction((tx) =>
        repository.create(
          { ...data(), id: original.id, startAt: at('12:00'), endAt: at('12:30') },
          tx,
        ),
      ),
    ).rejects.toThrow('Appointment identifier already exists.');
    expect(await database.prisma.appointment.count()).toBe(1);
  });

  it('rolls back preceding writes when a skipped insert loses an allocation race', async () => {
    await repository.transaction((tx) => repository.create(data(), tx));
    const customer = randomUUID();
    await expect(
      repository.transaction(async (tx) => {
        await tx.customer.create({ data: { id: customer, name: 'Rollback fixture' } });
        return repository.create({ ...data(), customerId: customer }, tx);
      }),
    ).rejects.toEqual(new BookingConflict('resource'));
    expect(await database.prisma.customer.findUnique({ where: { id: customer } })).toBeNull();
    expect(await database.prisma.appointment.count()).toBe(1);
  });

  it.each([
    ['foreign key', { customerId: randomUUID() }, '23503'],
    ['interval CHECK', { endAt: at('09:00') }, '23514'],
  ])(
    'preserves unexpected %s failures on an actual insertion',
    async (_name, changes, expected) => {
      let failure: unknown;
      try {
        await repository.transaction((tx) => repository.create({ ...data(), ...changes }, tx));
      } catch (error) {
        failure = error;
      }
      expect(postgresState(failure)).toBe(expected);
      expect(failure).not.toBeInstanceOf(BookingConflict);
      expect(await database.prisma.appointment.count()).toBe(0);
    },
  );

  it('inherits database defaults and restores a test override after statement cancellation', async () => {
    type Settings = { pid: number; lock: string; statement: string; transaction: string };
    const settings = () =>
      application.prisma.$queryRaw<
        Settings[]
      >`SELECT pg_backend_pid() AS pid, current_setting('lock_timeout') AS lock, current_setting('statement_timeout') AS statement, current_setting('transaction_timeout') AS transaction`;
    const [before] = await settings();
    expect(before).toMatchObject({ lock: '250ms', statement: '2s', transaction: '5s' });
    await expect(
      repository.transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '100ms'`;
        const [local] = await tx.$queryRaw<
          Settings[]
        >`SELECT pg_backend_pid() AS pid, current_setting('lock_timeout') AS lock, current_setting('statement_timeout') AS statement, current_setting('transaction_timeout') AS transaction`;
        expect(local.lock).toBe('100ms');
        expect(local.statement).toBe('2s');
        expect(local.transaction).toBe('5s');
        await repository.create(data(), tx);
        await tx.$executeRaw`SELECT pg_sleep(3)`;
      }),
    ).rejects.toBeInstanceOf(DatabaseUnavailable);
    const [after] = await settings();
    expect(after).toEqual(before);
    expect(await database.prisma.appointment.count()).toBe(0);
    await application.http
      .post('/api/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .send(bookingInput)
      .expect(201);
  });

  it('enforces the fixed five-second database transaction limit independently of Prisma', async () => {
    await expect(
      repository.transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL statement_timeout = '0'`;
        await repository.create(data(), tx);
        await tx.$executeRaw`SELECT pg_sleep(6)`;
      }, performance.now() + 10000),
    ).rejects.toBeInstanceOf(DatabaseUnavailable);
    expect(await database.prisma.appointment.count()).toBe(0);
    await application.http
      .post('/api/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .send(bookingInput)
      .expect(201);
  });

  it('returns 503 and rolls back when the remaining Prisma booking budget expires first', async () => {
    const config = application.app.get(ConfigService);
    config.set('BOOKING_TIMEOUT_MS', 100);
    const create = repository.create.bind(repository);
    vi.spyOn(repository, 'create').mockImplementationOnce(async (...args) => {
      const appointment = await create(...args);
      await args[1].$executeRaw`SELECT pg_sleep(0.25)`;
      return appointment;
    });
    const response = await application.http
      .post('/api/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .send(bookingInput)
      .expect(503);
    expect(response.body).toMatchObject({ error: { code: 'BOOKING_TIMEOUT' } });
    expect(await database.prisma.appointment.count()).toBe(0);
    expect(capacity.counts.active).toBe(0);
    config.set('BOOKING_TIMEOUT_MS', 5000);
    await application.http
      .post('/api/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .send(bookingInput)
      .expect(201);
  });

  it('does not classify an unrelated closed-transaction bug as booking timeout', async () => {
    const closed = await application.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1`;
      return tx;
    });
    await expect(
      repository.transaction(() => closed.customer.findUnique({ where: { id: id.customer1 } })),
    ).rejects.toMatchObject({ code: 'P2028' });
    expect(await database.prisma.appointment.count()).toBe(0);
  });

  it.each([
    { endpoint: 'availability', table: 'dealerships' },
    { endpoint: 'availability', table: 'appointments' },
    { endpoint: 'appointment', table: 'appointments' },
  ])(
    'returns safe 503 for read-side lock timeout: $endpoint GET / $table',
    async ({ endpoint, table }) => {
      const appointment = await repository.transaction((tx) => repository.create(data(), tx));
      const path =
        endpoint === 'availability'
          ? `/api/v1/dealerships/${id.dealershipA}/availability`
          : `/api/v1/appointments/${appointment.id}`;
      const query =
        endpoint === 'availability'
          ? { serviceTypeId: id.oilChange, startAt: bookingInput.startAt }
          : {};
      const before = await application.http.get(path).query(query).expect(200);
      const count = await database.prisma.appointment.count();
      const locked = deferred();
      const release = deferred();
      const holder = database.prisma.$transaction(async (tx) => {
        if (table === 'dealerships') {
          await tx.$executeRaw`LOCK TABLE dealerships IN ACCESS EXCLUSIVE MODE`;
        } else {
          await tx.$executeRaw`LOCK TABLE appointments IN ACCESS EXCLUSIVE MODE`;
        }
        locked.resolve();
        await release.promise;
      });

      try {
        // Also propagate acquisition failure instead of waiting indefinitely for the barrier.
        await Promise.race([locked.promise, holder]);
        const response = await application.http.get(path).query(query).expect(503);
        const body = response.body as ErrorJson;
        expect(body.requestId).toEqual(expect.any(String));
        expect(response.body).toEqual({
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'The service is temporarily unavailable. Please retry later.',
          },
          requestId: body.requestId,
        });
        expect(response.headers['retry-after']).toBe('1');
        expect(response.headers['x-request-id']).toBe(body.requestId);
      } finally {
        release.resolve();
        await holder;
      }

      const recovered = await application.http.get(path).query(query).expect(200);
      expect(recovered.body).toEqual(before.body);
      expect(await database.prisma.appointment.count()).toBe(count);
    },
  );

  it('rejects excess admission with 503 while read-only availability stays responsive', async () => {
    const config = application.app.get(ConfigService);
    config.set('BOOKING_MAX_CONCURRENT', 1);
    config.set('BOOKING_MAX_PENDING', 0);
    const release = await capacity.acquire(performance.now() + 5000);
    try {
      const response = await application.http
        .post('/api/v1/appointments')
        .set('Idempotency-Key', randomUUID())
        .send(bookingInput)
        .expect(503);
      expect(response.body).toMatchObject({ error: { code: 'BOOKING_BUSY' } });
      expect(response.headers['retry-after']).toBe('1');
      await application.http
        .get(`/api/v1/dealerships/${id.dealershipA}/availability`)
        .query({ serviceTypeId: id.oilChange, startAt: bookingInput.startAt })
        .expect(200);
      expect(await database.prisma.appointment.count()).toBe(0);
    } finally {
      release();
    }
    await application.http
      .post('/api/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .send(bookingInput)
      .expect(201);
  });

  it('removes a disconnected HTTP request from the pending queue', async () => {
    application.app.get(ConfigService).set('BOOKING_MAX_CONCURRENT', 1);
    const release = await capacity.acquire(performance.now() + 5000);
    const queued = deferred(),
      aborted = deferred();
    const acquire = capacity.acquire.bind(capacity);
    vi.spyOn(capacity, 'acquire').mockImplementationOnce((deadline, signal) => {
      const result = acquire(deadline, signal);
      signal?.addEventListener('abort', aborted.resolve, { once: true });
      queued.resolve();
      return result;
    });
    const server = application.app.getHttpServer() as import('node:http').Server;
    const client = request({
      hostname: '127.0.0.1',
      port: (server.address() as AddressInfo).port,
      method: 'POST',
      path: '/api/v1/appointments',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
    });
    client.on('error', () => {
      /* Expected client-side destruction below. */
    });
    client.end(JSON.stringify(bookingInput));
    try {
      await queued.promise;
      expect(capacity.counts.pending).toBe(1);
      client.destroy();
      await aborted.promise;
      expect(capacity.counts.pending).toBe(0);
      expect(await database.prisma.appointment.count()).toBe(0);
    } finally {
      client.destroy();
      release();
    }
    expect(capacity.counts.active).toBe(0);
  });

  it('returns retryable contention for a real held FK lock and releases the booking slot', async () => {
    application.app.get(ConfigService).set('BOOKING_MAX_ATTEMPTS', 1);
    const locked = deferred(),
      release = deferred();
    const holder = database.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM technicians WHERE id = ${id.technicianA1}::uuid FOR UPDATE`;
      locked.resolve();
      await release.promise;
    });
    await locked.promise;
    try {
      const response = await application.http
        .post('/api/v1/appointments')
        .set('Idempotency-Key', randomUUID())
        .send(bookingInput)
        .expect(503);
      expect(response.body).toMatchObject({ error: { code: 'BOOKING_CONTENTION' } });
      expect(capacity.counts.active).toBe(0);
      expect(await database.prisma.appointment.count()).toBe(0);
    } finally {
      release.resolve();
      await holder;
    }
    await application.http
      .post('/api/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .send(bookingInput)
      .expect(201);
  });
  it('reports pool acquisition failure as 503 without starting a booking transaction', async () => {
    const full = deferred(),
      release = deferred();
    let acquired = 0;
    const holders = Array.from({ length: 10 }, () =>
      application.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1`;
          if (++acquired === 10) full.resolve();
          await release.promise;
        },
        { timeout: 10000 },
      ),
    );
    await full.promise;
    try {
      const response = await application.http
        .post('/api/v1/appointments')
        .set('Idempotency-Key', randomUUID())
        .send(bookingInput)
        .expect(503);
      expect(response.body).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } });
      expect(capacity.counts.active).toBe(0);
      expect(await database.prisma.appointment.count()).toBe(0);
    } finally {
      release.resolve();
      await Promise.all(holders);
    }
    await application.http
      .post('/api/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .send(bookingInput)
      .expect(201);
  });
});
