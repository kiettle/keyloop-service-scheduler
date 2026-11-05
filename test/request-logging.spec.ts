import { Body, Controller, Get, INestApplication, Logger, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IsUUID } from 'class-validator';
import { Server } from 'node:http';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BookingError, DatabaseUnavailable } from '../src/appointments/booking.error';
import { HttpModule } from '../src/common/http/http.module';

const privateDetail = 'private customer VIN SQL detail';

class LoggingInput {
  @IsUUID()
  customerId!: string;
}

@Controller('logging-probe')
class LoggingController {
  @Post()
  create(@Body() input: LoggingInput) {
    return input;
  }

  @Get('missing')
  missing() {
    throw new BookingError('CUSTOMER_NOT_FOUND', 'Customer not found.');
  }

  @Get('ownership')
  ownership() {
    throw new BookingError('BUSINESS_RULE_VIOLATION', 'Vehicle does not belong to the customer.');
  }

  @Get('unavailable')
  unavailable() {
    throw new DatabaseUnavailable();
  }

  @Get('unexpected')
  unexpected() {
    throw new Error(privateDetail);
  }
}

describe('classified HTTP failure logs', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [HttpModule],
      controllers: [LoggingController],
    }).compile();
    app = module.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    http = request(app.getHttpServer() as Server);
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => app?.close());

  it.each([
    ['validation', 400, 'VALIDATION_ERROR'],
    ['missing', 404, 'CUSTOMER_NOT_FOUND'],
    ['ownership', 422, 'BUSINESS_RULE_VIOLATION'],
    ['unavailable', 503, 'SERVICE_UNAVAILABLE'],
    ['unexpected', 500, 'INTERNAL_ERROR'],
  ] as const)(
    'logs %s once with its safe status, code, and request ID',
    async (kind, status, code) => {
      const warning = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const failure = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const response =
        kind === 'validation'
          ? await http.post('/logging-probe').send({ customerId: privateDetail }).expect(status)
          : await http.get(`/logging-probe/${kind}`).expect(status);
      const entries: unknown[] = [...warning.mock.calls, ...failure.mock.calls].map(
        (call) => call[0] as unknown,
      );
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        event: 'request_failed',
        requestId: response.headers['x-request-id'],
        method: kind === 'validation' ? 'POST' : 'GET',
        status,
        outcome: code,
      });
      expect(response.body).toMatchObject({
        error: { code },
        requestId: response.headers['x-request-id'],
      });
      expect(warning).toHaveBeenCalledTimes(status < 500 ? 1 : 0);
      expect(failure).toHaveBeenCalledTimes(status >= 500 ? 1 : 0);
      expect(JSON.stringify(entries)).not.toContain(privateDetail);
      expect(response.text).not.toContain(privateDetail);
    },
  );
});
