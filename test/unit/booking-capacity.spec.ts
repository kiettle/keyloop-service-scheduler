import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { performance } from 'node:perf_hooks';
import { BookingCapacity } from '../../src/appointments/booking-capacity';
import { remainingBookingTime } from '../../src/appointments/booking-deadline';
import { validateEnvironment } from '../../src/config/environment';

function capacity(pending = 2) {
  return new BookingCapacity(
    new ConfigService(
      validateEnvironment({
        DATABASE_URL: 'postgresql://localhost/unit',
        BOOKING_MAX_CONCURRENT: 1,
        BOOKING_MAX_PENDING: pending,
      }),
    ),
  );
}
const deadline = () => performance.now() + 5000;
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('bounded booking admission', () => {
  it('transfers a released slot in FIFO order without exceeding capacity', async () => {
    const gate = capacity();
    const release = await gate.acquire(deadline());
    const second = gate.acquire(deadline());
    const third = gate.acquire(deadline());
    expect(gate.counts).toEqual({ active: 1, pending: 2 });
    await expect(gate.acquire(deadline())).rejects.toMatchObject({ code: 'BOOKING_BUSY' });
    release();
    const releaseSecond = await second;
    expect(gate.counts).toEqual({ active: 1, pending: 1 });
    releaseSecond();
    (await third)();
    release(); // Repeated cleanup must not create another slot.
    expect(gate.counts).toEqual({ active: 0, pending: 0 });
  });

  it('supports immediate rejection instead of queuing', async () => {
    const gate = capacity(0);
    const release = await gate.acquire(deadline());
    await expect(gate.acquire(deadline())).rejects.toMatchObject({ code: 'BOOKING_BUSY' });
    release();
  });

  it('removes disconnected waiters and admits the next request', async () => {
    const gate = capacity();
    const release = await gate.acquire(deadline());
    const controller = new AbortController();
    const cancelled = gate.acquire(deadline(), controller.signal);
    const rejection = expect(cancelled).rejects.toMatchObject({ code: 'BOOKING_BUSY' });
    const next = gate.acquire(deadline());
    controller.abort();
    await rejection;
    expect(gate.counts.pending).toBe(1);
    release();
    (await next)();
    expect(gate.counts).toEqual({ active: 0, pending: 0 });
  });

  it('does not admit an already cancelled request', async () => {
    const gate = capacity();
    const controller = new AbortController();
    controller.abort();
    await expect(gate.acquire(deadline(), controller.signal)).rejects.toMatchObject({
      code: 'BOOKING_BUSY',
    });
    expect(gate.counts.active).toBe(0);
  });

  it('expires queued work without holding a connection or leaving an entry', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const gate = capacity();
    const release = await gate.acquire(deadline());
    const waiting = gate.acquire(performance.now() + 100);
    const rejection = expect(waiting).rejects.toMatchObject({ code: 'BOOKING_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(101);
    await rejection;
    expect(gate.counts).toEqual({ active: 1, pending: 0 });
    release();
  });

  it('rejects queued work on shutdown and refuses new admissions', async () => {
    const gate = capacity();
    const release = await gate.acquire(deadline());
    const waiting = gate.acquire(deadline());
    const rejection = expect(waiting).rejects.toMatchObject({ code: 'BOOKING_BUSY' });
    gate.onModuleDestroy();
    await rejection;
    await expect(gate.acquire(deadline())).rejects.toMatchObject({ code: 'BOOKING_BUSY' });
    release();
    expect(gate.counts).toEqual({ active: 0, pending: 0 });
  });

  it('skips an expired waiter when a slot is released before its timer runs', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const gate = capacity();
    const release = await gate.acquire(6000);
    const expired = gate.acquire(1100);
    const rejection = expect(expired).rejects.toMatchObject({ code: 'BOOKING_TIMEOUT' });
    const next = gate.acquire(6000);

    now.mockReturnValue(1200);
    release();
    await rejection;
    const releaseNext = await next;
    expect(gate.counts).toEqual({ active: 1, pending: 0 });
    expect(vi.getTimerCount()).toBe(0);
    releaseNext();
    expect(gate.counts).toEqual({ active: 0, pending: 0 });
  });

  it('rejects an expired overall deadline', () => {
    expect(() => remainingBookingTime(performance.now() - 1)).toThrow(
      'Booking time budget expired',
    );
  });
});
