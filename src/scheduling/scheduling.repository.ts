import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { TimeInterval } from './interval';
import { EligibleResources } from './resource-allocation.service';

@Injectable()
export class SchedulingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async dealershipExists(dealershipId: string): Promise<boolean> {
    const dealership = await this.prisma.dealership.findUnique({
      where: { id: dealershipId },
      select: { id: true },
    });
    return dealership !== null;
  }

  findServiceType(serviceTypeId: string) {
    return this.prisma.serviceType.findUnique({
      where: { id: serviceTypeId },
      select: { id: true, isActive: true, durationMinutes: true },
    });
  }

  async findEligibleResources(
    dealershipId: string,
    serviceTypeId: string,
    interval: TimeInterval,
  ): Promise<EligibleResources> {
    const blockingOverlap: Prisma.AppointmentWhereInput = {
      status: 'CONFIRMED',
      startAt: { lt: interval.endAt },
      endAt: { gt: interval.startAt },
    };
    // Two set-based reads regardless of resource count; no queries per candidate.
    const [technicians, bays] = await Promise.all([
      this.prisma.technician.findMany({
        where: {
          dealershipId,
          isActive: true,
          qualifications: { some: { serviceTypeId } },
          appointments: { none: blockingOverlap },
        },
        select: { id: true },
      }),
      this.prisma.serviceBay.findMany({
        where: {
          dealershipId,
          isActive: true,
          appointments: { none: blockingOverlap },
        },
        select: { id: true },
      }),
    ]);
    return { technicianIds: technicians.map((t) => t.id), serviceBayIds: bays.map((b) => b.id) };
  }
}
