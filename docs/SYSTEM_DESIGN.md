# System design — Keyloop Unified Service Scheduler

## Architecture and technologies

The backend is a NestJS/TypeScript modular monolith with PostgreSQL and Prisma. Docker Compose supplies a development database and a separate disposable test database service. This keeps deployment and review straightforward while letting PostgreSQL enforce invariants across application instances. Package versions and the lockfile are pinned; there is no frontend, authentication system, Redis, Kafka, or distributed lock service.

`AppointmentsModule` owns booking/retrieval controllers, application orchestration, the concrete persistence repository, and database error classification. `SchedulingModule` owns the availability controller, shared availability use case, candidate queries, deterministic selector, and pure interval utilities. `DatabaseModule` owns the Prisma connection lifecycle. Shared HTTP infrastructure supplies DTO validation, request correlation, structured logs, and safe error responses. `HealthModule` exposes process liveness at `/health`.

Controllers perform transport conversion and call use cases. DTO validation uses [Nest's standard validation pipe](https://docs.nestjs.com/techniques/validation). The code uses concrete repositories rather than generic repository interfaces or a Clean Architecture framework. The scheduling use case accepts an optional Prisma transaction client, an intentional small coupling that lets booking reuse identical SQL predicates inside its transaction. Domain interval functions remain independent of Nest and Prisma. The injectable clock makes future-time rules deterministic in tests.

## Data model and rules

Eight models represent dealerships, customers, vehicles, service types, technicians, explicit technician qualifications, bays, and appointments. Resources belong to one dealership; vehicles belong to customers. Service types are global, with a positive integer duration and active flag. All active bays support every service in the MVP. Appointments retain their scheduled interval even if the catalog changes later.

PostgreSQL enforces required fields, foreign keys, unique VINs/qualification pairs, positive duration, and `startAt < endAt`. Two independent partial GiST exclusions protect each technician and each bay using `tstzrange(start_at, end_at, '[)')`; only CONFIRMED appointments block. `btree_gist` provides UUID equality. Half-open intervals permit adjacency. Prisma alone cannot express the exclusions/CHECKs, so committed SQL migrations are required. See [DATABASE.md](DATABASE.md).

Ownership, active flags, qualifications, matching dealership, future time, and catalog-derived duration are application rules. Ordinary foreign keys only establish reference existence. Reference data is controlled through seeds, with no concurrent administrative API in P0. There is no vehicle-level overlap rule or idempotency guarantee.

## Booking data flow and concurrency

1. The HTTP validation pipe rejects malformed/missing fields, invalid UUIDs/calendar timestamps, missing offsets, excessive precision, and client-supplied assignment/duration/end/status.
2. The create use case begins an interactive READ COMMITTED transaction. It validates customer/vehicle existence and ownership and invokes shared scheduling with that transaction client.
3. Scheduling validates dealership and active service type, checks a strictly future start with the clock, computes end using absolute elapsed minutes, and selects active eligible resources with no CONFIRMED overlap. Queries use `existing.startAt < requested.endAt AND existing.endAt > requested.startAt` for the full interval.
4. The selector picks the smallest technician ID and bay ID independently. Because bays are interchangeable, any eligible pair is valid. Two set-based candidate queries avoid N+1 queries.
5. The repository attempts one complete CONFIRMED row using conflict-aware insertion with both exclusions. A skipped insert rolls back as an allocation conflict; a primary-key collision is checked separately. There are no explicit resource-row locks. The controller returns 201 only after the transaction Promise resolves. GET retrieves the public fields from PostgreSQL, including all relationship IDs.
6. A concurrent insert can invalidate the initial reads. PostgreSQL rejects overlapping resource assignments. After rollback, verified exclusion/deadlock/serialization conflicts may start a fresh transaction, re-read current candidates, and choose alternatives. Four total attempts is the default and configurable limit.
7. Empty candidates mean 409. Exhausted conflict attempts without a fresh exhaustion determination mean retryable 503. Unexpected errors remain 500. Recognized connection failures yield 503 without replay because a commit acknowledgement may be lost.

The transaction API and explicit write-conflict retry handling follow the [Prisma 7 transaction documentation](https://docs.prisma.io/docs/orm/v7/prisma-client/queries/transactions); the exclusion error's actual adapter shape is separately verified by local PostgreSQL tests.

Availability GET invokes the same scheduling use case outside a booking transaction. It returns interval/counts/boolean and creates no rows or holds. Independent reads can become stale immediately, so a prior availability result is never trusted as a reservation.

## Alternatives and trade-offs

- Read-then-insert without exclusions and in-memory locks were rejected because they permit double booking across processes. Optimistic version columns alone would require correctly coordinating both resources and all write paths; range exclusions directly enforce the requested invariant, including direct SQL writes.
- READ COMMITTED plus both exclusions enforces exclusivity. A temporary resource-row-lock fix addressed observed plain-INSERT deadlock storms, then the approved conflict-aware insert replaced it so unrelated intervals can proceed without that row serialization. PostgreSQL still performs index/FK locking internally; fixed role/database wait/statement/transaction timeouts bound this work. SERIALIZABLE would still need conflict handling.
- Stable ID ordering is reproducible and easy to review. It can concentrate contention and does not optimize fairness. Bounded retries handle small races, with an explicit 503 path under sustained contention.
- A single appointment row atomically represents both assignments. There is no separate reservation table or hold-expiration workflow.
- Input precision is limited to milliseconds to match Date and timestamptz(3), avoiding silently truncated scheduling boundaries. Timezone calendars and working hours are outside the MVP; comparisons use absolute instants.

## Observability, errors, and operations

Nest's JSON console logger emits request and booking events: processing, confirmation, unavailability, conflict, retry, and unexpected failure. Server-generated request IDs appear in logs, `x-request-id`, and error bodies. Booking logs include dealership/service, appointment ID on success, outcome, elapsed duration, and retry count where applicable. Customer names, VINs, request payloads, SQL, credentials, and raw database messages are not logged by these handlers. Unexpected failures record the error type and available SQLSTATE for correlation.

The common filter provides machine-readable 400/404/409/422/500/503 responses and safe validation details; retryable 503 responses include Retry-After. `/health` is process liveness. Prisma checks PostgreSQL at startup and disconnects on shutdown. Connection pools are bounded at ten connections. Database setup configures fixed role/database defaults of 250 ms lock, 2 s statement, and 5 s transaction timeout, inherited on new connections. There is no per-booking configuration round trip. Interactive transactions use Prisma's remaining-budget timeout, a one-second acquisition cap, and callback deadline checks. Fixed server limits and the overall booking deadline are distinct; cleanup and commit/response overhead can exceed the nominal request budget. A per-instance BookingCapacity gate admits eight active bookings and up to 128 waiting, removes disconnected/expired waiters, and leaves two of the ten pool connections for other operations. Retries back off only after rollback; total budget defaults to five seconds. Admission/budget exhaustion maps to explicit retryable 503 codes. No external work occurs inside booking transactions.

Deployment to a managed host must verify extension/DDL permissions and use suitable credentials/configuration. No production-host verification or performance numbers are claimed. A transport failure during commit can produce an ambiguous complete outcome; exactly-once client requests require separately approved idempotency work. Current retry behavior does not solve fairness, administrative mutation, authentication, or availability guarantees.

## Verification and design-phase AI usage

Unit tests exercise pure time/selection rules, orchestration, validation outcomes, retry limits, fresh transaction contexts, and error classification. PostgreSQL integration tests apply the real migration and seed to isolated newly created databases. HTTP tests use the real AppModule and PrismaService, verify rollback and retrieval after app restart, and never substitute mocked database results. Two app instances with independent pools exercise actual contested writes, alternate-pair recovery, resource bottlenecks, adjacent intervals, and final SQL overlap/reference invariants. See [PHASE_4.md](PHASE_4.md) for executed commands, counts, and exact scope limitations.

The developer selected the scope and requested critical design/simplicity reviews. AI assisted with analysis of interval constraints, transactional allocation/retries, implementation, test design, and documentation. Actual ORM error probes changed classification from assumptions about generic Prisma codes to verified SQLSTATEs. Developer questions led to simpler date validation and extra time-boundary coverage. The README's AI Collaboration Narrative and phase records describe actual corrections and verification, without invented mistakes or performance claims. The required demonstration video and later phases remain unfinished.

The approved concurrency decision, known limits, and current isolated load evidence are recorded in [CONCURRENCY_PROPOSAL.md](CONCURRENCY_PROPOSAL.md). The implemented load runner uses k6 with separate Node app processes, reports both rate and burst results, and validates persisted counts and resource invariants. It does not establish a universal production-capacity guarantee.
