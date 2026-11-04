# Keyloop Unified Service Scheduler

Backend-only implementation of **Keyloop Scenario A**. A customer requests a service for a vehicle at a dealership and time; the backend assigns a qualified technician and an available bay for the full catalog duration, then persists a CONFIRMED appointment.

| Keyloop requirement                          | Implementation                                                                            |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Resource-constrained booking                 | Validated POST; automatic technician/bay assignment                                       |
| Availability for the entire service duration | Qualification/active/dealership filters, half-open overlap queries, PostgreSQL exclusions |
| Persistent confirmed associations            | Atomic appointment row and retrieval after app restart                                    |

Implemented: booking, retrieval, advisory availability, strict validation, safe errors, structured logs/request IDs, bounded fresh-transaction retries, Swagger, reproducible seeds/migrations, and real PostgreSQL/HTTP/concurrency tests. Durable booking idempotency, a cached service-selection catalog, booking-data lookups, and customer appointment history are the explicitly approved additions.

- [System design and diagrams](docs/SYSTEM_DESIGN.md)
- [Requirements, executed evidence, and submission readiness](docs/FINAL_REVIEW.md)
- [Reproducible demo and video outline](docs/DEMO_GUIDE.md)
- [Detailed database rules and fixture IDs](docs/DATABASE.md)

## Stack and architecture

NestJS **11.2.8**, TypeScript **5.9.3**, Prisma/client/adapter **7.10.1**, PostgreSQL **17.6-alpine**, Vitest **4.1.11**, and Swagger **11.4.7**. Direct versions are pinned; commit `package-lock.json` and use `npm ci`. A scoped override pins Swagger's js-yaml to patched 5.4.1; the existing Nest/Multer override is retained. Audits and their limits are recorded in the final review.

One modular monolith: thin controllers call application use cases; concrete repositories own SQL/transactions; shared scheduling owns interval and selection rules. HTTP validation/filter/logging and Prisma connection lifecycle are shared infrastructure. Repositories remain concrete; optional Redis caches service types and dealership pages.

Booking uses READ COMMITTED and a single-item conflict-aware insert with both GiST exclusions. A skipped resource-conflict insert rolls back before a fresh allocation attempt; an identity collision remains unexpected. There are no explicit resource-row locks. Four total allocation attempts with jittered backoff is the default; settled exhaustion is 409 and unresolved contention is 503. Success follows commit. A bounded per-process queue protects capacity, and all attempts share one booking deadline.

## Prerequisites

- Node.js **24.21.0**, npm **11.19.0**; `.nvmrc` and package engines describe the supported versions.
- Docker Engine with Docker Compose v2.
- `curl` for the demo. Demo JSON generation uses Node, not jq.

Verification covers the available macOS arm64 environment and PostgreSQL Docker image. Installing prerequisites on another host is outside the recorded checks; no cross-platform or hosted deployment claim is made.

## First installation

Docker Compose services are defined in [`docker-compose.yaml`](docker-compose.yaml).

From a new checkout:

```sh
node --version
npm --version
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

Do not overwrite an existing `.env`. Add the new Redis variables from `.env.example` to an existing setup if you want caching; without REDIS_URL the catalog reads PostgreSQL directly. The clean-install check uses the complete current submission candidate in an isolated temporary copy, with a separate Compose project/volume and available ports. See FINAL_REVIEW for the distinction between that check and a committed-checkout/GitHub handoff.

In another terminal:

```sh
curl --fail http://localhost:3000/health
curl --fail --silent --show-error http://localhost:3000/docs-json
```

Open **[Swagger UI](http://localhost:3000/docs)**. The OpenAPI JSON is **`/docs-json`**. Swagger schemas describe the actual inputs, public responses, and error statuses; no Swagger compiler plugin is required.

For development after setup:

```sh
npm run start:dev
```

Stop the app with Ctrl-C. Stop the development database while retaining its volume:

```sh
npm run db:down
```

Do not remove a development volume to repeat a demo. Choose a new future interval instead. Use committed migrations, not `prisma db push`, because the SQL-only exclusions and CHECKs are essential. Seed reruns insert missing fixtures and preserve existing edits/bookings.

## Environment configuration

| Variable                                            | Meaning / default example                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `NODE_ENV`                                          | development, test, or production; defaults to development                                  |
| `PORT`                                              | Application port, 1–65535; default 3000                                                    |
| `DATABASE_URL`                                      | Required PostgreSQL URL including host/database                                            |
| `BOOKING_MAX_ATTEMPTS`                              | Total attempts including the first; default 4, valid 1–10                                  |
| `BOOKING_MAX_CONCURRENT`                            | Active booking limit per process; default 8, valid 1–8                                     |
| `BOOKING_MAX_PENDING`                               | Waiting booking limit per process; default 128, valid 0–1000                               |
| `BOOKING_TIMEOUT_MS`                                | Overall queue/attempt/backoff budget; default 5000, valid 100–30000                        |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Local Compose credentials/database; keep aligned with DATABASE_URL                         |
| `POSTGRES_PORT`                                     | Development PostgreSQL host port; example 55432                                            |
| `TEST_DATABASE_URL`                                 | Dedicated test server/database; example port 55433, base database `service_scheduler_test` |
| `REDIS_URL`                                         | Optional Redis URL; unset/empty disables both reference-list caches                        |
| `CATALOG_CACHE_NAMESPACE`                           | Required with Redis; shared by replicas, distinct per deployment/database                  |
| `TEST_REDIS_URL`                                    | Dedicated test Redis: `redis://127.0.0.1:56380`; fixtures own unique namespaces            |

