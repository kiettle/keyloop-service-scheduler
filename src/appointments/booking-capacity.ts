import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Environment } from '../config/environment';
import { remainingBookingTime } from './booking-deadline';
import { BookingError } from './booking.error';

interface WaitingBooking {
  admit(): void;
  cancel(error: BookingError): void;
}

// Capacity protection per app instance; resource exclusivity remains in PostgreSQL.
@Injectable()
export class BookingCapacity implements OnModuleDestroy {
  private active = 0;
  private closing = false;
  private readonly pending: WaitingBooking[] = [];

  constructor(private readonly config: ConfigService<Environment, true>) {}

  get counts() {
    return { active: this.active, pending: this.pending.length };
  }

  acquire(deadline: number, signal?: AbortSignal): Promise<() => void> {
    const waitMs = remainingBookingTime(deadline);
    if (this.closing)
      return Promise.reject(
        new BookingError('BOOKING_BUSY', 'The service is shutting down. Please retry.'),
      );
    if (signal?.aborted) return Promise.reject(this.cancelled());
    if (this.active < this.config.get('BOOKING_MAX_CONCURRENT', { infer: true })) {
      this.active++;
      return Promise.resolve(this.releaseOnce());
    }
    if (this.pending.length >= this.config.get('BOOKING_MAX_PENDING', { infer: true })) {
      return Promise.reject(
        new BookingError('BOOKING_BUSY', 'Booking capacity is full. Please retry.'),
      );
    }

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      };
      const entry: WaitingBooking = {
        admit: () => {
          cleanup();
          try {
            remainingBookingTime(deadline);
            if (signal?.aborted) throw this.cancelled();
            resolve(this.releaseOnce());
          } catch (error) {
            reject(error instanceof Error ? error : new Error('Booking admission failed.'));
            this.release();
          }
        },
        cancel: (error) => {
          const index = this.pending.indexOf(entry);
          if (index < 0) return;
          this.pending.splice(index, 1);
          cleanup();
          reject(error);
        },
      };
      const abort = () => entry.cancel(this.cancelled());
      const timer = setTimeout(() => {
        entry.cancel(
          new BookingError('BOOKING_TIMEOUT', 'Booking time budget expired. Please retry.'),
        );
      }, waitMs);
      this.pending.push(entry);
      signal?.addEventListener('abort', abort, { once: true });
    });
  }

  onModuleDestroy(): void {
    this.closing = true;
    for (const entry of [...this.pending]) {
      entry.cancel(new BookingError('BOOKING_BUSY', 'The service is shutting down. Please retry.'));
    }
  }

  private cancelled() {
    return new BookingError('BOOKING_BUSY', 'Booking request was cancelled.');
  }

  private releaseOnce(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.release();
    };
  }

  private release(): void {
    const next = this.pending.shift();
    if (next) next.admit();
    else this.active--;
  }
}
