import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { Counter, Trend } from 'k6/metrics';
import { randomBytes } from 'k6/crypto';

const mode = __ENV.LOAD_MODE;
const count = Number(__ENV.LOAD_COUNT);
const rate = Number(__ENV.LOAD_RATE);
const vus = Number(__ENV.LOAD_VUS || 1000);
const duration = Number(__ENV.LOAD_DURATION);
const workload = __ENV.LOAD_WORKLOAD;
const urls = JSON.parse(__ENV.LOAD_URLS);
const dealers = JSON.parse(__ENV.LOAD_DEALERS);
const planned = mode === 'burst' ? count : rate * duration;
const expectedBookings = workload === 'hotspot' ? 1 : planned;
const started = new Counter('booking_requests_started');
const confirmed = new Counter('bookings_confirmed');
// A middle window excludes startup/drain effects while arrivals continue at the target rate.
const measureRate = mode === 'rate' && workload !== 'hotspot' && duration > 10;
const measurementStartMs = 5000;
const measurementEndMs = (duration - 5) * 1000;
const measurementSeconds = duration - 10;
const windowStarted = new Counter('booking_requests_started_in_window');
const windowConfirmed = new Counter('bookings_confirmed_in_window');
const conflicts = new Counter('booking_conflicts');
const overload = new Counter('booking_overload');
const busy = new Counter('booking_busy');
const timeouts = new Counter('booking_timeouts');
const contention = new Counter('booking_contention');
const unavailable = new Counter('booking_service_unavailable');
const warmupFailures = new Counter('booking_warmup_failures');
const recoveryFailures = new Counter('booking_recovery_failures');
const unexpected = new Counter('booking_unexpected_errors');
const latency = new Trend('booking_latency_ms', true);
const launch = new Trend('booking_start_offset_ms', true);

