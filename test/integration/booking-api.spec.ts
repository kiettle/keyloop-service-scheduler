import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { fixtureIds as id } from '../../prisma/seed-data';
import { AppointmentRepository } from '../../src/appointments/appointment.repository';
import { BookingConflict } from '../../src/appointments/booking.error';
import { postgresState } from '../../src/appointments/database-error';
import { Environment } from '../../src/config/environment';
import { PrismaService } from '../../src/database/prisma.service';
import { SchedulingRepository } from '../../src/scheduling/scheduling.repository';
import { createTestDatabase } from '../helpers/test-database';
import {
  AppointmentJson,
  at,
  bookingInput,
  createBookingApp,
  ErrorJson,
  resetBookingFixtures,
} from '../helpers/booking-app';

describe('booking API with migrated PostgreSQL', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>> | undefined;
  let application: Awaited<ReturnType<typeof createBookingApp>>;
  let prisma: PrismaClient;

  beforeAll(async () => {
    database = await createTestDatabase();
    prisma = database.prisma;
    application = await createBookingApp(database.url);
  });
  beforeEach(async () => {
    await resetBookingFixtures(prisma);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    try {
      await application?.close();
    } finally {
      await database?.close();
    }
  });

  async function apiDocument() {
    const response = await application.http.get('/docs-json').expect(200);
    return response.body as OpenAPIObject;
  }

  function schema(document: OpenAPIObject, name: string): SchemaObject {
    const result = document.components?.schemas?.[name];
    if (!result || '$ref' in result) throw new Error(`Missing concrete schema ${name}`);
    return result;
  }

  it('serves the Swagger UI and local initialization script', async () => {
    const html = await application.http.get('/docs/').expect(200).expect('Content-Type', /html/);
    expect(html.text).toContain('Keyloop API documentation');
    expect(html.text).toContain('swagger-ui-init.js');
    await application.http.get('/docs/swagger-ui-init.js').expect(200);
  });

  it('documents exactly the accepted booking fields and unchanged API routes', async () => {
    const document = await apiDocument();
    expect(Object.keys(document.paths).toSorted()).toEqual([
      '/api/v1/appointments',
      '/api/v1/appointments/{id}',
      '/api/v1/dealerships/{dealershipId}/availability',
      '/health',
    ]);
    const booking = schema(document, 'CreateAppointmentDto');
    expect(document.paths['/api/v1/appointments'].post!.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Idempotency-Key',
          in: 'header',
          required: true,
        }),
      ]),
    );
    expect(document.paths['/api/v1/appointments'].post!.responses['201']).toMatchObject({
      headers: { 'Idempotency-Replayed': { schema: { enum: ['false', 'true'] } } },
    });
    const fields = ['customerId', 'dealershipId', 'serviceTypeId', 'startAt', 'vehicleId'];
    expect(booking.required?.toSorted()).toEqual(fields);
    expect(Object.keys(booking.properties ?? {}).toSorted()).toEqual(fields);
    expect(booking.additionalProperties).toBe(false);
    expect(booking.properties?.customerId).toMatchObject({ type: 'string', format: 'uuid' });
    expect(booking.properties?.startAt).toMatchObject({
      type: 'string',
      format: 'date-time',
    });
    expect(booking.properties?.startAt).toHaveProperty('pattern');
    expect(Object.keys(document.paths['/api/v1/appointments'].post!.responses).toSorted()).toEqual([
      '201',
      '400',
      '404',
      '409',
      '422',
      '500',
      '503',
    ]);
    const temporaryFailure = document.paths['/api/v1/appointments'].post!.responses['503'];
    expect(temporaryFailure).toHaveProperty('description', expect.stringContaining('BOOKING_BUSY'));
    expect(temporaryFailure).toHaveProperty(
      'description',
      expect.stringContaining('BOOKING_TIMEOUT'),
    );
  });

  it('documents public appointment/availability responses and required query parameters', async () => {
    const document = await apiDocument();
    const appointment = schema(document, 'AppointmentResponseDto');
    expect(Object.keys(appointment.properties ?? {}).toSorted()).toEqual([
      'createdAt',
      'customerId',
      'dealershipId',
      'endAt',
      'id',
      'serviceBayId',
      'serviceTypeId',
      'startAt',
      'status',
      'technicianId',
      'vehicleId',
    ]);
    expect(appointment.properties?.startAt).toMatchObject({ type: 'string', format: 'date-time' });
    const availability = schema(document, 'AvailabilityResponseDto');
    expect(Object.keys(availability.properties ?? {}).toSorted()).toEqual([
      'available',
      'availableServiceBayCount',
      'availableTechnicianCount',
      'dealershipId',
      'endAt',
      'serviceTypeId',
      'startAt',
    ]);
    const operation = document.paths['/api/v1/dealerships/{dealershipId}/availability'].get!;
    expect(operation.responses['503']).toHaveProperty(
      'description',
      expect.stringContaining('SERVICE_UNAVAILABLE'),
    );
    expect(operation.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'dealershipId', in: 'path', required: true }),
        expect.objectContaining({ name: 'serviceTypeId', in: 'query', required: true }),
        expect.objectContaining({ name: 'startAt', in: 'query', required: true }),
      ]),
    );
    expect(schema(document, 'ApiErrorResponseDto').required?.toSorted()).toEqual([
      'error',
      'requestId',
    ]);
    expect(schema(document, 'ApiErrorDetailsDto').required?.toSorted()).toEqual([
      'code',
      'message',
    ]);
  });

  it('does not reserve or change appointments when documentation is requested', async () => {
    await application.http
      .post('/api/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .send(bookingInput)
      .expect(201);
    const before = await prisma.appointment.findMany();
    await apiDocument();
    await application.http.get('/docs/').expect(200);
    expect(await prisma.appointment.findMany()).toEqual(before);
  });

  it('returns 201 only for a persisted confirmed booking and retrieves it after app restart', async () => {
    const response = await application.http
      .post('/api/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .send(bookingInput)
      .expect(201);
    const created = response.body as AppointmentJson;
    expect(created).toMatchObject({
      ...bookingInput,
      technicianId: id.technicianA1,
      serviceBayId: id.bayA1,
      endAt: at('10:30').toISOString(),
      status: 'CONFIRMED',
    });
    expect(created.id).toEqual(expect.any(String));
    expect(await prisma.appointment.findUnique({ where: { id: created.id } })).toMatchObject({
      id: created.id,
      technicianId: created.technicianId,
      serviceBayId: created.serviceBayId,
      startAt: at('10:00'),
      endAt: at('10:30'),
      status: 'CONFIRMED',
    });
    await application.close();
    application = await createBookingApp(database!.url);
    await application.http.get(`/api/v1/appointments/${created.id}`).expect(200).expect(created);
  });

  it.each([
    ['missing customer', { customerId: undefined }],
    ['missing vehicle', { vehicleId: undefined }],
    ['missing dealership', { dealershipId: undefined }],
    ['missing service', { serviceTypeId: undefined }],
    ['missing time', { startAt: undefined }],
    ['malformed UUID', { customerId: 'bad-id' }],
    ['non-string UUID', { customerId: 12 }],
    ['no offset', { startAt: '2035-01-15T10:00:00' }],
    ['invalid calendar date', { startAt: '2035-02-30T10:00:00Z' }],
    ['invalid time', { startAt: '2035-01-15T25:00:00Z' }],
    ['invalid offset', { startAt: '2035-01-15T10:00:00+25:00' }],
    ['null time', { startAt: null }],
    ['excess timestamp precision', { startAt: '2035-01-15T10:00:00.1234Z' }],
    ['technician injection', { technicianId: id.technicianA1 }],
    ['bay injection', { serviceBayId: id.bayA1 }],
    ['end injection', { endAt: at('10:01').toISOString() }],
    ['duration injection', { durationMinutes: 1 }],
    ['status injection', { status: 'CANCELLED' }],
    ['unknown property', { unexpected: true }],
  ])('rejects %s with 400 and no writes', async (_name, changes) => {
    const response = await application.http
      .post('/api/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .send({ ...bookingInput, ...changes })
      .expect(400);
    expect((response.body as ErrorJson).error.code).toBe('VALIDATION_ERROR');
    expect(await prisma.appointment.count()).toBe(0);
  });

  it('rejects malformed JSON with the same safe error envelope', async () => {
    const response = await application.http
      .post('/api/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .set('Content-Type', 'application/json')
      .send('{broken')
      .expect(400);
    expect((response.body as ErrorJson).error.code).toBe('VALIDATION_ERROR');
    expect(await prisma.appointment.count()).toBe(0);
  });

  it.each([
    ['customerId', 'CUSTOMER_NOT_FOUND'],
    ['vehicleId', 'VEHICLE_NOT_FOUND'],
    ['dealershipId', 'DEALERSHIP_NOT_FOUND'],
    ['serviceTypeId', 'SERVICE_TYPE_NOT_FOUND'],
  ])('returns 404 for nonexistent %s', async (field, code) => {
    const response = await application.http
      .post('/api/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .send({ ...bookingInput, [field]: randomUUID() })
      .expect(404);
    expect((response.body as ErrorJson).error.code).toBe(code);
    expect(await prisma.appointment.count()).toBe(0);
  });

  it.each([at('00:00').toISOString(), '2035-01-14T23:59:59Z'])(
    'rejects nonfuture time %s with 422',
    async (startAt) => {
      const response = await application.http
        .post('/api/v1/appointments')
        .set('Idempotency-Key', randomUUID())
        .send({ ...bookingInput, startAt })
        .expect(422);
      expect((response.body as ErrorJson).error.code).toBe('INVALID_BOOKING_TIME');
      expect(await prisma.appointment.count()).toBe(0);
    },
  );

  it('rejects customer/vehicle mismatch with 422 and no writes', async () => {
    const response = await application.http
      .post('/api/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .send({ ...bookingInput, vehicleId: id.vehicle3 })
      .expect(422);
    expect((response.body as ErrorJson).error.code).toBe('BUSINESS_RULE_VIOLATION');
    expect(await prisma.appointment.count()).toBe(0);
  });

  it('rejects an inactive service with 422 for booking and availability', async () => {
    await prisma.serviceType.update({ where: { id: id.oilChange }, data: { isActive: false } });
    const response = await application.http
      .post('/api/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .send(bookingInput)
      .expect(422);
    expect((response.body as ErrorJson).error.code).toBe('BUSINESS_RULE_VIOLATION');
    const availability = await application.http
      .get(`/api/v1/dealerships/${id.dealershipA}/availability`)
      .query({ serviceTypeId: id.oilChange, startAt: bookingInput.startAt })
      .expect(422);
    expect((availability.body as ErrorJson).error.code).toBe('BUSINESS_RULE_VIOLATION');
    expect(await prisma.appointment.count()).toBe(0);
  });

  it('excludes unqualified technicians', async () => {
    await prisma.technicianQualification.deleteMany({
      where: {
        serviceTypeId: id.oilChange,
        technicianId: { in: [id.technicianA1, id.technicianA3] },
      },
    });
    const response = await application.http
      .post('/api/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .send(bookingInput)
      .expect(409);
    expect((response.body as ErrorJson).error.code).toBe('NO_AVAILABILITY');
    expect(await prisma.appointment.count()).toBe(0);
  });

  it('excludes inactive and wrong-dealership technicians and bays', async () => {
    await prisma.technician.updateMany({
      where: { dealershipId: id.dealershipA },
      data: { isActive: false },
    });
    await prisma.serviceBay.updateMany({
      where: { dealershipId: id.dealershipA },
      data: { isActive: false },
    });
    await application.http
      .post('/api/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .send(bookingInput)
      .expect(409);
    expect(await prisma.appointment.count()).toBe(0);
    const response = await application.http
      .post('/api/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .send({ ...bookingInput, dealershipId: id.dealershipB })
      .expect(201);
    expect(response.body).toMatchObject({ technicianId: id.technicianB1, serviceBayId: id.bayB1 });
  });

  it('chooses alternatives instead of inactive resources', async () => {
    await prisma.technician.update({ where: { id: id.technicianA1 }, data: { isActive: false } });
    await prisma.serviceBay.update({ where: { id: id.bayA1 }, data: { isActive: false } });
    const response = await application.http
      .post('/api/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .send(bookingInput)
      .expect(201);
    expect(response.body).toMatchObject({ technicianId: id.technicianA3, serviceBayId: id.bayA2 });
  });

  it('derives intervals for equivalent offsets and permits adjacent bookings', async () => {
    await prisma.technician.update({ where: { id: id.technicianA3 }, data: { isActive: false } });
    await prisma.serviceBay.update({ where: { id: id.bayA2 }, data: { isActive: false } });
    const first = await application.http
      .post('/api/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .send({ ...bookingInput, startAt: '2035-01-15T17:00:00+07:00' })
      .expect(201);
    expect(first.body).toMatchObject({
      startAt: at('10:00').toISOString(),
      endAt: at('10:30').toISOString(),
    });
    await application.http
      .post('/api/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .send({ ...bookingInput, startAt: at('10:30').toISOString() })
      .expect(201);
    expect(await prisma.appointment.count()).toBe(2);
  });

  it('ignores cancelled appointments for both resources', async () => {
    await prisma.appointment.create({
      data: {
        ...bookingInput,
        startAt: at('10:00'),
        endAt: at('11:00'),
        technicianId: id.technicianA1,
        serviceBayId: id.bayA1,
        status: 'CANCELLED',
      },
    });
    const response = await application.http
      .post('/api/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .send(bookingInput)
      .expect(201);
    expect(response.body).toMatchObject({ technicianId: id.technicianA1, serviceBayId: id.bayA1 });
    expect(await prisma.appointment.count({ where: { status: 'CONFIRMED' } })).toBe(1);
  });

  it('returns 404 for unknown appointments and 400 for malformed identifiers', async () => {
    const missing = await application.http.get(`/api/v1/appointments/${randomUUID()}`).expect(404);
    expect((missing.body as ErrorJson).error.code).toBe('APPOINTMENT_NOT_FOUND');
    await application.http.get('/api/v1/appointments/bad-id').expect(400);
  });

  it('checks full-duration availability without writes and revalidates a stale snapshot at booking', async () => {
    await prisma.technician.update({ where: { id: id.technicianA3 }, data: { isActive: false } });
    await prisma.serviceBay.update({ where: { id: id.bayA2 }, data: { isActive: false } });
    const endpoint = `/api/v1/dealerships/${id.dealershipA}/availability`;
    const query = { serviceTypeId: id.oilChange, startAt: bookingInput.startAt };
    const before = await application.http.get(endpoint).query(query).expect(200);
    expect(before.body).toEqual({
      dealershipId: id.dealershipA,
      ...query,
      endAt: at('10:30').toISOString(),
      available: true,
      availableTechnicianCount: 1,
      availableServiceBayCount: 1,
    });
    expect(await prisma.appointment.count()).toBe(0);
    await application.http
      .post('/api/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .send(bookingInput)
      .expect(201);
    await application.http
      .post('/api/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .send(bookingInput)
      .expect(409);
    const after = await application.http
      .get(endpoint)
      .query({ ...query, startAt: at('10:15').toISOString() })
      .expect(200);
    expect(after.body).toMatchObject({
      available: false,
      availableTechnicianCount: 0,
      availableServiceBayCount: 0,
    });
    expect(await prisma.appointment.count()).toBe(1);
  });

  it.each([
    ['bad-id', { serviceTypeId: id.oilChange, startAt: bookingInput.startAt }],
    [id.dealershipA, { serviceTypeId: 'bad-id', startAt: bookingInput.startAt }],
    [id.dealershipA, { serviceTypeId: id.oilChange }],
    [id.dealershipA, { serviceTypeId: id.oilChange, startAt: '2035-01-15T10:00:00' }],
    [
      id.dealershipA,
      { serviceTypeId: id.oilChange, startAt: bookingInput.startAt, unknown: 'value' },
    ],
  ])('validates availability identifiers and query: %s %j', async (dealership, query) => {
    await application.http
      .get(`/api/v1/dealerships/${dealership}/availability`)
      .query(query)
      .expect(400);
    expect(await prisma.appointment.count()).toBe(0);
  });

  it.each(['DEALERSHIP_NOT_FOUND', 'SERVICE_TYPE_NOT_FOUND'])(
    'returns 404 for missing availability context: %s',
    async (code) => {
      const dealership = code === 'DEALERSHIP_NOT_FOUND' ? randomUUID() : id.dealershipA;
      const serviceTypeId = code === 'SERVICE_TYPE_NOT_FOUND' ? randomUUID() : id.oilChange;
      const response = await application.http
        .get(`/api/v1/dealerships/${dealership}/availability`)
        .query({ serviceTypeId, startAt: bookingInput.startAt })
        .expect(404);
      expect((response.body as ErrorJson).error.code).toBe(code);
      expect(await prisma.appointment.count()).toBe(0);
    },
  );

  it.each(['technician', 'bay'])(
    'classifies a real ORM %s exclusion and leaves only the original booking',
    async (resource) => {
      const repository = application.app.get(AppointmentRepository);
      const data = {
        ...bookingInput,
        startAt: at('10:00'),
        endAt: at('10:30'),
        technicianId: id.technicianA1,
        serviceBayId: id.bayA1,
      };
      await repository.transaction((tx) => repository.create(data, tx));
      const conflicting = {
        ...data,
        ...(resource === 'technician'
          ? { serviceBayId: id.bayA2 }
          : { technicianId: id.technicianA3 }),
      };
      let original: unknown;
      await expect(
        prisma
          .$transaction((tx) => tx.appointment.create({ data: conflicting }))
          .catch((error: unknown) => {
            original = error;
            throw error;
          }),
      ).rejects.toMatchObject({ code: 'P2039' });
      expect(postgresState(original)).toBe('23P01');
      await expect(
        repository.transaction((tx) => repository.create(conflicting, tx)),
      ).rejects.toEqual(new BookingConflict('resource'));
      expect(await prisma.appointment.count()).toBe(1);
    },
  );

  it('rolls back even if a write occurred before a later transaction failure', async () => {
    const repository = application.app.get(AppointmentRepository);
    await expect(
      repository.transaction(async (tx) => {
        await repository.create(
          {
            ...bookingInput,
            startAt: at('10:00'),
            endAt: at('10:30'),
            technicianId: id.technicianA1,
            serviceBayId: id.bayA1,
          },
          tx,
        );
        throw new Error('Forced later failure');
      }),
    ).rejects.toThrow('Forced later failure');
    expect(await prisma.appointment.count()).toBe(0);
  });

  it('classifies a real PostgreSQL deadlock as an aborted transaction conflict', async () => {
    const repository = application.app.get(AppointmentRepository);
    let arrivals = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const results = await Promise.allSettled(
      [
        [id.technicianA1, id.technicianA3],
        [id.technicianA3, id.technicianA1],
      ].map(([first, second]) =>
        repository.transaction(async (tx) => {
          // This probe deliberately forms a deadlock; let its detector run before a lock timeout.
          await tx.$executeRaw`SET LOCAL lock_timeout = '0'`;
          await tx.$queryRaw`SELECT id FROM technicians WHERE id = ${first}::uuid FOR UPDATE`;
          arrivals++;
          if (arrivals === 2) release();
          await barrier;
          await tx.$queryRaw`SELECT id FROM technicians WHERE id = ${second}::uuid FOR UPDATE`;
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.filter((r) => r.status === 'rejected');
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toEqual(new BookingConflict('transaction'));
    expect(await prisma.appointment.count()).toBe(0);
  });

  it('does not expose unexpected SQL failures as availability conflicts or leak their details', async () => {
    const repository = application.app.get(AppointmentRepository);
    const original = repository.transaction.bind(repository);
    vi.spyOn(repository, 'transaction').mockImplementationOnce(() =>
      original(async (tx) => {
        await tx.$executeRaw`SELECT * FROM phase4_intentionally_missing_table`;
        throw new Error('Unreachable');
      }),
    );
    const response = await application.http
      .post('/api/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .send(bookingInput)
      .expect(500);
    expect((response.body as ErrorJson).error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
    });
    expect(response.text).not.toContain('phase4_intentionally_missing_table');
    expect(response.headers['x-request-id']).toBe((response.body as ErrorJson).requestId);
    expect(await prisma.appointment.count()).toBe(0);
  });

  it('reports a real connection-refused failure as 503 without retrying or leaking connection details', async () => {
    const unavailable = new PrismaService(
      new ConfigService<Environment, true>({
        DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/unreachable',
      }),
    );
    const brokenRepository = new AppointmentRepository(unavailable);
    const repository = application.app.get(AppointmentRepository);
    const transaction = vi
      .spyOn(repository, 'transaction')
      .mockImplementationOnce((operation) => brokenRepository.transaction(operation));
    try {
      const response = await application.http
        .post('/api/v1/appointments')
        .set('Idempotency-Key', randomUUID())
        .send(bookingInput)
        .expect(503);
      expect((response.body as ErrorJson).error.code).toBe('SERVICE_UNAVAILABLE');
      expect(response.text).not.toContain('127.0.0.1');
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(await prisma.appointment.count()).toBe(0);
    } finally {
      await unavailable.$disconnect();
    }
  });

  it.each(['catalog', 'resources'] as const)(
    'reports a real database outage during availability %s reads as 503',
    async (stage) => {
      const unavailable = new PrismaService(
        new ConfigService<Environment, true>({
          DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/unreachable',
        }),
      );
      const brokenRepository = new SchedulingRepository(unavailable);
      const repository = application.app.get(SchedulingRepository);
      // Inject a real connection failure; neither query results nor SQL behavior are mocked.
      const query =
        stage === 'catalog'
          ? vi
              .spyOn(repository, 'dealershipExists')
              .mockImplementationOnce((...args) => brokenRepository.dealershipExists(...args))
          : vi
              .spyOn(repository, 'findEligibleResources')
              .mockImplementationOnce((...args) => brokenRepository.findEligibleResources(...args));
      try {
        const response = await application.http
          .get(`/api/v1/dealerships/${id.dealershipA}/availability`)
          .query({ serviceTypeId: id.oilChange, startAt: bookingInput.startAt })
          .expect(503);
        expect((response.body as ErrorJson).error.code).toBe('SERVICE_UNAVAILABLE');
        expect(response.headers['retry-after']).toBe('1');
        expect(response.text).not.toContain('127.0.0.1');
        expect(query).toHaveBeenCalledTimes(1);
        expect(await prisma.appointment.count()).toBe(0);
      } finally {
        await unavailable.$disconnect();
      }
    },
  );

  it('keeps unexpected availability SQL failures as safe 500 errors', async () => {
    const repository = application.app.get(SchedulingRepository);
    vi.spyOn(repository, 'findEligibleResources').mockImplementationOnce(async () => {
      await application.prisma.$queryRaw`SELECT * FROM intentionally_missing_availability_table`;
      throw new Error('Unreachable');
    });
    const response = await application.http
      .get(`/api/v1/dealerships/${id.dealershipA}/availability`)
      .query({ serviceTypeId: id.oilChange, startAt: bookingInput.startAt })
      .expect(500);
    expect((response.body as ErrorJson).error.code).toBe('INTERNAL_ERROR');
    expect(response.text).not.toContain('intentionally_missing_availability_table');
    expect(await prisma.appointment.count()).toBe(0);
  });
});
