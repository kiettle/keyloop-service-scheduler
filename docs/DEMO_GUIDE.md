# Demo guide and video outline

Use the local assessment setup. No video has been recorded by the agent. Complete command execution and remaining handoff items are recorded in [FINAL_REVIEW.md](FINAL_REVIEW.md).

## 1. Start the application

On a new checkout, follow [README](../README.md#first-installation). Preserve an existing `.env`. For the cache demonstration, add `REDIS_URL` and `CATALOG_CACHE_NAMESPACE` from `.env.example` before starting the app; otherwise both cached lists correctly read PostgreSQL directly.

```sh
cp .env.example .env
npm ci
npm run prisma:generate
npm run db:up
npm run cache:up
npm run prisma:validate
npm run db:migrate
npm run db:seed
npm run db:configure
npm run db:check
npm run build
npm start
```

Keep this terminal running. Use a second terminal at the project root for the remaining commands. Default application URL is localhost:3000; set BASE_URL differently if PORT was changed. Repeating this demo uses a new future interval, not a database reset.

## 2. Health and API documentation

```sh
export BASE_URL="${BASE_URL:-http://localhost:3000}"
curl --fail --silent --show-error "$BASE_URL/health"
curl --fail --silent --show-error --output /dev/null "$BASE_URL/docs/"
curl --fail --silent --show-error --output /dev/null "$BASE_URL/docs-json"
```

Expect health JSON `{ "status": "ok" }` and successful documentation responses. Open `$BASE_URL/docs` in the browser: Appointments, Booking lookups, Availability, Service catalog, and Health are documented. Explain the required UUID v4 Idempotency-Key header, five POST fields, server-derived assignments/duration, and status/error schemas. View the UI before issuing the cURL demo; executing additional POSTs in Swagger at the same interval would consume resources.

Fetch the booking reference IDs in Swagger or with these reads (replace the example IDs with returned IDs):

```bash
curl --fail --silent --show-error "$BASE_URL/api/v1/customers?limit=20"
curl --fail --silent --show-error "$BASE_URL/api/v1/customers/20000000-0000-4000-8000-000000000001/vehicles"
curl --fail --silent --show-error "$BASE_URL/api/v1/dealerships"
curl --fail --silent --show-error "$BASE_URL/api/v1/customers/20000000-0000-4000-8000-000000000001/appointments?page=1&limit=20"
```

Copy the customer, owned vehicle, dealership, and service-type IDs into the five-field booking body. VIN distinguishes vehicles. Repeat the history GET after booking to show the persisted result; the new appointment appears according to start-time descending order. Lists use `{ items, page, limit, hasNext }`; the service catalog keeps its existing array response. Reference IDs below remain a deterministic seeded demo shortcut. Customer reads are an unauthenticated assessment extension.

Before selecting a service, demonstrate the shared catalog cache using the configured namespace (the example is service-scheduler:local):

```sh
docker compose exec -T redis redis-cli DEL 'service-scheduler:local:service-types:v1:active'
curl --fail --silent --show-error "$BASE_URL/api/v1/service-types"
curl --fail --silent --show-error "$BASE_URL/api/v1/service-types"
docker compose exec -T redis redis-cli TTL 'service-scheduler:local:service-types:v1:active'
```

Expect the active service list; after Redis is ready the first request misses, the second hits, and TTL remains at most 300 seconds. Show cache events in application logs. After controlled catalog changes/seeding, delete the same key. To demonstrate fallback, stop only the disposable local Redis service with docker compose stop redis, repeat the GET, and restart with npm run cache:up. The catalog still reads PostgreSQL. Use a new booking key for booking demonstrations; cached catalog data is never authoritative for validation. See [README](../README.md#service-catalog-and-redis-caching) for configuration and limitations.

To show dealership page caching, request the same page twice:

```sh
curl --fail --silent --show-error "$BASE_URL/api/v1/dealerships?page=1&limit=20"
curl --fail --silent --show-error "$BASE_URL/api/v1/dealerships?page=1&limit=20"
docker compose exec -T redis redis-cli TTL 'service-scheduler:local:dealerships:v1:page:1:limit:20'
```

Use `reference_cache_miss` / `reference_cache_hit` logs and the real integration tests to explain query avoidance. Earlier lookup requests may already have populated these entries. Changing page/limit uses a separate key. Stop the disposable Redis service and repeat the dealership read to demonstrate database fallback, then restart it. Explain that displayed dealership data may be stale while booking still checks current resources. Show [targeted invalidation](../README.md#dealership-page-caching) after controlled changes; do not mutate demo data solely to demonstrate this during the video. No measured latency benefit is claimed.

To demonstrate replacement versus grouped invalidation, run the focused examples on the isolated test services:

```sh
npm run db:test:up
TEST_REDIS_URL=redis://127.0.0.1:56380 npm run test:integration -- \
  test/integration/service-catalog.spec.ts test/integration/directory-cache.spec.ts \
  -t 'refreshes the existing catalog|catalog update rolls back|invalidates all dealership pages'
```

Show the catalog refresh test: warm the original key, shorten its TTL, commit Oil Change from 30 to 45 minutes, read the full ordered active catalog, and replace the same key. Redis contains the new snapshot before the second instance's GET, expiry resets to about 300 seconds, and that GET performs no catalog database read or TTL extension. Show the rollback example leaving the database/cache unchanged and skipping refresh. These tests own temporary databases/namespaces and do not modify the live demo data.

Then show the existing grouped-invalidation tests: one operation removes several cached dealership pages/page sizes while preserving the service-catalog key. SCAN/UNLINK can require several batches; this is not atomic across the entire group. SCAN traverses the Redis database incrementally, MATCH selects the affected keys, and COUNT is a work hint rather than a strict batch-size limit. Renaming a dealership or changing list membership can move items between pages, so invalidation is simpler than patching every cached page.

Explain the boundary: this is a tested maintenance pattern using existing methods, with no update/refresh API or automatic writer. Refresh happens after commit and replaces the whole catalog; it is best effort, and awaiting set() does not confirm storage. A refresh can fail or overwrite a newer snapshot during concurrent updates. PostgreSQL/Redis are not atomically coordinated. Read [the refresh example and limitations](../README.md#refreshing-an-existing-catalog-entry); booking correctness still comes from PostgreSQL.

## 3. Generate a future interval and check availability

```sh
export DEMO_START="$(node -e 'console.log(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString())')"
export DEMO_DIR="$(mktemp -d "${TMPDIR:-/tmp}/keyloop-demo.XXXXXX")"
printf 'Demo interval starts at %s\n' "$DEMO_START"

curl --fail --silent --show-error --get \
  "$BASE_URL/api/v1/dealerships/10000000-0000-4000-8000-000000000001/availability" \
  --data-urlencode 'serviceTypeId=40000000-0000-4000-8000-000000000001' \
  --data-urlencode "startAt=$DEMO_START"
```

With unchanged seed data and an unused interval, expect available=true, two qualified technicians, two bays, and a 30-minute duration. This is an advisory result, not a reservation. Catalog edits or other bookings can change the counts; use a clean setup or explain existing data rather than resetting a development volume.

## 4. Create and retrieve a confirmed appointment

Define a small shell helper that produces the five accepted fields using the seed ID patterns. Arguments are customer number and vehicle number, not arbitrary resource IDs.

```sh
booking_payload() {
  node - "$1" "$2" <<'NODE'
const suffix = (value) => String(value).padStart(12, '0');
console.log(JSON.stringify({
  customerId: `20000000-0000-4000-8000-${suffix(process.argv[2])}`,
  vehicleId: `30000000-0000-4000-8000-${suffix(process.argv[3])}`,
  dealershipId: '10000000-0000-4000-8000-000000000001',
  serviceTypeId: '40000000-0000-4000-8000-000000000001',
  startAt: process.env.DEMO_START,
}));
NODE
}

export DEMO_KEY="$(node -e 'console.log(require("node:crypto").randomUUID())')"
booking_payload 1 1 > "$DEMO_DIR/request.json"
curl --fail-with-body --silent --show-error \
  "$BASE_URL/api/v1/appointments" \
  -H 'Content-Type: application/json' -H "Idempotency-Key: $DEMO_KEY" \
  --data-binary "@$DEMO_DIR/request.json" \
  --output "$DEMO_DIR/created.json" --write-out 'HTTP %{http_code}\n'
cat "$DEMO_DIR/created.json"

export APPOINTMENT_ID="$(node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).id)' "$DEMO_DIR/created.json")"
curl --fail --silent --show-error "$BASE_URL/api/v1/appointments/$APPOINTMENT_ID"
```

Expect HTTP 201, CONFIRMED, technician A1 and bay A1, a server-computed end 30 minutes after start, and all association IDs. GET returns the same persisted public record. Automated tests additionally shut down/recreate the app and retrieve that row again.

Before changing the request file, retry the same intent and then deliberately change its body:

```sh
curl --fail-with-body --silent --show-error \
  "$BASE_URL/api/v1/appointments" \
  -H 'Content-Type: application/json' -H "Idempotency-Key: $DEMO_KEY" \
  --data-binary "@$DEMO_DIR/request.json" \
  --dump-header "$DEMO_DIR/replayed-headers.txt" --output "$DEMO_DIR/replayed.json" \
  --write-out 'HTTP %{http_code}\n'
cat "$DEMO_DIR/replayed-headers.txt"
cmp "$DEMO_DIR/created.json" "$DEMO_DIR/replayed.json"

node - "$DEMO_DIR/request.json" > "$DEMO_DIR/changed.json" <<'NODE'
const fs = require('node:fs');
const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
input.startAt = new Date(Date.parse(input.startAt) + 3600000).toISOString();
console.log(JSON.stringify(input));
NODE
curl --silent --show-error "$BASE_URL/api/v1/appointments" \
  -H 'Content-Type: application/json' -H "Idempotency-Key: $DEMO_KEY" \
  --data-binary "@$DEMO_DIR/changed.json" --write-out '\nHTTP %{http_code}\n'
```

Expect the replay to return 201, `Idempotency-Replayed: true`, and exactly the saved response (`cmp` exits 0). Changed-body reuse returns 409 IDEMPOTENCY_KEY_REUSED before availability checks. The replay consumes no second resource pair. Use a new key for each independent booking below. Successful keys are retained indefinitely; failures do not consume keys. After a timeout or lost acknowledgement, keep the original key until the outcome is resolved.

## 5. Consume the alternative pair and show a conflict

Customer 2 owns vehicle 3; customer 3 owns vehicle 4. Both use dealership A in this demo because vehicles/customers have no dealership-specific ownership restriction.

```sh
export DEMO_KEY_2="$(node -e 'console.log(require("node:crypto").randomUUID())')"
booking_payload 2 3 > "$DEMO_DIR/request.json"
curl --fail-with-body --silent --show-error \
  "$BASE_URL/api/v1/appointments" -H 'Content-Type: application/json' -H "Idempotency-Key: $DEMO_KEY_2" \
  --data-binary "@$DEMO_DIR/request.json" --write-out '\nHTTP %{http_code}\n'

export DEMO_KEY_3="$(node -e 'console.log(require("node:crypto").randomUUID())')"
booking_payload 3 4 > "$DEMO_DIR/request.json"
curl --silent --show-error \
  "$BASE_URL/api/v1/appointments" -H 'Content-Type: application/json' -H "Idempotency-Key: $DEMO_KEY_3" \
  --data-binary "@$DEMO_DIR/request.json" --write-out '\nHTTP %{http_code}\n'

curl --fail --silent --show-error --get \
  "$BASE_URL/api/v1/dealerships/10000000-0000-4000-8000-000000000001/availability" \
  --data-urlencode 'serviceTypeId=40000000-0000-4000-8000-000000000001' \
  --data-urlencode "startAt=$DEMO_START"
```

Expect a second 201 with technician A3 / bay A2, then 409 NO_AVAILABILITY with a request ID. Final availability is false with both counts zero. The earlier true availability result did not guarantee another booking. Error responses do not expose SQL. Concurrency/API tests verify the failed operation leaves no additional appointment.

## 6. Demonstrate actual concurrent protection and tests

In the project terminal, ensure both TEST_DATABASE_URL and TEST_REDIS_URL from `.env.example` exist in `.env`, then:

```sh
npm run db:test:up
npm run test:concurrency
npm run test:e2e
TEST_REDIS_URL=redis://127.0.0.1:56380 npm run test:all
```

These tests own separate fresh databases; they do not clear the two demo bookings.

Explain the assertions, not just the green output:

- CT-01 sends twenty independent requests across two app instances: one 201, nineteen 409, one confirmed PostgreSQL row.
- CT-02 forces both requests to read the same free candidates: both must commit with distinct pairs, and transaction IDs prove a fresh retry.
- Technician and bay bottlenecks each allow one booking; concurrent adjacent intervals allow both.
- An intentionally one-attempt race returns retryable 503 instead of false NO_AVAILABILITY.
- Direct SQL checks count persisted rows, validate references/qualifications/duration, and reject any technician or bay overlap.
- Conflict-aware insertion avoids explicit resource-row locks. Both database exclusions remain active and reject direct writes that bypass the booking application. A skipped resource-conflict insert rolls back before fresh allocation and retry.

Show source for the two named exclusions, the conflict-aware insert, and the bounded retry loop. Explain `409` settled shortage versus `503` overload, expired budget, unresolved contention, or temporary database failure. Use actual current test output; the focused suites are subsets of test:all, not additional unique cases.

## 7. Video outline — approximately 8–9 minutes

| Time      | Content                                                                                                              |
| --------- | -------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:45 | Introduce yourself, Scenario A, and backend-only scope                                                               |
| 0:45–2:00 | Architecture/ER diagrams, modules, qualifications and durations                                                      |
| 2:00–3:30 | Half-open ranges, both exclusions, conflict-aware insertion, transaction commit and fresh retries                    |
| 3:30–6:00 | Swagger lookups, availability, booking/replay/mismatch, history; catalog miss/hit/fallback; show concurrency results |
| 6:00–7:30 | AI collaboration: developer direction, real error probes, review findings, verification and corrections              |
| 7:30–8:30 | Trade-offs, limitations, what you learned, and remaining production work                                             |

Use genuine examples: startup connectivity validation, Prisma SQLSTATE metadata, a test that incorrectly assumed only exclusion errors, and the progression from temporary resource locks to approved conflict-aware insertion and fixed database timeouts. State what you personally decided and can explain. Do not present proposed telemetry, authentication, production throughput, or a recorded video as implemented.

For the interview, explain the 100-request burst as a resilience test: enough eligible resource/time capacity yields 100 confirmations; one technician and bay at an identical interval yields one confirmation and 99 availability conflicts. Exact persisted counts, valid assignments, and zero overlaps matter; overload or technical failures fail these profiles. The mandatory 20-request regression remains. Requests launch from a client barrier, with actual launch spread reported. The per-process queue bounds active work; PostgreSQL exclusions enforce exclusivity across instances. Explicit resource-row locks were replaced by conflict-aware insertion and bounded fresh-transaction retries. Idempotency adds a unique key claim and saved response in the same transaction; replay bypasses resource allocation, while key mismatch returns 409.

Describe 1,000 successful bookings/second as an unverified future stretch goal, not submission acceptance or a verified Keyloop traffic requirement. Historical 100-request bursts and the 500-RPS minute control passed on earlier snapshots; the 1,000-RPS minute trials failed. Refer to [LOAD_RESULTS](LOAD_RESULTS.md) for source/configuration limitations. No load tests were rerun for the 2026-11-04 documentation-only goal revision, and no current-source or production capacity is established. Keep the architecture simple and improve it only when measurements justify the change.

Before submitting: record the actual 5–10 minute video, check its link/access, include every source/test/document file in your final Git commit, push it, and verify reviewer access. These manual handoff steps are not performed automatically.