`.env` is ignored. Example credentials are disposable local values, not production secrets. Compose binds PostgreSQL to loopback. URL-encode special credential characters; changing `.env` credentials does not update an already initialized database volume. Runtime pools have ten connections and a five-second connection acquisition timeout. Booking acquisition waits at most one second or the remaining budget; Prisma transaction timeout uses the budget remaining at the start of each attempt.

`npm run db:configure` sets PostgreSQL role/database defaults of 250 ms lock, 2 s statement, and 5 s transaction timeout. It is repeatable and changes no tables/data. Restart the app afterward so new connections inherit the defaults. No timeout-configuration query is sent per booking. Fixed database limits and the shared booking deadline are separate; cleanup, commit, and network time can exceed the nominal request budget. The local role is shared with CLI tasks, so later migration/seed sessions inherit these defaults too. Use separate administrative connections for longer maintenance work. See [database setup](docs/DATABASE.md#fixed-database-timeouts).

## API contracts and examples

| Route                                                | Success | Description                                                                 |
| ---------------------------------------------------- | ------- | --------------------------------------------------------------------------- |
| `POST /api/v1/appointments`                          | 201     | Confirm and assign both resources after commit                              |
| `GET /api/v1/appointments/:id`                       | 200     | Retrieve all public association IDs, interval, status, createdAt            |
| `GET /api/v1/dealerships/:dealershipId/availability` | 200     | Read-only full-duration availability and counts                             |
| `GET /api/v1/service-types`                          | 200     | Active global catalog for service selection; may be cached for five minutes |
| `GET /api/v1/customers`                              | 200     | Paginated customer lookup                                                   |
| `GET /api/v1/customers/:customerId/vehicles`         | 200     | Paginated owned vehicles, including VIN                                     |
| `GET /api/v1/dealerships`                            | 200     | Paginated dealership lookup                                                 |
| `GET /api/v1/customers/:customerId/appointments`     | 200     | Paginated customer appointment history                                      |
| `GET /health`                                        | 200     | Process liveness, not continuous database readiness                         |

Example POST payload using seeded customer 1 / vehicle 1 / dealership A / 30-minute oil change:

```json
{
  "customerId": "20000000-0000-4000-8000-000000000001",
  "vehicleId": "30000000-0000-4000-8000-000000000001",
  "dealershipId": "10000000-0000-4000-8000-000000000001",
  "serviceTypeId": "40000000-0000-4000-8000-000000000001",
  "startAt": "2035-01-15T10:00:00Z"
}
```

POST also requires one UUID v4 `Idempotency-Key` header; generate it once per booking intent and reuse it on retries. The example time must be future relative to the server for a new booking. The demo guide generates a fresh future timestamp and supplies exact cURL commands. Success includes a generated appointment ID, all association IDs, derived endAt, CONFIRMED status, and createdAt. Dates serialize as ISO UTC with milliseconds. GET availability returns interval, boolean, and technician/bay counts; its internal candidate IDs are omitted.

Only the five POST fields and two availability query fields are accepted. Client-supplied resource IDs, duration, end, or status are rejected. UUIDs and real calendar timestamps are validated; timestamps require seconds, `Z` or `±HH:MM`, and at most three fractional digits. All active bays are compatible with all services; service types are global. See [seed identities](docs/DATABASE.md#deterministic-reference-fixtures).

Errors use:

```json
{
  "error": {
    "code": "NO_AVAILABILITY",
    "message": "No qualified technician and service bay are available for the requested interval."
  },
  "requestId": "<server-generated-uuid>"
}
```

400 = malformed input; 404 = missing reference; 422 = business validation; 409 = settled resource exhaustion or `IDEMPOTENCY_KEY_REUSED`; 503 = admission exhaustion, expired booking budget, unresolved contention, or recognized temporary database failure; 500 = unexpected failure. Availability uses the same safe temporary/unexpected error policy. Validation may add a details array. Business API responses include `x-request-id`; 503 adds `Retry-After: 1`. SQL, credentials, and stacks are not exposed.

## Booking lookups and customer history

These optional assessment extensions support fetching IDs in Swagger before booking:

| GET endpoint                                 | Public item fields                         | Order                     |
| -------------------------------------------- | ------------------------------------------ | ------------------------- |
| `/api/v1/customers`                          | `id`, `name`                               | Name, ID ascending        |
| `/api/v1/customers/:customerId/vehicles`     | `id`, `customerId`, `vin`, `make`, `model` | ID ascending              |
| `/api/v1/dealerships`                        | `id`, `name`, `timeZone`                   | Name, ID ascending        |
| `/api/v1/customers/:customerId/appointments` | Existing public appointment response       | Start time, ID descending |

All four return `{ items, page, limit, hasNext }`. Defaults are `page=1&limit=20`; limit is 1–100. Pages must be positive integers with a supported database offset (at most 2,147,483,647). Unknown query fields, repeated parameters, malformed IDs, and invalid pagination return `400 VALIDATION_ERROR`. One extra row determines `hasNext`; no total-count query is issued. Known parents without results return an empty page; unknown customers return `404 CUSTOMER_NOT_FOUND`. Database failures retain the existing safe error contract.

Customers can have multiple vehicles and appointments. History includes all stored statuses, past and future, and remains scoped to the requested customer. Offset pages can shift during concurrent inserts; they are not a frozen snapshot. Booking still accepts only its original five fields and assigns technician/bay automatically.

Workflow: fetch customers → owned vehicles → dealerships → service types → availability → POST booking → customer appointment history. Copy IDs from GET responses into Swagger requests; there are no dynamic dropdowns. Service types and dealership pages use optional shared Redis cache-aside. Customer, vehicle, and appointment-history reads use PostgreSQL directly. The assessment has no authentication: production exposure of customer/vehicle/history data requires authorization.

## Service catalog and Redis caching

`GET /api/v1/service-types` returns active global services as `{ id, name, durationMinutes }[]`, sorted by name then ID. Empty results are `200 []`. Use it to populate a booking form rather than hardcoding fixture IDs. A listed service does not guarantee qualified/available resources at every dealership.

The catalog uses cache-aside: Redis GET first; on a miss or invalid JSON/shape, query PostgreSQL and store the successful array with atomic `SET ... EX 300`. Empty arrays are cached; errors are not. Hits never extend TTL. Redis read failures fall back to PostgreSQL; Redis SET failure does not discard a successful database response. Database errors retain the existing safe error contract and are not swallowed by cache fallback. Booking, availability, appointment retrieval, and durable idempotency do not use this cache.

Configure optional `REDIS_URL=redis://127.0.0.1:56379` and required-with-Redis `CATALOG_CACHE_NAMESPACE=service-scheduler:local`. Each deployment/database needs its own namespace; replicas for the same database share it. The key is `<namespace>:service-types:v1:active`. Unset or empty REDIS_URL disables caching. Redis connects in the background and is not an application-startup dependency. The single ioredis 6.0.0 connection per app instance uses a 1 s connection timeout, 100 ms command timeout, 1 s pending-reply socket timeout, disabled offline queuing/resending, zero request-level retries, and built-in reconnect backoff. The client disconnects on shutdown. `/health` remains process liveness.

The local Redis 7.4.12-alpine services bind to loopback (56379 development, 56380 test), use a 64 MiB Redis maxmemory setting with allkeys-lru eviction (not a container/process memory cap), and disable persistence. They are disposable caches; PostgreSQL data/configuration is unchanged. No memory-cache tier, coalescing, distributed lock, Pub/Sub, or background refresh is included. Concurrent misses can perform duplicate inexpensive catalog reads.

Five minutes is entry lifetime after population, not an immediate-consistency guarantee after an update. There is currently no service-type update API; the seed inserts missing rows and preserves edits. After controlled SQL changes or seeding, invalidate the exact catalog key, or use the explicit refresh example below to replace its complete value. Future application writers should call `ServiceCatalogCache.invalidate()` after database commit and log/retry failed invalidation operationally; `false` reports failure without undoing the commit. A reader can refill old data after deletion, so this simple policy remains eventually consistent. Booking always validates current PostgreSQL duration/status.

Local demonstration using the example namespace:

```sh
npm run cache:up
docker compose exec -T redis redis-cli DEL 'service-scheduler:local:service-types:v1:active'
curl --fail http://localhost:3000/api/v1/service-types
curl --fail http://localhost:3000/api/v1/service-types
docker compose exec -T redis redis-cli TTL 'service-scheduler:local:service-types:v1:active'
```

With Redis configured and ready, the logs distinguish `reference_cache_miss` and `reference_cache_hit`; subsequent hits do not reset TTL. Other events identify bypass, invalid values, read/write failures, and failed invalidation without logging Redis URLs or cached data. You can stop **only the disposable local cache** with `docker compose stop redis` to demonstrate PostgreSQL fallback, then restart with `npm run cache:up`. Use your actual namespace in the DEL/TTL commands. No global FLUSHDB is needed.

### Refreshing an existing catalog entry

For the small, complete catalog, maintenance can replace the cached value directly after a database update commits. Rebuild the entire active list through the existing repository so filtering and ordering are preserved. This is a tested maintenance example; there is no catalog-update endpoint, production writer, or automatic synchronization feature.

The isolated integration example uses the existing database/repository/cache instances:

```ts
await prisma.$transaction(async (tx) => {
  await tx.serviceType.update({
    where: { id: oilChangeId },
    data: { durationMinutes: 45 },
  });
}); // Commit must finish before reading and refreshing the catalog.
const services = await catalogRepository.findActiveServiceTypes();
await serviceCatalogCache.set(services);
```

This replaces the same key with `SET ... EX 300`, without deleting it first. Explicit replacement starts a fresh five-minute TTL; normal GET hits do not extend it. If the database transaction rolls back, stop before the catalog read/cache write. The integration tests inspect Redis before the next GET and verify that another app instance serves the refreshed list without another catalog database read.

Replacement is best effort: `set()` logs Redis failures or bypasses an unavailable client and returns no storage confirmation. The example verifies the actual Redis value and TTL; awaiting `set()` alone is not proof of a successful refresh. A database-read failure after commit also prevents refresh. PostgreSQL and Redis do not commit atomically together; failed refreshes or concurrent refreshes writing older snapshots can leave stale data until expiry or a later refresh. Neither this example nor invalidation provides immediate consistency. Booking still validates current PostgreSQL data.

Use replacement for this small whole-list snapshot. Keep grouped invalidation for paginated dealership lists: changing a dealership name or list membership can affect ordering, several pages/page sizes, and `hasNext`. `invalidateDealerships()` clears those pages while preserving the service-catalog key. One logical invalidation may issue multiple SCAN/UNLINK commands and is not atomic across all batches. No cache patching or versioning system is added.

### Dealership page caching

Redis also caches `GET /api/v1/dealerships`. Customer lists, owned vehicles, appointment history/retrieval, availability, booking, and idempotency remain uncached. CatalogModule and DirectoryModule share one optional Redis connection per application instance; domain cache providers validate their public payloads. There is no global interceptor or generic repository/cache framework.

The existing `CATALOG_CACHE_NAMESPACE` setting namespaces both caches. Keys are:

- `<namespace>:service-types:v1:active`
- `<namespace>:dealerships:v1:page:<page>:limit:<limit>`

Validated numeric page/limit values form the dealership keys. Cached pages retain `{ items, page, limit, hasNext }` and must match the requested pagination/public fields; hasNext=true requires a full page. Invalid values are misses. Successful empty pages are cached; database errors are not. Every entry uses fixed `SET ... EX 300`, and hits do not extend expiry. Redis failures fall back to PostgreSQL; database failures retain the existing safe error contract.

No reference-data write API exists. After controlled dealership changes/seeding, call `DirectoryCache.invalidateDealerships()` **after commit** to clear all dealership pages, across page numbers and limits. It returns false and logs on failure. It filters cursor-based SCAN results by the exact namespace/entity prefix and passes each batch of matching keys to one UNLINK command. The service-catalog key is preserved. SCAN traverses the Redis database incrementally; MATCH filters affected keys, and COUNT is a work hint rather than a strict batch-size limit. One logical invalidation may require several commands and is not atomic across batches. Concurrent stale refills remain possible, and invalidation cannot undo a committed database update.

For manual maintenance, use the actual namespace and delete only matching dealership keys:

```sh
docker compose exec -T redis redis-cli --scan --pattern 'service-scheduler:local:dealerships:v1:*' |
  while IFS= read -r key; do
    docker compose exec -T redis redis-cli UNLINK "$key"
  done
```

These maintenance scans run outside request handling. TTL and Redis maxmemory bound retained cache data; arbitrarily deep pagination should be revisited only if measurements justify it. The optional technician-list endpoint/cache has been removed; technician selection and qualification checks remain internal to scheduling. Any old roster-cache entries expire naturally without a cleanup operation. Tests establish query avoidance, not a latency or throughput gain.

Real Redis tests require `TEST_REDIS_URL=redis://127.0.0.1:56380`. Add it to your existing `.env` or supply it for a run:

```sh
npm run db:test:up
TEST_REDIS_URL=redis://127.0.0.1:56380 npm run test:all
```

Existing booking tests leave Redis unconfigured. Catalog integration tests use the dedicated Redis service and unique namespaces shared by their two app instances; cleanup deletes only keys in their owned namespace. A catalog hit replaces one small SELECT with a Redis GET; directory hits avoid their corresponding repository reads, which can involve multiple SQL statements for nested relations. Misses add Redis GET/SET work around those reads. The four-row seeded catalog does not establish a bottleneck, and no latency or throughput improvement is claimed. Verification demonstrates query avoidance and failure behavior; observed results are recorded in [FINAL_REVIEW](docs/FINAL_REVIEW.md).

## Booking idempotency

`POST /api/v1/appointments` requires exactly one UUID v4 `Idempotency-Key`; GET routes do not. A new successful booking returns 201 with `Idempotency-Replayed: false`. Repeating the same key and normalized five-field payload returns 201 with the original saved body and `Idempotency-Replayed: true`, even after restart, changed availability, or the booked start time passing. Each HTTP attempt gets a fresh `x-request-id`. A different payload with a successfully used key returns `409 IDEMPOTENCY_KEY_REUSED`; missing/invalid/repeated headers return `400 VALIDATION_ERROR`.

The claim, appointment, and public response snapshot commit in one PostgreSQL transaction. Concurrent same-key requests wait within the shared booking budget; unresolved waits return `503 BOOKING_TIMEOUT` with `Retry-After: 1`. Business/validation failures and rolled-back attempts do not consume the key. Successful keys are retained indefinitely; there is no expiry job or separate processing record. Resource exclusions and the admission gate retain their original responsibilities.

Frontend clients generate one key per intent (for example `crypto.randomUUID()`), share it across double-clicks/retries, and preserve it until an uncertain outcome is resolved. New keys do not deduplicate the same payload. No frontend is included. See the [idempotency design and limits](docs/IDEMPOTENCY.md) and [executable replay demo](docs/DEMO_GUIDE.md#4-create-and-retrieve-a-confirmed-appointment). This required header is a deliberate client contract change; existing appointments need no backfill.

## Testing and concurrency demonstration

```sh
npm run prisma:validate
npm run build
npm run typecheck
npm run lint
npm run format:check
npm run test:unit
npm run db:test:up
TEST_REDIS_URL=redis://127.0.0.1:56380 npm run test:all
npm run test:e2e
npm run test:concurrency
```

`npm test` runs unit, health HTTP, and a real-driver failed-startup regression without a running database. `test:all` adds PostgreSQL integration tests. Focused e2e/concurrency commands select subsets of that integration suite; do not add their counts together as additional coverage.

Each integration file creates an owned UUID-named database on the dedicated test server, applies actual migrations, seeds, and fixed timeout configuration, and removes that database afterward. It never resets the developer database. The role needs CREATEDB. HTTP tests use the real AppModule/PrismaService and one fixture-owned loopback listener per app, closed during fixture teardown; two app instances have independent ten-connection pools. An injected clock keeps tests independent of wall-clock dates.

The concurrency suite requires exactly one 201 and nineteen 409 responses for twenty distinct customers competing for one pair; two competing requests with two pairs must both commit using distinct resources. Other cases cover technician/bay bottlenecks, adjacency, and bounded retry exhaustion. A test-only barrier forces real reads to race; direct SQL verifies final counts, relationships, qualifications, and zero resource overlaps. No sleeps or mocked database results prove concurrency safety.

A failure is a finding to investigate, not a reason to raise timeouts or loosen invariants. Current command results, initial failures, fixes, fresh-install evidence, and unverified behavior are in FINAL_REVIEW. Prior phase documents are historical milestones, not the current submission status.

## Troubleshooting and limitations

- Startup fails on invalid configuration or unavailable PostgreSQL. Check Compose health, URL/credentials/ports, and `npm run db:check`.
- Integration tests require TEST_DATABASE_URL from `.env.example`; they never substitute DATABASE_URL.
- A 409 after repeated demo requests usually means that interval is occupied. Generate a new future timestamp.
- Availability is advisory. Booking always revalidates; a previous true result is not a reservation.
- This local demo has no authentication, vehicle-overlap exclusion, working hours, cancellation, or concurrent admin workflows. Same-key retries recover the saved successful booking; different keys remain independent booking intents. A lost acknowledgement still has an uncertain outcome until the same key is retried.
- Historical local burst/rate diagnostics are recorded in LOAD_RESULTS; 1,000 successful bookings/second is an unverified future stretch goal, not a submission requirement. Multi-host fault behavior and hosted extension permissions are unverified. Logs are implemented; metrics/tracing are future proposals.
- The 5–10 minute video and final repository publication/access checks remain manual submission steps.

## AI Collaboration Narrative

The developer selected Scenario A, backend-only scope, NestJS/PostgreSQL/Prisma, Vitest, phased approvals, and simple code. AI was directed to inspect first, challenge assumptions, implement only approved scope, and verify against PostgreSQL. The developer reviewed explanations and challenged relationships, date guards, testability abstractions, module exports, package pins, and complexity; final scope and submission ownership remain with the developer.

| Stage                 | AI contribution and review evidence                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requirements analysis | Compared the assessment's three core requirements with SPEC; separated requirements, assumptions, and optional features                                       |
| Architecture planning | Compared a modular monolith, transaction isolation, optimistic versions, locks, and database exclusions; retained concrete repositories and shared scheduling |
| Database modeling     | Added eight models, reviewed SQL CHECK/exclusion constraints, deterministic reference seeds, and actual migration tests                                       |
| Implementation        | Built phases under explicit approvals, with thin controllers, validation, and server-derived resource assignments                                             |
| Concurrency           | Verified real SQLSTATEs and rollback; tested distinct resources and fresh transactions across two app instances                                               |
| Testing               | Added unit, SQL, HTTP, concurrency, and Swagger checks; inspected persisted state rather than trusting response codes alone                                   |
| Debugging             | Corrected actual startup/metadata issues and Prisma error-shape assumptions; distinguished exclusion conflicts from real deadlocks                            |
| Documentation         | Produced design, evidence, and demo documents checked against code and executed commands                                                                      |

An earlier review reproduced exclusion-related deadlock storms and temporarily used selected-resource row locks. The developer subsequently challenged the contention cost, approved conflict-aware insertion with bounded admission/deadlines/backoff, and moved fixed database timeouts out of individual transactions. That implementation is now in commit 40352a1; this Phase 5 merge preserves it. Real PostgreSQL tests verify direct exclusion failures, skipped-insert rollback, fresh allocation, timeout recovery, and the unchanged strict contention assertions. The Phase 5 stash also records a Swagger YAML dependency advisory; its scoped patched override is retained and current audit results are recorded in FINAL_REVIEW.

The developer also selected read-only booking lookups and customer appointment history. AI helped implement bounded PostgreSQL reads and focused HTTP tests while preserving automatic assignment and the original booking contract.

The developer subsequently selected durable idempotency for lost-response recovery. AI helped design atomic key claiming and response snapshots in the existing PostgreSQL transaction, with successful keys retained indefinitely. Key-claim waits are classified separately from allocation retries; replay precedes time/catalog validation. Verification is recorded in [IDEMPOTENCY](docs/IDEMPOTENCY.md), with historical load evidence kept separate.

Earlier findings and command history are recorded in [Phase 1](docs/PHASE_1.md), [Phase 2](docs/PHASE_2.md), [Phase 3](docs/PHASE_3.md), and [Phase 4](docs/PHASE_4.md). Git history and these development records are evidence sources, not proof that every phase is already published remotely. Load diagnostics describe their measured source/configuration only. No video recording, interview outcome, production capacity, or unexecuted verification is claimed.

## Booking capacity and load verification

The assessment resilience criterion is a **100-request burst**: expect 100 confirmations when enough eligible resource/time capacity exists, or exactly one confirmation and 99 availability conflicts when all requests compete for one technician and bay at an identical interval. Verify persisted counts, valid assignments, and zero overlaps, with no overload or technical failures. The mandatory 20-request concurrency regression remains. Client requests launch from a barrier; actual launch spread is measured rather than claiming exact simultaneity.

**1,000 successfully committed bookings/second is an unverified future stretch goal, not a submission requirement or a verified Keyloop traffic need.** Keep one PostgreSQL database and the current safeguards; optimize from measurements. See [load evidence and future benchmarking](docs/CAPACITY_PLAN.md). Burst success does not establish sustained throughput or production capacity.

`.env.example` documents `BOOKING_MAX_CONCURRENT` (default 8, range 1–8), `BOOKING_MAX_PENDING` (default 128, range 0–1000), and `BOOKING_TIMEOUT_MS` (default 5000, range 100–30000). A zero pending limit rejects excess work immediately. These per-process limits protect capacity; PostgreSQL still enforces resource exclusivity across instances. A disconnected queued request is removed. An already executing request may still commit, so a lost client acknowledgement should be recovered by retrying the same key.

The overall booking budget covers queueing, attempts, and backoff. PostgreSQL's fixed five-second limit applies separately to each transaction and is configured once during database setup. Prisma uses the remaining booking budget per attempt. Cleanup and response delivery can exceed the nominal budget; the database limit is not an exact HTTP-response deadline. No timeout-configuration query is issued for each booking.

The load runner requires **k6 2.3.0** in addition to Node and Docker. It creates its own PostgreSQL database and launches separate Node application processes on ephemeral loopback ports. It never targets a supplied/public URL or resets development data. JSON reports under ignored `artifacts/` include failures, latency, admission/DB samples, and direct SQL invariants. Fixture and connection warmup are described in each report; the default burst uses warm HTTP connections, while the rate profile starts cold and reuses connections thereafter.

```sh
npm run db:test:up
k6 version
npm run test:load -- --mode burst --count 100 --workload spread --report artifacts/burst.json
npm run test:load -- --mode burst --count 100 --workload same-resource --report artifacts/adjacent.json
npm run test:load -- --mode burst --count 100 --workload hotspot --report artifacts/hotspot.json
```

Optional future stretch investigation, separate from submission acceptance (a configured rate is not measured successful-booking throughput):

```sh
npm run test:load -- --mode rate --rate 1000 --duration 60 --instances 4 --workload spread --report artifacts/stretch-1000.json
```

The successful profile uses distinct intervals across twenty fixture dealerships. Customers/vehicles are synthetic and reused at different intervals; the injected test clock keeps fixtures deterministic. The hotspot profile expects one confirmed row and the remaining requests to receive 409. Overload, dropped arrivals, wrong counts or broken database invariants fail the target profile. Reports distinguish all responses from successful bookings. Latency is measured, with no unagreed production SLO implied. See [concurrency design and evidence](docs/CONCURRENCY_PROPOSAL.md).

Historical local evidence from earlier source/configuration snapshots: all final 100-request burst shapes passed; the two-process 500-RPS / 60-second control passed with 30,001 confirmed rows and no errors/overload. The earlier 1,000-RPS minute target **did not pass**, including at four processes. Increasing the bounded pending queue to 256 made latency and dropped arrivals worse, so the default stays 128. Under the former, now-withdrawn target, a five-second 10,000-RPS diagnostic also failed, including generator saturation and transport errors. See [all retained results and limitations](docs/LOAD_RESULTS.md). These runs do not establish current-source or production capacity. No load tests were rerun for that documentation-only goal revision. The subsequent idempotency implementation has its own [current burst verification](docs/IDEMPOTENCY.md#executed-evidence--2026-11-04), separate from historical rate results.

The main bootstrap and HTTP fixtures share 65-second HTTP keep-alive / 66-second header-timeout settings. These must be considered alongside actual proxy/client idle limits in deployment. Compiled startup and /health were checked; no deployment or repository publication was performed.
