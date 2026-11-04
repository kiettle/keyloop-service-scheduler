import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { Clock } from '../../src/common/time/clock';
import { configureHttpServer } from '../../src/config/http-server';
import { Environment, validateEnvironment } from '../../src/config/environment';
import { PrismaService } from '../../src/database/prisma.service';
import { setupSwagger } from '../../src/config/swagger';
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

export async function createBookingApp(url: string, overrides: Partial<Environment> = {}) {
  let app: INestApplication | undefined;
  try {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Clock)
      .useValue({ now: () => at('00:00') })
      .overrideProvider(ConfigService)
      .useValue(new ConfigService({ ...validateEnvironment({ DATABASE_URL: url }), ...overrides }))
      .compile();
    app = module.createNestApplication({ logger: false });
    setupSwagger(app);
    await app.init();
    configureHttpServer(app.getHttpServer() as Server);
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
    prisma.appointmentBookingRequest.deleteMany(),
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

export async function seedIndependentCustomers(prisma: PrismaClient, count = 20) {
  const inputs = Array.from({ length: count }, (_, i) => independentInput(i));
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
