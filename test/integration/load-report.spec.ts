import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase } from '../helpers/test-database';
import { writeLoadReport } from '../load/write-load-report';

describe('load report retention', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let directory: string;
  const measurements = {
    exitCode: 0,
    summary: { metrics: { bookings_confirmed: { values: { count: 2 } } } },
    samples: [{ activeBookings: 1, pendingBookings: 0 }],
    workerSamples: [[{ cpuPercent: 40, rssMiB: 100 }]],
  };

  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => database?.close());
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'load-report-'));
  });
  afterEach(async () => rm(directory, { recursive: true, force: true }));

  it('saves measurements before a real PostgreSQL timeout and retains an unsuccessful report', async () => {
    const destination = join(directory, 'reports', 'load.json');
    const report = await writeLoadReport(destination, measurements, async () => {
      const checkpoint: unknown = JSON.parse(await readFile(destination, 'utf8'));
      expect(checkpoint).toMatchObject({
        ...measurements,
        passed: false,
        verification: { status: 'incomplete' },
        invariants: null,
      });
      // The fixture's real two-second statement limit must cancel this verification query.
      await database.prisma.$queryRaw`SELECT pg_sleep(3)`;
      return { passed: true, invariants: {}, queryPlans: {} };
    });

    expect(report).toMatchObject({
      ...measurements,
      passed: false,
      verification: { status: 'failed', error: { sqlstate: '57014' } },
      invariants: null,
    });
    expect(JSON.parse(await readFile(destination, 'utf8'))).toEqual(report);
    expect(await database.prisma.appointment.count()).toBe(0);
  });

  it.each([true, false])(
    'keeps the completed verification result when passed=%s',
    async (passed) => {
      const destination = join(directory, 'load.json');
      const result = {
        passed,
        invariants: { successRowsMatch: passed },
        queryPlans: { technician: ['fixture plan'] },
      };
      const report = await writeLoadReport(destination, measurements, () =>
        Promise.resolve(result),
      );

      expect(report).toEqual({
        ...measurements,
        ...result,
        verification: { status: 'complete' },
      });
      expect(JSON.parse(await readFile(destination, 'utf8'))).toEqual(report);
    },
  );
});
