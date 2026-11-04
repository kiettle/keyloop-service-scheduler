# Durable appointment booking idempotency

Approved addition — 2026-11-04. This is the selected P1 enhancement, not an original Keyloop requirement. It protects one booking intent across double submissions, network retries, and lost commit acknowledgements using the existing PostgreSQL database. It adds no cache, broker, deployment, or frontend.

## Client contract

POST /api/v1/appointments requires exactly one UUID v4 Idempotency-Key header. Header names and UUID casing are case-insensitive; keys normalize to lowercase. GET endpoints do not require keys. Body/header syntax is always validated; unknown body fields remain rejected.

| Situation                                                        | Response                                       | Persisted effect                                      |
| ---------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------- |
| New key and successful booking                                   | 201; Idempotency-Replayed: false               | One confirmed appointment and complete request record |
| Same successful key and equivalent body                          | 201; Idempotency-Replayed: true; original body | No additional booking                                 |
| Same successful key and changed body                             | 409 IDEMPOTENCY_KEY_REUSED                     | No additional booking                                 |
| Missing, invalid, or repeated header                             | 400 VALIDATION_ERROR                           | No key consumed                                       |
| Failed or rolled-back booking                                    | Existing safe error contract                   | No key consumed                                       |
| Concurrent duplicate remains blocked until shared budget expires | 503 BOOKING_TIMEOUT; Retry-After: 1            | No additional booking; retry the same key             |

Each response carries the current HTTP attempt's x-request-id; saved bodies contain only the public appointment fields. Successful keys never expire. Only successful commit binds a key permanently: a failed attempt may later succeed using the same key, and no business-error response is cached.

Frontend clients generate a key once per booking intent, for example with crypto.randomUUID(), and share it across duplicate submits and retries. Preserve the key until an uncertain outcome is resolved. Do not generate a new key for each HTTP attempt. Different keys are independent intents, even with identical payloads; this feature does not enforce vehicle non-overlap or protect request delivery. No frontend implementation is included.

Keys are globally scoped to this endpoint because this assessment has no authenticated principal. All five request fields participate in the fingerprint; reusing a successful key for another customer/dealership is rejected. Keys do not provide authorization. A future authenticated API must authorize the caller before replay and define principal scoping explicitly.

## Data and transaction design

The ninth Prisma model, AppointmentBookingRequest, maps to appointment_booking_requests. Its additive migration preserves the original domain tables, data, seeds, and both resource exclusions. Existing appointments need no backfill. Apply npm run db:migrate; no database reset is required or performed by this feature.

The UUID key is the primary key. A fixed-order SHA-256 fingerprint includes v1:POST:/api/v1/appointments, the four lowercased UUIDs, and startAt serialized to UTC milliseconds. JSON field order, UUID casing, equivalent offsets, and equivalent fractional precision do not change the intent. Every actual field change does.

The record also stores a unique nullable appointment foreign key, nullable JSONB response, and creation timestamp. SQL checks validate the fingerprint and pair the nullable fields, requiring an object when complete. Foreign keys restrict deletion/update of the linked appointment identity. A claim starts with both fields null inside an uncommitted transaction; every normal success path fills both, and every failure throws to roll back. The paired-field CHECK does not itself prevent a direct writer from committing two null fields. Such unexpected incomplete state, or a malformed snapshot, produces a safe 500 and is never silently reclaimed. The application is the only supported booking writer.

The booking flow is:

