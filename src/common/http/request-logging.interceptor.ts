import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { tap } from 'rxjs';
import { HttpRequest, HttpResponse } from './request-context';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestLoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<HttpRequest>();
    const response = context.switchToHttp().getResponse<HttpResponse>();
    request.requestId = randomUUID();
    response.setHeader('x-request-id', request.requestId);
    const started = Date.now();
    this.logger.log({
      event: 'request_started',
      requestId: request.requestId,
      method: request.method,
    });
    return next.handle().pipe(
      tap({
        next: () =>
          this.logger.log({
            event: 'request_completed',
            requestId: request.requestId,
            status: response.statusCode,
            durationMs: Date.now() - started,
          }),
        error: () =>
          this.logger.log({
            event: 'request_completed',
            requestId: request.requestId,
            outcome: 'failed',
            durationMs: Date.now() - started,
          }),
      }),
    );
  }
}
