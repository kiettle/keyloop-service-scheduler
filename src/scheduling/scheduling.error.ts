export type SchedulingErrorCode =
  | 'INVALID_BOOKING_TIME'
  | 'DEALERSHIP_NOT_FOUND'
  | 'SERVICE_TYPE_NOT_FOUND'
  | 'SERVICE_TYPE_INACTIVE';

// Application outcomes are independent of HTTP status codes.
export class SchedulingError extends Error {
  constructor(
    readonly code: SchedulingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SchedulingError';
  }
}
