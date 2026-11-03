import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { PrismaService } from '../database/prisma.service';
import { remainingBookingTime } from './booking-deadline';
import { BookingConflict, BookingError } from './booking.error';
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

  async transaction<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
    deadline = performance.now() + 5000,
  ): Promise<T> {
    let transactionStarted = false;
    try {
      const budget = remainingBookingTime(deadline);
      return await this.prisma.$transaction(
        async (tx) => {
          transactionStarted = true;
          remainingBookingTime(deadline);
          const result = await operation(tx);
          remainingBookingTime(deadline);
          return result;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          maxWait: Math.min(1000, budget),
          timeout: budget,
        },
      );
    } catch (error) {
      // Awaiting above ensures rollback/commit finishes before classification.
      if (
        transactionStarted &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2028' &&
        performance.now() >= deadline
      ) {
        throw new BookingError('BOOKING_TIMEOUT', 'Booking time budget expired. Please retry.');
      }
      throw translateDatabaseError(error, transactionStarted);
    }
  }

  findCustomer(id: string, tx: Prisma.TransactionClient) {
    return tx.customer.findUnique({ where: { id }, select: { id: true } });
  }

  findVehicle(id: string, tx: Prisma.TransactionClient) {
    return tx.vehicle.findUnique({ where: { id }, select: { id: true, customerId: true } });
  }

  async create(data: Prisma.AppointmentUncheckedCreateInput, tx: Prisma.TransactionClient) {
    const id = data.id ?? randomUUID();
    // A single-item ON CONFLICT DO NOTHING avoids plain-INSERT exclusion deadlock storms.
    // Both exclusion constraints still arbitrate the full interval, including direct writes.
    const [appointment] = await tx.appointment.createManyAndReturn({
      data: [{ ...data, id }],
      skipDuplicates: true,
      select: appointmentSelect,
    });
    if (appointment) return appointment;
    if (await tx.appointment.findUnique({ where: { id }, select: { id: true } })) {
      throw new Error('Appointment identifier already exists.');
    }
    // The only other arbiters in the current schema are the two resource exclusions.
    throw new BookingConflict('resource');
  }

  async findById(id: string) {
    try {
      return await this.prisma.appointment.findUnique({ where: { id }, select: appointmentSelect });
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }
}
