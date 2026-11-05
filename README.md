# Keyloop Service Scheduler

A backend for **Keyloop Scenario A**: book a vehicle service at a dealership for a requested time. The server calculates the duration, assigns a qualified technician and an available bay for the entire interval, and saves a confirmed appointment.

The service is a modular monolith built with **NestJS, TypeScript, PostgreSQL, Prisma, Redis, and Vitest**. Controllers stay thin; application use cases coordinate booking transactions.

## Engineering highlights

- **Database-enforced booking safety.** PostgreSQL exclusion constraints prevent overlapping confirmed appointments for either resource, including across app instances. Adjacent appointments remain valid.
- **Durable idempotency.** Retrying the same key and equivalent booking payload returns the original saved response. The key, appointment, and response commit together in PostgreSQL.
- **Bounded concurrency.** Admission limits, a shared booking budget, and bounded retries in fresh transactions protect the database during bursts.
- **Shared reference caching.** Redis cache-aside serves service types and dealership pages with a five-minute TTL and PostgreSQL fallback. Booking and availability always use authoritative database data.

[System design and diagrams](docs/SYSTEM_DESIGN.md) · [Specification](docs/SPEC.md) · [Verification evidence](docs/FINAL_REVIEW.md)

## First installation

Requires **Node.js 24.21.0**, **npm 11.x**, and **Docker with Compose v2**. The Node version is also in `.nvmrc`.

From the project root on a new checkout (keep your existing `.env` if already configured):

```sh
cp .env.example .env
npm ci
npm run setup:local
npm start
```

`setup:local` starts PostgreSQL and Redis, generates the Prisma client and builds the app, applies committed migrations, seeds reference data, and configures database timeouts. It stops if a step fails and does not reset existing data.

Open **[Swagger UI](http://localhost:3000/docs)** to explore and execute requests. Health is at [`/health`](http://localhost:3000/health); the OpenAPI contract is at [`/docs-json`](http://localhost:3000/docs-json).

### Start again

After the first installation:

```sh
docker compose up -d --wait postgres redis
npm start
```

For development, replace `npm start` with `npm run start:dev`. Otherwise, rebuild after code changes with `npm run build`. Stop the app with Ctrl-C and local services with `npm run db:down`; PostgreSQL's volume is retained.

Configuration defaults are in [`.env.example`](.env.example). Clear `REDIS_URL` to bypass caching and read PostgreSQL directly. When enabled, `CATALOG_CACHE_NAMESPACE` is required; replicas for the same database share a namespace, while separate environments use different ones.

Use the committed migrations: they contain SQL constraints that `prisma db push` would not reproduce. `db:configure` applies fixed database timeouts without changing data. For connection problems, run `npm run db:check`; see [database setup](docs/DATABASE.md#fixed-database-timeouts).

## Try a booking

In Swagger, fetch a customer, their owned vehicle, a dealership, and a service type. Check availability, create the appointment, then retrieve it or view the customer's appointment history. Availability is advisory; creation revalidates and assigns resources automatically.

Send `POST /api/v1/appointments` with a UUID v4 **`Idempotency-Key`** header and these five fields. This example uses [seeded IDs](docs/DATABASE.md#deterministic-reference-fixtures); choose a future, unused start time:

```json
{
  "customerId": "20000000-0000-4000-8000-000000000001",
  "vehicleId": "30000000-0000-4000-8000-000000000001",
  "dealershipId": "10000000-0000-4000-8000-000000000001",
  "serviceTypeId": "40000000-0000-4000-8000-000000000001",
  "startAt": "2035-01-15T10:00:00.000Z"
}
```

A successful response is `201` with the appointment ID, assigned resource IDs, status, and UTC timestamps including the derived end time. Retrying the same key and equivalent payload returns the saved response with `Idempotency-Replayed: true`; changing the payload under a successful key returns `409 IDEMPOTENCY_KEY_REUSED`. Keep the same key after a timeout or lost response. Different keys represent independent booking intents.

Swagger documents all routes, response schemas, and errors and lets you execute requests directly.

## Build and test

After installation, run the checks and start the dedicated test services:

```sh
npm run prisma:validate
npm run build
npm run typecheck
npm run lint
npm run format:check
npm run db:test:up
TEST_REDIS_URL=redis://127.0.0.1:56380 npm run test:all
```

`test:all` runs unit tests, HTTP checks, and real PostgreSQL/Redis integration suites. Fixtures create and remove isolated test databases and Redis namespaces using `TEST_DATABASE_URL` and `TEST_REDIS_URL`; they do not reset development data. The test database role needs permission to create databases.

For a quick check without running services, use `npm test`. To run the focused database concurrency suite, use `npm run test:concurrency` after starting test services. It includes the mandatory **20 competing requests → one confirmation and 19 conflicts**, plus direct database invariant checks. Other integration cases cover rollback, resource eligibility, multi-instance idempotency, cache hits, invalidation, and Redis failure fallback.

The separate **100-request burst** verification covers sufficient capacity and sold-out contention. [Load results](docs/LOAD_RESULTS.md) and [holiday surge experiments](docs/HOLIDAY_PEAK.md) retain measured outcomes, failed trials, and environment limits. These local bursts do not establish sustained throughput or production capacity.

Optional capacity investigation, requiring k6: `npm run test:capacity -- --report artifacts/capacity-run-1.json` offers 1,000 booking requests/second for five minutes. This is separate from `test:all`; the target remains unverified. See the [capacity procedure and acceptance checks](docs/LOAD_RESULTS.md#repeatable-capacity-check).

## AI Collaboration Narrative

**Strategy.** I used Codex to assist with requirements review, design alternatives, implementation, tests, and documentation. I set the backend scope and stack, required repository inspection before changes, and approved work in small phases. Correct booking and understandable code took priority over feature count.

**Review and refinement.** I challenged proposed abstractions, locking costs, throughput assumptions, and optional endpoints. The design evolved from temporary resource-row locking to conflict-aware insertion with database exclusions and bounded retries. I also narrowed Redis to shared reference lists and removed technician listing because booking assigns resources automatically.

**Verification.** Generated code was checked with typechecking, linting, builds, and tests against real PostgreSQL and Redis. Concurrency tests inspect persisted rows and constraints, not only HTTP statuses. Reviews corrected actual issues, including Prisma error-shape assumptions and a duplicate load-worker listener startup. Failed load trials and unverified claims remain visible in the evidence documents.

I retain responsibility for reviewing the final code, understanding the trade-offs, and deciding the submission scope. The [design narrative](docs/SYSTEM_DESIGN.md#ai-use-during-design) and [verification record](docs/FINAL_REVIEW.md) provide the detailed decisions and observed results.

## Scope and trade-offs

This is an unauthenticated assessment demo. Customer lookup supports Swagger exploration; production customer access requires authorization. Working hours, cancellation, and vehicle-overlap prevention are outside the implemented scope.

Cached reference lists are eventually consistent; hits do not extend TTL. Controlled updates can refresh the catalog or invalidate dealership pages after commit, but no update API or automatic synchronization is implemented. Redis tests demonstrate query avoidance and failure handling; no latency improvement is claimed for the small seeded dataset.

For deeper review:

- [Specification and API contracts](docs/SPEC.md)
- [Database rules and seed fixtures](docs/DATABASE.md)
- [Idempotency design and limitations](docs/IDEMPOTENCY.md)
- [Cache behavior and maintenance](docs/SYSTEM_DESIGN.md#redis-caching)
- [Development archive](docs/archive/README.md): historical plans, drafts, and verification records.
