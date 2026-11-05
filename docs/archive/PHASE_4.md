# Phase 4 — Booking API and concurrency

> Historical planning or verification record; statements apply to their recorded source and date. Use the [current specification](../SPEC.md), [system design](../SYSTEM_DESIGN.md), and [verification summary](../FINAL_REVIEW.md) for current behavior.

> Historical milestone and follow-up review. The later approved conflict-aware insertion/capacity implementation and current verification are in [CONCURRENCY_PROPOSAL.md](CONCURRENCY_PROPOSAL.md).

Date: 2026-11-03, Asia/Ho_Chi_Minh. Scope: booking, retrieval, availability HTTP APIs; atomic confirmation; bounded retries; structured logs; and real PostgreSQL/HTTP/concurrency evidence. Phase 5 and optional features are not started.

## Review before changes

- Read AGENTS.md, the spec's contracts/invariants/acceptance criteria, and the existing modules, schema, migration, fixtures, and tests. Existing Phase 3 changes were already staged by the developer; they were preserved without staging, committing, resetting, or switching branches.
- Executed `npm run db:test:up && npm run test:all` before implementation: **49 default tests and 71 PostgreSQL tests passed**. The actual committed migration and seed were applied to clean test databases. Tests inspected both named immediate partial GiST exclusions and `btree_gist`.
- Reused the Phase 3 interval calculation, qualification/active/dealership/overlap predicates, stable selection, and injectable clock. Added an optional transaction client to the shared use case and repository methods, avoiding a second allocation algorithm. When booking supplies a client, every scheduling query uses it.
- The spec roadmap labels scheduling/atomic booking with different phase numbers; the latest explicit Phase 4 instruction controls this milestone. Availability and retrieval are explicitly approved here, despite general priority guidance that defers them.
- The internal `SERVICE_TYPE_INACTIVE` scheduling error maps to the spec's HTTP `422 BUSINESS_RULE_VIOLATION`. `SERVICE_UNAVAILABLE` is an additional documented code for recognized temporary database failures, separate from `BOOKING_CONTENTION` and `NO_AVAILABILITY`.
- No schema, migration, seed, or exclusion changes were needed. No microservices or optional infrastructure were added.

## Implemented files and responsibilities

| Files                                                                                                | Responsibility                                                                                                               |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `src/appointments/appointments.module.ts`, `appointments.controller.ts`, `create-appointment.dto.ts` | Thin POST/GET handlers, typed DTOs, validated UUIDs and required/allowed fields                                              |
| `src/appointments/create-appointment.use-case.ts`                                                    | Reference/ownership checks, transaction coordination, shared allocation, bounded fresh-attempt retries, booking outcome logs |
| `src/appointments/get-appointment.use-case.ts`                                                       | Retrieve the committed appointment or report not found                                                                       |
| `src/appointments/appointment.repository.ts`                                                         | Concrete Prisma transaction boundary and customer/vehicle/appointment queries; return only public appointment fields         |
| `src/appointments/database-error.ts`, `booking.error.ts`                                             | Narrow database classification and application outcomes                                                                      |
| `src/scheduling/availability.controller.ts`, `availability.dto.ts`                                   | Read-only availability HTTP contract and shared timestamp/service validation                                                 |
| Existing scheduling use case/repository/module                                                       | Pass the transaction client through existing reads; register the availability controller                                     |
| `src/common/http/*`                                                                                  | Global DTO validation, consistent exception responses, generated request IDs, correlated request logs                        |
| `src/app.module.ts`, `src/main.ts`                                                                   | Register modules; use Nest's JSON console logger at runtime                                                                  |
| `src/config/environment.ts`, `.env.example`                                                          | Validate `BOOKING_MAX_ATTEMPTS`, default 4, range 1–10                                                                       |
| `package.json`, `package-lock.json`                                                                  | Pin `class-validator` 0.14.4 and `class-transformer` 0.5.1; add focused e2e/concurrency commands                             |
| `test/unit/create-appointment.spec.ts`, `database-error.spec.ts`, `test/environment.spec.ts`         | Orchestration, fresh transaction/reallocation, retry limits, classification, environment validation                          |
| `test/helpers/booking-app.ts`, `test/integration/booking-api.spec.ts`, `booking-concurrency.spec.ts` | Actual AppModule/PrismaService HTTP tests, clean fixtures, concurrent requests, direct PostgreSQL assertions                 |
| AGENTS.md, README.md, DATABASE.md, SYSTEM_DESIGN.md, this record                                     | Approved phase boundary, commands/examples, design decisions, actual results and limits                                      |

