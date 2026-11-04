import { Injectable } from '@nestjs/common';
import { AppointmentRepository } from './appointment.repository';
import { BookingError } from './booking.error';
import { serializeAppointment } from './appointment-result';

@Injectable()
export class GetAppointmentUseCase {
  constructor(private readonly repository: AppointmentRepository) {}

  async execute(id: string) {
    const appointment = await this.repository.findById(id);
    if (!appointment) throw new BookingError('APPOINTMENT_NOT_FOUND', 'Appointment not found.');
    return serializeAppointment(appointment);
  }
}
