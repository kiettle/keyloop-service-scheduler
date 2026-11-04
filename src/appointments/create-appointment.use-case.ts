import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { performance } from 'node:perf_hooks';
import { randomInt } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { BookingCapacity } from './booking-capacity';
import { remainingBookingTime } from './booking-deadline';
import { Environment } from '../config/environment';
import {
  CheckAvailabilityInput,
  CheckAvailabilityUseCase,
} from '../scheduling/check-availability.use-case';
import { AppointmentRepository } from './appointment.repository';
import { BookingConflict, BookingError } from './booking.error';
import { BookingKeyBusy, bookingFingerprint, normalizeBooking } from './booking-idempotency';
import { BookingRequestRepository } from './booking-request.repository';
import { AppointmentResult, serializeAppointment } from './appointment-result';

export interface CreateAppointmentInput extends CheckAvailabilityInput {
  customerId: string;
  vehicleId: string;
}

export interface CreateAppointmentResult {
  appointment: AppointmentResult;
  replayed: boolean;
}

@Injectable()
export class CreateAppointmentUseCase {
  private readonly logger = new Logger(CreateAppointmentUseCase.name);

  constructor(
    private readonly repository: AppointmentRepository,
    private readonly availability: CheckAvailabilityUseCase,
    private readonly config: ConfigService<Environment, true>,
    private readonly capacity: BookingCapacity,
    private readonly requests: BookingRequestRepository,
  ) {}

  async execute(
    input: CreateAppointmentInput,
    key: string,
    requestId?: string,
    signal?: AbortSignal,
  ): Promise<CreateAppointmentResult> {
    input = normalizeBooking(input);
    const fingerprint = bookingFingerprint(input);
    const started = performance.now();
    const deadline = started + this.config.get('BOOKING_TIMEOUT_MS', { infer: true });
    let release: () => void;
    try {
      release = await this.capacity.acquire(deadline, signal);
    } catch (error) {
      this.logger.warn({
        event: 'booking_rejected',
        requestId,
        dealershipId: input.dealershipId,
        serviceTypeId: input.serviceTypeId,
        outcome: error instanceof BookingError ? error.code : 'INTERNAL_ERROR',
        durationMs: Math.round(performance.now() - started),
        ...this.capacity.counts,
      });
      throw error;
    }
    try {
      return await this.book(
        input,
        key.toLowerCase(),
        fingerprint,
        requestId,
        deadline,
        performance.now() - started,
        signal,
      );
    } finally {
      release();
    }
  }

  private async book(
    input: CreateAppointmentInput,
    key: string,
    fingerprint: string,
    requestId: string | undefined,
    deadline: number,
    queueWaitMs: number,
    signal?: AbortSignal,
  ) {
    const started = performance.now();
    const fields = {
      requestId,
      dealershipId: input.dealershipId,
      serviceTypeId: input.serviceTypeId,
      queueWaitMs: Math.round(queueWaitMs),
    };
    const attempts = this.config.get('BOOKING_MAX_ATTEMPTS', { infer: true });
    this.logger.log({ event: 'booking_started', ...fields });
    let attempt = 1;
    while (attempt <= attempts) {
      remainingBookingTime(deadline);
      if (signal?.aborted) throw new BookingError('BOOKING_BUSY', 'Booking request was cancelled.');
      try {
        const result = await this.repository.transaction(
          async (tx): Promise<CreateAppointmentResult> => {
            const claim = await this.requests.claim(key, fingerprint, tx);
            if (!claim.claimed) {
              if (claim.fingerprint !== fingerprint) {
                this.logger.warn({
                  event: 'booking_key_mismatch',
                  ...fields,
                  appointmentId: claim.appointment.id,
                });
                throw new BookingError(
                  'IDEMPOTENCY_KEY_REUSED',
                  'Idempotency-Key was already used for a different booking request.',
                );
              }
              return { appointment: claim.appointment, replayed: true };
            }
            const appointment = serializeAppointment(await this.confirm(input, tx));
            await this.requests.complete(key, appointment, tx);
            return { appointment, replayed: false };
          },
          deadline,
        );
        this.logger.log({
          event: result.replayed ? 'booking_replayed' : 'booking_confirmed',
          ...fields,
          appointmentId: result.appointment.id,
          outcome: result.replayed ? 'replayed' : 'confirmed',
          durationMs: Math.round(performance.now() - started + queueWaitMs),
          retryCount: attempt - 1,
        });
        return result;
      } catch (error) {
        if (error instanceof BookingKeyBusy) {
          // The aborted claim transaction has rolled back. No connection is held while waiting.
          await delay(Math.min(randomInt(25, 51), remainingBookingTime(deadline)));
          continue;
        }
        if (error instanceof BookingConflict) {
          this.logger.warn({
            event: 'booking_conflict',
            ...fields,
            kind: error.kind,
            retryCount: attempt - 1,
          });
          if (attempt < attempts) {
            this.logger.log({ event: 'booking_retry', ...fields, retryCount: attempt });
            // The repository has finished rollback; backoff holds no DB connection.
            await delay(
              Math.min(randomInt(10, 31) * 2 ** (attempt - 1), remainingBookingTime(deadline)),
            );
            attempt++;
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
            durationMs: Math.round(performance.now() - started + queueWaitMs),
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
