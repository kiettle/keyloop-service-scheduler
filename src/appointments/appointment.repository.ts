import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { translateDatabaseError } from './database-error';

const appointmentSelect = {
  id: true,
  customerId: true,
  vehicleId: true,
  dealershipId: true,
  serviceTypeId: true,
  technicianId: true,
  serviceBayId: true,
  startAt: true,
  endAt: true,
  status: true,
  createdAt: true,
} satisfies Prisma.AppointmentSelect;

@Injectable()
export class AppointmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async transaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 5000,
        timeout: 10_000,
      });
    } catch (error) {
      // Awaiting above ensures rollback/commit finishes before classification.
      throw translateDatabaseError(error);
    }
  }

  findCustomer(id: string, tx: Prisma.TransactionClient) {
    return tx.customer.findUnique({ where: { id }, select: { id: true } });
  }

  findVehicle(id: string, tx: Prisma.TransactionClient) {
    return tx.vehicle.findUnique({ where: { id }, select: { id: true, customerId: true } });
  }

  async create(data: Prisma.AppointmentUncheckedCreateInput, tx: Prisma.TransactionClient) {
    return await tx.appointment.create({ data, select: appointmentSelect });
  }

  async findById(id: string) {
    try {
      return await this.prisma.appointment.findUnique({ where: { id }, select: appointmentSelect });
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }
}
