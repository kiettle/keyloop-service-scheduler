import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { HttpRequest } from '../common/http/request-context';
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
  create(@Body() input: CreateAppointmentDto, @Req() request: HttpRequest) {
    return this.createAppointment.execute(
      { ...input, startAt: new Date(input.startAt) },
      request.requestId,
    );
  }

  @Get(':id')
  get(@Param() params: AppointmentParamsDto) {
    return this.getAppointment.execute(params.id);
  }
}
