# Keyloop Service Scheduler

Backend-only submission for Keyloop Scenario A. **Current milestone: Phase 4 booking API and concurrency.** Appointment creation, retrieval, and availability APIs are implemented, with transactional confirmation, database overlap protection, and bounded conflict retries. The complete proposed contract is in [docs/SPEC.md](docs/SPEC.md); implementation evidence and limitations are recorded in [docs/PHASE_4.md](docs/PHASE_4.md). See [docs/SYSTEM_DESIGN.md](docs/SYSTEM_DESIGN.md) for architecture and data flow.

## Foundation design

One NestJS process, organized as a modular monolith: `AppModule` composes configuration, HTTP validation/error handling, `HealthModule`, `DatabaseModule`, `SchedulingModule`, and `AppointmentsModule`. Prisma verifies PostgreSQL with a startup query and disconnects during graceful shutdown. Startup fails if configuration or the database connection is invalid.

`GET /health` returns `200` and `{"status":"ok"}`. This is process liveness, not a continuous database-readiness check. Database connectivity is verified separately with `npm run db:check`; no SQL error or credentials are returned by that script.

The Prisma schema defines Dealership, Customer, Vehicle, ServiceType, Technician, TechnicianQualification, ServiceBay, and Appointment. Reviewed SQL adds CHECK constraints and independent partial GiST exclusions for technician and bay overlaps. See [docs/DATABASE.md](docs/DATABASE.md) for enforcement boundaries, migration risks, fixture IDs, and test evidence. Phase 4 additionally tests allocation and retry behavior through HTTP against PostgreSQL.

`SchedulingModule` owns the shared availability use case and deterministic selection of the smallest eligible technician and bay IDs. Only overlapping `CONFIRMED` appointments block resources; adjacency is allowed. GET availability performs four SQL reads without queries per candidate. Its independent reads provide advisory availability, not a transactionally consistent snapshot or reservation. Booking passes its transaction client into the same use case and queries, revalidating references, ownership, service status, and resource eligibility on every attempt. A `201` is returned only after commit. Exclusion violations and explicit aborted-transaction conflicts can retry in a fresh transaction, up to four total attempts by default.

## Prerequisites and pinned tools

- Node.js **24.21.0** (`nvm install && nvm use` reads `.nvmrc`).
- npm **11.19.0** (package manager used to produce the lockfile).
- Docker Engine with Docker Compose v2.
- PostgreSQL image **17.6-alpine**; local app connects through port **55432** by default.

Direct packages are exact-pinned in `package.json`, with transitive versions in `package-lock.json`. NestJS **11.2.8**, TypeScript **5.9.3**, and Prisma/client **7.10.1** use a straightforward CommonJS setup. Prisma 7 uses the PostgreSQL driver adapter and `prisma.config.ts`; environment loading is explicit for CLI commands. Patched versions were selected after an initial dependency audit. A scoped override pins Nest's Multer dependency to 2.5.0 to address its reported denial-of-service advisory; there are no upload endpoints. Future major upgrades require separate compatibility verification. Vitest is the single test runner. Tests import their APIs explicitly; the SWC test transform preserves Nest decorator metadata, following the [NestJS Vitest recipe](https://docs.nestjs.com/recipes/swc#vitest). The build uses TypeScript directly; no global Nest CLI is needed.

## Local setup

From the repository root:

```sh
nvm install
nvm use
cp .env.example .env
npm ci
npm run prisma:generate
npm run db:up
npm run prisma:validate
npm run db:migrate
npm run db:seed
npm run db:check
npm run build
npm start
```

In another terminal:

```sh
curl --fail http://localhost:3000/health
```

For development after initial setup (Node watch mode with ts-node preserves the decorator metadata Nest needs for dependency injection):

```sh
npm run start:dev
```

`.env` is ignored. Example credentials are disposable local development values, not production credentials. Compose binds PostgreSQL only to `127.0.0.1` and uses its own named volume. Keep `DATABASE_URL` aligned with the `POSTGRES_*` values. URL-encode special characters in database credentials. Changing database credentials in `.env` does not change an already initialized volume; use a fresh database/volume or explicitly administer that database.

