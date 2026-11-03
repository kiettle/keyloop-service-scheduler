import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { AppointmentStatus, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { fixtureIds as id, seedDatabase } from '../../prisma/seed-data';
import { Clock } from '../../src/common/time/clock';
import { PrismaService } from '../../src/database/prisma.service';
import { CheckAvailabilityUseCase } from '../../src/scheduling/check-availability.use-case';
import { SchedulingModule } from '../../src/scheduling/scheduling.module';
import { createTestDatabase } from '../helpers/test-database';

const at = (time: string) => new Date(`2035-01-15T${time}:00Z`);
const input = { dealershipId: id.dealershipA, serviceTypeId: id.oilChange, startAt: at('10:00') };
const clock = { now: () => at('00:00') };

describe('read-only PostgreSQL scheduling', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>> | undefined;
  let prisma: PrismaClient;
  let module: TestingModule;
  let useCase: CheckAvailabilityUseCase;

  beforeAll(async () => {
    database = await createTestDatabase();
    prisma = database.prisma;
    module = await Test.createTestingModule({ imports: [SchedulingModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    useCase = module.get(CheckAvailabilityUseCase);
  });

  beforeEach(async () => {
    await prisma.$transaction([
      prisma.appointment.deleteMany(),
      prisma.technician.updateMany({ data: { isActive: true } }),
      prisma.serviceBay.updateMany({ data: { isActive: true } }),
      prisma.serviceType.updateMany({ data: { isActive: true } }),
      prisma.serviceType.update({ where: { id: id.oilChange }, data: { durationMinutes: 30 } }),
    ]);
    await seedDatabase(prisma); // Restore qualifications removed by a test; IDs remain stable.
  });

  afterAll(async () => {
    try {
      await module?.close();
    } finally {
      await database?.close();
    }
  });

  function book(
    data: { technicianId?: string; serviceBayId?: string; status?: AppointmentStatus } = {},
  ) {
    return prisma.appointment.create({
      data: {
        customerId: id.customer1,
        vehicleId: id.vehicle1,
        dealershipId: id.dealershipA,
        serviceTypeId: id.oilChange,
        technicianId: id.technicianA1,
        serviceBayId: id.bayA1,
        startAt: at('10:00'),
        endAt: at('11:00'),
        ...data,
      },
    });
  }

  it('uses active qualified resources from the requested dealership and derives duration', async () => {
    const result = await useCase.execute(input);
    expect(result).toMatchObject({
      available: true,
      technicianId: id.technicianA1,
      serviceBayId: id.bayA1,
      availableTechnicianCount: 2,
      availableServiceBayCount: 2,
      endAt: at('10:30'),
    });
    const brakes = await useCase.execute({ ...input, serviceTypeId: id.brakeRepair });
    expect(brakes).toMatchObject({
      available: true,
      technicianId: id.technicianA2,
      availableTechnicianCount: 1,
      endAt: at('12:00'),
    });
  });

  it('excludes active but unqualified technicians', async () => {
    await prisma.technicianQualification.deleteMany({
      where: {
        technicianId: { in: [id.technicianA1, id.technicianA3] },
        serviceTypeId: id.oilChange,
      },
    });
    expect(await useCase.execute(input)).toMatchObject({
      available: false,
      availableTechnicianCount: 0,
      availableServiceBayCount: 2,
    });
  });

  it('excludes inactive technicians and chooses another qualified technician', async () => {
    await prisma.technician.update({ where: { id: id.technicianA1 }, data: { isActive: false } });
    expect(await useCase.execute(input)).toMatchObject({
      available: true,
      technicianId: id.technicianA3,
      availableTechnicianCount: 1,
    });
  });

  it('excludes inactive bays and chooses another active bay', async () => {
    await prisma.serviceBay.update({ where: { id: id.bayA1 }, data: { isActive: false } });
    expect(await useCase.execute(input)).toMatchObject({
      available: true,
      serviceBayId: id.bayA2,
      availableServiceBayCount: 1,
    });
  });

  it('does not borrow qualified technicians or bays from another dealership', async () => {
    await prisma.technician.updateMany({
      where: { dealershipId: id.dealershipA },
      data: { isActive: false },
    });
    await prisma.serviceBay.updateMany({
      where: { dealershipId: id.dealershipA },
      data: { isActive: false },
    });
    expect(await useCase.execute(input)).toMatchObject({
      available: false,
      availableTechnicianCount: 0,
      availableServiceBayCount: 0,
    });
    expect(await useCase.execute({ ...input, dealershipId: id.dealershipB })).toMatchObject({
      available: true,
      technicianId: id.technicianB1,
      serviceBayId: id.bayB1,
    });
  });

  it('uses an alternative technician while independently selecting a free bay', async () => {
    await book({ serviceBayId: id.bayA2 });
    expect(await useCase.execute(input)).toMatchObject({
      available: true,
      technicianId: id.technicianA3,
      serviceBayId: id.bayA1,
      availableTechnicianCount: 1,
      availableServiceBayCount: 1,
    });
  });

  it('uses an alternative bay while independently selecting a free technician', async () => {
    await book({ technicianId: id.technicianA3 });
    expect(await useCase.execute(input)).toMatchObject({
      available: true,
      technicianId: id.technicianA1,
      serviceBayId: id.bayA2,
      availableTechnicianCount: 1,
      availableServiceBayCount: 1,
    });
  });

  it('reports no technicians when both qualified local technicians are occupied', async () => {
    await book();
    await book({ technicianId: id.technicianA3, serviceBayId: id.bayA2 });
    expect(await useCase.execute(input)).toMatchObject({
      available: false,
      technicianId: null,
      serviceBayId: null,
      availableTechnicianCount: 0,
      availableServiceBayCount: 0,
    });
  });

  it('reports no bays even when a qualified technician remains available', async () => {
    await book({ technicianId: id.technicianA2 });
    await book({ technicianId: id.technicianA3, serviceBayId: id.bayA2 });
    expect(await useCase.execute(input)).toMatchObject({
      available: false,
      technicianId: null,
      serviceBayId: null,
      availableTechnicianCount: 1,
      availableServiceBayCount: 0,
    });
  });

  it('reports no technicians even when a bay remains available', async () => {
    await prisma.technician.updateMany({
      where: { dealershipId: id.dealershipA },
      data: { isActive: false },
    });
    expect(await useCase.execute(input)).toMatchObject({
      available: false,
      availableTechnicianCount: 0,
      availableServiceBayCount: 2,
    });
  });

  it('ignores cancelled appointments when evaluating both resources', async () => {
    await book({ status: 'CANCELLED' });
    expect(await useCase.execute(input)).toMatchObject({
      available: true,
      technicianId: id.technicianA1,
      serviceBayId: id.bayA1,
      availableTechnicianCount: 2,
      availableServiceBayCount: 2,
    });
  });

  it.each([
    ['identical', '10:00', 60, false],
    ['partial start', '09:45', 30, false],
    ['partial end', '10:45', 30, false],
    ['contained', '10:15', 30, false],
    ['encompassing', '09:30', 120, false],
    ['adjacent before', '09:30', 30, true],
    ['adjacent after', '11:00', 30, true],
  ] as const)('checks the entire interval: %s', async (_name, start, duration, available) => {
    await prisma.technician.update({ where: { id: id.technicianA3 }, data: { isActive: false } });
    await prisma.serviceBay.update({ where: { id: id.bayA2 }, data: { isActive: false } });
    await book();
    await prisma.serviceType.update({
      where: { id: id.oilChange },
      data: { durationMinutes: duration },
    });
    expect(await useCase.execute({ ...input, startAt: at(start) })).toMatchObject({
      available,
      availableTechnicianCount: available ? 1 : 0,
      availableServiceBayCount: available ? 1 : 0,
    });
  });

  it('returns the same interval and eligibility for equivalent offset timestamps', async () => {
    expect(
      await useCase.execute({ ...input, startAt: new Date('2035-01-15T17:00:00+07:00') }),
    ).toEqual(await useCase.execute(input));
  });

  it('distinguishes missing and inactive service types from unavailable resources', async () => {
    await expect(useCase.execute({ ...input, serviceTypeId: randomUUID() })).rejects.toMatchObject({
      code: 'SERVICE_TYPE_NOT_FOUND',
    });
    await prisma.serviceType.update({ where: { id: id.oilChange }, data: { isActive: false } });
    await expect(useCase.execute(input)).rejects.toMatchObject({
      code: 'SERVICE_TYPE_INACTIVE',
    });
    await expect(useCase.execute({ ...input, dealershipId: randomUUID() })).rejects.toMatchObject({
      code: 'DEALERSHIP_NOT_FOUND',
    });
  });

  it('only reads: repeated candidate selection creates no reservation or changed appointment', async () => {
    await book({ status: 'CANCELLED' });
    const before = await prisma.appointment.findMany();
    const first = await useCase.execute(input);
    expect(await useCase.execute(input)).toEqual(first);
    expect(await useCase.execute(input)).toEqual(first);
    expect(await prisma.appointment.findMany()).toEqual(before);
  });

  it('uses four actual SQL reads without N+1 candidate queries', async () => {
    const client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: database!.url, connectionTimeoutMillis: 5000 }),
      log: [{ emit: 'event', level: 'query' }],
    });
    const queries: string[] = [];
    client.$on('query', (event) => queries.push(event.query));
    const instrumented = await Test.createTestingModule({ imports: [SchedulingModule] })
      .overrideProvider(PrismaService)
      .useValue(client)
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    try {
      expect(await instrumented.get(CheckAvailabilityUseCase).execute(input)).toMatchObject({
        available: true,
      });
      expect(queries).toHaveLength(4);
      expect(queries.every((query) => query.trimStart().startsWith('SELECT'))).toBe(true);
    } finally {
      await instrumented.close();
      await client.$disconnect();
    }
  });
});
