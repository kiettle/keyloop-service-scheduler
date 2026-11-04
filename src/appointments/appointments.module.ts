import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { CustomerAppointmentsController } from './customer-appointments.controller';
import { ListCustomerAppointmentsUseCase } from './list-customer-appointments.use-case';
import { AppointmentRepository } from './appointment.repository';
import { AppointmentsController } from './appointments.controller';
import { CreateAppointmentUseCase } from './create-appointment.use-case';
import { GetAppointmentUseCase } from './get-appointment.use-case';
import { BookingCapacity } from './booking-capacity';
import { BookingRequestRepository } from './booking-request.repository';

@Module({
  imports: [DatabaseModule, SchedulingModule],
  controllers: [AppointmentsController, CustomerAppointmentsController],
  providers: [
    AppointmentRepository,
    BookingCapacity,
    BookingRequestRepository,
    CreateAppointmentUseCase,
    GetAppointmentUseCase,
    ListCustomerAppointmentsUseCase,
  ],
})
export class AppointmentsModule {}