## API policy

- `POST /api/v1/appointments` returns `201` after commit, including all associations, interval, `CONFIRMED` status, and `createdAt`.
- `GET /api/v1/appointments/:id` returns the persisted public record. Associations are represented by their IDs, matching the create response; no nested administrative data is exposed.
- `GET /api/v1/dealerships/:dealershipId/availability` returns the spec's interval, counts, and boolean. Candidate IDs remain internal. It performs no writes or reservations.
- The existing `/health` remains unprefixed and unchanged.
- Only the five specified POST fields and two specified availability query fields are accepted. Client-supplied assignment, duration, end, and status are rejected. No implicit type conversion accepts numeric identifiers as strings.
- Timestamps use a four-digit calendar year, seconds, optional 1–3 fractional digits, and `Z` or a `±HH:MM` offset. Strict calendar and time validation rejects invalid dates, missing offsets, and excess precision rather than silently truncating. This explicit millisecond-precision input policy matches the database/JavaScript model; the spec does not prescribe accepting higher input precision.
- Malformed input returns `400 VALIDATION_ERROR`; nonfuture valid times return `422 INVALID_BOOKING_TIME`; missing records return entity-specific 404s; ownership/inactive-service failures return `422 BUSINESS_RULE_VIOLATION`; empty candidate sets return `409 NO_AVAILABILITY`; exhausted conflicts return `503 BOOKING_CONTENTION`; recognized temporary connection/pool failures return `503 SERVICE_UNAVAILABLE`; unexpected failures return `500 INTERNAL_ERROR`.
- Error bodies use `{ error: { code, message, details? }, requestId }`. Only DTO validation adds an optional array of safe validation messages. Headers include the server-generated `x-request-id`; 503 adds `Retry-After: 1`. SQL, credentials, raw database messages, and stacks are never returned.

## Transaction and retry policy

Each attempt opens a fresh Prisma interactive transaction at READ COMMITTED, with a 5-second acquisition wait and 10-second execution limit. It loads customer/vehicle, validates ownership, invokes the shared scheduling use case using that same transaction client, and inserts one complete CONFIRMED appointment. Reference data is revalidated on every attempt. There are no external calls inside the transaction. The transaction Promise must resolve after commit before the controller can return success.

Database exclusions remain the final authority for technician and bay exclusivity. READ COMMITTED reads may be stale by insert time; this is why reads alone are insufficient. Rejected inserts cause full rollback before error classification/retry. The application never continues querying inside an aborted transaction.

Actual ORM conflicts in Prisma 7.10.1 are `P2039` with SQLSTATE `23P01` at `meta.driverAdapterError.cause.originalCode`. The original raw-query path is `P2010` with the same underlying state. Both technician and bay ORM errors were inspected and tested. No conflict is inferred just from an error message or the generic outer `P2039` code.

- `23P01`: resource-allocation conflict; retry with fresh availability.
- `40P01`, `40001`, or Prisma `P2034`: explicit aborted transaction conflict; separately classified and retried with a fresh transaction. A real PostgreSQL deadlock is tested.
- Recognized connection/pool failures: return 503 without automatic replay. A lost connection during commit can have an ambiguous outcome, so blindly retrying could duplicate intent. A real connection-refused `P1001` is verified.
- Business validation and unexpected errors are not retried.
- Four total attempts is the default, not four retries. Empty candidate sets on any fresh attempt stop immediately with 409. Exhausting conflicts without a fresh determination of unavailability returns 503. There is no fairness or throughput guarantee.

## Executed verification

Environment: Node 24.21.0, npm 11.19.0, Nest 11.2.8, Prisma/client/adapter 7.10.1, Vitest 4.1.11, PostgreSQL 17.6 Docker. Test databases are fresh UUID-named databases on the dedicated port 55433 service; no development database reset or migration was performed.

