import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { Clock } from '../../src/common/time/clock';
import { PrismaService } from '../../src/database/prisma.service';
import { fixtureIds as id, seedDatabase } from '../../prisma/seed-data';

export const at = (time: string) => new Date(`2035-01-15T${time}:00.000Z`);
export const bookingInput = {
  customerId: id.customer1,
  vehicleId: id.vehicle1,
  dealershipId: id.dealershipA,
  serviceTypeId: id.oilChange,
  startAt: at('10:00').toISOString(),
};
export interface AppointmentJson {
  id: string;
  customerId: string;
  vehicleId: string;
  dealershipId: string;
  serviceTypeId: string;
  technicianId: string;
  serviceBayId: string;
  startAt: string;
  endAt: string;
  status: string;
  createdAt: string;
}
export interface ErrorJson {
  error: { code: string; message: string };
  requestId: string;
}

export async function createBookingApp(url: string) {
  let app: INestApplication | undefined;
  try {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Clock)
      .useValue({ now: () => at('00:00') })
      .overrideProvider(ConfigService)
      .useValue(new ConfigService({ DATABASE_URL: url, BOOKING_MAX_ATTEMPTS: 4 }))
      .compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
    const initialized = app;
    return {
      app: initialized,
      prisma: initialized.get(PrismaService),
      http: request(initialized.getHttpServer() as Server),
      async close() {
        await initialized.close();
      },
    };
  } catch (error) {
    await app?.close();
    throw error;
  }
}

export async function resetBookingFixtures(prisma: PrismaClient) {
  await prisma.$transaction([
    prisma.appointment.deleteMany(),
    prisma.technician.updateMany({ data: { isActive: true } }),
    prisma.serviceBay.updateMany({ data: { isActive: true } }),
    prisma.serviceType.updateMany({ data: { isActive: true } }),
    prisma.serviceType.update({ where: { id: id.oilChange }, data: { durationMinutes: 30 } }),
  ]);
  await seedDatabase(prisma);
}

export function independentInput(index: number) {
  const suffix = String(index + 1).padStart(12, '0');
  return {
    ...bookingInput,
    customerId: `70000000-0000-4000-8000-${suffix}`,
    vehicleId: `80000000-0000-4000-8000-${suffix}`,
  };
}

export async function seedIndependentCustomers(prisma: PrismaClient) {
  const inputs = Array.from({ length: 20 }, (_, i) => independentInput(i));
  await prisma.customer.createMany({
    data: inputs.map(({ customerId }) => ({
      id: customerId,
      name: 'Concurrency fixture',
    })),
  });
  await prisma.vehicle.createMany({
    data: inputs.map(({ customerId, vehicleId }, i) => ({
      id: vehicleId,
      customerId,
      vin: `PHASE4${String(i).padStart(11, '0')}`,
      make: 'Demo',
      model: 'Test',
    })),
  });
}
