import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { Clock } from '../../src/common/time/clock';
import { CheckAvailabilityUseCase } from '../../src/scheduling/check-availability.use-case';
import {
  EligibleResources,
  ResourceAllocationService,
} from '../../src/scheduling/resource-allocation.service';
import { SchedulingRepository } from '../../src/scheduling/scheduling.repository';

const now = new Date('2035-01-15T00:00:00Z');
const input = {
  dealershipId: 'dealer',
  serviceTypeId: 'service',
  startAt: new Date('2035-01-15T10:00:00Z'),
};
type ServiceType = Awaited<ReturnType<SchedulingRepository['findServiceType']>>;

describe('availability orchestration', () => {
  let module: TestingModule;
  let useCase: CheckAvailabilityUseCase;
  const repository = {
    dealershipExists: vi.fn<() => Promise<boolean>>(),
    findServiceType: vi.fn<() => Promise<ServiceType>>(),
    findEligibleResources: vi.fn<() => Promise<EligibleResources>>(),
  };

  beforeEach(async () => {
    repository.dealershipExists.mockResolvedValue(true);
    repository.findServiceType.mockResolvedValue({
      id: 'service',
      isActive: true,
      durationMinutes: 30,
    });
    repository.findEligibleResources.mockResolvedValue({
      technicianIds: ['t1'],
      serviceBayIds: ['b1'],
    });
    module = await Test.createTestingModule({
      providers: [
        CheckAvailabilityUseCase,
        ResourceAllocationService,
        { provide: SchedulingRepository, useValue: repository },
        { provide: Clock, useValue: { now: () => now } },
      ],
    }).compile();
    useCase = module.get(CheckAvailabilityUseCase);
  });
  afterEach(async () => {
    await module.close();
    vi.clearAllMocks();
  });

  it('returns the calculated interval, counts, and selected pair', async () => {
    expect(await useCase.execute(input)).toEqual({
      ...input,
      endAt: new Date('2035-01-15T10:30:00Z'),
      available: true,
      technicianId: 't1',
      serviceBayId: 'b1',
      availableTechnicianCount: 1,
      availableServiceBayCount: 1,
    });
  });

  it('accepts a start one millisecond in the future without rounding', async () => {
    const startAt = new Date(now.getTime() + 1);

    expect(await useCase.execute({ ...input, startAt })).toMatchObject({
      available: true,
      startAt,
      endAt: new Date('2035-01-15T00:30:00.001Z'),
    });
  });

  it('reports missing resources without a partial pair', async () => {
    repository.findEligibleResources.mockResolvedValue({
      technicianIds: ['t1'],
      serviceBayIds: [],
    });
    expect(await useCase.execute(input)).toMatchObject({
      available: false,
      technicianId: null,
      serviceBayId: null,
      availableTechnicianCount: 1,
      availableServiceBayCount: 0,
    });
  });

  it('distinguishes a missing dealership from unavailability', async () => {
    repository.dealershipExists.mockResolvedValue(false);
    await expect(useCase.execute(input)).rejects.toMatchObject({
      code: 'DEALERSHIP_NOT_FOUND',
    });
  });

  it('distinguishes a missing service type from unavailability', async () => {
    repository.findServiceType.mockResolvedValue(null);
    await expect(useCase.execute(input)).rejects.toMatchObject({
      code: 'SERVICE_TYPE_NOT_FOUND',
    });
  });

  it('rejects an inactive service type', async () => {
    repository.findServiceType.mockResolvedValue({
      id: 'service',
      isActive: false,
      durationMinutes: 30,
    });
    await expect(useCase.execute(input)).rejects.toMatchObject({
      code: 'SERVICE_TYPE_INACTIVE',
    });
  });

  it.each([new Date(NaN), now, new Date('2035-01-14T23:59:59Z')])(
    'rejects invalid/nonfuture time %s',
    async (startAt) => {
      await expect(useCase.execute({ ...input, startAt })).rejects.toMatchObject({
        code: 'INVALID_BOOKING_TIME',
      });
    },
  );

  it('propagates unexpected infrastructure errors instead of reporting unavailable', async () => {
    const failure = new Error('Database failure');
    repository.findEligibleResources.mockRejectedValueOnce(failure);
    await expect(useCase.execute(input)).rejects.toBe(failure);
  });
});