`PORT` must be an integer from 1 to 65535; `NODE_ENV` is development, test, or production; `DATABASE_URL` must be a PostgreSQL URL with a host and database. `BOOKING_MAX_ATTEMPTS` defaults to 4 total attempts, with a validated range of 1–10. The Prisma PostgreSQL adapter uses a pool of 10 connections and bounds connection acquisition to five seconds. A booking transaction has a five-second acquisition wait and a ten-second execution limit.

## Booking API

Routes:

- `POST /api/v1/appointments`: validate input and atomically confirm an appointment (`201`).
- `GET /api/v1/appointments/:id`: retrieve a persisted appointment (`200`).
- `GET /api/v1/dealerships/:dealershipId/availability`: read-only availability (`200`).

After migrations and seeding, check availability and create a booking using the stable demo IDs:

```sh
curl --get http://localhost:3000/api/v1/dealerships/10000000-0000-4000-8000-000000000001/availability \
  --data-urlencode 'serviceTypeId=40000000-0000-4000-8000-000000000001' \
  --data-urlencode 'startAt=2035-01-15T10:00:00Z'

curl -i http://localhost:3000/api/v1/appointments \
  -H 'Content-Type: application/json' \
  --data '{"customerId":"20000000-0000-4000-8000-000000000001","vehicleId":"30000000-0000-4000-8000-000000000001","dealershipId":"10000000-0000-4000-8000-000000000001","serviceTypeId":"40000000-0000-4000-8000-000000000001","startAt":"2035-01-15T10:00:00Z"}'

# Replace <appointment-id> with the ID returned above.
curl 'http://localhost:3000/api/v1/appointments/<appointment-id>'
```

The oil-change fixture lasts 30 minutes. Demo dates must remain in the future relative to the server. Repeating the POST can consume the second qualified technician/bay pair, then returns `409`; there are no idempotency keys or vehicle-level overlap restrictions in P0.

Unknown POST/query fields are rejected, including client-supplied technician, bay, duration, end time, or status. UUIDs must be valid; timestamps must include seconds and `Z` or a colon-separated UTC offset, with at most three fractional digits. Invalid dates are rejected rather than normalized. Responses serialize dates in UTC with milliseconds. DTO validation uses pinned `class-validator` 0.14.4 and `class-transformer` 0.5.1 through Nest's standard validation pipe.

Errors consistently use `{ "error": { "code": "...", "message": "..." }, "requestId": "..." }`; validation errors can include a `details` array. HTTP statuses are 400 for malformed input, 404 for missing references, 422 for business rules, 409 for settled unavailability, 503 for unresolved contention or recognized temporary database failure, and 500 for unexpected failures. Every routed response has a server-generated `x-request-id`; error bodies include the same ID. A 503 includes `Retry-After: 1`. SQL statements, connection details, and stack traces are not returned. Availability snapshots never reserve resources.

## Verification

```sh
npm run build
npm run typecheck
npm run lint
npm run format:check
npm test
npm run prisma:validate
npm run db:check
```

`npm test` runs configuration, scheduling, booking orchestration, and error-classification unit tests, an isolated HTTP contract suite for the health module, and a real-driver regression proving startup rejects an unreachable database. These tests do not require a running PostgreSQL server; the startup-failure regression uses an unreachable local port. Unit mocks do not prove transactional or concurrency behavior. `npm run db:check` executes an actual `SELECT 1` through Prisma against the configured database and exits nonzero on failure. `npm run test:unit` and `npm run test:http` select unit and health suites.

Database integration checks run separately against the dedicated test service:

```sh
# Add TEST_DATABASE_URL from .env.example to an existing .env first.
npm run db:test:up
npm run test:integration

# Optional focused runs; included in test:integration above.
npm run test:e2e
npm run test:concurrency
```