| Executed command/action                                                              | Observed result                                                                                             |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Baseline `npm run db:test:up && npm run test:all`                                    | 49 default + 71 PostgreSQL tests passed before changes                                                      |
| Diagnostic real ORM conflicting inserts                                              | Both named exclusions emitted `P2039`, underlying `23P01`; temporary DB removed                             |
| `npm run test:unit` during implementation                                            | 82 unit tests passed                                                                                        |
| Initial targeted booking API/concurrency run                                         | 50 tests passed; subsequently strengthened with restart, deadlock, transient-failure and exhaustion checks  |
| `npm run build`                                                                      | Passed, including actual Prisma client generation and TypeScript compilation                                |
| `npm run typecheck`                                                                  | Passed                                                                                                      |
| `npm run lint`                                                                       | Passed                                                                                                      |
| `npm run format:check`                                                               | Passed after formatting touched files                                                                       |
| Final `npm run test:all`                                                             | **84 default tests + 126 PostgreSQL integration tests passed**                                              |
| Actual migrations and seed in final integration harness                              | Applied successfully to four fresh databases; original 49 database and 22 scheduling tests passed unchanged |
| `git diff --exit-code -- prisma/schema.prisma prisma/migrations prisma/seed-data.ts` | No schema/migration/seed changes                                                                            |
| `npm audit --omit=dev --json`                                                        | Zero production dependency advisories at execution time                                                     |

The default count includes 82 unit tests, the existing health HTTP test, and the real-driver startup failure regression. The integration count includes 71 existing tests, 49 booking API/SQL tests, and six concurrency tests. The focused commands were also executed: `npm run test:e2e` passed 49 tests and `npm run test:concurrency` passed six. These select subsets already included in the full integration run. A PostgreSQL catalog query after teardown found zero generated `scheduler_test_*` databases remaining.

### Concurrency outcomes

Tests run concurrent HTTP requests through two Nest application instances with separate ten-connection pools, independent customer/vehicle fixtures, and a real shared PostgreSQL database. These are two app instances in one test process, not a multi-host deployment. No database query result is mocked.

| Scenario                                                        | Observed assertions                                                                                                                                                                                                 |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CT-01: 20 customers, one technician/bay, same interval          | Exactly one 201, nineteen 409 NO_AVAILABILITY, one confirmed database row; no 500/503                                                                                                                               |
| CT-02: two requests, two technicians/bays                       | Both 201 with distinct pairs; enforced race causes a verified exclusion (23P01) or deadlock (40P01); three distinct transaction IDs prove the losing request starts a fresh transaction and sees the remaining pair |
| CT-03: one technician, three bays                               | Exactly one 201 and two 409; one row                                                                                                                                                                                |
| CT-04: three qualified technicians, one bay                     | Exactly one 201 and two 409; one row                                                                                                                                                                                |
| CT-05: concurrent adjacent intervals, one pair                  | Both 201; two non-overlapping rows                                                                                                                                                                                  |
| Retry-exhaustion HTTP path, deliberately reduced to one attempt | One 201 and one 503 BOOKING_CONTENTION, never false NO_AVAILABILITY; one complete row                                                                                                                               |
| CT-06 invariants after each scenario                            | Direct SQL overlap join finds zero technician or bay conflicts; all rows have matching ownership/dealerships, active qualified resources, correct duration, and no extra/partial appointments                       |

A test-only barrier holds the first two actual candidate reads until both complete; it does not change their results or production selection. PostgreSQL backend IDs prove two connections are active, avoiding accidental serialization. There are no arbitrary sleeps. API tests also verify actual rollback after a write followed by a failure, retrieval after app shutdown/restart, malformed/forbidden fields, adjacent/cancelled appointments, and booking after a stale availability snapshot.

## Actual issues and limitations

- An initial ad hoc seed probe failed because it ran outside npm without `node_modules/.bin` on PATH. Its owned database was cleaned up, and the probe succeeded with that PATH. Standard npm test commands were unaffected.
- Type checking initially rejected async test instrumentation because the repository exposed Prisma's fluent thenable. Its concrete create method now exposes a normal Promise. An unused test import and formatting warnings were also corrected before final checks.
- `npm install` reported 13 moderate development-inclusive dependency advisories. The production-only audit returned zero. No forced or major dependency upgrades were applied; the full development dependency audit remains separate maintenance work.
- GET availability remains advisory, with independent reads rather than a transactionally consistent snapshot. Confirmed booking exclusively relies on authoritative attempt-time validation and database exclusions.
- Concurrent administrative catalog/qualification edits, hosted database extension privileges, multi-host/process-network faults, and representative performance/load benchmarks remain unverified. Reference data has no admin API in P0.
- A connection lost during commit can leave an unknown complete outcome; there is no exactly-once request guarantee. Repeated client requests are separate bookings. Idempotency, vehicle-level exclusions, cancellation, rescheduling, hours/shifts, authentication, notifications, and other optional features are not implemented.
- Logs use Nest's JSON console logger and correlation IDs; no external collector or monitoring stack was added. The required demonstration video has not been produced.

