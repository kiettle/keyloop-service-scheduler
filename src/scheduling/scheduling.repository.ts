import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { TimeInterval } from './interval';
import { EligibleResources } from './resource-allocation.service';

@Injectable()
export class SchedulingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async dealershipExists(
    dealershipId: string,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<boolean> {
    const dealership = await client.dealership.findUnique({
      where: { id: dealershipId },
      select: { id: true },
    });
    return dealership !== null;
  }

  findServiceType(serviceTypeId: string, client: Prisma.TransactionClient = this.prisma) {
    return client.serviceType.findUnique({
      where: { id: serviceTypeId },
      select: { id: true, isActive: true, durationMinutes: true },
    });
  }

  async findEligibleResources(
    dealershipId: string,
    serviceTypeId: string,
    interval: TimeInterval,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<EligibleResources> {
    const requested = Prisma.sql`tstzrange(${interval.startAt}::timestamptz, ${interval.endAt}::timestamptz, '[)')`;
    // Match the existing partial GiST indexes directly as appointment history grows.
    // Two set-based reads, with bound values and no per-candidate queries.
    const [technicians, bays] = await Promise.all([
      client.$queryRaw<Array<{ id: string }>>`
        SELECT t.id FROM technicians t
        WHERE t.dealership_id = ${dealershipId}::uuid AND t.is_active
          AND EXISTS (SELECT 1 FROM technician_qualifications q
            WHERE q.technician_id = t.id AND q.service_type_id = ${serviceTypeId}::uuid)
          AND NOT EXISTS (SELECT 1 FROM appointments a
            WHERE a.technician_id = t.id AND a.status = 'CONFIRMED'
              AND tstzrange(a.start_at, a.end_at, '[)') && ${requested})`,
      client.$queryRaw<Array<{ id: string }>>`
        SELECT b.id FROM service_bays b
        WHERE b.dealership_id = ${dealershipId}::uuid AND b.is_active
          AND NOT EXISTS (SELECT 1 FROM appointments a
            WHERE a.service_bay_id = b.id AND a.status = 'CONFIRMED'
              AND tstzrange(a.start_at, a.end_at, '[)') && ${requested})`,
    ]);
    return { technicianIds: technicians.map((t) => t.id), serviceBayIds: bays.map((b) => b.id) };
  }
}
