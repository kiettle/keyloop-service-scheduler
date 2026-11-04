# Booking concurrency — approved design and verification

Date: 2026-11-03, Asia/Ho_Chi_Minh. **Approved and implemented.** The user approved the replacement and capacity safeguards after reviewing the prototype. The application uses conflict-aware inserts, bounded admission, a monotonic booking budget, server-side timeouts, and backoff after rollback. SPEC section 7 records the approved policy. The historical prototype evidence below is separate from integrated verification at the end. No E-commerce files were changed.

Current goal revision — 2026-11-04: keep the **100-request burst** resilience criterion; **1,000 successfully committed bookings/second is an unverified future stretch goal**, not submission acceptance or a verified Keyloop traffic requirement. Historical decision: the former 10,000-bookings/second requirement is withdrawn. See [CAPACITY_PLAN.md](CAPACITY_PLAN.md). All prototype and integrated measurements below remain historical evidence for their stated source/configuration; no load tests were rerun for this documentation-only revision.

Subsequent approved addition: [durable booking idempotency](IDEMPOTENCY.md) adds an atomic key claim and saved response to the existing transaction. Historical prototype/load numbers below predate that change. Resource allocation, exclusion constraints, capacity limits, and deadlines remain; distinct-key regressions preserve the original contention tests.

On 2026-11-04 the user approved fixed role/database timeout defaults, replacing per-booking configuration. Current policy is 250 ms lock, 2 s statement, and 5 s transaction timeout; the application retains its shared deadline and remaining-budget Prisma timeout. The original prototype/time-budget experiments below are historical. Setup and verification are recorded in DATABASE.md and LOAD_RESULTS.md.

## Target and scope

The assessment resilience criterion and optional future stretch investigation are separate profiles:

| Profile         | Defined workload                                                                                             | Purpose                                                                       | Evidence boundary                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Burst criterion | **100 independent valid HTTP booking requests** released from a barrier; report actual launch spread         | Allocation races, correctness, latency, overload recovery                     | Historical integrated profiles passed; see results below               |
| Future stretch  | **1,000 successful bookings/second**, with an initial **60-second** measurement window after separate warmup | Investigate sustained committed-booking throughput; not submission acceptance | **Unverified; historical minute trials failed. See CAPACITY_PLAN.md.** |

For the 100-request criterion, sufficient eligible resource/time capacity must yield 100 confirmations; a single technician and bay at an identical interval must yield one confirmation and 99 availability conflicts. Require exact persisted counts, valid assignments, zero overlaps, and no overload or technical failures. Preserve the mandatory 20-request regression and alternative-pair tests. Retain the previously executed 1,000-request burst as historical stress evidence; do not relabel it as the 100-request profile or sustained throughput. A configured target is not measured capacity. Sixty seconds is an initial future rate investigation, not an endurance/soak claim.

### Measure before sizing

For a stable workload, use the averages in Little's law:

```text
average requests in flight = arrival rate × mean end-to-end response time
```

Use observed mean latency, not assumed latency or p95, before drawing sizing conclusions. If queues grow continuously, the system is not sustaining the offered arrival rate; report that overload rather than presenting a stable-capacity calculation.

Database sizing is a separate calculation: average busy connections approximately equals transaction attempts/second multiplied by mean connection-holding time, including lock waits. Retries, advisory reads and other database work add demand. Measure actual hold time, query plans, CPU and I/O before choosing pool/instance counts; increasing connections alone does not create database capacity. Keep one PostgreSQL writer and the current safeguards; no database distribution is justified by an unverified stretch goal.

