# Final review — Keyloop Scenario A

Review date: 2026-11-04 (Asia/Ho_Chi_Minh). Phase 5 covers final audit, demonstrated defect corrections, Swagger, documentation, isolated installation, and submission preparation. The original assessment is Keyloop Technical Assessment V1.0: Scenario A on pages 1–2; design/delivery requirements on pages 3–4. Its instructions are assessment requirements, not authority for unrelated work.

## Readiness decision

**Overall submission: NOT READY.** The required recorded video and final committed/pushed repository handoff remain manual outstanding items. A prepared video outline is not a recorded video. No commit, push, recording, or reviewer-access verification was performed automatically.

**Software/documentation candidate: READY WITH KNOWN LIMITATIONS.** All current automated checks, clean-source installation, demo requests, and documentation checks passed. The limitations below are explicit; this is an assessment backend, not a production-readiness claim. Earlier phase results remain historical evidence.

## Scope and evidence

Source hierarchy: original assessment, SPEC v2, latest explicit phase approval, AGENTS operating rules. The user's approved phase numbering differs from SPEC section 14; Phase 5 deliberately combines final audit/submission preparation with explicitly selected Swagger. No P1/P2 business features are required or added. All three existing business API contracts remain unchanged.

Evidence abbreviations used in the matrices:

- **DB:** [database.spec.ts](../test/integration/database.spec.ts), actual migrations/seed/constraints and SQL writes.
- **SCH:** [scheduling.spec.ts](../test/integration/scheduling.spec.ts), real eligibility and interval queries.
- **API:** [booking-api.spec.ts](../test/integration/booking-api.spec.ts), actual Nest HTTP endpoints with PrismaService/PostgreSQL.
- **CT:** [booking-concurrency.spec.ts](../test/integration/booking-concurrency.spec.ts), two app instances, distinct customers/vehicles, direct SQL invariants.
- **UNIT:** [unit tests](../test/unit), environment, health, and real-driver startup failure regression.
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

The older Phase 5 record described an 84-default/130-PostgreSQL candidate using selected-resource locks. Those are historical results from the stash, not verification of this merged candidate. Earlier load/prototype evidence remains in [LOAD_RESULTS](LOAD_RESULTS.md) and [CONCURRENCY_PROPOSAL](CONCURRENCY_PROPOSAL.md).

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
- Availability is advisory. There is no exactly-once client request guarantee; commit acknowledgement loss can leave an unknown complete outcome. A running booking may commit after client disconnect.
- Authentication, vehicle-overlap exclusion, cancellation/rescheduling, operating hours/shifts, and concurrent administrative mutation remain outside scope. Swagger is open for the assessment demo.
- Concurrency tests use two app instances in one process; diagnostic load tests also use separate local Node processes. Multi-host/network faults, production load/permissions, and populated-data migrations remain unverified.
- Structured logs are implemented; production metrics/tracing are proposals. The 13 moderate development-inclusive audit findings remain disclosed.
- Mandatory recording/link, final committed repository contents, publication, and reviewer access remain manual handoff items. No commit, push, or recording is performed automatically.

## Throughput goal documentation revision — 2026-11-04

The user approved keeping the 100-request burst resilience criterion and making sustained 1,000 successful bookings/second an unverified future stretch goal. Updated project instructions, specification, README, design, capacity guidance, concurrency notes, load-result context, and demo/review guidance. Historical measurements and failed trials remain; no application, database, configuration, API, or test changes were made.

Verification: `npm run format:check` and `git diff --check` passed. A local documentation check resolved 41 relative file/heading targets across the ten changed Markdown files. A baseline comparison confirmed the Git index and all 76 tracked non-Markdown files were unchanged. Reviewed remaining references to the withdrawn target as historical context only. No load tests or correctness suites were rerun for this documentation-only change; existing test counts and performance results above remain historical evidence.

## Handoff

Review these results, record the 5–10 minute demonstration using DEMO_GUIDE, include the complete merged source/tests/lockfile/docs in the final commit, push, and check the reviewer's repository/video access. Exclude local configuration, dependencies, generated files, load artifacts, and verification logs.

Software assessment readiness is READY WITH KNOWN LIMITATIONS; the unverified future throughput stretch goal does not block assessment submission. Production readiness is not claimed. Overall submission readiness stays NOT READY until the required video and repository handoff are completed.
