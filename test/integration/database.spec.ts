import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AppointmentStatus, PrismaClient } from '@prisma/client';
import { fixtureIds as id, seedDatabase } from '../../prisma/seed-data';
import { createClient, createTestDatabase } from '../helpers/test-database';

type Insert = {
  customerId: string | null;
  vehicleId: string | null;
  dealershipId: string | null;
  serviceTypeId: string | null;
  technicianId: string | null;
  serviceBayId: string | null;
  startAt: Date | null;
  endAt: Date | null;
  status: AppointmentStatus | null;
};
const at = (time: string) => new Date(`2035-01-15T${time}:00.000Z`);

describe('migrated PostgreSQL domain', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>> | undefined;
  let prisma: PrismaClient;

  beforeAll(async () => {
    database = await createTestDatabase();
    prisma = database.prisma;
  });

  beforeEach(async () => {
    // Only this suite's newly created, disposable database is ever cleared.
    await prisma.appointment.deleteMany();
  });

  afterAll(async () => {
    await database?.close();
  });

  function insert(input: Partial<Insert> = {}, client = prisma) {
    const data: Insert = {
      customerId: id.customer1,
      vehicleId: id.vehicle1,
      dealershipId: id.dealershipA,
      serviceTypeId: id.oilChange,
      technicianId: id.technicianA1,
      serviceBayId: id.bayA1,
      startAt: at('10:00'),
      endAt: at('11:00'),
      status: 'CONFIRMED',
      ...input,
    };
    // Direct SQL bypasses any future booking application validation.
    return client.$executeRaw`
      INSERT INTO appointments
        (customer_id, vehicle_id, dealership_id, service_type_id, technician_id,
         service_bay_id, start_at, end_at, status)
      VALUES (${data.customerId}::uuid, ${data.vehicleId}::uuid,
        ${data.dealershipId}::uuid, ${data.serviceTypeId}::uuid,
        ${data.technicianId}::uuid, ${data.serviceBayId}::uuid,
        ${data.startAt}::timestamptz, ${data.endAt}::timestamptz,
        ${data.status}::appointment_status)
    `;
  }

  async function expectSqlError(
    operation: PromiseLike<unknown>,
    code: string,
    constraint?: string,
  ) {
    try {
      await operation;
    } catch (error) {
      expect(error).toMatchObject({
        code: 'P2010',
        meta: { driverAdapterError: { cause: { originalCode: code } } },
      });
      if (constraint) expect(JSON.stringify(error)).toContain(constraint);
      return;
    }
    throw new Error(`Expected PostgreSQL error ${code}`);
  }

  it('installs the extension, CHECKs and two immediate partial GiST constraints', async () => {
    const extensions = await prisma.$queryRaw<Array<{ extname: string }>>`
      SELECT extname FROM pg_extension WHERE extname = 'btree_gist'
    `;
    expect(extensions).toHaveLength(1);
    const constraints = await prisma.$queryRaw<
      Array<{ conname: string; condeferrable: boolean; definition: string }>
    >`
      SELECT conname, condeferrable, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE contype = 'x' AND conrelid = 'appointments'::regclass
      ORDER BY conname
    `;
    expect(constraints.map((c) => c.conname)).toEqual([
      'no_overlapping_bay_appointments',
      'no_overlapping_technician_appointments',
    ]);
    for (const constraint of constraints) {
      expect(constraint.condeferrable).toBe(false);
      expect(constraint.definition).toContain('EXCLUDE USING gist');
      expect(constraint.definition).toContain("'[)'::text");
      expect(constraint.definition).toContain('CONFIRMED');
    }
  });

  it('seeds the same reference records twice without duplicates or appointments', async () => {
    const first = await prisma.vehicle.findMany({ orderBy: { id: 'asc' } });
    await seedDatabase(prisma);
    expect(await prisma.vehicle.findMany({ orderBy: { id: 'asc' } })).toEqual(first);
    expect(await prisma.dealership.count()).toBe(2);
    expect(await prisma.customer.count()).toBe(3);
    expect(await prisma.vehicle.count()).toBe(4);
    expect(await prisma.serviceType.count()).toBe(4);
    expect(await prisma.technician.count()).toBe(4);
    expect(await prisma.serviceBay.count()).toBe(3);
    expect(await prisma.technicianQualification.count()).toBe(8);
    expect(await prisma.appointment.count()).toBe(0);
  });

  it('stores appointment IDs as UUIDs and instants with millisecond time-zone precision', async () => {
    const columns = await prisma.$queryRaw<
      Array<{ column_name: string; data_type: string; datetime_precision: number | null }>
    >`
      SELECT column_name, data_type, datetime_precision
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'appointments'
        AND column_name IN ('id', 'start_at', 'end_at')
      ORDER BY column_name
    `;
    expect(columns).toEqual([
      { column_name: 'end_at', data_type: 'timestamp with time zone', datetime_precision: 3 },
      { column_name: 'id', data_type: 'uuid', datetime_precision: null },
      { column_name: 'start_at', data_type: 'timestamp with time zone', datetime_precision: 3 },
    ]);
  });

  it('persists all appointment associations through Prisma', async () => {
    await insert({ endAt: at('10:30') });
    const booking = await prisma.appointment.findFirstOrThrow({
      include: {
        customer: true,
        vehicle: true,
        dealership: true,
        serviceType: true,
        technician: true,
        serviceBay: true,
      },
    });
    expect(booking).toMatchObject({
      status: 'CONFIRMED',
      startAt: at('10:00'),
      endAt: at('10:30'),
      customer: { id: id.customer1 },
      vehicle: { id: id.vehicle1 },
      dealership: { id: id.dealershipA },
      serviceType: { id: id.oilChange },
      technician: { id: id.technicianA1 },
      serviceBay: { id: id.bayA1 },
    });
  });

  const overlaps = [
    ['identical', '10:00', '11:00'],
    ['contained', '10:15', '10:45'],
    ['containing', '09:00', '12:00'],
    ['start overlap', '09:30', '10:30'],
    ['end overlap', '10:30', '11:30'],
  ];
  describe.each(['technician', 'bay'] as const)('%s exclusion independently', (resource) => {
    it.each(overlaps)('rejects %s', async (_name, start, end) => {
      await insert();
      const alternative =
        resource === 'technician' ? { serviceBayId: id.bayA2 } : { technicianId: id.technicianA3 };
      const constraint =
        resource === 'technician'
          ? 'no_overlapping_technician_appointments'
          : 'no_overlapping_bay_appointments';
      await expectSqlError(
        insert({ ...alternative, startAt: at(start), endAt: at(end) }),
        '23P01',
        constraint,
      );
      expect(await prisma.appointment.count()).toBe(1);
    });

    it('rejects an update that creates an independent resource overlap', async () => {
      await insert();
      await insert({ technicianId: id.technicianA3, serviceBayId: id.bayA2 });
      if (resource === 'technician') {
        await expectSqlError(
          prisma.$executeRaw`
          UPDATE appointments SET technician_id = ${id.technicianA1}::uuid
          WHERE technician_id = ${id.technicianA3}::uuid
        `,
          '23P01',
          'no_overlapping_technician_appointments',
        );
      } else {
        await expectSqlError(
          prisma.$executeRaw`
          UPDATE appointments SET service_bay_id = ${id.bayA1}::uuid
          WHERE service_bay_id = ${id.bayA2}::uuid
        `,
          '23P01',
          'no_overlapping_bay_appointments',
        );
      }
      expect(await prisma.appointment.count()).toBe(2);
    });

    it('allows adjacency before and after the existing appointment', async () => {
      await insert();
      const alternative =
        resource === 'technician' ? { serviceBayId: id.bayA2 } : { technicianId: id.technicianA3 };
      await insert({ ...alternative, startAt: at('09:00'), endAt: at('10:00') });
      await insert({ ...alternative, startAt: at('11:00'), endAt: at('12:00') });
      expect(await prisma.appointment.count({ where: { status: 'CONFIRMED' } })).toBe(3);
    });
  });

  it('allows overlapping appointments on distinct resource pairs', async () => {
    await insert();
    await insert({ technicianId: id.technicianA3, serviceBayId: id.bayA2 });
    expect(await prisma.appointment.count()).toBe(2);
  });

  it('cancelled rows do not block either resource', async () => {
    await insert({ status: 'CANCELLED' });
    await insert({ status: 'CANCELLED' });
    await insert();
    expect(await prisma.appointment.count()).toBe(3);
    expect(await prisma.appointment.count({ where: { status: 'CONFIRMED' } })).toBe(1);
  });

  it('allows cancelled rows even when a confirmed row occupies the interval', async () => {
    await insert();
    await insert({ status: 'CANCELLED' });
    expect(await prisma.appointment.count()).toBe(2);
  });

  it('releases both resources after a status change commits', async () => {
    await insert();
    await prisma.$transaction(async (tx) => {
      await tx.appointment.updateMany({
        where: { status: 'CONFIRMED' },
        data: { status: 'CANCELLED' },
      });
    });

    const other = createClient(database!.url);
    try {
      await insert({}, other);
      expect(await other.appointment.count({ where: { status: 'CONFIRMED' } })).toBe(1);
      expect(await other.appointment.count({ where: { status: 'CANCELLED' } })).toBe(1);
    } finally {
      await other.$disconnect();
    }
  });

  it('rejects restoring a cancelled row if either resource would overlap', async () => {
    await insert();
    await insert({ status: 'CANCELLED' });
    await expectSqlError(
      prisma.$executeRaw`
      UPDATE appointments SET status = 'CONFIRMED' WHERE status = 'CANCELLED'
    `,
      '23P01',
    );
    expect(await prisma.appointment.count({ where: { status: 'CANCELLED' } })).toBe(1);
  });

  it('enforces the same interval for equivalent time-zone offsets', async () => {
    await insert();
    await expectSqlError(
      insert({
        startAt: new Date('2035-01-15T17:00:00+07:00'),
        endAt: new Date('2035-01-15T18:00:00+07:00'),
        serviceBayId: id.bayA2,
      }),
      '23P01',
      'no_overlapping_technician_appointments',
    );
  });

  it.each(['09:00', '10:00'])('rejects invalid interval ending at %s', async (end) => {
    await expectSqlError(insert({ endAt: at(end) }), '23514', 'appointment_valid_interval');
    expect(await prisma.appointment.count()).toBe(0);
  });

  it.each([0, -1])('rejects service duration %i directly in SQL', async (duration) => {
    await expectSqlError(
      prisma.$executeRaw`
      INSERT INTO service_types (name, duration_minutes) VALUES ('Invalid', ${duration})
    `,
      '23514',
      'service_types_positive_duration',
    );
  });

  it.each([
    'customerId',
    'vehicleId',
    'dealershipId',
    'serviceTypeId',
    'technicianId',
    'serviceBayId',
  ] as const)('rejects missing referenced %s', async (field) => {
    await expectSqlError(insert({ [field]: randomUUID() }), '23503');
    expect(await prisma.appointment.count()).toBe(0);
  });

  it.each([
    'customerId',
    'vehicleId',
    'dealershipId',
    'serviceTypeId',
    'technicianId',
    'serviceBayId',
    'startAt',
    'endAt',
    'status',
  ] as const)('requires %s at the database layer', async (field) => {
    await expectSqlError(insert({ [field]: null }), '23502');
  });

  it('rejects dangling vehicle, resource, and qualification references', async () => {
    await expectSqlError(
      prisma.$executeRaw`
      INSERT INTO vehicles (customer_id, vin, make, model) VALUES (${randomUUID()}::uuid, 'MISSING', 'Demo', 'Demo')
    `,
      '23503',
    );
    await expectSqlError(
      prisma.$executeRaw`
      INSERT INTO technicians (dealership_id, name) VALUES (${randomUUID()}::uuid, 'Missing')
    `,
      '23503',
    );
    await expectSqlError(
      prisma.$executeRaw`
      INSERT INTO service_bays (dealership_id, name) VALUES (${randomUUID()}::uuid, 'Missing')
    `,
      '23503',
    );
    await expectSqlError(
      prisma.$executeRaw`
      INSERT INTO technician_qualifications (technician_id, service_type_id)
      VALUES (${randomUUID()}::uuid, ${id.oilChange}::uuid)
    `,
      '23503',
    );
    await expectSqlError(
      prisma.$executeRaw`
      INSERT INTO technician_qualifications (technician_id, service_type_id)
      VALUES (${id.technicianA1}::uuid, ${randomUUID()}::uuid)
    `,
      '23503',
    );
  });

  it('enforces VIN uniqueness and qualification composite identity', async () => {
    await expectSqlError(
      prisma.$executeRaw`
      INSERT INTO vehicles (customer_id, vin, make, model)
      VALUES (${id.customer1}::uuid, 'TEST0000000000001', 'Demo', 'Demo')
    `,
      '23505',
      'vehicles_vin_key',
    );
    await expectSqlError(
      prisma.$executeRaw`
      INSERT INTO technician_qualifications (technician_id, service_type_id)
      VALUES (${id.technicianA1}::uuid, ${id.oilChange}::uuid)
    `,
      '23505',
      'technician_qualifications_pkey',
    );
  });

  it('protects referenced history from deletion', async () => {
    await insert();
    await expectSqlError(
      prisma.$executeRaw`DELETE FROM customers WHERE id = ${id.customer1}::uuid`,
      '23503',
    );
    await expectSqlError(
      prisma.$executeRaw`DELETE FROM service_bays WHERE id = ${id.bayA1}::uuid`,
      '23503',
    );
    expect(await prisma.appointment.count()).toBe(1);
  });

  it('rolls back a successful insert when its transaction subsequently fails', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.appointment.create({
          data: {
            customerId: id.customer1,
            vehicleId: id.vehicle1,
            dealershipId: id.dealershipA,
            serviceTypeId: id.oilChange,
            technicianId: id.technicianA1,
            serviceBayId: id.bayA1,
            startAt: at('10:00'),
            endAt: at('10:30'),
          },
        });
        throw new Error('Intentional rollback after insert');
      }),
    ).rejects.toThrow('Intentional rollback');
    const other = createClient(database!.url);
    try {
      expect(await other.appointment.count()).toBe(0);
    } finally {
      await other.$disconnect();
    }
  });

  it('preserves the booked interval and catalog edits when seeds rerun', async () => {
    await insert({ endAt: at('10:30') });
    try {
      await prisma.serviceType.update({
        where: { id: id.oilChange },
        data: { durationMinutes: 45 },
      });
      await seedDatabase(prisma);
      expect(
        (await prisma.serviceType.findUniqueOrThrow({ where: { id: id.oilChange } }))
          .durationMinutes,
      ).toBe(45);
      expect(await prisma.appointment.count()).toBe(1);
      expect((await prisma.appointment.findFirstOrThrow()).endAt).toEqual(at('10:30'));
    } finally {
      await prisma.serviceType.update({
        where: { id: id.oilChange },
        data: { durationMinutes: 30 },
      });
    }
  });

  it('allows exactly one confirmed insert across 20 competing writes and two clients', async () => {
    const other = createClient(database!.url);
    try {
      const results = await Promise.allSettled(
        Array.from({ length: 20 }, (_, i) =>
          insert({ endAt: at('10:30') }, i % 2 ? other : prisma),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(rejected).toHaveLength(19);
      for (const result of rejected) {
        expect(result.reason).toMatchObject({ code: 'P2010' });
        expect(JSON.stringify(result.reason)).toMatch(/"originalCode":"(23P01|40P01)"/);
      }
      expect(await other.appointment.count()).toBe(1);
      expect(await other.appointment.count({ where: { status: 'CONFIRMED' } })).toBe(1);
      const overlaps = await other.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*) FROM appointments a JOIN appointments b ON a.id < b.id
        WHERE a.status = 'CONFIRMED' AND b.status = 'CONFIRMED'
          AND (a.technician_id = b.technician_id OR a.service_bay_id = b.service_bay_id)
          AND tstzrange(a.start_at, a.end_at, '[)') && tstzrange(b.start_at, b.end_at, '[)')
      `;
      expect(overlaps[0].count).toBe(0n);
    } finally {
      await other.$disconnect();
    }
  });
});