For any future sustained-rate investigation, use an open arrival model that schedules requests independently of previous response completion. A loop that waits for responses before sending more requests reduces offered load when the server slows and does not demonstrate 1,000 requests/second. A k6 constant-arrival-rate profile can implement this, with one booking request per iteration; report actual request-start rate, dropped iterations, completed response rate, unfinished work and generator saturation. See [open and closed models](https://grafana.com/docs/k6/latest/using-k6/scenarios/concepts/open-vs-closed/) and [constant arrival rate](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/constant-arrival-rate/).

State the request mix explicitly. Initially make the throughput target booking-POST-only; measure availability/retrieval separately and during contention. Provide enough distinct eligible resource/time capacity for the successful-booking profile. Run a separate hotspot profile where 409 conflicts are expected. Report confirmed bookings/second separately from total responses/second; 1,000 sold-out responses/second does not establish 1,000 successful bookings/second. Verify successful responses match persisted rows and that resource overlaps remain zero. Numeric latency/error/overload budgets still need agreement before production acceptance.

Improve booking concurrency within the existing NestJS/PostgreSQL/Prisma modular monolith. Preserve API fields, active/qualification/ownership/dealership rules, half-open intervals, both exclusion constraints, commit-before-success, and the four-attempt default. No Redis, Kafka, microservices, new business endpoints, cancellation, or idempotency is proposed in this change.

## What the E-commerce reference actually does

The current inventory reservation path uses a transaction, ordered `FOR UPDATE` locks on reservation/stock rows, conditional quantity updates, unique/check constraints, and replay-safe reservation identities. The conditional normal-stock update requires active status and sufficient available quantity. The inspected path does not use a version column to arbitrate reservations.

Reference locations in `/Users/kietle/Documents/personal/projects/e-commerce-clone`:

- `apps/inventory-service/src/inventory/infrastructure/persistence/prisma/inventory.prisma.repository.ts`: `reserveStock` (around lines 93–198); lock helpers (around lines 500–541).
- `docs/interview-guide/08-inventory-reservations-and-concurrency.md`: invariants and lock ordering.
- `docs/flash-sale-verification-report.md`: warm 1,000-buyer trials around lines 145–200.

The recorded 1,000-buyer warm bursts produced 200 purchases / 800 sold-out responses, around 250 total responses/second, and about 3.9-second median per-run p95. Larger levels missed that project's latency targets. Those are historical reference results, not tests rerun here and not sustained 1,000 requests/second. Its multi-service checkout and this scheduler are different workloads; comparing their latency as a speedup would be misleading.

Reuse database-enforced invariants, short transactions, consistent error handling, bounded resource usage, and repeatable load/invariant reporting. Do not transplant stock counters, distributed checkout infrastructure, or one lock per resource regardless of appointment time. A stock unit is consumed from a counter; scheduling allocates two resources over an interval.

## Options investigated

| Option                                         | Observation                                                                                                                                                                               | Decision                                                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Plain INSERT + constraints + retries           | Correct exclusions, but repeated application tests reproduced GiST-related deadlock storms                                                                                                | Keep constraints; improve the write path                                                    |
| Lock technician then bay rows                  | Narrow existing fix passed the strict contention tests; still serializes unrelated times sharing a resource                                                                               | Keep as current baseline pending replacement verification                                   |
| Select eligible rows with SKIP LOCKED          | In an isolated 100-operation prototype, one contested interval produced 1 success / 99 unavailable; 100 non-overlapping intervals produced only 32 successes / 68 retry-exhausted results | Reject a simple replacement: temporary row contention unnecessarily affects different times |
| Time-bucket advisory coordination              | Requires bucket boundaries, bounded lock counts, collision handling, and a consistent protocol across all writers                                                                         | Not implemented or benchmarked; defer this extra policy unless simpler options fail         |
| Conflict-aware INSERT with existing exclusions | SQL and real HTTP prototypes passed the tested 1,000-request workloads without explicit resource-row locks                                                                                | Recommended candidate                                                                       |

`SKIP LOCKED` is not a general availability guarantee: skipped rows may simply be locked. A missing lockable row cannot automatically mean 409. See [PostgreSQL SELECT locking semantics](https://www.postgresql.org/docs/17/sql-select.html#SQL-FOR-UPDATE-SHARE).

## Implemented write path

1. Validate DTOs and admit only bounded booking work before acquiring a connection.
2. Begin a short READ COMMITTED transaction with the remaining-budget Prisma timeout; database safety defaults are inherited from the role/database configuration.
3. Validate references/ownership and reuse shared duration/eligibility queries. Select candidates in stable ID order.
4. Attempt one complete appointment insert using `INSERT ... ON CONFLICT DO NOTHING RETURNING ...` with both immediate partial exclusions unchanged. Do not acquire technician/bay row locks first.
5. A returned row is a provisional success; return 201 only after commit.
6. If no row is returned, distinguish resource contention from an unrelated unique identity collision, throw a typed allocation conflict, and roll back the attempt. A skipped insert is never a booking confirmation.
7. After rollback, retry with fresh validation/allocation. Keep four total attempts, add small jittered backoff outside the transaction, and enforce one total request deadline (default 5,000 ms).
8. Empty fresh eligible candidate sets give 409. An exhausted contention/deadline/admission budget gives a retryable 503. Validation and unexpected failures never become NO_AVAILABILITY.

PostgreSQL supports DO NOTHING for exclusion conflicts, with returned rows representing actual inserts. Its speculative insertion path specifically handles the exclusion-insertion deadlock/livelock problem differently from plain INSERT. See [INSERT documentation](https://www.postgresql.org/docs/17/sql-insert.html#SQL-ON-CONFLICT) and [PostgreSQL 17 executor source, speculative insertion commentary](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/backend/executor/execIndexing.c). This is not a claim that every database wait or possible deadlock disappears.

The installed Prisma 7.10.1 prototype used `appointment.createManyAndReturn` with one data item and `skipDuplicates: true`; query logging verified `ON CONFLICT DO NOTHING`. Add a comment explaining why this single-item write deliberately uses that API. No custom SQL framework is needed.

### Do not hide other failures

DO NOTHING without a conflict target handles both exclusions but can also skip a primary-key collision. The prototype generated an appointment UUID, checked for that UUID after a skipped insert, and treated an existing identity as an unexpected failure. The production implementation must test this guard and revisit the classification if another appointment unique constraint is added. The current schema has the primary key and the two exclusions as arbiters.

Keep verified SQLSTATE classification for ordinary/direct writes and other aborted transactions. ON CONFLICT returns no row for its handled conflict rather than raising 23P01; tests must assert that explicit typed outcome, not fabricate a PostgreSQL error. Unexpected errors must still propagate. Preserve direct Prisma/SQL tests proving both constraints raise 23P01 when ON CONFLICT is not used.

Reference validation must happen before insertion. In the SQL experiment, a conflicting appointment caused DO NOTHING to skip an insert before a bad foreign key was checked. The foreign-key error check was therefore moved to a free interval, where an actual insert was attempted. This does not justify removing application validation or accepting unrelated errors as allocation conflicts.

## Protect the application under overload

The integrated implementation includes these safeguards:

- **Bounded admission:** allow eight active bookings and 128 pending by default, with a ten-connection per-instance pool. Both capacity limits are configurable within validated ranges. Pending work shares the overall booking budget. Waiting for admission must not hold a database connection. Reject excess work promptly with a documented retryable 503. A per-process gate protects capacity; PostgreSQL still protects correctness across instances. Remove cancelled queued requests.
- **One deadline:** include admission, connection acquisition, database work, retries, and backoff. Do not multiply an effectively unbounded client delay by the number of attempts.
- **Server-enforced budgets:** fixed role/database defaults bound waits, including implicit index/FK locks, individual statements, and transaction lifetime. Apply 250 ms lock / 2 s statement / 5 s transaction limits once during database setup, and reconnect. Booking sends no timeout-configuration SQL. Prisma uses the remaining request budget per attempt; fixed server limits are independent of time already spent queueing. Cleanup/commit/network time can exceed the nominal request budget. These are initial settings, not measured production SLOs. See [PostgreSQL timeout settings](https://www.postgresql.org/docs/17/runtime-config-client.html#GUC-LOCK-TIMEOUT).
- **Narrow error policy:** lock timeout 55P03 is contention; statement cancellation 57014 is a temporary failure/503, without automatic replay that amplifies load. Keep exclusion/deadlock/serialization handling; transaction timeout 25P04 is also a temporary failure. P2028 before callback entry is acquisition failure; after callback entry and expiration of the overall deadline it becomes BOOKING_TIMEOUT. Closed-transaction bugs before expiration remain unexpected. Do not replay ambiguous connection/commit failures. Verify the installed driver's actual shapes.
- **Pool budget:** account for all instances and other database clients. Do not increase connections in proportion to client count. Leave capacity for retrieval/availability and operational queries; headroom alone is not a guarantee against every overload.
- **Observability:** record queue wait, attempt count, database/total duration, and outcome with request IDs. Load reports should include connection/lock waits, latency and success/rejection counts, generator load, and post-run SQL invariants. No external monitoring stack is required for this change.

## Executed prototype evidence

Environment: Apple M2, 8 logical CPUs, 16 GiB host memory, macOS arm64/Darwin 22.6.0, Node 24.21.0; existing PostgreSQL 17.6 dedicated test server. Every experiment used a fresh UUID-named database, actual migration/seed, and real PostgreSQL queries. Development data was not reset.

The application repository write and transaction-timeout wrapper were replaced **only inside a temporary child-process prototype**, retaining the real AppModule, controllers, validation, scheduling, use cases, transaction/commit logic and Prisma queries. Database results were not mocked. This evaluates the candidate; it is not verification of an integrated application patch.

Two Nest application instances ran with independent ten-connection pools. A Node HTTP generator warmed 1,000 independent keep-alive connections via /health, then submitted the bookings in a burst. Warmup/fixture creation are outside the measured interval. Generator and apps shared one process/host, not separate production machines. Launch spread was 7–18 ms in the repeated trials; exact server-side simultaneity was not measured.

**Three repetitions of four workloads: 12,000 submitted HTTP bookings.** Each trial exited 0. No unexpected HTTP errors occurred; all database assertions passed.

| Workload per trial                                                 | Expected and observed HTTP outcomes in all three trials | Persisted rows | p95 range across trials |
| ------------------------------------------------------------------ | ------------------------------------------------------- | -------------: | ----------------------: |
| 1,000 requests, one pair, identical interval                       | 1 × 201; 999 × 409                                      |              1 |            866–1,040 ms |
| 1,000 requests, two pairs, identical interval                      | 2 × 201; 998 × 409                                      |              2 |            763–1,107 ms |
| 1,000 adjacent/non-overlapping intervals, one pair                 | 1,000 × 201                                             |          1,000 |          1,128–1,468 ms |
| 1,000 requests across ten dealerships, distinct intervals per pair | 1,000 × 201                                             |          1,000 |          1,040–1,086 ms |

Each run directly checked exact confirmed counts, zero technician/bay overlaps, correct ownership/dealership/qualification/active flags, and catalog-derived interval lengths. Responses/s is deliberately not reported as sustained throughput. No production SLO or general capacity claim follows from these local burst trials.

Separate SQL probes exercised held resource locks, unrelated-dealership progress, and rollback without a partial appointment. A held-lock probe is necessary even without explicit resource locks because foreign-key and exclusion checks can still wait. Further SQL semantics checks passed: both independent resource conflicts skipped insertion, adjacency and CANCELLED rows inserted, and a duplicate identity was detected separately. A free-interval invalid foreign key raised 23503; an invalid interval raised 23514. An actual held-lock wait aborted with 55P03 after 107 ms under a 100 ms lock timeout. A deliberately slow statement raised 57014 under a 20 ms probe timeout. Both transaction-local timeout settings returned to their original values on the same reused backend connection after rollback. These are observed local probe results, not hard latency guarantees.

Temporary execution commands were `node /private/tmp/keyloop-allocation-prototype.cjs`, `node /private/tmp/keyloop-conditional-insert-prototype.cjs`, `node /private/tmp/keyloop-http-allocation-prototype.cjs` (three recorded repeat trials), and `node /private/tmp/keyloop-insert-semantics-prototype.cjs`. These temporary files are research tooling, not checked-in project commands or an automated release gate. The initial bare-Node runner could not find ts-node for seeding; adding node_modules/.bin to its child-process PATH matched npm's environment and corrected that setup. A committed load runner is required in the implementation stage.

## Implementation and verification checklist

1. Amend SPEC section 7 with the agreed conflict-aware insert result, identity-collision policy, database/request deadlines, and overload responses; leave resource exclusions and public booking fields unchanged.
2. Change only AppointmentRepository's insertion strategy first. Retain the architecture and typed conflict/retry boundary. Add regression checks for both skipped exclusions, unexpected identity collisions, rollback after a skipped insert, and foreign-key/CHECK failures on actual insert attempts.
3. Keep the shared deadline, apply fixed role/database timeouts once during setup, and test narrow timeout mapping. Prove cancellation releases locks/connections, replacement connections inherit defaults, and test-only overrides reset on a reused connection.
4. Add jittered retries outside completed rollback and bounded admission ahead of connection acquisition. Test overload response, queue cancellation/drain, and availability/retrieval responsiveness during a held booking lock. Configure these limits together, not independently guessed magic numbers.
5. Preserve the original 20-request exact 1/19 gate and two-pair success assertions. Add a controlled stale-candidate/external-writer case proving genuine fresh-transaction conflict recovery. The new write path can resolve ordinary collisions without a raw 23P01, so inspect typed outcomes and still verify actual database errors independently.
6. Add a reproducible isolated HTTP load runner and sanitized result reports. Run the four workload shapes at the newly requested 100-request burst size, retaining the 1,000-request burst as an additional stress profile; repeat with exact persisted outcomes. Keep cold-connection and warm-connection profiles separate; record source/hardware/pool/client settings. Do not hide failed trials or accept arbitrary 5xx errors.
7. Future stretch work only: measure sustained arrival rates in steps toward 1,000 successful bookings/second with controlled booking/reference-data distribution and distinct intervals. Stop when latency, errors, connection pressure, or generator limits breach agreed targets. The historical local minute trials failed; this does not block assessment submission. Follow CAPACITY_PLAN.md for evidence boundaries and future benchmarking. Retain failed or generator-limited results and report actual offered/completed rates; neither a configured rate nor burst results prove this goal. Numeric production latency targets remain to be agreed.
8. Run build/typecheck/lint/format plus the entire unit, PostgreSQL, HTTP and concurrency suites. Inspect constraints, final state, and disposable database cleanup. Preserve the user's Git index and developer database.

## Readiness boundary

**Recommendation: proceed with conflict-aware insertion plus bounded work/time budgets.** Reject SKIP LOCKED alone and defer custom time-bucket/advisory protocols while the simpler candidate meets measured workloads. The temporary row locks were removed together with the tested replacement. The original strict 20-request and two-pair HTTP invariants remain in the regression suite.

This implementation improves production-oriented booking concurrency. Authentication/authorization, durable client idempotency, operational recovery, hosted permissions, and other production controls remain separate decisions. The prototype does not make the whole application production-ready, does not prove sustained 1,000 requests/second, and does not replace implementation regression tests.

## Integrated implementation notes

The application uses the existing concrete repositories and use cases. New production files are `booking-capacity.ts` (one booking-specific admission gate) and `booking-deadline.ts` (shared monotonic budget check). There is no generic concurrency framework or distributed lock service. The controller passes a disconnect signal and removes its listener afterward. Queued cancellation frees admission immediately; an in-flight operation may still commit, so a lost acknowledgement remains ambiguous without durable idempotency.

Eligibility still uses two set-based queries and the same full-interval rules. Parameterized range predicates now match the existing partial GiST expressions directly, enabling those indexes as history grows. The schema, migrations, and seeds are unchanged. SQL plans are recorded by the load runner; a small fixture may legitimately choose another plan.

Configuration: BOOKING_MAX_CONCURRENT defaults to 8 (1–8), BOOKING_MAX_PENDING to 128 (0–1000), BOOKING_TIMEOUT_MS to 5000 (100–30000). The pool remains ten connections. Queue wait, retries, and backoff consume the same overall budget. Admission rejections log outcome and current active/pending counts. Backoff holds an admission slot but no database connection.

Database timeouts are separate fixed defaults, configured with npm run db:configure for the local application role/database. Existing connections must be replaced afterward. The same SQL is applied to each migrated/seeded temporary test database before fresh pools connect. A larger BOOKING_TIMEOUT_MS does not raise the fixed five-second database cap.

Regression tests include the existing direct 23P01 probes, forced allocation races/fresh transaction IDs, exact 1/19 outcomes, all interval cases, rollback and safe errors. Added tests cover skipped-write rollback, unrelated identity/foreign-key/CHECK errors, queue order/fullness/expiry/cancellation/shutdown, HTTP disconnect removal, real lock/statement/transaction timeouts, settings restored on the same reused backend, recovery after cancellation, and pool acquisition failure. Deadlock probes deliberately disable lock_timeout for that transaction so the actual deadlock detector is exercised; their assertions are not weakened.

### Load verification method

`npm run test:load -- --mode burst --count 100 --workload spread` runs the barrier burst. Repeat with `--workload same-resource` or `hotspot`. `npm run test:load -- --mode rate --rate 1000 --duration 60 --workload spread` is an optional future stretch diagnostic, not submission acceptance. Default: two separate Node processes, production environment, ten DB connections and eight active booking slots per process. JSON application logging is enabled but stdout is discarded by the harness; no external logging collector/transport is benchmarked. Rate-profile HTTP connections start cold and are reused thereafter; burst clients warm via health before a common clock barrier. Report actual start offsets, not exact server-side simultaneity.

The rate executor can schedule a handful of extra iterations at its duration boundary. The gate requires at least the planned arrivals and no more than 1% extra, zero dropped iterations/overload/technical failures, all expected outcomes, and persisted rows matching successes. Burst counts remain exact. Actual offered counts/rates must be reported; no reduced-rate run may be labeled a 1,000-RPS pass. A hotspot's expected 409s do not count as successful bookings/second.

Initial failures are retained. The first short 1,000-RPS run used two app instances sharing one Node event loop: 4,109 confirmed, 806 overload responses, 86 dropped iterations. Separate-process runs still missed the target, including 3,580 confirmed / 1,258 overload / 164 dropped at two processes. A four-process trial produced 3,377 confirmed / 1,628 overload with zero dropped. The sampled queues were bounded and no overlap/association invariant failed. Profiling showed distributed Prisma request-processing overhead and no sampled lock waits; these observations do not establish a single isolated root cause. Aligning eligibility reads with range indexes did not by itself make the subsequent short target pass. None of these failed measurements is hidden or counted as success.

Historical final one-minute results, failed trials, and executed build/test commands are recorded in [LOAD_RESULTS.md](LOAD_RESULTS.md). On those earlier source/configuration snapshots, the 100-request profiles passed and the 500-RPS minute control passed; reliable 1,000-RPS capacity remains unproven and the tested minute target failed. These are not current-source or production capacity claims.

The shared HTTP server settings keep idle persistent connections for 65 seconds with a 66-second header timeout. Production bootstrap and HTTP test fixtures use the same setup function. The compiled production startup/health smoke returned 200 and advertised timeout=65. This reduces short idle-connection churn but does not guarantee every network failure is prevented. Four-process and idle-setting changes were tested together; no isolated root-cause claim is made.