## Follow-up correctness and simplicity review

Separated the transaction's validation/allocation/insert steps into one private method, keeping the retry loop easy to follow. Removed duplicate temporary-database-error conversion from the booking use case; the shared HTTP filter now handles that mapping for both booking and retrieval. No new layers, files, or dependencies were introduced by this review.

The first full rerun passed 84 default tests and 125 of 126 integration tests. CT-02's assertion incorrectly required an exclusion violation even though both bookings succeeded with distinct pairs. A targeted diagnostic reproduced an actual PostgreSQL deadlock (`40P01`, Prisma `P2034`), which the existing production retry policy already handled correctly. The race tests now accept only the two verified database conflict states (`23P01` and `40P01`), while retaining transaction-ID, distinct-resource, and final database-invariant assertions. Separate SQL tests still require real exclusion violations for each resource. The corrected CT-02 passed five consecutive focused runs.

After these corrections, build, typecheck, lint, and formatting checks passed. The final `npm run test:all` rerun passed **84 default tests and all 126 PostgreSQL integration tests**, including HTTP and concurrency checks. Schema, migrations, and seed definitions remained unchanged.

The approved Phase 4 definition of done is satisfied by the executed checks above. Phase 5 has not been started.

## Follow-up correctness and simplicity review — 2026-11-03

Reviewed the complete staged Phase 4 changes against SPEC: validation, qualifications/active flags/dealership scoping, full-interval queries, persistence, transaction propagation, retries, safe errors/logs, database constraints, and test isolation. Thin controllers, concrete repositories, the two appointment use cases, and shared scheduling remain appropriate; no structural refactor or new abstraction was needed. Use cases consistently retain `execute`; the optional transaction parameter is named `transactionClient`.

The initial full suite passed (84 default and 126 PostgreSQL tests), but repeating `npm run test:concurrency` exposed an intermittent defect. Repeats 1–2 passed all six cases; repeat 3 failed four cases: CT-01/02/03 timed out at the unchanged 30-second deadline, and the one-attempt race returned two 503s instead of one 201 and one 503. PostgreSQL activity showed 20 waiting transactions, and server logs identified repeated deadlocks while checking appointment exclusions.

Correction: `AppointmentRepository.create` locks the selected technician row, then the bay row, in the same transaction before inserting. All booking attempts follow this order, reducing GiST insert contention. A stale allocation still fails the existing exclusions and rolls back before a fresh retry. The four-attempt default, error classification, both exclusions, and all concurrency assertions remain unchanged. Adjacent bookings can briefly wait on the same resource row but remain valid. No schema/migration/seed changes were made.

Executed after the correction, all with exit 0:

| Command                                               | Observed result                                     |
| ----------------------------------------------------- | --------------------------------------------------- |
| `npm run build`                                       | Prisma generation and TypeScript compilation passed |
| `npm run typecheck`                                   | Passed                                              |
| `npm run lint`                                        | Passed                                              |
| `npm run format:check`                                | Passed                                              |
| `npm run test:all`                                    | 84 default and 126 PostgreSQL tests passed          |
| `npm run test:concurrency`, three consecutive repeats | Six cases passed on each run                        |

`npm run prisma:validate` also passed during the initial review; the schema was not changed. The PostgreSQL suite includes 49 database, 22 scheduling, 49 actual HTTP/API, and six concurrency tests. Focused repeats select existing cases, not additional coverage. Assertions inspect persisted row counts, references/qualifications, transaction IDs on retries, rollback, and zero resource overlaps. Migrations/seeds are applied to fresh UUID-named test databases. Existing staged changes were preserved; no commit or push was performed.

These results cover the tested local PostgreSQL environment. Sustained production load, multi-host failures, and concurrent administrative changes remain outside the evidence. The required video/final submission preparation remains a separate deliverable; this review does not claim it is complete.
