import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { CreateAppointmentInput } from './create-appointment.use-case';

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function bookingKey(rawHeaders: readonly string[]): string {
  const values: string[] = [];
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (rawHeaders[i]?.toLowerCase() === 'idempotency-key') values.push(rawHeaders[i + 1] ?? '');
  }
  if (values.length !== 1 || !uuidV4.test(values[0])) {
    throw new BadRequestException({ message: ['Idempotency-Key must be one UUID v4 header.'] });
  }
  return values[0].toLowerCase();
}

export function normalizeBooking(input: CreateAppointmentInput): CreateAppointmentInput {
  return {
    customerId: input.customerId.toLowerCase(),
    vehicleId: input.vehicleId.toLowerCase(),
    dealershipId: input.dealershipId.toLowerCase(),
    serviceTypeId: input.serviceTypeId.toLowerCase(),
    startAt: input.startAt,
  };
}

export function bookingFingerprint(input: CreateAppointmentInput): string {
  const normalized = normalizeBooking(input);
  return createHash('sha256')
    .update(
      JSON.stringify([
        'v1:POST:/api/v1/appointments',
        normalized.customerId,
        normalized.vehicleId,
        normalized.dealershipId,
        normalized.serviceTypeId,
        normalized.startAt.toISOString(),
      ]),
    )
    .digest('hex');
}

// Only a lock timeout from the key-claim INSERT has this meaning.
export class BookingKeyBusy extends Error {
  constructor() {
    super('Another booking transaction owns this key.');
    this.name = 'BookingKeyBusy';
  }
}
