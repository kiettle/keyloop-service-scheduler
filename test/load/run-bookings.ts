import { fork, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir, cpus, totalmem, platform, arch } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Prisma } from '@prisma/client';
import { createTestDatabase } from '../helpers/test-database';
import { seedIndependentCustomers } from '../helpers/booking-app';
import { validateEnvironment } from '../../src/config/environment';
import { DATABASE_POOL_MAX } from '../../src/database/prisma.service';
import type { LoadMessage, LoadSample } from './server';
import { writeLoadReport } from './write-load-report';

interface K6Summary {
  metrics: Record<
    string,
    { values: Record<string, number>; thresholds?: Record<string, { ok: boolean }> }
  >;
}
function positive(value: string, name: string, max: number): number {
  const number = Number(value);
  if (!/^\d+$/.test(value) || number < 1 || number > max)
    throw new Error(`Invalid ${name}; expected 1–${max}.`);
  return number;
}
async function startApp(databaseUrl: string, sampleIntervalMs: number) {
  const child = fork('test/load/server.ts', [], {
    execArgv: [
      ...(process.env.LOAD_CPU_PROFILE === '1' ? ['--cpu-prof', '--cpu-prof-dir=artifacts'] : []),
      '--require',
      'ts-node/register',
    ],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DATABASE_URL: databaseUrl,
      LOAD_DATABASE_URL: databaseUrl,
      LOAD_SAMPLE_INTERVAL_MS: String(sampleIntervalMs),
    },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  const state = {
    url: '',
    sample: {
      activeBookings: 0,
      pendingBookings: 0,
      cpuPercent: 0,
      eventLoopDelayMs: 0,
      rssMiB: 0,
    },
    samples: [] as LoadSample[],
    close: () =>
      new Promise<void>((done) => {
        if (child.exitCode !== null || child.signalCode !== null) return done();
        const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
        child.once('exit', () => {
          clearTimeout(timer);
          done();
        });
        if (child.connected) child.send('stop');
        else child.kill('SIGTERM');
      }),
  };
  try {
    await new Promise<void>((ready, reject) => {
      const timer = setTimeout(() => reject(new Error('Load worker startup timed out.')), 20000);
      child.once('error', reject);
      child.once('exit', (code) => {
        clearTimeout(timer);
        if (!state.url) reject(new Error(`Load worker exited during startup: ${code}`));
      });
      child.on('message', (message: unknown) => {
        const event = message as LoadMessage;
        if (event.type === 'ready') {
          state.url = event.url;
          clearTimeout(timer);
          ready();
        }
        if (event.type === 'sample') {
          state.sample = event.sample;
          state.samples.push(event.sample);
        }
      });
    });
    return state;
  } catch (error) {
    await state.close();
    throw error;
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      mode: { type: 'string', default: 'burst' },
      workload: { type: 'string', default: 'spread' },
      count: { type: 'string', default: '100' },
      rate: { type: 'string', default: '1000' },
      vus: { type: 'string', default: '1000' },
      duration: { type: 'string', default: '60' },
      instances: { type: 'string', default: '2' },
      report: { type: 'string', default: 'artifacts/booking-load.json' },
    },
  });
  const { mode, workload } = values;
  if (mode !== 'burst' && mode !== 'rate') throw new Error('mode must be burst or rate.');
  if (!['spread', 'same-resource', 'hotspot', 'holiday'].includes(workload))
    throw new Error('Invalid workload.');
  const count = positive(values.count, 'count', 1000),
    rate = positive(values.rate, 'rate', 10000);
  const duration = positive(values.duration, 'duration', 300),
    instances = positive(values.instances, 'instances', 4);
  const vus = positive(values.vus, 'vus', 10000);
  const sampleIntervalMs = mode === 'burst' ? 100 : 1000;
  // Synthetic appointment-day capacity, not opening-hours rules or measured traffic demand.
  const holidayDay = {
    startAt: new Date('2035-01-15T08:00:00.000Z'),
    endAt: new Date('2035-01-15T16:00:00.000Z'),
    slots: 16,
    dealerships: 20,
    pairsPerDealership: 2,
    capacity: 640,
  };
  if (workload === 'holiday' && (mode !== 'burst' || count > holidayDay.capacity)) {
    throw new Error('Holiday profile requires burst mode and at most 640 requests.');
  }
  const database = await createTestDatabase();
  const apps: Awaited<ReturnType<typeof startApp>>[] = [];
  let scratch: string | undefined;
  const samples: Array<{
    activeTransactions: number;
    waitingLocks: number;
    activeBookings: number;
    pendingBookings: number;
  }> = [];
  let sampling = false;
  let samplingFailed = false;
  let samplePromise = Promise.resolve();
  let monitor: ReturnType<typeof setInterval> | undefined;
  try {
    const settings = validateEnvironment({ ...process.env, DATABASE_URL: database.url });
    scratch = await mkdtemp(join(tmpdir(), 'keyloop-load-'));
    const summaryPath = join(scratch, 'summary.json');
    await seedIndependentCustomers(database.prisma, 1000);
    const dealers: string[] = [];
    const technicians: string[] = [];
    const bays: string[] = [];
    const dealershipCount =
      workload === 'holiday' ? holidayDay.dealerships : workload === 'spread' ? 20 : 1;
    for (let i = 0; i < dealershipCount; i++) {
      const dealer = await database.prisma.dealership.create({
        data: { name: `Load dealership ${i}`, timeZone: 'UTC' },
      });
      dealers.push(dealer.id);
      const pairs = workload === 'holiday' ? holidayDay.pairsPerDealership : 1;
      for (let pair = 0; pair < pairs; pair++) {
        const technician = await database.prisma.technician.create({
          data: {
            dealershipId: dealer.id,
            name: 'Load technician',
            qualifications: { create: { serviceTypeId: '40000000-0000-4000-8000-000000000001' } },
          },
        });
        const bay = await database.prisma.serviceBay.create({
          data: { dealershipId: dealer.id, name: 'Load bay' },
        });
        technicians.push(technician.id);
        bays.push(bay.id);
      }
    }
    const urls: string[] = [];
    for (let i = 0; i < instances; i++) {
      const app = await startApp(database.url, sampleIntervalMs);
      apps.push(app);
      urls.push(app.url);
    }
    monitor = setInterval(() => {
      if (sampling) return;
      sampling = true;
      samplePromise = (async () => {
        const [databaseSample] = await database.prisma.$queryRaw<
          Array<{ activeTransactions: number; waitingLocks: number }>
        >`
          SELECT count(*) FILTER (WHERE state = 'active')::int AS "activeTransactions",
            count(*) FILTER (WHERE wait_event_type = 'Lock')::int AS "waitingLocks"
          FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()`;
        const counts = apps.map((a) => a.sample);
        samples.push({
          ...databaseSample,
          activeBookings: counts.reduce((n, c) => n + c.activeBookings, 0),
          pendingBookings: counts.reduce((n, c) => n + c.pendingBookings, 0),
        });
      })()
        .catch(() => {
          samplingFailed = true;
        })
        .finally(() => {
          sampling = false;
        });
      // Keep a failed sampling query visible without an unhandled rejection.
      void samplePromise.catch(() => undefined);
    }, sampleIntervalMs);
    const exitCode = await new Promise<number>((done, reject) => {
      const child = spawn(
        'k6',
        ['run', '--quiet', '--no-usage-report', 'test/load/bookings.k6.js'],
        {
          stdio: 'inherit',
          env: {
            ...process.env,
            LOAD_MODE: mode,
            LOAD_WORKLOAD: workload,
            LOAD_COUNT: String(count),
            LOAD_RATE: String(rate),
            LOAD_VUS: String(vus),
            LOAD_DURATION: String(duration),
            LOAD_URLS: JSON.stringify(urls),
            LOAD_DEALERS: JSON.stringify(dealers),
            LOAD_DAY_START: holidayDay.startAt.toISOString(),
            LOAD_DAY_SLOTS: String(holidayDay.slots),
            LOAD_SUMMARY: summaryPath,
          },
        },
      );
      const interrupt = () => child.kill('SIGINT');
      process.once('SIGINT', interrupt);
      child.once('error', reject);
      child.once('exit', (code) => {
        process.off('SIGINT', interrupt);
        done(code ?? 1);
      });
    });
    clearInterval(monitor);
    await samplePromise;
    const summary = JSON.parse(await readFile(summaryPath, 'utf8')) as K6Summary;
    const measurementSeconds = duration - 10;
    const rateMeasurement =
      mode === 'rate' && workload !== 'hotspot' && measurementSeconds > 0
        ? {
            startOffsetSeconds: 5,
            endOffsetSeconds: duration - 5,
            seconds: measurementSeconds,
            started: summary.metrics.booking_requests_started_in_window.values.count,
            confirmed: summary.metrics.bookings_confirmed_in_window.values.count,
          }
        : undefined;
    const rateWindowPassed =
      !rateMeasurement ||
      (rateMeasurement.confirmed >= rate * rateMeasurement.seconds &&
        rateMeasurement.confirmed >= rateMeasurement.started);
    const destination = resolve(values.report);
    const report = await writeLoadReport(
      destination,
      {
        exitCode,
        mode,
        workload,
        count,
        rate,
        duration,
        rateMeasurement,
        rateWindowPassed,
        instances,
        generatorMaxVUs: mode === 'rate' ? vus : count,
        generatorPreallocatedVUs: mode === 'rate' ? vus : count,
        poolPerInstance: DATABASE_POOL_MAX,
        processPerInstance: true,
        runtimeEnvironment: 'production',
        sampleIntervalMs,
        holidayDay: workload === 'holiday' ? holidayDay : undefined,
        applicationLogging:
          'JSON logging enabled; stdout discarded by the harness, no collector benchmarked',
        workerSamples: apps.map((a) => a.samples),
        samplingFailed,
        maxActiveBookingsPerInstance: settings.BOOKING_MAX_CONCURRENT,
        maxPendingBookingsPerInstance: settings.BOOKING_MAX_PENDING,
        httpConnections:
          mode === 'burst' ? 'warm, barrier' : 'cold at start, persistent thereafter',
        host: {
          platform: platform(),
          arch: arch(),
          cpu: cpus()[0].model,
          logicalCPUs: cpus().length,
          memoryGiB: totalmem() / 1024 ** 3,
          node: process.version,
        },
        samples,
        summary,
      },
      async () => {
        const queryPlans: Record<string, unknown> = {};
        const [overlaps] = await database.prisma.$queryRaw<
          Array<{ technician: boolean; bay: boolean }>
        >`
      SELECT EXISTS(SELECT 1 FROM appointments a JOIN appointments b ON a.id < b.id AND a.technician_id = b.technician_id
        WHERE a.status = 'CONFIRMED' AND b.status = 'CONFIRMED' AND tstzrange(a.start_at,a.end_at,'[)') && tstzrange(b.start_at,b.end_at,'[)')) AS technician,
      EXISTS(SELECT 1 FROM appointments a JOIN appointments b ON a.id < b.id AND a.service_bay_id = b.service_bay_id
        WHERE a.status = 'CONFIRMED' AND b.status = 'CONFIRMED' AND tstzrange(a.start_at,a.end_at,'[)') && tstzrange(b.start_at,b.end_at,'[)')) AS bay`;
        const [invalid] = await database.prisma.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM appointments a JOIN vehicles v ON v.id=a.vehicle_id
      JOIN technicians t ON t.id=a.technician_id JOIN service_bays b ON b.id=a.service_bay_id JOIN service_types s ON s.id=a.service_type_id
      WHERE a.status <> 'CONFIRMED' OR v.customer_id <> a.customer_id OR t.dealership_id <> a.dealership_id OR b.dealership_id <> a.dealership_id
        OR NOT t.is_active OR NOT b.is_active OR a.end_at <> a.start_at + s.duration_minutes * INTERVAL '1 minute'
        OR NOT EXISTS(SELECT 1 FROM technician_qualifications q WHERE q.technician_id=t.id AND q.service_type_id=s.id)`;
        queryPlans.technician = await database.prisma
          .$queryRaw`EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM appointments
      WHERE technician_id = ${technicians[0]}::uuid AND status = 'CONFIRMED'
        AND tstzrange(start_at,end_at,'[)') && tstzrange('2040-01-01'::timestamptz,'2040-01-02'::timestamptz,'[)')`;
        queryPlans.bay = await database.prisma
          .$queryRaw`EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM appointments
      WHERE service_bay_id = ${bays[0]}::uuid AND status = 'CONFIRMED'
        AND tstzrange(start_at,end_at,'[)') && tstzrange('2040-01-01'::timestamptz,'2040-01-02'::timestamptz,'[)')`;
        const persisted = await database.prisma.appointment.count();
        const bookingRequests = await database.prisma.appointmentBookingRequest.count();
        const incompleteBookingRequests = await database.prisma.appointmentBookingRequest.count({
          where: { OR: [{ appointmentId: null }, { responseBody: { equals: Prisma.DbNull } }] },
        });
        const confirmed = summary.metrics.bookings_confirmed.values.count;
        const outsideHolidayDay =
          workload === 'holiday'
            ? await database.prisma.appointment.count({
                where: {
                  OR: [
                    { startAt: { lt: holidayDay.startAt } },
                    { endAt: { gt: holidayDay.endAt } },
                  ],
                },
              })
            : 0;
        const invariants = {
          ...overlaps,
          invalidAssociations: invalid.count,
          persisted,
          confirmed,
          successRowsMatch: persisted === confirmed,
          bookingRequests,
          incompleteBookingRequests,
          bookingRequestRowsMatch: bookingRequests === persisted && incompleteBookingRequests === 0,
          outsideHolidayDay,
        };
        const passed =
          exitCode === 0 &&
          rateWindowPassed &&
          !samplingFailed &&
          !overlaps.technician &&
          !overlaps.bay &&
          invalid.count === 0 &&
          outsideHolidayDay === 0 &&
          invariants.successRowsMatch &&
          invariants.bookingRequestRowsMatch;
        return { passed, invariants, queryPlans };
      },
    );
    console.log(
      JSON.stringify(
        {
          report: destination,
          passed: report.passed,
          verification: report.verification,
          rateMeasurement,
          rateWindowPassed,
          invariants: report.invariants,
          latency: summary.metrics.booking_latency_ms.values,
          started: summary.metrics.booking_requests_started.values.count,
          dropped: summary.metrics.dropped_iterations?.values.count ?? 0,
          overload: summary.metrics.booking_overload.values.count,
        },
        null,
        2,
      ),
    );
    if (!report.passed) process.exitCode = 1;
  } finally {
    clearInterval(monitor);
    await samplePromise.catch(() => undefined);
    await Promise.all(apps.map((a) => a.close()));
    await database.close();
    if (scratch) await rm(scratch, { recursive: true, force: true });
  }
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Load verification failed.');
  process.exitCode = 1;
});
