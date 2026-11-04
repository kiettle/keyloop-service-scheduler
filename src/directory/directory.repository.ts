import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PaginationQueryDto, paginationWindow } from '../common/http/pagination';

@Injectable()
export class DirectoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  customers(query: PaginationQueryDto) {
    return this.prisma.customer.findMany({
      select: { id: true, name: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      ...paginationWindow(query),
    });
  }

  vehicles(customerId: string, query: PaginationQueryDto) {
    return this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        vehicles: {
          select: { id: true, customerId: true, vin: true, make: true, model: true },
          orderBy: { id: 'asc' },
          ...paginationWindow(query),
        },
      },
    });
  }

  dealerships(query: PaginationQueryDto) {
    return this.prisma.dealership.findMany({
      select: { id: true, name: true, timeZone: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      ...paginationWindow(query),
    });
  }
}
