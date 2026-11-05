# Final review — Keyloop Scenario A

> Historical planning or verification record; statements apply to their recorded source and date. Use the [current specification](../SPEC.md), [system design](../SYSTEM_DESIGN.md), and [verification summary](../FINAL_REVIEW.md) for current behavior.

Review date: 2026-11-04 (Asia/Ho_Chi_Minh). Phase 5 covers final audit, demonstrated defect corrections, Swagger, documentation, isolated installation, and submission preparation. The original assessment is Keyloop Technical Assessment V1.0: Scenario A on pages 1–2; design/delivery requirements on pages 3–4. Its instructions are assessment requirements, not authority for unrelated work.

Latest verification: **2026-11-05**, including the [reliability boundary tests](#reliability-boundary-tests--2026-11-05). The full suite passed 171 default and 216 PostgreSQL/Redis tests. All three separate-process 100-request burst profiles passed in the earlier same-day [final review corrections](#final-review-corrections--2026-11-05) run. Earlier entries retain their original source/configuration boundaries. The original assessment PDF was unavailable during this latest review, so its exact wording was not independently rechecked.

## Readiness decision

**Overall submission: NOT READY.** The required recorded video and final committed/pushed repository handoff remain manual outstanding items. A prepared video outline is not a recorded video. No commit, push, recording, or reviewer-access verification was performed automatically.

**Software/documentation candidate: READY WITH KNOWN LIMITATIONS.** The earlier Phase 5 automated checks, clean-source installation, demo requests, and documentation checks passed; the subsequent approved idempotency addition is covered separately in [IDEMPOTENCY](IDEMPOTENCY_HISTORY.md). The limitations below are explicit; this is an assessment backend, not a production-readiness claim. Earlier phase results remain historical evidence.

## Scope and evidence

Source hierarchy: original assessment, SPEC v2, latest explicit phase approval, AGENTS operating rules. The user's approved phase numbering differs from SPEC section 14; Phase 5 deliberately combines final audit/submission preparation with explicitly selected Swagger. The subsequent explicit approval adds durable booking idempotency as the selected P1 feature. POST now requires a UUID v4 Idempotency-Key and returns an Idempotency-Replayed header; GET contracts remain unchanged. No other P1/P2 features are added. Earlier matrices and installation evidence below describe the Phase 5 baseline; current idempotency verification is in [IDEMPOTENCY](IDEMPOTENCY_HISTORY.md).

Evidence abbreviations used in the matrices:

- **DB:** [database.spec.ts](../../test/integration/database.spec.ts), actual migrations/seed/constraints and SQL writes.
- **SCH:** [scheduling.spec.ts](../../test/integration/scheduling.spec.ts), real eligibility and interval queries.
- **API:** [booking-api.spec.ts](../../test/integration/booking-api.spec.ts), actual Nest HTTP endpoints with PrismaService/PostgreSQL.
- **CT:** [booking-concurrency.spec.ts](../../test/integration/booking-concurrency.spec.ts), two app instances, distinct customers/vehicles, direct SQL invariants.
- **UNIT:** [unit tests](../../test/unit), environment, health, and real-driver startup failure regression.
- **FRESH / DEMO / DOC:** isolated clean-source install, executed demo, and document/diagram checks described below.

A test assertion is not marked satisfied until the corresponding command succeeds. Focused API/concurrency commands select subsets already counted in the integration suite.

## Requirements traceability

### Original Scenario A

| Requirement                                          | Implementation                                                               | Evidence / expected assertion                                       | Phase 5 status |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------- |
| K-R1: request service for vehicle/dealership/time    | POST DTO, controller, CreateAppointmentUseCase                               | API valid/malformed/reference/ownership cases                       | Verified       |
| K-R2: qualified technician and bay for full duration | Shared scheduling; active/qualification/dealership filters; interval queries | SCH overlap/alternatives; CT bottlenecks; DB independent exclusions | Verified       |
| K-R3: persistent confirmed associations              | AppointmentRepository transaction and complete row; GET                      | API persisted record/app restart; DB FKs; CT final state            | Verified       |

### SPEC P0 capabilities

| ID    | Implementation and evidence                                                  | Phase 5 status                      |
| ----- | ---------------------------------------------------------------------------- | ----------------------------------- |
| P0-01 | Eight models, migration, deterministic reference seeds; DB                   | Verified                            |
| P0-02 | Atomic POST, server-assigned resources/duration; API                         | Verified                            |
| P0-03 | Shared read-only GET availability; SCH/API                                   | Verified                            |
| P0-04 | Persisted GET with safe 400/404; API app restart                             | Verified                            |
| P0-05 | DTO/calendar/offset/UUID rules; ownership/status/scoping; UNIT/SCH/API       | Verified                            |
| P0-06 | Conflict-aware insertion, both exclusions, bounded fresh transactions; DB/CT | Verified                            |
| P0-07 | Stable seed IDs, Swagger and executable demo                                 | Verified DEMO                       |
| P0-08 | Unit, PostgreSQL, HTTP, and concurrency suites                               | Verified                            |
| P0-09 | README, design diagrams, AI narrative, demo/video outline                    | Verified DOC; video outstanding     |
| P0-10 | Validated configuration, startup query, safe errors, IDs/logs                | Verified UNIT/API and startup smoke |

### SPEC acceptance criteria

| ID     | Evidence and assertions                                                                       | Phase 5 status     |
| ------ | --------------------------------------------------------------------------------------------- | ------------------ |
| AC-F01 | API 201, complete committed row, correct derived end; forbidden assignment/duration fields    | Verified           |
| AC-F02 | API 400/404/422 validation with zero writes                                                   | Verified           |
| AC-F03 | UNIT time boundaries; API explicit offsets, equal instants, future time and adjacency         | Verified           |
| AC-F04 | SCH/API qualification, inactive/wrong dealership exclusion, alternatives and no resources     | Verified           |
| AC-F05 | DB independent overlap shapes; SCH interval shapes; adjacent/cancelled cases                  | Verified           |
| AC-F06 | API availability counts/no writes/stale snapshot; SCH four-query instrumentation              | Verified           |
| AC-F07 | API committed row after app restart; real rollback after write; UNIT commit failure           | Verified           |
| AC-F08 | CT-01 exact 1/19 result; CT-02 two pairs/fresh transaction; DB direct bypass protection       | Verified           |
| AC-F09 | API safe 400–503 errors and correlation; JSON booking logs; unexpected DB failure remains 500 | Verified           |
| AC-F10 | FRESH install plus diagrams, demo, limitations and AI narrative                               | Verified FRESH/DOC |

### Submission gates

| Gate    | Evidence / remaining action                                                        | Status                             |
| ------- | ---------------------------------------------------------------------------------- | ---------------------------------- |
| GATE-01 | API valid confirmed booking                                                        | Verified                           |
| GATE-02 | UNIT/SCH/API validation and eligibility                                            | Verified                           |
| GATE-03 | UNIT/SCH/DB full-interval overlaps and adjacency                                   | Verified                           |
| GATE-04 | DB + API direct independent exclusion failures                                     | Verified                           |
| GATE-05 | CT-01 twenty requests, exactly one persisted appointment                           | Verified                           |
| GATE-06 | CT-02 both pairs succeed; distinct transaction IDs and SQL invariants              | Verified                           |
| GATE-07 | All final automated suites                                                         | Verified                           |
| GATE-08 | Clean-source installation; committed-checkout verification remains a handoff check | Verified current source copy       |
| GATE-09 | System design with architecture, ER and sequence diagrams                          | Verified                           |
| GATE-10 | Specific evidence-based README AI narrative                                        | Verified                           |
| GATE-11 | Required 5–10 minute recording/link                                                | **Outstanding manual deliverable** |

### Requested scenarios A–J

| Scenario                               | Evidence                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| A valid booking                        | API 201 plus direct persisted row; DEMO first booking                           |
| B unqualified technician               | SCH qualified/unqualified cases; API excludes unqualified, 409/no write         |
| C unavailable bay                      | SCH no bays and independent bay conflict; CT-04 bay bottleneck                  |
| D overlap rejection                    | DB both resources/all shapes; API stale allocation/exclusions; CT same interval |
| E adjacency                            | UNIT/SCH/DB both directions; API equivalent-offset/adjacent requests; CT-05     |
| F no partial writes                    | DB rollback; API write-then-fail transaction; CT row count/reference checks     |
| G twenty requests/one pair             | CT-01 exact 201/409 counts and one SQL row                                      |
| H different resources under contention | CT-02 forced race and fresh allocation; final distinct resource IDs             |
| I stale availability                   | API initial GET true, another booking, subsequent POST 409; DEMO third booking  |
| J retrieval                            | API persisted GET after app shutdown/restart; DEMO GET                          |

## Merge findings and corrections

The Phase 5 stash was applied onto commit 40352a1 and left six conflicted files: AGENTS, README, SYSTEM_DESIGN, AppointmentRepository, AppointmentsController, and main. A backup of the conflict files and all three index stages was saved outside the repository before editing. The original stash remains available.

- Preserved the newer conflict-aware insert, identity-collision guard, bounded admission, disconnect signal, shared deadline, fixed database defaults, jittered backoff, and narrow driver-error classification. The stashed resource-row locks were superseded and were not restored.
- Combined Swagger metadata with the existing async controller and its finally-based listener cleanup. Production bootstrap and HTTP fixtures use the shared Swagger setup alongside the existing HTTP keep-alive configuration.
- Updated Swagger's POST 503 descriptions for BOOKING_BUSY/BOOKING_TIMEOUT and availability's temporary-database 503 response. Real HTTP schema tests assert these new contract details.
- Updated README, database/design/demo documentation and the AI narrative to describe the merged code. Setup includes db:configure; diagrams show conflict-aware insertion and admission instead of obsolete selected-resource locks. A Mermaid parse failure caused by punctuation in a sequence note was corrected; all three diagrams now parse/render.
- Retained exact package pins and the existing scoped Swagger/YAML and Nest/Multer overrides. No optional business feature, schema change, new abstraction layer, or external infrastructure was added.

The older Phase 5 record described an 84-default/130-PostgreSQL candidate using selected-resource locks. Those are historical results from the stash, not verification of this merged candidate. Earlier load/prototype evidence remains in [LOAD_RESULTS](../LOAD_RESULTS.md) and [CONCURRENCY_PROPOSAL](CONCURRENCY_PROPOSAL.md).

## Code, database, and security review

Controllers handle HTTP validation/transport/documentation and disconnect lifecycle. Concrete use cases/repositories retain one shared allocation algorithm, and every booking read/write uses the attempt's transaction client. A successful response follows commit; bounded retries happen after rollback with fresh allocation. Unexpected errors remain 500, settled exhaustion is 409, and admission/deadline/contention/recognized temporary failures are 503.

Both independent partial GiST exclusions remain immediate, CONFIRMED-only, and half-open. NOT NULL/FKs, unique VIN/qualification identity, positive duration, and valid interval are exercised by real PostgreSQL tests. Ownership, qualification, active flags, matching dealership, and future time remain application rules under the seeded-reference-data scope. Schema/migrations/seeds match the committed baseline.

Database configuration sets 250 ms lock, 2 s statement, and 5 s transaction defaults only for the role/database pair. New pooled connections inherit them. Prisma uses the remaining booking budget; callback checks and queue/retry checks share one monotonic deadline. The nominal budget is not a strict HTTP response deadline. There is no timeout-configuration query per booking. Longer maintenance work needs separately configured administrative connections because the local runtime/CLI role is shared.

The review covers parameterized queries, validation/response/log exposure, dependency advisories, and generated/local-file hygiene. It is not penetration testing or proof that all secrets/vulnerabilities were detected. The production audit has zero reported vulnerabilities; the full tree has 13 moderate development-inclusive findings, with no high/critical findings. No forced or major upgrade was used to hide them.

## Executed merged-candidate checks

Executed on 2026-11-04. Exit codes are 0 unless stated otherwise. Focused test counts overlap with test:all.

| Command                     | Actual result                                       |
| --------------------------- | --------------------------------------------------- |
| npm run db:test:up          | Dedicated PostgreSQL server healthy                 |
| npm run prisma:validate     | Schema valid                                        |
| npm run build               | Prisma generation and TypeScript compilation passed |
| npm run typecheck           | Passed                                              |
| npm run lint                | Passed                                              |
| npm run test:unit           | 108 passed                                          |
| npm run test:all            | 110 default + 146 PostgreSQL passed                 |
| npm run test:e2e            | 56 passed                                           |
| npm run test:concurrency    | 6 passed                                            |
| npm audit --omit=dev --json | 0 vulnerabilities, exit 0                           |
| npm audit --json            | 13 moderate, no high/critical, exit 1               |

The PostgreSQL total comprises 49 database, 22 scheduling, 56 API/Swagger, 13 resilience, and six concurrency cases. The default total contains 108 unit cases plus health/startup checks. CT-01 keeps exactly one 201 and nineteen 409 responses with one confirmed row; CT-02 forces a real race and commits two distinct pairs with fresh transaction IDs. Bottleneck, adjacency, retry exhaustion, actual exclusion/deadlock classification, rollback, timeout recovery, pool saturation, and queued disconnect checks remain strict. SQL assertions inspect persisted counts, complete valid associations, duration, and zero resource overlaps. No arbitrary database exception is accepted as proof of resource contention.

## Fresh installation and demo evidence

Copied all 91 current candidate source/config/document files into a new temporary directory, excluding .git, real .env, dependencies, and generated artifacts. The copy used Compose project keyloop-phase5-merge-f54f06aff4, its own new database volume, PostgreSQL port 50845, and application port 50844. Environment configuration came from .env.example with those verification-owned overrides. The developer database was not reset or migrated.

Executed successfully there: npm ci, prisma:generate, db:up, prisma:validate, db:migrate, db:seed, db:configure, db:check, build, and npm start. This includes the fixed role/database defaults, unlike the old Phase 5 installation record. The exact health/Swagger/availability/booking/retrieval/conflict shell blocks from DEMO_GUIDE were executed with a generated next-day timestamp and distinct seeded customer/vehicle pairs.

Observed initial availability true with two technicians/two bays; first booking 201 with successful persisted GET; second pair booking 201; third booking 409; final availability false with zero counts. SQL inspection found two appointments, two distinct technicians, two distinct bays, zero overlaps, both validated named CONFIRMED-only [) exclusions, and defaults 250ms / 2s / 5s. No production endpoint or data was used.

Swagger UI rendered and was inspected with the POST operation expanded, showing five accepted fields and every response status including the current four 503 codes. HTTP tests inspect the generated schemas, routes, parameters, local UI assets, and absence of appointment writes from documentation reads. Mermaid 11.12.0 temporary tooling parsed/rendered all three diagrams after the sequence-note correction. No compiler plugin or custom documentation framework was introduced.

The complete fresh installation also passed build, typecheck, lint, format:check, and test:all (110 default + 146 PostgreSQL). The development startup command independently returned 200 for health, Swagger, OpenAPI (four paths), and retrieval of an appointment committed by the compiled app before restart. HTTP keep-alive remained timeout=65. The merged candidate contains 91 files; 42 local documentation targets passed existence checks, and a limited common private-key/token scan found no matches or generated/local files in the candidate.

This verifies a complete working-source copy, not a committed checkout, remote clone, interviewer access, prerequisite installation on a virgin machine, or another operating system. Verification-owned app/diagram processes were stopped. The documented db:down command and explicit cleanup of the unique verification project/volume were performed; developer resources were preserved. The original Phase 5 stash and conflict backup were retained. No commit or push was performed.

## Trade-offs and remaining limitations

- PostgreSQL exclusions enforce exclusivity across instances; conflict-aware insertion and deterministic selection still do not guarantee fairness or successful admission under arbitrary contention.
- The 100-request burst remains the assessment resilience criterion. Sustained 1,000 successfully committed bookings/second is an unverified future stretch goal, not a submission requirement; see CAPACITY_PLAN and LOAD_RESULTS. Historical local diagnostics do not establish current-source or production capacity. No load tests were rerun for the 2026-11-04 documentation-only goal revision.
- Availability is advisory. Same-key retries recover committed bookings; different keys are independent and response delivery is not guaranteed. A running booking may commit after client disconnect. Successful keys are retained indefinitely; authenticated scoping and an expiry policy remain future decisions.
- Authentication, vehicle-overlap exclusion, cancellation/rescheduling, operating hours/shifts, and concurrent administrative mutation remain outside scope. Swagger is open for the assessment demo.
- Concurrency tests use two app instances in one process; diagnostic load tests also use separate local Node processes. Multi-host/network faults, production load/permissions, and populated-data migrations remain unverified.
- Structured logs are implemented; production metrics/tracing are proposals. The 13 moderate development-inclusive audit findings remain disclosed.
- Mandatory recording/link, final committed repository contents, publication, and reviewer access remain manual handoff items. No commit, push, or recording is performed automatically.

## Throughput goal documentation revision — 2026-11-04

The user approved keeping the 100-request burst resilience criterion and making sustained 1,000 successful bookings/second an unverified future stretch goal. Updated project instructions, specification, README, design, capacity guidance, concurrency notes, load-result context, and demo/review guidance. Historical measurements and failed trials remain; no application, database, configuration, API, or test changes were made.

Verification: `npm run format:check` and `git diff --check` passed. A local documentation check resolved 41 relative file/heading targets across the ten changed Markdown files. A baseline comparison confirmed the Git index and all 76 tracked non-Markdown files were unchanged. Reviewed remaining references to the withdrawn target as historical context only. No load tests or correctness suites were rerun for this documentation-only change; existing test counts and performance results above remain historical evidence.

## Durable idempotency follow-up — 2026-11-04

The explicitly approved P1 addition is implemented: required booking key header, canonical fingerprints, atomic PostgreSQL claims/appointments/saved responses, replay before dynamic validation, changed-body rejection, bounded same-key waiting, and indefinite successful-key retention. Other business features and infrastructure remain excluded. The migration is additive and was verified in owned temporary databases; developer data was not migrated or reset.

Final checks passed: Prisma generation/validation, build, typecheck, lint, formatting, whitespace, 138 default tests, and 175 PostgreSQL tests. Existing strict contention checks remain; the six-case focused concurrency command passed as well. The three 100-request load profiles passed with complete key-record and appointment counts and no invariant violations. The replay/mismatch demo was executed against isolated data, including exact-byte replay equality. All three updated diagrams parsed/rendered after correcting punctuation. Source fingerprint, exact commands, counts, load limitations, observed review corrections, and cleanup are recorded in [IDEMPOTENCY](IDEMPOTENCY_HISTORY.md#executed-evidence--2026-11-04). No current sustained-rate claim, full fresh npm installation, commit, push, video, or production deployment is added by this follow-up.

## Handoff

Review these results, record the 5–10 minute demonstration using DEMO_GUIDE, include the complete merged source/tests/lockfile/docs in the final commit, push, and check the reviewer's repository/video access. Exclude local configuration, dependencies, generated files, load artifacts, and verification logs.

Software assessment readiness is READY WITH KNOWN LIMITATIONS; the unverified future throughput stretch goal does not block assessment submission. Production readiness is not claimed. Overall submission readiness stays NOT READY until the required video and repository handoff are completed.

## Service catalog Redis follow-up — 2026-11-04

The explicitly approved catalog extension is implemented: GET /api/v1/service-types returns active global id/name/duration fields ordered by name then ID; shared Redis uses cache-aside and atomic five-minute expiry. Redis is optional and connects in the background. Cache reads, writes, invalid values, and invalidation failures are handled within the cache provider; database reads remain outside fallback catches. Booking, availability, retrieval/idempotency, the error filter, Prisma schema/migrations, and PostgreSQL timeout defaults were not changed from the staged candidate. No update API, generic caching framework, request coalescing, Pub/Sub, distributed lock, background refresh, or cache-clearing CLI was added.

Added exactly pinned ioredis 6.0.0 and development/test Redis 7.4.12-alpine services with loopback ports, 64 MiB memory limits, and no persistence. Updated .env.example, environment validation, the explicit Swagger route inventory, setup/demo guidance, and architecture/scope documents. Existing .env contents were preserved. A configured Redis URL requires a separate deployment/database namespace; the dedicated Redis fixture uses UUID namespaces and removes only its owned key. Existing booking fixtures leave Redis unconfigured.

Executed commands and final results:

- npm install --save-exact ioredis@6.0.0: succeeded; the installer reported 13 moderate development-inclusive audit findings, consistent with the previously disclosed count. No automatic audit fix or dependency upgrade was performed.
- npm run db:test:up: dedicated PostgreSQL and Redis services healthy.
- npm run build (including Prisma generation), npm run typecheck, npm run lint, npm run format:check, and git diff --check: passed.
- npm run test:unit: 161 passed during focused development. The subsequent full suite includes these cases.
- TEST_REDIS_URL=redis://127.0.0.1:56380 npm run test:all: **163 default tests and 187 real integration tests passed**. The integration total includes ten new Redis/PostgreSQL catalog cases and all existing booking, idempotency, and concurrency cases.

The real cache test observed one catalog database read on initial miss, then no catalog database read from the second app instance on a shared hit. Both responses matched. Redis TTL was 299–300 seconds after population; shortening it to 60 seconds showed that a hit did not reset it. Controlled expiration and post-commit invalidation fetched updated data. Empty results and malformed values, namespace isolation, database-outage classification, Redis-unavailable startup/catalog/booking, and stale-catalog/current-booking-duration and inactive-service validation were verified. Unit cases additionally cover Redis read timeout, failed SET/DEL, unavailable-client bypass, and shutdown. These tests establish query avoidance and failure separation, not a latency or throughput improvement. No sustained-rate or new burst benchmark was executed for this read-only extension.

One initial combined API/catalog run failed an existing malformed-UUID test with an unexpected 401 instead of 400; the catalog suite passed. The unchanged focused validation rerun returned 400, and the complete final suite passed the original assertion. No source of 401 was found in the application and no root cause is established; the initial failure is retained here rather than counted as success. The runtime validation/error-handling code was not changed to accommodate it.

Five-minute TTL is entry lifetime after refill, not strict freshness from the time of a database change. Manual SQL/seeding requires targeted invalidation; future writers should invalidate after successful commit. A concurrent stale refill remains possible. PostgreSQL still authorizes bookings from current data. The four-row seed catalog is not a demonstrated performance bottleneck. Production deployment, operational failover, immediate cross-instance consistency, and current-source booking throughput are not claimed. Developer data and existing staged work were preserved; no commit or push was performed.

## Booking lookup and history follow-up — 2026-11-04

Implemented the five approved read-only endpoints: customers, owned vehicles (including VIN), dealerships, active dealership technicians with qualification IDs, and customer appointment history. New lists use bounded page/limit reads and `{ items, page, limit, hasNext }`, fetching one extra row without a count query. Parent-scoped reads distinguish missing parents from empty children. History reuses the existing appointment projection and serializer; booking transaction methods, allocation, idempotency, constraints, cache behavior, schema, dependencies, and configuration are unchanged. Swagger, README, specification, architecture, demo, and scope instructions describe the extension and its unauthenticated assessment boundary.

Verification executed:

- Focused PostgreSQL run: `TEST_REDIS_URL=redis://127.0.0.1:56380 npm run test:integration -- test/integration/booking-lookups.spec.ts test/integration/booking-api.spec.ts`: 75 passed before the final database-outage case was added.
- `TEST_REDIS_URL=redis://127.0.0.1:56380 npm run test:all`: final rerun passed **163 default tests and 207 real PostgreSQL/Redis integration tests**, including 20 new lookup/history cases and the existing concurrency/idempotency assertions.
- `npm run build` (including Prisma generation), `npm run prisma:validate`, `npm run typecheck`, `npm run lint`, `npm run format:check`, and `git diff --check`: passed.

The tests verify ownership boundaries, multiple vehicles/appointments, past and future history with stored statuses, deterministic ordering/ties, pagination and invalid/repeated queries, missing/empty parents, active dealership-scoped rosters, unchanged public serialization, database outage/unexpected-error safety, and lookup → availability → booking → history. Client-supplied resource IDs remain rejected. No load benchmark was run and no performance improvement is claimed.

The first full run passed all new cases but failed an unchanged availability SQL-error test with an unexpected 404 instead of 500. The earlier focused API run and the final complete rerun both passed that assertion unchanged. A cause was not established; this observation is retained alongside the earlier catalog review’s unexpected HTTP result. Initial execution without local-network access also failed before any tests could run; the suites were then executed with local-service access. No application error behavior was changed to accommodate these failures.

The staged diff checksum remained `97bfbe75550a55d4dd43adf83733a3ec3264a81281f1887d45737dc931938c00`. No commit, push, migration, deployment, or developer-data reset was performed. Offset pages may shift during concurrent inserts; production access to customer/vehicle/history data requires authorization. Technician rosters do not guarantee availability or change automatic assignment.

## API and cache re-review — 2026-11-04

Reviewed all added lookup/history controllers, pagination validation, parent-scoped repository reads, appointment serialization, and catalog cache-aside orchestration. No additional application changes were justified. The small concrete modules and existing error handling remain sufficient; no generic cache framework, extra caching, locks, background workers, or dependencies were added.

Fresh verification: `TEST_REDIS_URL=redis://127.0.0.1:56380 npm run test:all` passed 163 default tests and 207 PostgreSQL/Redis integration tests. The earlier unexpected availability HTTP response did not recur in this run; its cause remains unresolved rather than being declared fixed. Build/Prisma generation, typecheck, Prisma validation, lint, formatting, and diff checks passed. An isolated query-log diagnostic confirmed that the customer-history child query includes SQL LIMIT and OFFSET; pagination is not merely an in-memory slice. The diagnostic initially failed because the standalone process lacked the local ts-node executable on PATH, then succeeded with the project executable path; its temporary database was cleaned up in both cases.

The existing cache is the chosen interview example: one shared, namespaced service-catalog key; cache-aside; validated JSON; atomic 300-second expiry without refresh on hit; targeted post-commit invalidation; cache failures fall back to PostgreSQL while database errors remain visible. Real integration tests verify cross-instance hits without another catalog query, expiration, invalidation, malformed entries, empty results, optional-Redis startup, and authoritative scheduling despite stale catalog content. Unit tests cover read timeouts and failed cache writes/deletions. Customer history, lookups, availability, and booking stay outside Redis. The four-row catalog does not establish a performance bottleneck; no latency improvement or new throughput evidence is claimed. Staged work remained unchanged.

## Dealership and technician cache extension — 2026-11-04

The user explicitly selected dealership and active technician-roster caching, extending the original catalog-only scope. Both GET endpoints now use cache-aside with fixed 300-second expiry. Keys include page/limit and, for technicians, a lowercase dealership UUID. Public page/item shapes, expected pagination, and technician dealership are validated. Successful empty pages are cacheable; missing-parent and database errors are not. Cache failures fall back to PostgreSQL, while database failures remain visible. Customer, vehicle, history, availability, booking, and idempotency behavior remain uncached and unchanged.

Extracted the existing Redis connection/error/lifecycle behavior into one small RedisCache provider shared by CatalogModule and DirectoryModule. This keeps one client per app instance and preserves the existing catalog key, namespace configuration, timeout/reconnect controls, and optional startup. Domain providers own their keys and payload validation. Maintenance invalidation removes all matching pages through namespace/entity-scoped SCAN and UNLINK. Catalog exact-key invalidation is preserved. No global cache interceptor, new dependency/configuration, database migration, background worker, distributed lock, service-bay endpoint, or automatic writer was added. Invalidation remains post-commit maintenance; stale refill and stale display data are documented limitations.

Executed verification:

- `npm run build` (including Prisma generation), `npm run typecheck`, `npm run lint`, `npm run format:check`, and `git diff --check`: passed.
- The final full run used `NODE_OPTIONS="${NODE_OPTIONS:-} --require=/tmp/http-diagnostics.cjs" TEST_REDIS_URL=redis://127.0.0.1:56380 npm run test:all`: **165 default tests and 214 PostgreSQL/Redis integration tests passed**. The temporary diagnostic only adds response details to failed Supertest status assertions; it does not change requests, application responses, expected statuses, or retry behavior. No mismatch occurred in that run.
- Seven new real Redis/PostgreSQL cases verify shared dealership/technician hits without additional repository reads; isolated page/limit/dealership keys; fixed TTL; expiry/refill; all-page and dealership-specific invalidation preserving unrelated entries; empty rosters; malformed/wrongly scoped pages; missing parents and database outages without cached errors; Redis-unavailable startup; and authoritative booking/availability after cached technicians are deactivated. Two added unit cases cover multi-cursor invalidation and failure/bypass handling.

During development, one unit fixture initially retained the old cache instance after constructing an unconfigured transport; updating the fixture to inject the new transport corrected that test. Subsequent complete runs each encountered one intermittent unexpected status: 403 on the unchanged vehicle-list workflow, then 401 on a technician pagination request. These are consistent with the previously recorded unexplained HTTP failures but do not establish a common root cause. A diagnostic run captured headers/bodies on any mismatch and passed all original assertions. No application status mapping was weakened and no retries were added to hide failures. These intermittent observations remain unresolved.

README, specification, project instructions, architecture diagram/design, Swagger descriptions, environment-example comments, and demo guidance now describe all three cached lists, key scopes, stale-roster limitations, and targeted maintenance. No load benchmark or latency gain is claimed. Existing user work was preserved; the Git index was empty at the start and remained unchanged. No commit, push, deployment, or developer-data reset was performed.

## Catalog refresh and grouped invalidation demonstration — 2026-11-04

Added two real PostgreSQL/Redis examples in service-catalog.spec.ts using the existing repository and cache methods. The successful example warms the original catalog, shortens TTL, commits Oil Change duration from 30 to 45 minutes, rereads the complete ordered active catalog, and replaces the same Redis key without invalidation. It inspects the updated Redis value before any subsequent GET and observes a renewed TTL of 299–300 seconds. After shortening TTL again, a second app instance serves the new value without a catalog database query or TTL extension. The rollback example aborts the database update, verifies the persisted duration remains 30 and the cached bytes are unchanged, confirms no refresh read/write occurred, and serves the original cached result through the second instance.

Retained the existing grouped-invalidation implementation and tests: one operation clears multiple dealership pages while preserving technician entries, or clears one dealership's roster pages while preserving another dealership. No runtime API, writer, abstraction, configuration, dependency, lock, worker, or versioning mechanism was added. Application files were not changed in this follow-up. The Git index was empty at the start and remained unchanged; existing user work was preserved.

Executed checks:

- `TEST_REDIS_URL=redis://127.0.0.1:56380 npm run test:integration -- test/integration/service-catalog.spec.ts test/integration/directory-cache.spec.ts`: **19 passed**.
- `TEST_REDIS_URL=redis://127.0.0.1:56380 npm run test:all`: **165 default tests and 216 PostgreSQL/Redis integration tests passed**, including existing concurrency, booking/idempotency, Redis failure, malformed-value, and authoritative scheduling assertions. No temporary diagnostic preload was used. The earlier intermittent unexpected HTTP statuses did not recur in this run; their root cause remains unresolved.
- `npm run build` (including Prisma generation), `npm run typecheck`, `npm run lint`, `npm run format:check`, and `git diff --check`: passed.

README, demo guidance, and specification distinguish whole-catalog replacement from grouped page invalidation and provide a focused demonstration command. Replacement is best effort: set() returns no storage confirmation, so the tests verify Redis directly. A failed database read after commit, failed Redis refresh, or overlapping refreshes can leave an older snapshot until expiry or another refresh. PostgreSQL and Redis do not commit atomically. These are isolated maintenance examples rather than an implemented catalog-update API or automatic synchronization feature. No load benchmark, commit, push, deployment, or developer-data reset was performed.

## Redis correctness and documentation review — 2026-11-04

Reviewed the shared Redis lifecycle and timeout options, cache-aside orchestration, domain key/payload validation, catalog replacement, grouped invalidation, namespace isolation, and current documentation. The existing three-list design remains sufficient and understandable; no additional cache framework, dependency, API, worker, lock, configuration, or database change was introduced.

Found and reproduced one concrete cache-validation gap: an empty cached page with hasNext=true was accepted despite being impossible for the repository pagination helper. A direct guard probe accepted it, and the new real Redis malformed-value regression failed before the fix with an empty list. Added one consistency condition requiring a full page whenever hasNext is true. The regression now covers both dealership and technician pages and verifies database fallback replaces the malformed value. Existing valid empty pages with hasNext=false remain supported.

Documentation corrections: the architecture diagram now identifies the shared RedisCacheModule rather than presenting ServiceCatalogCache as the transport used by all domains; scope lists all three cached endpoints. Added Redis configuration variables to the README table. Clarified that SCAN traverses the Redis database incrementally, MATCH filters affected keys, COUNT is a work hint, and one logical invalidation can require several non-atomic SCAN/UNLINK batches. Corrected the memory description: Redis maxmemory is not a container/process memory cap. Explained catalog versus directory query avoidance without assuming every repository read is one SQL statement. The system design now includes the existing catalog replacement example and its best-effort/non-atomic limitations.

The first full regression run passed 165 default tests and 215/216 integration tests but encountered ECONNRESET in a dealership cache request. Inspection of the installed Supertest source and fixture showed that most suites repeatedly opened/closed an HTTP listener per request; the resilience and idempotency suites already explicitly owned listeners. Centralized one loopback listener per application in createBookingApp, removed the now-redundant explicit starts, and added a regression that verifies the same listener remains open across successful and validation-error requests. This removes avoidable server lifecycle churn; it does not establish the cause of every earlier unexplained 401/403/404 response. No request retries or weakened assertions were added.

Executed verification:

- Malformed-cache regression before the validation fix: failed as expected; this demonstrated the defect rather than being counted as successful verification.
- `TEST_REDIS_URL=redis://127.0.0.1:56380 npm run test:integration -- test/integration/service-catalog.spec.ts test/integration/directory-cache.spec.ts`: 19 passed after the validation fix.
- Final `TEST_REDIS_URL=redis://127.0.0.1:56380 npm run test:all`: **165 default tests and 217 PostgreSQL/Redis integration tests passed** with the shared listener fixture, including restart/response-loss, admission cancellation, resource exclusions/concurrency, Redis failure/fallback, replacement, rollback, and grouped invalidation coverage. No temporary diagnostic preload or automatic retries were used.
- Build/Prisma generation, typecheck, lint, formatting, and diff checks passed. An initial type annotation in the listener regression was corrected to use the repository's existing explicit Server cast; subsequent typecheck/lint passed.

The staged binary diff SHA-256 remained `d413ab7b93f6d9fb3536846b8211ea3577c844952d53df79ac79e451546d6751`. The user's staged docker-compose.yaml rename and all other staged work were preserved. No load benchmark, commit, push, deployment, or developer-data reset was performed. Cache consistency remains eventual; controlled updates need post-commit refresh/invalidation, and concurrent stale refill/refresh is still possible.

## Latest scope: remove optional technician listing

The user narrowed the public API to booking inputs and customer history. Removed GET /api/v1/dealerships/:dealershipId/technicians and its dedicated handler, service/repository methods, response/parameter DTOs, and cache key/validation/invalidation methods. Shared directory files/providers remain in place. CustomerParamsDto remains available to appointment history; availability retains its separate DealershipParamsDto. Technician models, qualifications, seeds, scheduling queries, automatic assignment, stored/returned assignment IDs, booking/idempotency transactions, and PostgreSQL safeguards were not changed.

Current Redis scope is the service catalog and paginated dealerships, using the existing shared client and settings. Grouped dealership invalidation now demonstrates removal of three warmed page/limit variants while preserving the service-catalog value byte-for-byte. Valid empty pages remain cacheable and shared across instances. Catalog replacement/rollback, cache failure/fallback, TTL, malformed pagination, and safe database errors remain covered. Removed only roster-specific API/cache expectations and added an explicit route-not-found regression; the Swagger inventory excludes the removed endpoint. Earlier follow-up entries describe their historical source snapshots and are retained rather than rewritten as current behavior.

Executed verification:

- `TEST_REDIS_URL=redis://127.0.0.1:56380 npm run test:integration -- test/integration/booking-lookups.spec.ts test/integration/booking-api.spec.ts test/integration/directory-cache.spec.ts test/integration/service-catalog.spec.ts`: **93 passed**.
- `TEST_REDIS_URL=redis://127.0.0.1:56380 npm run test:all`: **165 default tests and 214 PostgreSQL/Redis integration tests passed**. Existing qualification, inactive/wrong-dealership resources, ownership, client-resource-ID rejection, resource concurrency, interval, idempotency/restart, and cancellation assertions remain intact. No failed run was retried or assertions weakened; the focused/full runs passed on their first execution. A dangling roster DTO declaration was caught by typecheck during cleanup and removed before running these suites.
- Build/Prisma generation, typecheck, lint, formatting, and diff checks passed.

README, Swagger descriptions, specification, system design, demo commands, environment comments, and agent scope now describe the remaining lookups and two caches. Old roster cache entries are allowed to expire; no Redis cleanup/flush is performed. No migration, dependency, configuration value, replacement endpoint, load benchmark, commit, push, or deployment was added. The staged binary diff SHA-256 remains `7aa71080c1108d66f0bcd01746b856703e0e2b6a67595c4a10e9693004a94f03`; this cleanup is unstaged so the user's staged snapshot is preserved.

## Final review corrections — 2026-11-05

The user approved the final review fixes after removing the optional technician-list API/cache in another session. That removal remains intact: the public route still returns 404 and is absent from Swagger, while internal technician eligibility, qualifications, assignment, and both database exclusions remain unchanged. This follow-up changes no booking policy, migration, dependency, capacity setting, or cache scope.

Corrected the load worker's duplicate listener start. createBookingApp already starts and owns one loopback listener; the worker now reads that listener's address instead of calling listen again. A new PostgreSQL-backed regression forks the real worker, waits for readiness, makes repeated health requests, and requires a clean process exit after stop. It bounds startup/shutdown and cleans up its own child/database on failure. Before the fix, this regression failed because the worker exited before readiness; the earlier review's standalone probe identified ERR_SERVER_ALREADY_LISTEN.

The exception filter now logs every classified HTTP failure with request ID, method, final status, and safe public outcome code. It uses warning severity for 4xx and error severity for 5xx, retaining safe error type/SQLSTATE diagnostics for server failures. Request duration remains in the separate completion event. A focused HTTP suite verifies 400 DTO validation, 404 missing customer, 422 ownership rejection, 503 database unavailability, and 500 unexpected failure. It requires one classified warning/error per failure, correlation with the response, and omission of private input/error details. All five regressions failed before the fix and passed afterward. The public error contract is unchanged.

Executed verification:

- `npm run db:test:up`: dedicated PostgreSQL and Redis services healthy.
- Focused logging and worker regressions passed after the corrections: five HTTP cases and one real child-process lifecycle case.
- `TEST_REDIS_URL=redis://127.0.0.1:56380 npm run test:all`: **170 default tests and 215 PostgreSQL/Redis integration tests passed**. This includes the removed-route/Swagger checks, strict twenty-request resource contention, alternative pairs/fresh transactions, rollback, idempotency/restart, and cache fallback/invalidation coverage.
- `npm run build`, `npm run typecheck`, `npm run lint`, `npm run format:check`, and `git diff --check`: passed. Initial lint/format issues in the new test files were corrected; they were not counted as passing checks.
- All three documented separate-process 100-request burst profiles passed: spread and adjacent intervals each confirmed/persisted 100 bookings and complete request records; identical-interval contention confirmed/persisted one booking/key and returned 99 availability conflicts. All had zero overload, unexpected errors, dropped work, invalid assignments, incomplete keys, or resource overlaps. [LOAD_RESULTS](../LOAD_RESULTS.md#final-review-burst-rerun--2026-11-05) records commands, source fingerprint, environment, and measurements.

The two engineering findings are corrected and the tested software candidate is ready with its documented MVP limitations. The required 5–10 minute recording/link, final repository publication/access, and independent comparison with the unavailable original assessment remain manual submission checks. This follow-up does not claim they are complete. Historical failed load trials and earlier unexplained HTTP observations remain preserved; the latter did not recur in this full run. No sustained-rate benchmark, new fresh dependency installation, production deployment, commit, push, or recording was performed.

## Reliability boundary tests — 2026-11-05

The user approved two focused additions after a review of business scenarios and assertions. Both passed against the existing application; no runtime change was required.

- The booking unit test models a successfully completed transaction whose result arrives after the nominal five-second budget. It advances the monotonic clock without sleeping and requires the saved success to return, with no retry or duplicate write and no admission slot left active. This protects the policy that an acknowledged commit must not become a timeout response merely because completion arrived late; it is an orchestration test, not a measured database latency claim.
- The PostgreSQL/HTTP test holds a real uncommitted key claim in one app instance and submits the equivalent request to another. It releases the owner only after the waiting INSERT has actually produced BookingKeyBusy from the database lock timeout. The same waiting HTTP request must internally retry in fresh PostgreSQL transaction IDs, preserve its original deadline and one allowed allocation attempt, and return 201 with the owner's exact saved body and replay header. The waiting instance must perform no appointment insertion. Final state requires one appointment, one complete key record, zero resource overlaps, and no admission leak. Barriers observe the real operations; no database result/error is fabricated and no arbitrary sleep orders the requests.

Executed: the focused booking unit suite passed 23 cases and the focused idempotency integration suite passed 29 cases. After adding the shared-deadline assertion, `TEST_REDIS_URL=redis://127.0.0.1:56380 npm run test:all` passed **171 default tests and 216 PostgreSQL/Redis integration tests**. Typecheck, lint, formatting, and diff checks passed. Existing assertions were retained, including the removed technician route, twenty-request contention, alternative resource allocation, rollback, restart/replay, and cache behavior.

This follow-up changes only the two test files and this evidence document. Earlier staged changes are preserved. No load benchmark was repeated for these test-only additions; earlier burst measurements keep their recorded source fingerprint. No application, schema, dependency, configuration, scope, commit, or publication change is included.

## Holiday peak measurement — 2026-11-05

The user requested an interview-ready measurement of occasional holiday booking spikes. Added a bounded holiday-day fixture to the existing load runner: twenty dealerships, two eligible resource pairs per dealership, sixteen half-hour slots, and at most 640 requests with sufficient appointment capacity. No booking implementation, admission setting, database constraint, dependency, or public endpoint changed. The technician-list removal remains intact.

The runner now samples burst activity every 100 ms, counts overload/error outcomes separately, gates health warmup, and checks post-burst health and authoritative availability reads for the holiday profile. It still requires every request to confirm when resources exist; overload remains a strict failure. Isolated SQL checks reconcile appointments and complete idempotency records and verify ownership, qualifications, duration, active/dealership scope, resource non-overlap, and the appointment-day window.

Final trials: 100 requests/one process passed; 250/one failed with 137 confirmations and 113 BOOKING_BUSY responses; 250/two passed; 500/two failed with 272 confirmations and 228 BOOKING_BUSY responses; 500/four passed. The successful 250/two and 500/four configurations each passed a second run. A 250-request/two-process popular-time trial passed with one confirmation and 249 availability conflicts. All final database invariants held and all holiday post-burst read probes passed. The failed 250/one trial also had 98 health warmup connection resets, whose cause was not isolated. Initial diagnostic trials and failures are retained, not relabeled.

Executed checks for this follow-up: `npm run typecheck`, `npm run lint`, `npm run format:check`, and `git diff --check` passed; `npm run test:concurrency` passed six real PostgreSQL cases; `npm run test:integration -- test/integration/load-worker.spec.ts` passed its real child-process case. CLI checks rejected holiday rate mode and 641-request bursts before database creation. The earlier full 171/216 suites were not rerun for these load-tool/document changes. Each load run owned and cleaned up its disposable database and local workers. [HOLIDAY_PEAK](../HOLIDAY_PEAK.md) records exact commands, results, source fingerprints, environment, limitations, and report paths.

These results support an explanation of bounded admission and manually adding prestarted workers for a predictable burst. They do not establish automatic scaling, cloud costs/savings, sustained throughput, production sizing, or post-overload booking-write recovery. No deployment, purchase, commit, push, or recording was performed.
