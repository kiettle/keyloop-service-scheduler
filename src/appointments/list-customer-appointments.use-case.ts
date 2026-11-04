import { Injectable } from '@nestjs/common';
import { PaginationQueryDto, paginate } from '../common/http/pagination';
import { AppointmentRepository } from './appointment.repository';
import { serializeAppointment } from './appointment-result';
import { BookingError } from './booking.error';

@Injectable()
export class ListCustomerAppointmentsUseCase {
  constructor(private readonly repository: AppointmentRepository) {}

  async execute(customerId: string, query: PaginationQueryDto) {
    const customer = await this.repository.findByCustomer(customerId, query);
    if (!customer) throw new BookingError('CUSTOMER_NOT_FOUND', 'Customer not found.');
    return paginate(customer.appointments.map(serializeAppointment), query);
  }
}
