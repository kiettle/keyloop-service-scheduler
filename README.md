# Keyloop Unified Service Scheduler

Backend-only implementation of **Keyloop Scenario A**. A customer requests a service for a vehicle at a dealership and time; the backend assigns a qualified technician and an available bay for the full catalog duration, then persists a CONFIRMED appointment.

| Keyloop requirement                          | Implementation                                                                            |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Resource-constrained booking                 | Validated POST; automatic technician/bay assignment                                       |
| Availability for the entire service duration | Qualification/active/dealership filters, half-open overlap queries, PostgreSQL exclusions |
| Persistent confirmed associations            | Atomic appointment row and retrieval after app restart                                    |

Implemented: booking, retrieval, advisory availability, strict validation, safe errors, structured logs/request IDs, bounded fresh-transaction retries, Swagger, reproducible seeds/migrations, and real PostgreSQL/HTTP/concurrency tests. No optional business features are implemented.

- [System design and diagrams](docs/SYSTEM_DESIGN.md)
- [Requirements, executed evidence, and submission readiness](docs/FINAL_REVIEW.md)
- [Reproducible demo and video outline](docs/DEMO_GUIDE.md)
- [Detailed database rules and fixture IDs](docs/DATABASE.md)

## Stack and architecture

NestJS **11.2.8**, TypeScript **5.9.3**, Prisma/client/adapter **7.10.1**, PostgreSQL **17.6-alpine**, Vitest **4.1.11**, and Swagger **11.4.7**. Direct versions are pinned; commit `package-lock.json` and use `npm ci`. A scoped override pins Swagger's js-yaml to patched 5.4.1; the existing Nest/Multer override is retained. Audits and their limits are recorded in the final review.

One modular monolith: thin controllers call application use cases; concrete repositories own SQL/transactions; shared scheduling owns interval and selection rules. HTTP validation/filter/logging and Prisma connection lifecycle are shared infrastructure. No generic repository framework or additional services.

Booking uses READ COMMITTED and a single-item conflict-aware insert with both GiST exclusions. A skipped resource-conflict insert rolls back before a fresh allocation attempt; an identity collision remains unexpected. There are no explicit resource-row locks. Four total attempts with jittered backoff is the default; settled exhaustion is 409 and unresolved contention is 503. Success follows commit. A bounded per-process queue protects capacity, and all attempts share one booking deadline.

## Prerequisites

- Node.js **24.21.0**, npm **11.19.0**; `.nvmrc` and package engines describe the supported versions.
- Docker Engine with Docker Compose v2.
- `curl` for the demo. Demo JSON generation uses Node, not jq.

Verification covers the available macOS arm64 environment and PostgreSQL Docker image. Installing prerequisites on another host is outside the recorded checks; no cross-platform or hosted deployment claim is made.

## First installation

From a new checkout:

```sh
node --version
npm --version
cp .env.example .env
npm ci
npm run prisma:generate
npm run db:up
npm run prisma:validate
npm run db:migrate
npm run db:seed
npm run db:configure
npm run db:check
npm run build
npm start
```

Do not overwrite an existing `.env`. The clean-install check uses the complete current submission candidate in an isolated temporary copy, with a separate Compose project/volume and available ports. See FINAL_REVIEW for the distinction between that check and a committed-checkout/GitHub handoff.

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

`.env` is ignored. Example credentials are disposable local values, not production secrets. Compose binds PostgreSQL to loopback. URL-encode special credential characters; changing `.env` credentials does not update an already initialized database volume. Runtime pools have ten connections and a five-second connection acquisition timeout. Booking acquisition waits at most one second or the remaining budget; Prisma transaction timeout uses the budget remaining at the start of each attempt.

