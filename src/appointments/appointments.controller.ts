import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../common/http/api-error.dto';
import { AppointmentResponseDto } from './appointment-response.dto';
import { HttpRequest, HttpResponse } from '../common/http/request-context';
import { AppointmentParamsDto, CreateAppointmentDto } from './create-appointment.dto';
import { CreateAppointmentUseCase } from './create-appointment.use-case';
import { GetAppointmentUseCase } from './get-appointment.use-case';
import { bookingKey } from './booking-idempotency';

@Controller('api/v1/appointments')
@ApiTags('Appointments')
export class AppointmentsController {
  constructor(
    private readonly createAppointment: CreateAppointmentUseCase,
    private readonly getAppointment: GetAppointmentUseCase,
  ) {}

  @Post()
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    example: 'c2ea7f26-2687-46ad-bdf1-7ab632f420cb',
    schema: {
      type: 'string',
      format: 'uuid',
      pattern:
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
    },
    description:
      'One UUID v4 per booking intent. The example key is for the seeded demo body; repeating it replays the saved booking. Use a new key for a different intent. Reuse it for retries; successful results are retained indefinitely.',
  })
  @ApiOperation({
    summary: 'Confirm an appointment',
    description:
      'Assigns resources automatically. Returns success only after commit. Same key and normalized body replay the original result before dynamic business validation. Failed attempts do not consume a key. Unknown input fields are rejected.',
  })
  @ApiCreatedResponse({
    type: AppointmentResponseDto,
    description: 'Committed CONFIRMED appointment, or the original saved response on replay.',
    headers: {
      'Idempotency-Replayed': {
        schema: { type: 'string', enum: ['false', 'true'] },
        description: 'true when returning a previously committed result.',
      },
    },
  })
  @ApiResponse({
    status: 400,
    type: ApiErrorResponseDto,
    description:
      'VALIDATION_ERROR: malformed, missing, or forbidden fields, or missing/invalid/repeated Idempotency-Key.',
  })
  @ApiResponse({
    status: 404,
    type: ApiErrorResponseDto,
    description:
      'CUSTOMER_NOT_FOUND, VEHICLE_NOT_FOUND, DEALERSHIP_NOT_FOUND, or SERVICE_TYPE_NOT_FOUND.',
  })
  @ApiResponse({
    status: 409,
    type: ApiErrorResponseDto,
    description:
      'NO_AVAILABILITY: no eligible pair remains; IDEMPOTENCY_KEY_REUSED: a successful key was reused with a different request.',
  })
  @ApiResponse({
    status: 422,
    type: ApiErrorResponseDto,
    description: 'INVALID_BOOKING_TIME or BUSINESS_RULE_VIOLATION.',
  })
  @ApiResponse({
    status: 503,
    type: ApiErrorResponseDto,
    description:
      'BOOKING_BUSY, BOOKING_TIMEOUT, BOOKING_CONTENTION, or SERVICE_UNAVAILABLE; Retry-After: 1.',
  })
  @ApiResponse({
    status: 500,
    type: ApiErrorResponseDto,
    description: 'INTERNAL_ERROR: unexpected failure; no database details exposed.',
  })
  async create(
    @Body() input: CreateAppointmentDto,
    @Req() request: HttpRequest,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    const key = bookingKey(request.rawHeaders);
    const cancellation = new AbortController();
    const disconnected = () => {
      if (!response.writableEnded) cancellation.abort();
    };
    response.on('close', disconnected);
    try {
      const result = await this.createAppointment.execute(
        { ...input, startAt: new Date(input.startAt) },
        key,
        request.requestId,
        cancellation.signal,
      );
      response.setHeader('Idempotency-Replayed', String(result.replayed));
      return result.appointment;
    } finally {
      response.off('close', disconnected);
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Retrieve a persisted appointment' })
  @ApiOkResponse({ type: AppointmentResponseDto })
  @ApiResponse({
    status: 400,
    type: ApiErrorResponseDto,
    description: 'VALIDATION_ERROR: malformed identifier.',
  })
  @ApiResponse({ status: 404, type: ApiErrorResponseDto, description: 'APPOINTMENT_NOT_FOUND.' })
  @ApiResponse({ status: 503, type: ApiErrorResponseDto, description: 'SERVICE_UNAVAILABLE.' })
  @ApiResponse({ status: 500, type: ApiErrorResponseDto, description: 'INTERNAL_ERROR.' })
  get(@Param() params: AppointmentParamsDto) {
    return this.getAppointment.execute(params.id);
  }
}
