import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BookingKeyBusy } from './booking-idempotency';
import { postgresState } from './database-error';
import { AppointmentResult, readBookingSnapshot } from './appointment-result';

export type BookingClaim =
  | { claimed: true }
  | { claimed: false; fingerprint: string; appointment: AppointmentResult };

@Injectable()
export class BookingRequestRepository {
  async claim(
    key: string,
    fingerprint: string,
    tx: Prisma.TransactionClient,
  ): Promise<BookingClaim> {
    let inserted: Array<{ key: string }>;
    try {
      inserted = await tx.$queryRaw<Array<{ key: string }>>`
        INSERT INTO appointment_booking_requests (key, request_fingerprint)
        VALUES (${key}::uuid, ${fingerprint})
        ON CONFLICT (key) DO NOTHING RETURNING key
      `;
    } catch (error) {
      if (postgresState(error) === '55P03') throw new BookingKeyBusy();
      throw error;
    }
    if (inserted.length === 1) return { claimed: true };
    // A separate READ COMMITTED statement sees the conflict winner's committed result.
    const saved = await tx.appointmentBookingRequest.findUniqueOrThrow({ where: { key } });
    if (!saved.appointmentId || saved.responseBody === null) {
      throw new Error('Incomplete saved booking request.');
    }
    return {
      claimed: false,
      fingerprint: saved.requestFingerprint,
      appointment: readBookingSnapshot(saved.responseBody, saved.appointmentId),
    };
  }

  async complete(
    key: string,
    body: AppointmentResult,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    // A returned transaction callback must never leave its own claim unfinished.
    await tx.appointmentBookingRequest.update({
      where: { key },
      data: { appointmentId: body.id, responseBody: { ...body } },
    });
  }
}
