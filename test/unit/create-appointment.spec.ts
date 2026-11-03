import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppointmentRepository } from '../../src/appointments/appointment.repository';
import { BookingConflict, DatabaseUnavailable } from '../../src/appointments/booking.error';
import { CreateAppointmentUseCase } from '../../src/appointments/create-appointment.use-case';
import {
  AvailabilityResult,
  CheckAvailabilityUseCase,
} from '../../src/scheduling/check-availability.use-case';
import { SchedulingError } from '../../src/scheduling/scheduling.error';

const input = {
  customerId: 'customer',
  vehicleId: 'vehicle',
  dealershipId: 'dealer',
  serviceTypeId: 'service',
  startAt: new Date('2035-01-15T10:00:00Z'),
};
const available: AvailabilityResult = {
  ...input,
  available: true,
  technicianId: 't1',
  serviceBayId: 'b1',
  endAt: new Date('2035-01-15T10:30:00Z'),
  availableTechnicianCount: 1,
  availableServiceBayCount: 1,
};

describe('booking orchestration', () => {
  let module: TestingModule;
  let useCase: CreateAppointmentUseCase;
  const transactions: Prisma.TransactionClient[] = [];
  const persisted = {
    id: 'appointment',
    ...input,
    technicianId: 't1',
    serviceBayId: 'b1',
    endAt: available.endAt,
    status: 'CONFIRMED' as const,
    createdAt: input.startAt,
  };
  const repository = {
    transaction: vi.fn(
      async (operation: (tx: Prisma.TransactionClient) => Promise<typeof persisted>) => {
        const tx = {} as Prisma.TransactionClient;
        transactions.push(tx);
        return operation(tx);
      },
    ),
    findCustomer: vi.fn<() => Promise<{ id: string } | null>>(),
    findVehicle: vi.fn<() => Promise<{ id: string; customerId: string } | null>>(),
    create: vi.fn<() => Promise<typeof persisted>>(),
  };
  const availability = { execute: vi.fn<() => Promise<AvailabilityResult>>() };

  beforeEach(async () => {
    transactions.length = 0;
    repository.findCustomer.mockResolvedValue({ id: input.customerId });
    repository.findVehicle.mockResolvedValue({ id: input.vehicleId, customerId: input.customerId });
    repository.create.mockResolvedValue(persisted);
    availability.execute.mockResolvedValue(available);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    module = await Test.createTestingModule({
      providers: [
        CreateAppointmentUseCase,
        { provide: AppointmentRepository, useValue: repository },
        { provide: CheckAvailabilityUseCase, useValue: availability },
        { provide: ConfigService, useValue: new ConfigService({ BOOKING_MAX_ATTEMPTS: 4 }) },
      ],
    }).compile();
    useCase = module.get(CreateAppointmentUseCase);
  });
  afterEach(async () => {
    await module.close();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('persists only the catalog-derived interval and selected pair in the same transaction', async () => {
    expect(await useCase.execute(input)).toEqual(persisted);
    expect(repository.transaction).toHaveBeenCalledTimes(1);
    expect(availability.execute).toHaveBeenCalledWith(input, transactions[0]);
    expect(repository.create).toHaveBeenCalledWith(
      {
        ...input,
        technicianId: 't1',
        serviceBayId: 'b1',
        endAt: available.endAt,
        status: 'CONFIRMED',
      },
      transactions[0],
    );
  });

  it.each(['CUSTOMER_NOT_FOUND', 'VEHICLE_NOT_FOUND', 'BUSINESS_RULE_VIOLATION'])(
    'rejects %s without persistence or retries',
    async (code) => {
      if (code === 'CUSTOMER_NOT_FOUND') repository.findCustomer.mockResolvedValue(null);
      if (code === 'VEHICLE_NOT_FOUND') repository.findVehicle.mockResolvedValue(null);
      if (code === 'BUSINESS_RULE_VIOLATION')
        repository.findVehicle.mockResolvedValue({ id: 'vehicle', customerId: 'other' });
      await expect(useCase.execute(input)).rejects.toMatchObject({ code });
      expect(repository.create).not.toHaveBeenCalled();
      expect(repository.transaction).toHaveBeenCalledTimes(1);
    },
  );

  it('does not retry invalid times or other scheduling validation failures', async () => {
    availability.execute.mockRejectedValueOnce(
      new SchedulingError('INVALID_BOOKING_TIME', 'Invalid time.'),
    );
    await expect(useCase.execute(input)).rejects.toMatchObject({ code: 'INVALID_BOOKING_TIME' });
    expect(repository.transaction).toHaveBeenCalledTimes(1);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it.each([
    { availableTechnicianCount: 0, availableServiceBayCount: 1 },
    { availableTechnicianCount: 1, availableServiceBayCount: 0 },
  ])('reports exhaustion without persistence for %j', async (counts) => {
    availability.execute.mockResolvedValueOnce({
      ...available,
      ...counts,
      available: false,
      technicianId: null,
      serviceBayId: null,
    });
    await expect(useCase.execute(input)).rejects.toMatchObject({ code: 'NO_AVAILABILITY' });
    expect(repository.transaction).toHaveBeenCalledTimes(1);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it.each(['resource', 'transaction'] as const)(
    'retries a %s conflict in a fresh transaction with fresh allocation',
    async (kind) => {
      repository.create.mockRejectedValueOnce(new BookingConflict(kind));
      availability.execute
        .mockResolvedValueOnce(available)
        .mockResolvedValueOnce({ ...available, technicianId: 't2', serviceBayId: 'b2' });
      await useCase.execute(input);
      expect(transactions).toHaveLength(2);
      expect(transactions[0]).not.toBe(transactions[1]);
      expect(availability.execute).toHaveBeenNthCalledWith(2, input, transactions[1]);
      expect(repository.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          technicianId: 't2',
          serviceBayId: 'b2',
        }),
        transactions[1],
      );
    },
  );

  it('stops after four total attempts and reports retryable contention', async () => {
    repository.create.mockRejectedValue(new BookingConflict('resource'));
    await expect(useCase.execute(input)).rejects.toMatchObject({ code: 'BOOKING_CONTENTION' });
    expect(repository.transaction).toHaveBeenCalledTimes(4);
    expect(new Set(transactions).size).toBe(4);
  });

  it('honors a configured limit of one total attempt', async () => {
    module.get(ConfigService).set('BOOKING_MAX_ATTEMPTS', 1);
    repository.create.mockRejectedValue(new BookingConflict('resource'));
    await expect(useCase.execute(input)).rejects.toMatchObject({ code: 'BOOKING_CONTENTION' });
    expect(repository.transaction).toHaveBeenCalledTimes(1);
  });

  it('reports actual exhaustion after a lost race without consuming remaining attempts', async () => {
    repository.create.mockRejectedValueOnce(new BookingConflict('resource'));
    availability.execute.mockResolvedValueOnce(available).mockResolvedValueOnce({
      ...available,
      available: false,
      technicianId: null,
      serviceBayId: null,
      availableTechnicianCount: 0,
      availableServiceBayCount: 0,
    });
    await expect(useCase.execute(input)).rejects.toMatchObject({ code: 'NO_AVAILABILITY' });
    expect(repository.transaction).toHaveBeenCalledTimes(2);
    expect(repository.create).toHaveBeenCalledTimes(1);
  });

  it('does not retry ambiguous connection failures', async () => {
    const error = new DatabaseUnavailable();
    repository.create.mockRejectedValueOnce(error);
    await expect(useCase.execute(input)).rejects.toBe(error);
    expect(repository.transaction).toHaveBeenCalledTimes(1);
  });

  it('propagates unexpected database failures rather than reporting unavailability', async () => {
    const error = new Error('Unexpected database failure');
    repository.create.mockRejectedValueOnce(error);
    await expect(useCase.execute(input)).rejects.toBe(error);
    expect(repository.transaction).toHaveBeenCalledTimes(1);
  });

  it('returns success only after transaction completion', async () => {
    repository.transaction.mockImplementationOnce(async (operation) => {
      await operation({} as Prisma.TransactionClient);
      throw new Error('Commit failed');
    });
    await expect(useCase.execute(input)).rejects.toThrow('Commit failed');
  });
});