1. Validate HTTP syntax, normalize the input, compute its fingerprint, and enter BookingCapacity using the existing shared deadline.
2. In a fresh READ COMMITTED transaction, INSERT the key/fingerprint with ON CONFLICT (key) DO NOTHING RETURNING key. Uniqueness coordinates the same key across app instances.
3. If another transaction committed that key, use a subsequent statement to read its fingerprint and validated response snapshot. Match returns the original body; mismatch rejects reuse. The separate statement is important because the INSERT snapshot may not see the conflict winner. See [PostgreSQL READ COMMITTED behavior](https://www.postgresql.org/docs/17/transaction-iso.html).
4. A new owner performs authoritative business validation and allocation using the existing booking path. Store the typed public response and appointment reference, then commit them with the appointment. Return success only after transaction completion.
5. Replay skips current future-time, catalog, ownership, and resource/availability reads because it returns the original committed result. Header/body syntax is still validated. GET appointment returns the current persisted public record; replay returns its saved creation response.

Key claims use ordinary PostgreSQL unique-index coordination, not explicit technician/bay row locks, advisory locks, or an in-memory duplicate map. Resource exclusions still guarantee non-overlap; the admission gate still bounds per-process work.

## Failure handling and retention

An allocation conflict rolls back the entire transaction, including the key claim, before fresh allocation. The default remains four allocation attempts. Another same-key request may become the owner after rollback; only the successful commit binds the key.

A 55P03 lock timeout specifically from the claim INSERT becomes an internal key-busy signal. The repository finishes rollback before the application waits with 25–50 ms jitter and opens a fresh transaction. Key waiting does not consume allocation attempts, but queueing, waiting, allocation retries, and backoff all consume the existing monotonic booking budget. No database connection is held during backoff. Other database errors retain their existing classification.

Defaults remain eight active operations, 128 pending requests, ten pool connections, and a five-second booking budget per app process. Database defaults remain 250 ms lock, 2 s statement, and 5 s transaction timeout. Cleanup, commit, and network overhead mean these are not a strict HTTP-response deadline. Queued cancellations leave no claim; an already executing request may still commit. A connection failure during commit is not automatically replayed by the server; the client retries with its original key to discover the result.

Successful records remain indefinitely with their appointment. There is no TTL, processing lease, cleanup job, or automatic deletion. Indefinite retention has a storage cost and would need an explicit operational policy before a real deployment. Logs distinguish creation, replay, and key mismatch using request/appointment IDs; they do not log raw keys, request bodies, or saved responses.

## Verification

The dedicated [PostgreSQL/HTTP suite](../test/integration/booking-idempotency.spec.ts) covers sequential and concurrent replay, normalization, all five changed fields, 100 same-key requests across two instances, rollback at three transaction stages, failed-key reuse, changed catalog/time replay, lost-response recovery after app restart, real key-lock expiry/recovery, queue disconnect, header validation, corrupt-state safety, and actual SQL constraints. Unit tests cover orchestration and canonicalization/snapshot guards. Original resource-contention assertions use distinct keys and remain unchanged.

Execution results for the completed implementation are recorded below. Historical performance reports in [LOAD_RESULTS](LOAD_RESULTS.md) predate this feature unless explicitly labeled otherwise. No sustained-rate capacity is inferred from correctness or burst tests.

## Executed evidence — 2026-11-04

Measured working candidate, based on commit 9fb59f40eb21a081ddd285d61b6c09cdcaf99f3a. Source SHA-256: `123ec55363b05f329d11f10ac33c87fe55fffd5255f92209638bdfb76ab468ec`. The digest covers 76 files: sorted relative paths and contents under src, prisma, scripts, and test, plus package/lock files, both tsconfigs, both Vitest configs, .env.example, compose.yaml, and prisma.config.ts; each path and content is followed by a NUL separator. Documentation is excluded. The digest remained unchanged through the final correctness suite, burst runs, and executed demo. This is working-source evidence, not a committed-checkout or deployment claim.

Final commands and outcomes:

- `npm run prisma:generate`, `npm run prisma:validate`, `npm run build`, `npm run typecheck`, `npm run lint`, `npm run format:check`, and `git diff --check`: passed.
- `npm run test:all`: **138 default tests and 175 real PostgreSQL tests passed**. The PostgreSQL suite includes 26 dedicated idempotency cases, the existing strict contention/alternative-pair cases, and database/API/resilience coverage.
- `npm run test:concurrency`: **six passed** in the focused run; these are a subset of the full suite, not additional unique tests. The subsequent final full run also retained all six after the replay-serialization correction.
- All three commands below exited 0. They ran sequentially after the correctness suite, with distinct keys, separate app processes, migrated/seeded/configured disposable databases, and direct persisted-state assertions.

```sh
npm run test:load -- --mode burst --count 100 --workload spread --report artifacts/idempotency-burst-spread-100.json
npm run test:load -- --mode burst --count 100 --workload same-resource --report artifacts/idempotency-burst-adjacent-100.json
npm run test:load -- --mode burst --count 100 --workload hotspot --report artifacts/idempotency-burst-hotspot-100.json
```

| Profile                      | Started | 201 | 409 | 503 / other / dropped | Appointments / complete key records | p95 ms | p99 ms | Client start offsets ms | Result |
| ---------------------------- | ------: | --: | --: | --------------------- | ----------------------------------- | -----: | -----: | ----------------------- | ------ |
| Spread, twenty dealerships   |     100 | 100 |   0 | 0 / 0 / 0             | 100 / 100                           | 288.40 | 299.40 | 2–7                     | PASS   |
| One pair, adjacent intervals |     100 | 100 |   0 | 0 / 0 / 0             | 100 / 100                           | 501.23 | 514.42 | 1–25                    | PASS   |
| One pair, identical interval |     100 |   1 |  99 | 0 / 0 / 0             | 1 / 1                               | 447.76 | 449.51 | 4–19                    | PASS   |

Environment: Apple M2, eight logical CPUs, 16 GiB RAM, macOS arm64, Node 24.21.0, PostgreSQL 17.6 in Docker, k6 2.3.0. Each profile used two separate app processes, eight active booking slots and a ten-connection pool per process, 128 pending, and the existing five-second budget. Generator/apps/database shared one laptop. HTTP connections were warmed before a client barrier; offsets are actual client starts, not exact server simultaneity. JSON logging was enabled with stdout discarded; no collector or production networking was benchmarked. Reports remain locally under ignored artifacts/. All three profiles had zero technician/bay overlaps, invalid associations, or incomplete key records. These are burst measurements, not sustained capacity, and should not be presented as controlled before/after performance comparisons.

Executed `DEMO_GUIDE` sections 3–5 verbatim in a temporary shell against an isolated app/database using the actual current clock. New creation, exact-byte replay comparison, changed-body rejection, the alternative resource pair, and sold-out conflict passed; final state was two appointments and two complete request records. Local output is retained in artifacts/idempotency-demo-output.txt. All three system-design Mermaid diagrams parsed and rendered using the existing temporary Mermaid 11.12.0 tooling in the browser. Documentation file/heading checks passed; temporary app/diagram processes were stopped and the test server reported zero remaining `scheduler_test_*` databases. Developer data and the Git index were unchanged; no commit or push was performed. A full fresh npm installation or production deployment was not repeated.

Review corrections are retained as real AI-collaboration evidence: a new unit regression first failed because JSONB reordered response fields; replay now reuses the public serializer, and HTTP tests assert identical response bytes. The initial direct-Node Mermaid check lacked DOM APIs; browser verification then exposed sequence-text semicolons, which were corrected before all three diagrams rendered. Initial Docker access needed local execution permission; rerunning the approved test-service command with that access succeeded. Early type/lint/whitespace checks were corrected and final checks passed. None of these failed checks is counted as a pass. No sustained-rate investigation was run; 1,000 successful bookings/second remains an unverified future stretch goal.

## Compatibility and maintainability review — 2026-11-04

Reviewed the staged implementation's HTTP validation, fingerprint normalization, snapshot serialization/guards, key claiming, error classification, shared deadline, allocation retries, transaction rollback, SQL constraints, and existing API behavior. No additional runtime defect was found. Kept the production code, schema, dependencies, capacity/timeouts, and load clients unchanged; the small booking-specific helpers each retain one concrete responsibility. The required POST key header remains the explicitly approved contract change, while GET behavior and older appointments without request records remain supported.

Added two real-PostgreSQL compatibility checks in the existing suite: a waiting same-key request takes ownership after the first transaction rolls back and its result subsequently replays; an older keyless appointment remains retrievable and unchanged while a new booking uses the remaining resource pair. Extended the existing barrier-based race test without new test infrastructure. Strengthened the existing UUID-case fingerprint test with hexadecimal letters because the numeric-only seed IDs did not exercise casing.

Executed `npm run db:test:up`, `npm run prisma:validate`, `npm run build` (including Prisma generation), `npm run typecheck`, `npm run lint`, `npm run format:check`, `git diff --check`, and `npm run test:all`. Final full-suite result: **138 default tests and 177 PostgreSQL tests passed**. The latter includes 28 idempotency cases and the existing six resource-concurrency cases. An initial test-only unsafe-type lint finding was corrected before the final lint pass. The focused idempotency suite was also rerun after that assertion cleanup (28 passed), and `npm run test:unit` passed after strengthening the normalization assertion. No load test was repeated because application, database, and load-generator behavior did not change; the earlier burst evidence above remains labeled with its measured source fingerprint. Existing staged changes were preserved; developer data was not migrated/reset, and no commit or push was performed.