Each integration file creates a fresh UUID-named database, applies committed migrations using `prisma migrate deploy`, runs `prisma db seed`, tests real constraints, scheduling queries, or booking APIs, and drops only its own database afterward. HTTP tests use the actual AppModule and PrismaService against PostgreSQL. Concurrency checks use two Nest app instances with separate ten-connection pools, independent customers/vehicles, and direct database invariant assertions. A test-only barrier forces two real candidate reads to race, demonstrating a verified database conflict and a fresh-transaction retry without sleeps. `TEST_DATABASE_URL` is required and must name `service_scheduler_test` on the dedicated test server (default port 55433); the test role needs permission to create databases. No reset or truncation runs against the developer database. `npm run test:all` runs both suites when the test server is available. Stop/remove the test container with `docker compose --profile test rm --stop --force postgres-test`; it has disposable tmpfs storage.

Use `npm run db:migrate` and `npm run db:seed` for local development after schema changes. Seed reruns insert missing fixtures without overwriting existing edits or deleting appointments. Do not use `prisma db push` as a replacement for migrations: it cannot reconstruct the SQL-only overlap constraints.

Formatting is explicit (`npm run format`); lint and format checks do not modify files. Existing assessment documents are excluded from automatic formatting. Foundation history is recorded in [docs/PHASE_1.md](docs/PHASE_1.md), database verification in [docs/PHASE_2.md](docs/PHASE_2.md), scheduling verification in [docs/PHASE_3.md](docs/PHASE_3.md), and booking verification in [docs/PHASE_4.md](docs/PHASE_4.md); results apply only to the documented environment and commands.

Stop the app with Ctrl-C. Stop PostgreSQL without deleting its volume:

```sh
npm run db:down
```

Do not remove the volume unless you intend to delete its data. If startup fails, check configuration, `docker compose ps`, host port availability, and `npm run db:check`.

## AI Collaboration Narrative

The developer selected Scenario A, requested critical design reviews, and approved foundation work, then database/domain modeling as a separate phase. AI inspected the original assessment and the spec, raised risks around transaction retries and the evidence needed to prove overlap protection, and then created this scaffold within the approved boundary. No E-commerce source was modified or copied into this application. The developer retains ownership of scope and subsequent implementation decisions.

A follow-up review reproduced and corrected two foundation bugs: the original development runner omitted Nest constructor metadata, and the Prisma adapter created its pool lazily, so a startup query was needed to verify connectivity. Phase 1 verification consists of commands actually executed, documented in the milestone record. Unit/health tests are separate from real PostgreSQL connectivity checks. Phase 2 adds actual migration, seed, constraint, and competing-SQL-write verification. Its first test run exposed an incorrect assumption about the Prisma adapter error shape; assertions were corrected against observed PostgreSQL SQLSTATEs.

The developer then approved Phase 3 read-only scheduling. AI verified the existing 49 database tests before changes, identified the spec roadmap's different phase numbering/API scope, and implemented only the latest approved scope. Scheduling unit tests and real PostgreSQL eligibility tests exercise candidate selection; query logging verifies the fixed query count. An initial lint failure in test mock declarations was corrected. Developer review led to simpler date guards and additional time-boundary tests.

For Phase 4, AI first reran all existing tests (49 default / 71 PostgreSQL) and inspected actual exclusion failures. ORM inserts exposed Prisma `P2039` with SQLSTATE `23P01`, whereas the earlier raw-query tests used `P2010`; classification uses the verified underlying SQLSTATE. The developer's approved scope guided three thin HTTP endpoints, shared transaction-aware scheduling queries, and bounded retries. Tests force a genuine allocation race, demonstrate alternate-pair recovery across two app instances, and verify final database invariants. The new tests also exercise rollback, a real deadlock, connection refusal, and retrieval after application restart. A diagnostic seed probe initially lacked the npm binary PATH; it was rerun with that PATH and its disposable database cleaned up. A test instrumentation type error was fixed by exposing an ordinary Promise from the concrete repository's create method; no database behavior was mocked to make the tests pass. Actual command results and limits are recorded in the phase document. The required 5–10 minute demonstration video and later approved phases remain unfinished.

A follow-up simplicity review separated transaction work from the retry loop and removed duplicate HTTP error mapping. Its rerun caught an overly narrow concurrency assertion: PostgreSQL sometimes resolves the forced race with a deadlock (`40P01`/`P2034`), which production already retried correctly. Tests now check both verified conflict outcomes while retaining the database invariants; the corrected race test passed five consecutive focused runs.
