import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { fixtureIds as id } from '../../prisma/seed-data';
import { AppointmentRepository } from '../../src/appointments/appointment.repository';
import { postgresState } from '../../src/appointments/database-error';
import { SchedulingRepository } from '../../src/scheduling/scheduling.repository';
import { EligibleResources } from '../../src/scheduling/resource-allocation.service';
import { createTestDatabase } from '../helpers/test-database';
import {
  AppointmentJson,
  at,
  createBookingApp,
  ErrorJson,
  independentInput,
  resetBookingFixtures,
  seedIndependentCustomers,
} from '../helpers/booking-app';

describe('concurrent HTTP bookings across two app instances', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>> | undefined;
  let prisma: PrismaClient;
  let apps: Awaited<ReturnType<typeof createBookingApp>>[] = [];

  beforeAll(async () => {
    database = await createTestDatabase();
    prisma = database.prisma;
    await seedIndependentCustomers(prisma);
    apps = await Promise.all([createBookingApp(database.url), createBookingApp(database.url)]);
  });
  beforeEach(async () => {
    await resetBookingFixtures(prisma);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    try {
      await Promise.all(apps.map((app) => app.close()));
    } finally {
      await database?.close();
    }
  });

  async function resources(technicians: string[], bays: string[]) {
    await prisma.technician.updateMany({
      where: { dealershipId: id.dealershipA },
      data: { isActive: false },
    });
    await prisma.serviceBay.updateMany({
      where: { dealershipId: id.dealershipA },
      data: { isActive: false },
    });
    await prisma.technician.updateMany({
      where: { id: { in: technicians } },
      data: { isActive: true },
    });
    await prisma.serviceBay.updateMany({ where: { id: { in: bays } }, data: { isActive: true } });
  }

  // Instrument real SQL results; never replace candidates, writes, transactions, or DB errors.
  function forceFirstTwoReadsToRace() {
    const observations: Array<{
      resources: EligibleResources;
      transactionId: string;
      backend: number;
    }> = [];
    const errors: unknown[] = [];
    let arrivals = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    for (const application of apps) {
      const scheduling = application.app.get(SchedulingRepository);
      const read = scheduling.findEligibleResources.bind(scheduling);
      vi.spyOn(scheduling, 'findEligibleResources').mockImplementation(async (...args) => {
        const result = await read(...args);
        const tx = args[3];
        if (!tx) throw new Error('Booking query escaped the transaction.');
        const firstReads = arrivals < 2;
        arrivals++;
        const [identity] = await tx.$queryRaw<Array<{ transactionId: string; backend: number }>>`
          SELECT txid_current()::text AS "transactionId", pg_backend_pid() AS backend
        `;
        observations.push({ resources: result, ...identity });
        if (firstReads) {
          if (observations.length >= 2) release();
          await barrier;
        }
        return result;
      });
      const repository = application.app.get(AppointmentRepository);
      const create = repository.create.bind(repository);
      vi.spyOn(repository, 'create').mockImplementation(async (...args) => {
        try {
          return await create(...args);
        } catch (error) {
          errors.push(error);
          throw error;
        }
      });
    }
    return { observations, errors };
  }

  async function assertDatabaseInvariants(count: number) {
    const rows = await prisma.appointment.findMany({
      where: { status: 'CONFIRMED' },
      include: {
        technician: { include: { qualifications: true } },
        serviceBay: true,
        vehicle: true,
        serviceType: true,
      },
    });
    expect(rows).toHaveLength(count);
    for (const row of rows) {
      expect(row.vehicle.customerId).toBe(row.customerId);
      expect(row.technician.dealershipId).toBe(row.dealershipId);
      expect(row.serviceBay.dealershipId).toBe(row.dealershipId);
      expect(row.technician.isActive).toBe(true);
      expect(row.serviceBay.isActive).toBe(true);
      expect(row.technician.qualifications.some((q) => q.serviceTypeId === row.serviceTypeId)).toBe(
        true,
      );
      expect(row.endAt.getTime() - row.startAt.getTime()).toBe(
        row.serviceType.durationMinutes * 60_000,
      );
    }
    const [overlaps] = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count FROM appointments a JOIN appointments b ON a.id < b.id
      WHERE a.status = 'CONFIRMED' AND b.status = 'CONFIRMED'
        AND (a.technician_id = b.technician_id OR a.service_bay_id = b.service_bay_id)
        AND tstzrange(a.start_at, a.end_at, '[)') && tstzrange(b.start_at, b.end_at, '[)')
    `;
    expect(overlaps.count).toBe(0);
    expect(await prisma.appointment.count()).toBe(count);
  }

  it('CT-01: 20 independent concurrent customers -> exactly one 201, nineteen 409, one row', async () => {
    await resources([id.technicianA1], [id.bayA1]);
    const race = forceFirstTwoReadsToRace();
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        apps[i % 2].http.post('/api/v1/appointments').send(independentInput(i)),
      ),
    );
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(19);
    for (const response of responses.filter((r) => r.status === 409)) {
      expect((response.body as ErrorJson).error.code).toBe('NO_AVAILABILITY');
    }
    expect(new Set(race.observations.slice(0, 2).map((o) => o.backend)).size).toBe(2);
    expect(race.errors.length).toBeGreaterThan(0);
    for (const error of race.errors) {
      expect(['23P01', '40P01']).toContain(postgresState(error));
    }
    await assertDatabaseInvariants(1);
  });

  it('CT-02: two pairs recover from an enforced race using a fresh transaction and alternatives', async () => {
    await resources([id.technicianA1, id.technicianA3], [id.bayA1, id.bayA2]);
    const race = forceFirstTwoReadsToRace();
    const responses = await Promise.all(
      apps.map((app, i) => app.http.post('/api/v1/appointments').send(independentInput(i))),
    );
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    const appointments = responses.map((r) => r.body as AppointmentJson);
    expect(new Set(appointments.map((a) => a.technicianId)).size).toBe(2);
    expect(new Set(appointments.map((a) => a.serviceBayId)).size).toBe(2);
    for (const observation of race.observations.slice(0, 2)) {
      expect(observation.resources.technicianIds.toSorted()).toEqual([
        id.technicianA1,
        id.technicianA3,
      ]);
      expect(observation.resources.serviceBayIds.toSorted()).toEqual([id.bayA1, id.bayA2]);
    }
    expect(race.errors).toHaveLength(1);
    expect(['23P01', '40P01']).toContain(postgresState(race.errors[0]));
    expect(race.observations).toHaveLength(3);
    expect(new Set(race.observations.map((o) => o.transactionId)).size).toBe(3);
    expect(new Set(race.observations.slice(0, 2).map((o) => o.backend)).size).toBe(2);
    expect(race.observations[2].resources).toEqual({
      technicianIds: [id.technicianA3],
      serviceBayIds: [id.bayA2],
    });
    await assertDatabaseInvariants(2);
  });

  it('CT-03: one technician with three bays still permits exactly one booking', async () => {
    const third = await prisma.serviceBay.create({
      data: { dealershipId: id.dealershipA, name: 'CT-03 extra bay' },
    });
    await resources([id.technicianA1], [id.bayA1, id.bayA2, third.id]);
    const responses = await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        apps[i % 2].http.post('/api/v1/appointments').send(independentInput(i)),
      ),
    );
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(2);
    await assertDatabaseInvariants(1);
  });

  it('returns retryable 503 rather than false exhaustion when the attempt budget ends during a race', async () => {
    await resources([id.technicianA1, id.technicianA3], [id.bayA1, id.bayA2]);
    forceFirstTwoReadsToRace();
    for (const application of apps)
      application.app.get(ConfigService).set('BOOKING_MAX_ATTEMPTS', 1);
    try {
      const responses = await Promise.all(
        apps.map((app, i) => app.http.post('/api/v1/appointments').send(independentInput(i))),
      );
      expect(responses.map((r) => r.status).toSorted()).toEqual([201, 503]);
      const failure = responses.find((r) => r.status === 503)!;
      expect((failure.body as ErrorJson).error.code).toBe('BOOKING_CONTENTION');
      expect(failure.headers['retry-after']).toBe('1');
      await assertDatabaseInvariants(1);
    } finally {
      for (const application of apps)
        application.app.get(ConfigService).set('BOOKING_MAX_ATTEMPTS', 4);
    }
  });

  it('CT-04: three qualified technicians with one bay still permit exactly one booking', async () => {
    await prisma.technicianQualification.create({
      data: { technicianId: id.technicianA2, serviceTypeId: id.oilChange },
    });
    await resources([id.technicianA1, id.technicianA2, id.technicianA3], [id.bayA1]);
    const responses = await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        apps[i % 2].http.post('/api/v1/appointments').send(independentInput(i)),
      ),
    );
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(2);
    await assertDatabaseInvariants(1);
  });

  it('CT-05: adjacent intervals succeed concurrently on the same technician and bay', async () => {
    await resources([id.technicianA1], [id.bayA1]);
    const responses = await Promise.all([
      apps[0].http.post('/api/v1/appointments').send(independentInput(0)),
      apps[1].http
        .post('/api/v1/appointments')
        .send({ ...independentInput(1), startAt: at('10:30').toISOString() }),
    ]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    await assertDatabaseInvariants(2);
  });
});
