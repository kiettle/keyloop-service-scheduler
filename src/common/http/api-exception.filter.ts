import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { BookingError, DatabaseUnavailable } from '../../appointments/booking.error';
import { postgresState, translateDatabaseError } from '../../appointments/database-error';
import { SchedulingError } from '../../scheduling/scheduling.error';
import { HttpRequest, HttpResponse } from './request-context';

const statusByCode = {
  INVALID_BOOKING_TIME: 422,
  DEALERSHIP_NOT_FOUND: 404,
  SERVICE_TYPE_NOT_FOUND: 404,
  SERVICE_TYPE_INACTIVE: 422,
  CUSTOMER_NOT_FOUND: 404,
  VEHICLE_NOT_FOUND: 404,
  APPOINTMENT_NOT_FOUND: 404,
  BUSINESS_RULE_VIOLATION: 422,
  NO_AVAILABILITY: 409,
  BOOKING_CONTENTION: 503,
  BOOKING_BUSY: 503,
  BOOKING_TIMEOUT: 503,
} as const;

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<HttpRequest>();
    const response = http.getResponse<HttpResponse>();
    const requestId = request.requestId ?? randomUUID();
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred.';
    let details: unknown;
    if (error instanceof SchedulingError || error instanceof BookingError) {
      status = statusByCode[error.code];
      code = error.code === 'SERVICE_TYPE_INACTIVE' ? 'BUSINESS_RULE_VIOLATION' : error.code;
      message = error.message;
    } else if (translateDatabaseError(error) instanceof DatabaseUnavailable) {
      status = 503;
      code = 'SERVICE_UNAVAILABLE';
      message = 'The service is temporarily unavailable. Please retry later.';
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      if (status < 500) {
        code = status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR';
        message = status === 404 ? 'Route not found.' : 'Invalid request.';
      }
      const body: unknown = error.getResponse();
      if (
        typeof body === 'object' &&
        body !== null &&
        'message' in body &&
        Array.isArray(body.message) &&
        status < 500
      ) {
        details = body.message;
      }
    }
    if (status >= 500) {
      this.logger.error({
        event: 'request_failed',
        requestId,
        outcome: code,
        errorType: error instanceof Error ? error.name : 'UnknownError',
        sqlState: postgresState(error),
      });
    }
    response.setHeader('x-request-id', requestId);
    if (status === 503) response.setHeader('retry-after', '1');
    response
      .status(status)
      .json({ error: { code, message, ...(details ? { details } : {}) }, requestId });
  }
}
