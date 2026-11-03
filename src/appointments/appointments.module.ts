import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { AppointmentRepository } from './appointment.repository';
import { AppointmentsController } from './appointments.controller';
import { CreateAppointmentUseCase } from './create-appointment.use-case';
import { GetAppointmentUseCase } from './get-appointment.use-case';

@Module({
  imports: [DatabaseModule, SchedulingModule],
  controllers: [AppointmentsController],
  providers: [AppointmentRepository, CreateAppointmentUseCase, GetAppointmentUseCase],
})
export class AppointmentsModule {}
