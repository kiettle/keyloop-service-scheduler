import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { Counter, Trend } from 'k6/metrics';

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
const conflicts = new Counter('booking_conflicts');
const overload = new Counter('booking_overload');
const unexpected = new Counter('booking_unexpected_errors');
const latency = new Trend('booking_latency_ms', true);
const launch = new Trend('booking_start_offset_ms', true);

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
            preAllocatedVUs: Math.min(vus, rate),
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
    ...(mode === 'rate' ? { dropped_iterations: ['count==0'] } : {}),
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  return { barrier: Date.now() + 3000 };
}

export default function (data) {
  const index = exec.scenario.iterationInTest;
  const baseUrl = urls[index % urls.length];
  if (mode === 'burst') {
    // Warm the HTTP connection, then release all clients at the same clock barrier.
    http.get(`${baseUrl}/health`, { responseCallback: http.expectedStatuses(200) });
    const wait = data.barrier - Date.now();
    if (wait > 0) sleep(wait / 1000);
  }
  const customer = String((index % 1000) + 1).padStart(12, '0');
  const dealer = workload === 'spread' ? dealers[index % dealers.length] : dealers[0];
  const slot =
    workload === 'hotspot' ? 0 : workload === 'spread' ? Math.floor(index / dealers.length) : index;
  const input = {
    customerId: `70000000-0000-4000-8000-${customer}`,
    vehicleId: `80000000-0000-4000-8000-${customer}`,
    dealershipId: dealer,
    serviceTypeId: '40000000-0000-4000-8000-000000000001',
    startAt: new Date(Date.UTC(2035, 0, 15, 10) + slot * 30 * 60 * 1000).toISOString(),
  };
  started.add(1);
  launch.add(Date.now() - (mode === 'burst' ? data.barrier : exec.scenario.startTime));
  const response = http.post(`${baseUrl}/api/v1/appointments`, JSON.stringify(input), {
    headers: { 'Content-Type': 'application/json' },
    timeout: '10s',
    tags: { name: 'booking' },
  });
  latency.add(response.timings.duration);
  confirmed.add(response.status === 201 ? 1 : 0);
  conflicts.add(response.status === 409 ? 1 : 0);
  overload.add(response.status === 503 ? 1 : 0);
  unexpected.add([201, 409, 503].includes(response.status) ? 0 : 1);
  check(response, {
    'expected booking outcome': (r) =>
      workload === 'hotspot' ? [201, 409].includes(r.status) : r.status === 201,
    'confirmed response has both assignments': (r) =>
      r.status !== 201 ||
      Boolean(r.json('technicianId') && r.json('serviceBayId') && r.json('status') === 'CONFIRMED'),
  });
}

export function handleSummary(data) {
  return {
    [__ENV.LOAD_SUMMARY]: JSON.stringify(data, null, 2),
    stdout: `\nBooking load metrics saved; confirmed=${data.metrics.bookings_confirmed.values.count}, overload=${data.metrics.booking_overload.values.count}\n`,
  };
}