`npm run db:configure` sets PostgreSQL role/database defaults of 250 ms lock, 2 s statement, and 5 s transaction timeout. It is repeatable and changes no tables/data. Restart the app afterward so new connections inherit the defaults. No timeout-configuration query is sent per booking. Fixed database limits and the shared booking deadline are separate; cleanup, commit, and network time can exceed the nominal request budget. The local role is shared with CLI tasks, so later migration/seed sessions inherit these defaults too. Use separate administrative connections for longer maintenance work. See [database setup](docs/DATABASE.md#fixed-database-timeouts).

## API contracts and examples

| Route                                                | Success | Description                                                      |
| ---------------------------------------------------- | ------- | ---------------------------------------------------------------- |
| `POST /api/v1/appointments`                          | 201     | Confirm and assign both resources after commit                   |
| `GET /api/v1/appointments/:id`                       | 200     | Retrieve all public association IDs, interval, status, createdAt |
| `GET /api/v1/dealerships/:dealershipId/availability` | 200     | Read-only full-duration availability and counts                  |
| `GET /health`                                        | 200     | Process liveness, not continuous database readiness              |

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

The example time must be future relative to the server. The demo guide generates a fresh future timestamp and supplies exact cURL commands. Success includes a generated appointment ID, all association IDs, derived endAt, CONFIRMED status, and createdAt. Dates serialize as ISO UTC with milliseconds. GET availability returns interval, boolean, and technician/bay counts; its internal candidate IDs are omitted.

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

400 = malformed input; 404 = missing reference; 422 = business validation; 409 = settled resource exhaustion; 503 = admission exhaustion, expired booking budget, unresolved contention, or recognized temporary database failure; 500 = unexpected failure. Availability uses the same safe temporary/unexpected error policy. Validation may add a details array. Business API responses include `x-request-id`; 503 adds `Retry-After: 1`. SQL, credentials, and stacks are not exposed.

## Testing and concurrency demonstration

```sh
npm run prisma:validate
npm run build
npm run typecheck
npm run lint
npm run format:check
npm run test:unit
npm run db:test:up
npm run test:all
npm run test:e2e
npm run test:concurrency
```

`npm test` runs unit, health HTTP, and a real-driver failed-startup regression without a running database. `test:all` adds PostgreSQL integration tests. Focused e2e/concurrency commands select subsets of that integration suite; do not add their counts together as additional coverage.

Each integration file creates an owned UUID-named database on the dedicated test server, applies actual migrations, seeds, and fixed timeout configuration, and removes that database afterward. It never resets the developer database. The role needs CREATEDB. HTTP tests use the real AppModule/PrismaService; two app instances have independent ten-connection pools. An injected clock keeps tests independent of wall-clock dates.

The concurrency suite requires exactly one 201 and nineteen 409 responses for twenty distinct customers competing for one pair; two competing requests with two pairs must both commit using distinct resources. Other cases cover technician/bay bottlenecks, adjacency, and bounded retry exhaustion. A test-only barrier forces real reads to race; direct SQL verifies final counts, relationships, qualifications, and zero resource overlaps. No sleeps or mocked database results prove concurrency safety.

A failure is a finding to investigate, not a reason to raise timeouts or loosen invariants. Current command results, initial failures, fixes, fresh-install evidence, and unverified behavior are in FINAL_REVIEW. Prior phase documents are historical milestones, not the current submission status.

## Troubleshooting and limitations

- Startup fails on invalid configuration or unavailable PostgreSQL. Check Compose health, URL/credentials/ports, and `npm run db:check`.
- Integration tests require TEST_DATABASE_URL from `.env.example`; they never substitute DATABASE_URL.
- A 409 after repeated demo requests usually means that interval is occupied. Generate a new future timestamp.
- Availability is advisory. Booking always revalidates; a previous true result is not a reservation.
- This local demo has no authentication, durable request idempotency, vehicle-overlap exclusion, working hours, cancellation, or concurrent admin workflows. Repeating a client request can create another booking. A lost commit acknowledgement may have an unknown complete outcome.
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

Earlier findings and command history are recorded in [Phase 1](docs/PHASE_1.md), [Phase 2](docs/PHASE_2.md), [Phase 3](docs/PHASE_3.md), and [Phase 4](docs/PHASE_4.md). Git history and these development records are evidence sources, not proof that every phase is already published remotely. Load diagnostics describe their measured source/configuration only. No video recording, interview outcome, production capacity, or unexecuted verification is claimed.

## Booking capacity and load verification

The assessment resilience criterion is a **100-request burst**: expect 100 confirmations when enough eligible resource/time capacity exists, or exactly one confirmation and 99 availability conflicts when all requests compete for one technician and bay at an identical interval. Verify persisted counts, valid assignments, and zero overlaps, with no overload or technical failures. The mandatory 20-request concurrency regression remains. Client requests launch from a barrier; actual launch spread is measured rather than claiming exact simultaneity.

**1,000 successfully committed bookings/second is an unverified future stretch goal, not a submission requirement or a verified Keyloop traffic need.** Keep one PostgreSQL database and the current safeguards; optimize from measurements. See [load evidence and future benchmarking](docs/CAPACITY_PLAN.md). Burst success does not establish sustained throughput or production capacity.

`.env.example` documents `BOOKING_MAX_CONCURRENT` (default 8, range 1–8), `BOOKING_MAX_PENDING` (default 128, range 0–1000), and `BOOKING_TIMEOUT_MS` (default 5000, range 100–30000). A zero pending limit rejects excess work immediately. These per-process limits protect capacity; PostgreSQL still enforces resource exclusivity across instances. A disconnected queued request is removed. An already executing request may still commit, so a lost client acknowledgement remains ambiguous without durable idempotency.

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

Historical local evidence from earlier source/configuration snapshots: all final 100-request burst shapes passed; the two-process 500-RPS / 60-second control passed with 30,001 confirmed rows and no errors/overload. The earlier 1,000-RPS minute target **did not pass**, including at four processes. Increasing the bounded pending queue to 256 made latency and dropped arrivals worse, so the default stays 128. Under the former, now-withdrawn target, a five-second 10,000-RPS diagnostic also failed, including generator saturation and transport errors. See [all retained results and limitations](docs/LOAD_RESULTS.md). These runs do not establish current-source or production capacity. No load tests were rerun for the 2026-11-04 documentation-only goal revision.

The main bootstrap and HTTP fixtures share 65-second HTTP keep-alive / 66-second header-timeout settings. These must be considered alongside actual proxy/client idle limits in deployment. Compiled startup and /health were checked; no deployment or repository publication was performed.
