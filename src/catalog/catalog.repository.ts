import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class CatalogRepository {
  constructor(private readonly prisma: PrismaService) {}

  findActiveServiceTypes() {
    return this.prisma.serviceType.findMany({
      where: { isActive: true },
      select: { id: true, name: true, durationMinutes: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }
}
