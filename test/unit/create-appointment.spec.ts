import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BookingRequestRepository } from '../../src/appointments/booking-request.repository';
import { BookingClaim } from '../../src/appointments/booking-request.repository';
import { serializeAppointment } from '../../src/appointments/appointment-result';
import { bookingFingerprint, BookingKeyBusy } from '../../src/appointments/booking-idempotency';
import { BookingCapacity } from '../../src/appointments/booking-capacity';
import { validateEnvironment } from '../../src/config/environment';
import { AppointmentRepository } from '../../src/appointments/appointment.repository';
import { BookingConflict, DatabaseUnavailable } from '../../src/appointments/booking.error';
import {
  CreateAppointmentResult,
  CreateAppointmentUseCase,
} from '../../src/appointments/create-appointment.use-case';
import {
  AvailabilityResult,
  CheckAvailabilityUseCase,
} from '../../src/scheduling/check-availability.use-case';
import { SchedulingError } from '../../src/scheduling/scheduling.error';

vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn(() => Promise.resolve()) }));

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
      async (operation: (tx: Prisma.TransactionClient) => Promise<CreateAppointmentResult>) => {
        const tx = {} as Prisma.TransactionClient;
        transactions.push(tx);
        return operation(tx);
      },
    ),
    findCustomer: vi.fn<() => Promise<{ id: string } | null>>(),
    findVehicle: vi.fn<() => Promise<{ id: string; customerId: string } | null>>(),
    create: vi.fn<() => Promise<typeof persisted>>(),
  };
  const key = '12345678-1234-4123-8123-123456789abc';
  const requests = {
    claim: vi.fn<() => Promise<BookingClaim>>(),
    complete: vi.fn<() => Promise<void>>(),
  };
  const availability = { execute: vi.fn<() => Promise<AvailabilityResult>>() };

  beforeEach(async () => {
    transactions.length = 0;
    requests.claim.mockResolvedValue({ claimed: true });
    requests.complete.mockResolvedValue(undefined);
    repository.findCustomer.mockResolvedValue({ id: input.customerId });
    repository.findVehicle.mockResolvedValue({ id: input.vehicleId, customerId: input.customerId });
    repository.create.mockResolvedValue(persisted);
    availability.execute.mockResolvedValue(available);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    module = await Test.createTestingModule({
      providers: [
        CreateAppointmentUseCase,
        BookingCapacity,
        { provide: BookingRequestRepository, useValue: requests },
        { provide: AppointmentRepository, useValue: repository },
        { provide: CheckAvailabilityUseCase, useValue: availability },
        {
          provide: ConfigService,
          useValue: new ConfigService(
            validateEnvironment({ DATABASE_URL: 'postgresql://localhost/unit' }),
          ),
        },
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
    expect(await useCase.execute(input, key)).toEqual({
      appointment: serializeAppointment(persisted),
      replayed: false,
    });
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
      await expect(useCase.execute(input, key)).rejects.toMatchObject({ code });
      expect(repository.create).not.toHaveBeenCalled();
      expect(repository.transaction).toHaveBeenCalledTimes(1);
    },
  );

  it('does not retry invalid times or other scheduling validation failures', async () => {
    availability.execute.mockRejectedValueOnce(
      new SchedulingError('INVALID_BOOKING_TIME', 'Invalid time.'),
    );
    await expect(useCase.execute(input, key)).rejects.toMatchObject({
      code: 'INVALID_BOOKING_TIME',
    });
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
    await expect(useCase.execute(input, key)).rejects.toMatchObject({ code: 'NO_AVAILABILITY' });
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
      await useCase.execute(input, key);
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
    await expect(useCase.execute(input, key)).rejects.toMatchObject({ code: 'BOOKING_CONTENTION' });
    expect(repository.transaction).toHaveBeenCalledTimes(4);
    expect(new Set(transactions).size).toBe(4);
  });

  it('honors a configured limit of one total attempt', async () => {
    module.get(ConfigService).set('BOOKING_MAX_ATTEMPTS', 1);
    repository.create.mockRejectedValue(new BookingConflict('resource'));
    await expect(useCase.execute(input, key)).rejects.toMatchObject({ code: 'BOOKING_CONTENTION' });
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
    await expect(useCase.execute(input, key)).rejects.toMatchObject({ code: 'NO_AVAILABILITY' });
    expect(repository.transaction).toHaveBeenCalledTimes(2);
    expect(repository.create).toHaveBeenCalledTimes(1);
  });

  it('does not retry ambiguous connection failures', async () => {
    const error = new DatabaseUnavailable();
    repository.create.mockRejectedValueOnce(error);
    await expect(useCase.execute(input, key)).rejects.toBe(error);
    expect(repository.transaction).toHaveBeenCalledTimes(1);
  });

  it('propagates unexpected database failures rather than reporting unavailability', async () => {
    const error = new Error('Unexpected database failure');
    repository.create.mockRejectedValueOnce(error);
    await expect(useCase.execute(input, key)).rejects.toBe(error);
    expect(repository.transaction).toHaveBeenCalledTimes(1);
  });

  it('returns success only after transaction completion', async () => {
    repository.transaction.mockImplementationOnce(async (operation) => {
      await operation({} as Prisma.TransactionClient);
      throw new Error('Commit failed');
    });
    await expect(useCase.execute(input, key)).rejects.toThrow('Commit failed');
  });

  it('returns a committed success even when transaction completion arrives after the deadline', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    repository.transaction.mockImplementationOnce(async (operation) => {
      const result = await operation({} as Prisma.TransactionClient);
      // Model successful commit completion after the five-second budget, without sleeping.
      now.mockReturnValue(6001);
      return result;
    });

    await expect(useCase.execute(input, key)).resolves.toEqual({
      appointment: serializeAppointment(persisted),
      replayed: false,
    });
    expect(repository.transaction).toHaveBeenCalledTimes(1);
    expect(repository.create).toHaveBeenCalledTimes(1);
    expect(requests.complete).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
    expect(module.get(BookingCapacity).counts).toEqual({ active: 0, pending: 0 });
  });

  it('backs off only after a failed transaction has finished rollback', async () => {
    let activeTransaction = false;
    repository.transaction.mockImplementationOnce(async (operation) => {
      activeTransaction = true;
      try {
        return await operation({} as Prisma.TransactionClient);
      } finally {
        activeTransaction = false;
      }
    });
    repository.create.mockRejectedValueOnce(new BookingConflict('resource'));
    vi.mocked(delay).mockImplementationOnce(() => {
      expect(activeTransaction).toBe(false);
      return Promise.resolve();
    });
    expect(await useCase.execute(input, key)).toEqual({
      appointment: serializeAppointment(persisted),
      replayed: false,
    });
    expect(delay).toHaveBeenCalledTimes(1);
  });

  it('does not start another transaction after the total deadline expires', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    repository.create.mockImplementationOnce(() => {
      now.mockReturnValue(6001);
      return Promise.reject(new BookingConflict('resource'));
    });
    await expect(useCase.execute(input, key)).rejects.toMatchObject({ code: 'BOOKING_TIMEOUT' });
    expect(repository.transaction).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
    expect(module.get(BookingCapacity).counts.active).toBe(0);
  });

  it('replays before business reads, allocation, or persistence', async () => {
    const appointment = serializeAppointment(persisted);
    requests.claim.mockResolvedValueOnce({
      claimed: false,
      fingerprint: bookingFingerprint(input),
      appointment,
    });
    expect(await useCase.execute(input, key)).toEqual({ appointment, replayed: true });
    expect(repository.findCustomer).not.toHaveBeenCalled();
    expect(availability.execute).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
    expect(requests.complete).not.toHaveBeenCalled();
  });

  it('rejects a different fingerprint without allocating', async () => {
    requests.claim.mockResolvedValueOnce({
      claimed: false,
      fingerprint: 'different',
      appointment: serializeAppointment(persisted),
    });
    await expect(useCase.execute(input, key)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
    expect(availability.execute).not.toHaveBeenCalled();
    expect(requests.complete).not.toHaveBeenCalled();
  });

  it('waits for key ownership in fresh transactions without consuming allocation attempts', async () => {
    module.get(ConfigService).set('BOOKING_MAX_ATTEMPTS', 1);
    requests.claim
      .mockRejectedValueOnce(new BookingKeyBusy())
      .mockRejectedValueOnce(new BookingKeyBusy());
    const result = await useCase.execute(input, key);
    expect(result.replayed).toBe(false);
    expect(new Set(transactions).size).toBe(3);
    expect(repository.create).toHaveBeenCalledTimes(1);
    expect(requests.complete).toHaveBeenCalledWith(key, result.appointment, transactions[2]);
    expect(delay).toHaveBeenCalledTimes(2);
  });

  it('bounds key waiting by the shared deadline and releases admission', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    requests.claim.mockImplementationOnce(() => {
      now.mockReturnValue(6001);
      return Promise.reject(new BookingKeyBusy());
    });
    await expect(useCase.execute(input, key)).rejects.toMatchObject({ code: 'BOOKING_TIMEOUT' });
    expect(repository.create).not.toHaveBeenCalled();
    expect(module.get(BookingCapacity).counts.active).toBe(0);
  });

  it('fails the whole transaction when saving the response fails', async () => {
    requests.complete.mockRejectedValueOnce(new Error('Snapshot write failed'));
    await expect(useCase.execute(input, key)).rejects.toThrow('Snapshot write failed');
    expect(repository.transaction).toHaveBeenCalledTimes(1);
  });
});
