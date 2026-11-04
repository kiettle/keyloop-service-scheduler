import { Injectable } from '@nestjs/common';
import { BookingError } from '../appointments/booking.error';
import { PaginationQueryDto, paginate } from '../common/http/pagination';
import { DirectoryCache } from './directory-cache';
import { DirectoryRepository } from './directory.repository';

@Injectable()
export class DirectoryService {
  constructor(
    private readonly repository: DirectoryRepository,
    private readonly cache: DirectoryCache,
  ) {}

  async customers(query: PaginationQueryDto) {
    return paginate(await this.repository.customers(query), query);
  }

  async vehicles(customerId: string, query: PaginationQueryDto) {
    const customer = await this.repository.vehicles(customerId, query);
    if (!customer) throw new BookingError('CUSTOMER_NOT_FOUND', 'Customer not found.');
    return paginate(customer.vehicles, query);
  }

  async dealerships(query: PaginationQueryDto, requestId?: string) {
    const cached = await this.cache.getDealerships(query, requestId);
    if (cached !== null) return cached;
    const page = paginate(await this.repository.dealerships(query), query);
    await this.cache.setDealerships(query, page, requestId);
    return page;
  }
}
