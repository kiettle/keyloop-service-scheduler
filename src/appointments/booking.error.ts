export type BookingErrorCode =
  | 'CUSTOMER_NOT_FOUND'
  | 'VEHICLE_NOT_FOUND'
  | 'APPOINTMENT_NOT_FOUND'
  | 'BUSINESS_RULE_VIOLATION'
  | 'NO_AVAILABILITY'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'BOOKING_BUSY'
  | 'BOOKING_TIMEOUT'
  | 'BOOKING_CONTENTION';

export class BookingError extends Error {
  constructor(
    readonly code: BookingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BookingError';
  }
}

// These describe aborted allocation attempts, not public API errors.
export class BookingConflict extends Error {
  constructor(readonly kind: 'resource' | 'transaction') {
    super('Booking transaction conflicted.');
    this.name = 'BookingConflict';
  }
}

export class DatabaseUnavailable extends Error {
  constructor() {
    super('Database is temporarily unavailable.');
    this.name = 'DatabaseUnavailable';
  }
}
