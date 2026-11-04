import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../src/database/prisma.service';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { fixtureIds as id } from '../../prisma/seed-data';
import { DirectoryRepository } from '../../src/directory/directory.repository';
import {
  AppointmentJson,
  ErrorJson,
  at,
  bookingInput,
  createBookingApp,
  resetBookingFixtures,
} from '../helpers/booking-app';
import { createTestDatabase } from '../helpers/test-database';

interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  hasNext: boolean;
}
interface Lookup {
  id: string;
  name: string;
}
const customers = '/api/v1/customers';
const dealerships = '/api/v1/dealerships';
const vehicles = `${customers}/${id.customer1}/vehicles`;
const appointments = `${customers}/${id.customer1}/appointments`;

describe('booking lookups and appointment history with PostgreSQL', () => {
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

  it('lists customers in name order with defaults, bounded pages and no total count', async () => {
    const response = await application.http.get(customers).expect(200);
    expect(response.body as Page<Lookup>).toEqual({
      items: [
        { id: id.customer1, name: 'Demo Customer One' },
        { id: id.customer3, name: 'Demo Customer Three' },
        { id: id.customer2, name: 'Demo Customer Two' },
      ],
      page: 1,
      limit: 20,
      hasNext: false,
    });
    const first = await application.http.get(`${customers}?limit=2`).expect(200);
    const last = await application.http.get(`${customers}?limit=2&page=2`).expect(200);
    expect(first.body).toEqual({
      ...(response.body as Page<Lookup>),
      items: (response.body as Page<Lookup>).items.slice(0, 2),
      limit: 2,
      hasNext: true,
    });
    expect(last.body).toEqual({
      items: (response.body as Page<Lookup>).items.slice(2),
      page: 2,
      limit: 2,
      hasNext: false,
    });
    expect((await application.http.get(`${customers}?page=10&limit=100`).expect(200)).body).toEqual(
      { items: [], page: 10, limit: 100, hasNext: false },
    );
  });

  it('uses IDs to break equal customer names deterministically', async () => {
    await prisma.customer.update({
      where: { id: id.customer2 },
      data: { name: 'Demo Customer One' },
    });
    try {
      const response = await application.http.get(`${customers}?limit=1&page=2`).expect(200);
      expect((response.body as Page<Lookup>).items).toEqual([
        { id: id.customer2, name: 'Demo Customer One' },
      ]);
    } finally {
      await prisma.customer.update({
        where: { id: id.customer2 },
        data: { name: 'Demo Customer Two' },
      });
    }
  });

  it('returns only owned vehicles, including VIN, with pagination', async () => {
    const response = await application.http.get(vehicles).expect(200);
    expect((response.body as Page<Lookup>).items).toEqual([
      {
        id: id.vehicle1,
        customerId: id.customer1,
        vin: 'TEST0000000000001',
        make: 'Demo',
        model: 'Sedan',
      },
      {
        id: id.vehicle2,
        customerId: id.customer1,
        vin: 'TEST0000000000002',
        make: 'Demo',
        model: 'Hatchback',
      },
    ]);
    const page = await application.http.get(`${vehicles}?page=2&limit=1`).expect(200);
    expect(page.body).toEqual({
      items: [(response.body as Page<Lookup>).items[1]],
      page: 2,
      limit: 1,
      hasNext: false,
    });
  });

  it('lists dealership fields with pagination', async () => {
    const dealers = await application.http.get(`${dealerships}?limit=1`).expect(200);
    expect(dealers.body).toEqual({
      items: [{ id: id.dealershipA, name: 'Demo Dealership A', timeZone: 'Asia/Ho_Chi_Minh' }],
      page: 1,
      limit: 1,
      hasNext: true,
    });
  });

  it('returns empty pages for known parents without children', async () => {
    await prisma.vehicle.delete({ where: { id: id.vehicle4 } });
    for (const path of [`${customers}/${id.customer3}/vehicles`, appointments]) {
      expect((await application.http.get(path).expect(200)).body).toEqual({
        items: [],
        page: 1,
        limit: 20,
        hasNext: false,
      });
    }
  });

  it.each([
    [`${customers}/${randomUUID()}/vehicles`, 'CUSTOMER_NOT_FOUND'],
    [`${customers}/${randomUUID()}/appointments`, 'CUSTOMER_NOT_FOUND'],
  ])('returns a meaningful 404 for missing parents: %s', async (path, code) => {
    const response = await application.http.get(path).expect(404);
    expect((response.body as ErrorJson).error.code).toBe(code);
  });

  it.each([customers, vehicles, dealerships, appointments])(
    'validates pagination and unknown queries: %s',
    async (path) => {
      for (const query of [
        'page=0',
        'page=-1',
        'page=1.5',
        'limit=0',
        'limit=101',
        'limit=no',
        'page=2147483647&limit=100',
        'page=1&page=2',
        'limit=1&limit=2',
        'search=demo',
      ]) {
        const response = await application.http.get(`${path}?${query}`).expect(400);
        expect((response.body as ErrorJson).error.code).toBe('VALIDATION_ERROR');
      }
    },
  );

  it.each([`${customers}/invalid/vehicles`, `${customers}/invalid/appointments`])(
    'rejects invalid parent IDs: %s',
    async (path) => {
      expect(((await application.http.get(path).expect(400)).body as ErrorJson).error.code).toBe(
        'VALIDATION_ERROR',
      );
    },
  );

  it('lists all stored statuses and times for one customer, ordered by start then ID descending', async () => {
    const base = {
      customerId: id.customer1,
      vehicleId: id.vehicle1,
      dealershipId: id.dealershipA,
      serviceTypeId: id.oilChange,
      technicianId: id.technicianA1,
      serviceBayId: id.bayA1,
    };
    const ids = [randomUUID(), randomUUID()].sort();
    await prisma.appointment.createMany({
      data: [
        {
          ...base,
          startAt: new Date('2020-01-01T10:00:00Z'),
          endAt: new Date('2020-01-01T10:30:00Z'),
        },
        ...ids.map((appointmentId) => ({
          ...base,
          id: appointmentId,
          vehicleId: id.vehicle2,
          startAt: at('12:00'),
          endAt: at('12:30'),
          status: 'CANCELLED' as const,
        })),
        {
          ...base,
          customerId: id.customer2,
          vehicleId: id.vehicle3,
          startAt: at('14:00'),
          endAt: at('14:30'),
        },
      ],
    });
    const response = await application.http.get(appointments).expect(200);
    const result = response.body as Page<AppointmentJson>;
    expect(result.items).toHaveLength(3);
    expect(result.items.slice(0, 2).map((item) => item.id)).toEqual(ids.toReversed());
    expect(result.items.map((item) => item.status)).toEqual([
      'CANCELLED',
      'CANCELLED',
      'CONFIRMED',
    ]);
    expect(result.items[2].startAt).toBe('2020-01-01T10:00:00.000Z');
    for (const item of result.items) {
      expect(item).toEqual(
        (await application.http.get(`/api/v1/appointments/${item.id}`).expect(200)).body,
      );
    }
    const page = await application.http.get(`${appointments}?limit=1&page=2`).expect(200);
    expect(page.body).toEqual({ items: [result.items[1]], page: 2, limit: 1, hasNext: true });
    expect(await prisma.appointment.count()).toBe(4);
  });

  it('supports fetching booking IDs, creating a booking, and finding it in customer history', async () => {
    const customer = ((await application.http.get(customers).expect(200)).body as Page<Lookup>)
      .items[0];
    const vehicle = (
      (await application.http.get(`${customers}/${customer.id}/vehicles`).expect(200))
        .body as Page<Lookup>
    ).items[0];
    const dealer = ((await application.http.get(dealerships).expect(200)).body as Page<Lookup>)
      .items[0];
    const services = (await application.http.get('/api/v1/service-types').expect(200))
      .body as Lookup[];
    const service = services.find((item) => item.id === id.oilChange)!;
    const input = {
      ...bookingInput,
      customerId: customer.id,
      vehicleId: vehicle.id,
      dealershipId: dealer.id,
      serviceTypeId: service.id,
    };
    await application.http
      .get(`${dealerships}/${dealer.id}/availability`)
      .query({ serviceTypeId: service.id, startAt: input.startAt })
      .expect(200);
    const booked = await application.http
      .post('/api/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .send(input)
      .expect(201);
    expect(
      (
        (await application.http.get(`${customers}/${customer.id}/appointments`).expect(200))
          .body as Page<AppointmentJson>
      ).items,
    ).toEqual([booked.body]);
    for (const field of ['technicianId', 'serviceBayId']) {
      await application.http
        .post('/api/v1/appointments')
        .set('Idempotency-Key', randomUUID())
        .send({ ...input, [field]: (booked.body as Record<string, unknown>)[field] })
        .expect(400);
    }
    expect(await prisma.appointment.count()).toBe(1);
  });

  it('returns a safe 503 when the database is unavailable', async () => {
    const unavailable = new PrismaService(
      new ConfigService({
        DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/unreachable',
      }),
    );
    const repository = new DirectoryRepository(unavailable);
    vi.spyOn(application.app.get(DirectoryRepository), 'customers').mockImplementationOnce(
      (query) => repository.customers(query),
    );
    try {
      const response = await application.http.get(customers).expect(503);
      expect(response.body).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } });
      expect(response.headers['retry-after']).toBe('1');
    } finally {
      await unavailable.$disconnect();
    }
  });

  it('preserves the safe database error contract', async () => {
    vi.spyOn(application.app.get(DirectoryRepository), 'customers').mockImplementationOnce(() => {
      throw new Error('secret database detail');
    });
    const response = await application.http.get(customers).expect(500);
    expect((response.body as ErrorJson).error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
    });
    expect(response.text).not.toContain('secret');
  });
});
