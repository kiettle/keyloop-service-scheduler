import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { HttpRequest, HttpResponse } from '../common/http/request-context';
import { AppointmentParamsDto, CreateAppointmentDto } from './create-appointment.dto';
import { CreateAppointmentUseCase } from './create-appointment.use-case';
import { GetAppointmentUseCase } from './get-appointment.use-case';

@Controller('api/v1/appointments')
export class AppointmentsController {
  constructor(
    private readonly createAppointment: CreateAppointmentUseCase,
    private readonly getAppointment: GetAppointmentUseCase,
  ) {}

  @Post()
  async create(
    @Body() input: CreateAppointmentDto,
    @Req() request: HttpRequest,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    const cancellation = new AbortController();
    const disconnected = () => {
      if (!response.writableEnded) cancellation.abort();
    };
    response.on('close', disconnected);
    try {
      return await this.createAppointment.execute(
        { ...input, startAt: new Date(input.startAt) },
        request.requestId,
        cancellation.signal,
      );
    } finally {
      response.off('close', disconnected);
    }
  }

  @Get(':id')
  get(@Param() params: AppointmentParamsDto) {
    return this.getAppointment.execute(params.id);
  }
}
