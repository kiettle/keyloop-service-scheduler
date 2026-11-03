import { performance } from 'node:perf_hooks';
import { BookingError } from './booking.error';

export function remainingBookingTime(deadline: number): number {
  const remaining = Math.floor(deadline - performance.now());
  if (remaining <= 0) {
    throw new BookingError('BOOKING_TIMEOUT', 'Booking time budget expired. Please retry.');
  }
  return remaining;
}