function newBookingKey() {
  const bytes = new Uint8Array(randomBytes(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

http.setResponseCallback(http.expectedStatuses(...(workload === 'hotspot' ? [201, 409] : [201])));
export const options = {
  scenarios: {
    bookings:
      mode === 'burst'
        ? { executor: 'per-vu-iterations', vus: count, iterations: 1, maxDuration: '30s' }
        : {
            executor: 'constant-arrival-rate',
            rate,
            timeUnit: '1s',
            duration: `${duration}s`,
            // Prepare the chosen client budget before traffic, avoiding allocation during the run.
            preAllocatedVUs: vus,
            maxVUs: vus,
            gracefulStop: '15s',
          },
  },
  thresholds: {
    checks: ['rate==1'],
    booking_requests_started:
      mode === 'burst'
        ? [`count==${planned}`]
        : [`count>=${planned}`, `count<=${Math.ceil(planned * 1.01)}`],
    bookings_confirmed:
      mode === 'rate' && workload !== 'hotspot'
        ? [`count>=${expectedBookings}`]
        : [`count==${expectedBookings}`],
    booking_overload: ['count==0'],
    booking_unexpected_errors: ['count==0'],
    ...(mode === 'burst' ? { booking_warmup_failures: ['count==0'] } : {}),
    ...(workload === 'holiday' ? { booking_recovery_failures: ['count==0'] } : {}),
    ...(mode === 'rate' ? { dropped_iterations: ['count==0'] } : {}),
    ...(measureRate
      ? { bookings_confirmed_in_window: [`count>=${rate * measurementSeconds}`] }
      : {}),
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  return { barrier: Date.now() + 3000 };
}

export default function (data) {
  const index = exec.scenario.iterationInTest;
  const baseUrl = urls[index % urls.length];
  let warmupFailed = false;
  if (mode === 'burst') {
    // Warm the HTTP connection, then release all clients at the same clock barrier.
    const warmup = http.get(`${baseUrl}/health`, { responseCallback: http.expectedStatuses(200) });
    warmupFailed = warmup.status !== 200;
    const wait = data.barrier - Date.now();
    if (wait > 0) sleep(wait / 1000);
  }
  warmupFailures.add(warmupFailed ? 1 : 0);
  const customer = String((index % 1000) + 1).padStart(12, '0');
  const distributed = workload === 'spread' || workload === 'holiday';
  const dealer = distributed ? dealers[index % dealers.length] : dealers[0];
  const slot =
    workload === 'hotspot'
      ? 0
      : workload === 'holiday'
        ? Math.floor(index / dealers.length) % Number(__ENV.LOAD_DAY_SLOTS)
        : workload === 'spread'
          ? Math.floor(index / dealers.length)
          : index;
  const dayStart =
    workload === 'holiday' ? Date.parse(__ENV.LOAD_DAY_START) : Date.UTC(2035, 0, 15, 10);
  const input = {
    customerId: `70000000-0000-4000-8000-${customer}`,
    vehicleId: `80000000-0000-4000-8000-${customer}`,
    dealershipId: dealer,
    serviceTypeId: '40000000-0000-4000-8000-000000000001',
    startAt: new Date(dayStart + slot * 30 * 60 * 1000).toISOString(),
  };
  started.add(1);
  const startedAt = Date.now() - exec.scenario.startTime;
  windowStarted.add(
    measureRate && startedAt >= measurementStartMs && startedAt < measurementEndMs ? 1 : 0,
  );
  launch.add(Date.now() - (mode === 'burst' ? data.barrier : exec.scenario.startTime));
  const response = http.post(`${baseUrl}/api/v1/appointments`, JSON.stringify(input), {
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': newBookingKey() },
    timeout: '10s',
    tags: { name: 'booking' },
  });
  latency.add(response.timings.duration);
  confirmed.add(response.status === 201 ? 1 : 0);
  const finishedAt = Date.now() - exec.scenario.startTime;
  windowConfirmed.add(
    measureRate &&
      response.status === 201 &&
      finishedAt >= measurementStartMs &&
      finishedAt < measurementEndMs
      ? 1
      : 0,
  );
  conflicts.add(response.status === 409 ? 1 : 0);
  overload.add(response.status === 503 ? 1 : 0);
  let code;
  try {
    if (response.status !== 201) code = response.json('error.code');
  } catch {
    // Transport/non-JSON failures remain unexpected outcomes; never infer availability.
  }
  busy.add(code === 'BOOKING_BUSY' ? 1 : 0);
  timeouts.add(code === 'BOOKING_TIMEOUT' ? 1 : 0);
  contention.add(code === 'BOOKING_CONTENTION' ? 1 : 0);
  unavailable.add(code === 'SERVICE_UNAVAILABLE' ? 1 : 0);
  unexpected.add([201, 409, 503].includes(response.status) ? 0 : 1);
  check(response, {
    'expected booking outcome': (r) =>
      workload === 'hotspot'
        ? r.status === 201 || (r.status === 409 && code === 'NO_AVAILABILITY')
        : r.status === 201,
    'confirmed response has both assignments': (r) =>
      r.status !== 201 ||
      Boolean(r.json('technicianId') && r.json('serviceBayId') && r.json('status') === 'CONFIRMED'),
  });
}

export function teardown() {
  if (workload !== 'holiday') return;
  // Read-only recovery probes after the load has drained; they create no extra bookings.
  const query =
    '?serviceTypeId=40000000-0000-4000-8000-000000000001&startAt=2035-01-16T10%3A00%3A00Z';
  for (const baseUrl of urls) {
    const params = { responseCallback: http.expectedStatuses(200), timeout: '3s' };
    const health = http.get(`${baseUrl}/health`, params);
    const availability = http.get(
      `${baseUrl}/api/v1/dealerships/${dealers[0]}/availability${query}`,
      params,
    );
    let available = false;
    try {
      available = availability.status === 200 && availability.json('available') === true;
    } catch {
      // A malformed recovery response fails the profile rather than being ignored.
    }
    recoveryFailures.add(health.status === 200 && available ? 0 : 1);
    check(health, { 'health responds after burst': (r) => r.status === 200 });
    check(availability, { 'availability responds after burst': () => available });
  }
}

export function handleSummary(data) {
  return {
    [__ENV.LOAD_SUMMARY]: JSON.stringify(data, null, 2),
    stdout: `\nBooking load metrics saved; confirmed=${data.metrics.bookings_confirmed.values.count}, overload=${data.metrics.booking_overload.values.count}\n`,
  };
}
