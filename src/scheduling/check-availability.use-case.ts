import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Clock } from '../common/time/clock';
import { calculateServiceInterval } from './interval';
import { ResourceAllocation, ResourceAllocationService } from './resource-allocation.service';
import { SchedulingError } from './scheduling.error';
import { SchedulingRepository } from './scheduling.repository';

export interface CheckAvailabilityInput {
  dealershipId: string;
  serviceTypeId: string;
  startAt: Date;
}

export type AvailabilityResult = ResourceAllocation & {
  dealershipId: string;
  serviceTypeId: string;
  startAt: Date;
  endAt: Date;
  availableTechnicianCount: number;
  availableServiceBayCount: number;
};

@Injectable()
export class CheckAvailabilityUseCase {
  constructor(
    private readonly repository: SchedulingRepository,
    private readonly allocation: ResourceAllocationService,
    private readonly clock: Clock,
  ) {}

  async execute(
    input: CheckAvailabilityInput,
    transactionClient?: Prisma.TransactionClient,
  ): Promise<AvailabilityResult> {
    const { startAt } = input;

    if (!(startAt instanceof Date) || !Number.isFinite(startAt.getTime())) {
      throw new SchedulingError('INVALID_BOOKING_TIME', 'Start time must be a valid date.');
    }

    if (startAt.getTime() <= this.clock.now().getTime()) {
      throw new SchedulingError('INVALID_BOOKING_TIME', 'Start time must be in the future.');
    }
    const [dealershipExists, serviceType] = await Promise.all([
      this.repository.dealershipExists(input.dealershipId, transactionClient),
      this.repository.findServiceType(input.serviceTypeId, transactionClient),
    ]);
    if (!dealershipExists) {
      throw new SchedulingError('DEALERSHIP_NOT_FOUND', 'Dealership not found.');
    }
    if (!serviceType) {
      throw new SchedulingError('SERVICE_TYPE_NOT_FOUND', 'Service type not found.');
    }
    if (!serviceType.isActive) {
      throw new SchedulingError('SERVICE_TYPE_INACTIVE', 'Service type is inactive.');
    }
    const interval = calculateServiceInterval(startAt, serviceType.durationMinutes);
    const resources = await this.repository.findEligibleResources(
      input.dealershipId,
      input.serviceTypeId,
      interval,
      transactionClient,
    );
    return {
      dealershipId: input.dealershipId,
      serviceTypeId: input.serviceTypeId,
      ...interval,
      ...this.allocation.select(resources),
      availableTechnicianCount: resources.technicianIds.length,
      availableServiceBayCount: resources.serviceBayIds.length,
    };
  }
}
