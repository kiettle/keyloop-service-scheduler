import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { Environment } from '../config/environment';
import {
  CheckAvailabilityInput,
  CheckAvailabilityUseCase,
} from '../scheduling/check-availability.use-case';
import { AppointmentRepository } from './appointment.repository';
import { BookingConflict, BookingError } from './booking.error';

export interface CreateAppointmentInput extends CheckAvailabilityInput {
  customerId: string;
  vehicleId: string;
}

@Injectable()
export class CreateAppointmentUseCase {
  private readonly logger = new Logger(CreateAppointmentUseCase.name);

  constructor(
    private readonly repository: AppointmentRepository,
    private readonly availability: CheckAvailabilityUseCase,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  async execute(input: CreateAppointmentInput, requestId?: string) {
    const started = Date.now();
    const fields = {
      requestId,
      dealershipId: input.dealershipId,
      serviceTypeId: input.serviceTypeId,
    };
    const attempts = this.config.get('BOOKING_MAX_ATTEMPTS', { infer: true });
    this.logger.log({ event: 'booking_started', ...fields });
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const appointment = await this.repository.transaction((tx) => this.confirm(input, tx));
        this.logger.log({
          event: 'booking_confirmed',
          ...fields,
          appointmentId: appointment.id,
          outcome: 'confirmed',
          durationMs: Date.now() - started,
          retryCount: attempt - 1,
        });
        return appointment;
      } catch (error) {
        if (error instanceof BookingConflict) {
          this.logger.warn({
            event: 'booking_conflict',
            ...fields,
            kind: error.kind,
            retryCount: attempt - 1,
          });
          if (attempt < attempts) {
            this.logger.log({ event: 'booking_retry', ...fields, retryCount: attempt });
            continue;
          }
          throw new BookingError(
            'BOOKING_CONTENTION',
            'Booking contention could not be resolved. Please retry.',
          );
        }
        if (error instanceof BookingError && error.code === 'NO_AVAILABILITY') {
          this.logger.log({
            event: 'booking_unavailable',
            ...fields,
            outcome: 'unavailable',
            durationMs: Date.now() - started,
            retryCount: attempt - 1,
          });
        }
        throw error;
      }
    }
    throw new Error('Invalid booking attempt configuration.');
  }

  private async confirm(input: CreateAppointmentInput, tx: Prisma.TransactionClient) {
    const [customer, vehicle] = await Promise.all([
      this.repository.findCustomer(input.customerId, tx),
      this.repository.findVehicle(input.vehicleId, tx),
    ]);
    if (!customer) throw new BookingError('CUSTOMER_NOT_FOUND', 'Customer not found.');
    if (!vehicle) throw new BookingError('VEHICLE_NOT_FOUND', 'Vehicle not found.');
    if (vehicle.customerId !== customer.id) {
      throw new BookingError('BUSINESS_RULE_VIOLATION', 'Vehicle does not belong to the customer.');
    }

    const available = await this.availability.execute(input, tx);
    if (!available.available) {
      throw new BookingError(
        'NO_AVAILABILITY',
        'No qualified technician and service bay are available for the requested interval.',
      );
    }

    return this.repository.create(
      {
        customerId: input.customerId,
        vehicleId: input.vehicleId,
        dealershipId: input.dealershipId,
        serviceTypeId: input.serviceTypeId,
        technicianId: available.technicianId,
        serviceBayId: available.serviceBayId,
        startAt: available.startAt,
        endAt: available.endAt,
        status: 'CONFIRMED',
      },
      tx,
    );
  }
}
