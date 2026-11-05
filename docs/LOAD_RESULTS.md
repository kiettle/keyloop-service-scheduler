# Booking load verification

Recorded experiments: **3–6 November 2026**. Start with [capacity tuning — 2026-11-06](#capacity-tuning--2026-11-06) for the current limits and rate measurements. Larger holiday experiments have their own [results and limitations](HOLIDAY_PEAK.md). Earlier sections below preserve historical source snapshots and failed trials.

**Reliable sustained 1,000 successful bookings/second remains unverified.** The [full five-minute attempt](#full-five-minute-capacity-attempt--2026-11-06) failed with overload and timeout responses; post-run database verification also timed out. Earlier, one two-process minute trial passed and its identical repeat failed. All outcomes are retained below.

Separate experiment: [holiday surge measurements — 2026-11-05](HOLIDAY_PEAK.md) records the working-source fingerprint, all initial/final trials, repeat runs, overload failures, post-burst read recovery, exact commands, and limitations. It adds no sustained-rate or production-capacity claim. The historical results below retain their original scope.

Current goal revision — 2026-11-04: retain the 100-request burst resilience criterion; treat 1,000 successfully committed bookings/second as an unverified future stretch goal, not submission acceptance. The former 10,000-bookings/second requirement is withdrawn. The original measurements and command records below are historical local diagnostics from their stated source/configuration snapshots, not current-source or production capacity measurements. No load tests were rerun for that documentation-only revision. The separate [2026-11-05 burst rerun](#final-review-burst-rerun--2026-11-05) identifies its own working-source fingerprint and results. See [CAPACITY_PLAN.md](archive/CAPACITY_PLAN.md) for evidence boundaries and future benchmarking.

The original November 3 configuration did **not** meet the sustained 1,000-RPS target. It passed the 500-RPS / 60-second control and all final 100-request burst shapes. The November 6 section records the subsequent investigation separately; no failed trial below is reclassified as a pass.

## Repeatable capacity check

The optional `test:capacity` preset reuses `test/load/run-bookings.ts` and k6. It offers **1,000 new booking intents/second for 300 seconds**, using two app processes and 3,000 preallocated virtual clients. It is not part of `test:all` or the assessment's 100-request burst criterion. Adding this command does not establish the target.

After the README installation, ensure k6 is installed and `TEST_DATABASE_URL` points to the dedicated test server. Then run without competing builds, tests, or other load experiments:

```sh
npm run db:test:up
npm run test:capacity -- --report artifacts/capacity-run-1.json
# Repeat independently, keeping the first result even if it failed.
npm run test:capacity -- --report artifacts/capacity-run-2.json
```

Choose a fresh report name each time. The runner creates, migrates, seeds, and removes its own database and app processes; no separately running app is needed. Reports are local ignored artifacts. Once k6's summary is available, the runner saves it with host/configuration metadata and samples before database verification. Capture terminal output too: startup, missing summary, or filesystem failures can still prevent a report.

`verification.status` distinguishes `incomplete` (checks have not finished), `complete` (checks ran; inspect `passed` for their outcome), and `failed` (verification threw). A failed verification retains measurements with `passed: false`, `invariants: null`, and a safe error type/SQLSTATE when available. The command exits nonzero. `exitCode` in the report is k6's exit code, so it can be zero while verification fails; it is not the overall command result.

### What a passing report means

| Check                      | Expected evidence                                                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Offered traffic            | At least 300,000 requests started; zero dropped arrivals. A small number of boundary iterations is allowed.                                          |
| Successful new bookings    | Every request confirms; fresh keys prevent successful replays from inflating the count. No 409, overload, or unexpected responses.                   |
| Completions during traffic | In seconds 5–295, at least 290,000 successful HTTP completions; completions at least equal to starts in that window. The final drain does not count. |
| Persistence and integrity  | Acknowledged successes match persisted appointments and complete booking-request records; no invalid associations or technician/bay overlaps.        |
| Valid measurement          | Sampling succeeds and the command exits zero. Keep nonzero results as failures.                                                                      |

Review `rateMeasurement.confirmed / rateMeasurement.seconds` for the observed completion rate and `rateMeasurement.started - rateMeasurement.confirmed` for net growth in outstanding work across the window. This is an aggregate check; it does not promise 1,000 completions in every second or no temporary queue growth. `summary.metrics.booking_latency_ms.values` contains median, p95, and p99 latency, including all request outcomes. Fast rejection can make latency look better while throughput fails.

**Choose acceptable p95/p99 latency before a capacity decision.** The current runner reports latency but does not enforce a latency SLO. Its `passed` flag covers the checks above, not an agreed response-time objective. One passing run is insufficient; repeat it, inspect queue/latency behavior, and investigate inconsistent results rather than selecting the best run.

### How to investigate a failure

Read `workerSamples` for per-process CPU, memory, event-loop delay, and admission counts; `samples` records aggregate queue depth plus PostgreSQL active sessions and lock waits. These samples are evidence to guide investigation, not proof of a cause. Connection-pool acquisition latency and individual booking-query/transaction timings are not instrumented.

Use the existing `LOAD_CPU_PROFILE=1` option for a separate diagnostic run when application CPU is implicated. Profiling adds overhead. Saved `queryPlans` are post-run overlap probes, not plans for every booking query; examine actual slow queries with `EXPLAIN (ANALYZE, BUFFERS)` before changing indexes. Keep all booking exclusions, validation, retries, and success criteria intact. Change one factor, then repeat the same workload.

The fixture spreads bookings across twenty dealerships and non-overlapping future intervals with 1,000 customer/vehicle pairs. It establishes neither realistic demand nor representative production data. Apps, PostgreSQL, and the generator share a laptop; the runner launches ts-node workers with `NODE_ENV=production`, not a deployed service. Production sizing needs representative data, topology, traffic mix, separate resource-pressure measurements, and agreed latency/error objectives. See the [full five-minute attempt](#full-five-minute-capacity-attempt--2026-11-06) for the latest evidence; the earlier minute-long pass and failed repeat remain below.

**Preset verification — 2026-11-06.** `k6 inspect --include-system-env-vars` confirmed the five-minute preset's rate, client budget, total/window confirmation thresholds, and zero-drop/overload checks. `npm run test:capacity -- --rate 10 --duration 12 --instances 2 --vus 20 --report artifacts/capacity-profile-smoke-zqi9tcgf.json` passed with 120 confirmations, 120 persisted appointments/complete keys, and 20 starts/completions in the two-second middle window. There were no errors, dropped arrivals, invalid associations, overlaps, or incomplete keys; cleanup left no temporary databases. This validates command wiring, not target capacity. At preset creation, the full five-minute profile had not yet run; its subsequent failed attempt is recorded below. Typecheck, lint, and formatting checks passed. Source SHA-256: `02f1360c71a0e6f7825fd99f79fe27b5fe90a9fceaa089e32b7f515966d1b0a7`, using the 101-file method recorded below. This addition changes the package script and documentation only.

## Environment and scope

**Historical baseline — 3 November 2026.** The environment/settings and result table in this section describe that earlier source snapshot. Current limits and subsequent experiments are recorded in the dated sections below.

Apple M2, eight logical CPUs, 16 GiB host RAM, macOS arm64, Node 24.21.0, PostgreSQL 17.6 in Docker, k6 2.3.0. Load generator, application processes, and database share the host. Measured application source SHA-256 (src/prisma/package/TypeScript configuration files): `9b0a989903720ed3023fa312f4ddb203971a44f5face2fbe26d401805a495df5`. Verification used the complete working candidate; no committed-checkout or published-repository claim is made. The subsequent maintenance review below changed error handling and configuration validation; these load measurements describe the earlier source snapshot.

The final runner starts separate Node app processes in production mode, eight active booking slots and ten DB connections per process, five-second booking budget, and the stated bounded pending limit. Application JSON logging is enabled; stdout is discarded and stderr retained locally. External log collectors, hosted networking, and representative production datasets are not benchmarked. Bursts use warmed HTTP connections and a common clock barrier. Rate tests use open-model scheduling, cold connections initially and keep-alive thereafter. Test-created reference data supports the successful-booking profiles; a hotspot deliberately expects 409s.

All below reports were retained locally under ignored artifacts/. Earlier short profiles used evolving harness/settings (including two Nest instances sharing one event loop before separate workers were added); they are diagnostic history, not controlled before/after speedup comparisons. The 500-RPS minute control preceded the final HTTP idle-timeout adjustment. Final burst reports and the last two four-process minute trials use the shared 65-second keep-alive setting.

## Actual results

| Report / configuration                   | Rate or burst | Seconds | Instances | Pending each | Started |   201 | 409 |  503 | Other/transport | Dropped |  p95 ms |  p99 ms | Gate |
| ---------------------------------------- | ------------- | ------: | --------: | -----------: | ------: | ----: | --: | ---: | --------------: | ------: | ------: | ------: | ---- |
| burst-hotspot-100-1.json                 | burst 100     |       - |         2 |          128 |     100 |     1 |  99 |    0 |               0 |       0 |  228.83 |  230.92 | PASS |
| burst-same-resource-100-1.json           | burst 100     |       - |         2 |          128 |     100 |   100 |   0 |    0 |               0 |       0 |  222.44 |  225.13 | PASS |
| burst-spread-100-1.json                  | burst 100     |       - |         2 |          128 |     100 |   100 |   0 |    0 |               0 |       0 |  253.88 |  256.39 | PASS |
| final-burst-hotspot.json                 | burst 100     |       - |         2 |          128 |     100 |     1 |  99 |    0 |               0 |       0 |  198.67 |  200.14 | PASS |
| final-burst-same-resource.json           | burst 100     |       - |         2 |          128 |     100 |   100 |   0 |    0 |               0 |       0 |  263.69 |   266.9 | PASS |
| final-burst-spread.json                  | burst 100     |       - |         2 |          128 |     100 |   100 |   0 |    0 |               0 |       0 |  226.99 |  230.74 | PASS |
| rate-profile-1000.json                   | 1000          |       5 |         2 |          128 |    5001 |  3161 |   0 | 1840 |               0 |       0 |  649.66 |  879.38 | FAIL |
| rate-spread-100-5.json                   | 100           |       5 |         2 |          128 |     500 |   500 |   0 |    0 |               0 |       0 |   15.86 |   21.17 | PASS |
| rate-spread-1000-5-four-processes.json   | 1000          |       5 |         4 |          128 |    5005 |  3377 |   0 | 1628 |               0 |       0 | 1236.63 | 1434.06 | FAIL |
| rate-spread-1000-5-processes.json        | 1000          |       5 |         2 |          128 |    4838 |  3580 |   0 | 1258 |               0 |     164 |  571.37 |  778.43 | FAIL |
| rate-spread-1000-5-range.json            | 1000          |       5 |         2 |          128 |    5000 |  3265 |   0 | 1735 |               0 |       0 |  636.56 |  764.05 | FAIL |
| rate-spread-1000-5.json                  | 1000          |       5 |         2 |          128 |    4915 |  4109 |   0 |  806 |               0 |      86 |  370.66 |  386.16 | FAIL |
| rate-spread-1000-60-final.json           | 1000          |      60 |         2 |          128 |   60001 | 56661 |   0 | 3297 |              43 |       0 |  379.35 |   620.3 | FAIL |
| rate-spread-1000-60-four-pending256.json | 1000          |      60 |         4 |          256 |   56058 | 54928 |   0 | 1130 |               0 |    3942 | 1623.42 |  2281.7 | FAIL |
| rate-spread-1000-60-four-production.json | 1000          |      60 |         4 |          128 |   60001 | 59478 |   0 |  523 |               0 |       0 |  528.61 |   698.8 | FAIL |
| rate-spread-500-5.json                   | 500           |       5 |         2 |          128 |    2500 |  2500 |   0 |    0 |               0 |       0 |   10.04 |   51.61 | PASS |
| rate-spread-500-60-final.json            | 500           |      60 |         2 |          128 |   30001 | 30001 |   0 |    0 |               0 |       0 |   74.57 |  248.53 | PASS |

All 17 retained profiles passed their direct database invariants: zero technician overlaps, zero bay overlaps, valid ownership/scoping/qualification/duration, and persisted rows equal acknowledged successful bookings. These invariants do not erase performance or transport failures. The final four-process default-queue minute trial had 59,478 successes, 523 controlled overloads, no other errors, and no dropped arrivals; it still failed the target. Increasing the queue to 256 worsened latency and produced dropped arrivals, so the application's default remains 128.

The first two-process minute trial included 43 connection resets/EOFs and 3,297 overload responses. Subsequent four-process runs with shared HTTP idle settings had no transport failures, but process count and settings changed together, so the experiment does not isolate a single cause. No arbitrary OS limits, database connection increases, or weaker correctness assertions were used to force a pass.

Range-overlap query probes in the minute reports used both existing named GiST indexes. Those are overlap-probe plans, not a claim that every possible query/distribution uses those plans. Sampling found bounded queues and no sampled resource lock waits; CPU profiles showed distributed Prisma processing costs. A full causal bottleneck analysis and tuning on target production hardware remain future work. Do not claim sustainable 1,000 successful bookings/second based on the configured rate or the earlier prototype burst. Numeric production latency/error SLOs are still unagreed.

## Executed correctness checks

- prisma:validate, build, typecheck, lint, format:check: exit 0.
- test:unit: 105 passed. test:all: 107 default and 137 real PostgreSQL cases passed.
- test:e2e: 49 passed; these overlap with the PostgreSQL suite.
- test:concurrency: six passed on each of three consecutive final runs; original exact 1/19 and alternative-pair/fresh-transaction assertions remain.
- New PostgreSQL resilience tests: 11 passed, including actual timeout/rollback, reused-connection settings, pool exhaustion, HTTP disconnect, and recovery.
- An initial final-test attempt lacked local listen permissions (EPERM in health); the same full suite was rerun with local networking allowed and passed. This was an execution-environment failure, not suppressed or counted as a pass.

## Reproduction

Follow README setup, then run npm run db:test:up. Examples:

```sh
npm run test:load -- --mode burst --count 100 --workload spread --report artifacts/burst.json
npm run test:load -- --mode burst --count 100 --workload same-resource --report artifacts/adjacent.json
npm run test:load -- --mode burst --count 100 --workload hotspot --report artifacts/hotspot.json
npm run test:load -- --mode rate --rate 500 --duration 60 --instances 2 --workload spread --report artifacts/control.json
npm run test:load -- --mode rate --rate 1000 --duration 60 --instances 4 --workload spread --report artifacts/target.json
BOOKING_MAX_PENDING=256 npm run test:load -- --mode rate --rate 1000 --duration 60 --instances 4 --workload spread --report artifacts/queue-comparison.json
```

A failed target intentionally exits nonzero. The runner owns fresh UUID-named databases and ephemeral loopback app processes, records results before cleanup, and never resets the developer database. Keep failed reports when comparing runs. The historical prototype and implementation rationale are in [CONCURRENCY_PROPOSAL.md](archive/CONCURRENCY_PROPOSAL.md).

## Final hygiene and startup

The compiled production bootstrap started successfully on an owned temporary port. GET /health returned 200 with `{ "status": "ok" }` and HTTP keep-alive timeout=65. The spawned smoke-test app was stopped. After all tests/load runs, PostgreSQL reported zero remaining scheduler*test*\* databases. No developer database reset or migration was performed.

Formatting, local documentation targets, and whitespace checks passed. No common private-key/token patterns or unwanted .env/dependency/build/load artifacts were found among candidate repository files; this is a limited pattern scan, not a complete security assessment. Schema/migration/seed files remained unchanged. At the end of that verification, the application fingerprint matched the measured source.

The Git baseline advanced to cbbd1e8 (the Phase 4 booking commit) during this work, leaving the index empty. The agent ran no staging, commit, reset, branch, or push command and left that state intact. This concurrency follow-up remains working-tree changes for review.

## Maintenance review — 2026-11-03

Reviewed the booking and availability paths, DTO validation, resource queries, transaction context, retry classification, admission lifecycle, migrations, and concurrency assertions. Retained the concrete use cases/repositories, interval queries, conflict-aware insertion, and bounded capacity/timeouts: each has a specific responsibility or demonstrated failure case. No architecture, dependencies, database constraints, or booking algorithm changed.

Found and fixed one HTTP error-contract defect: availability reads bypassed transaction error translation, returning 500 on connection refusal instead of the documented 503. New real-connection regression tests first failed for both catalog and resource reads. An initial fix covered model reads but exposed an additional raw-query adapter shape: `P2010` with `driverAdapterError.cause.kind = DatabaseNotReachable` and no SQLSTATE. The existing classifier now recognizes that observed shape, and the HTTP filter reuses it. Unknown driver/SQL errors remain unexpected failures; no retries were added. A real missing-table query still returns a safe 500.

Reused the existing integer-setting validator for PORT, removing duplicate checks. Added a deterministic queue test for a waiter whose deadline expires before its timer runs: releasing a slot rejects that waiter, admits the next one, clears timers, and leaves no capacity leak. The existing admission implementation passed this case without modification.

Executed against the reviewed working files (all final commands exited 0):

- `npm run db:test:up`: dedicated test PostgreSQL healthy.
- `npm run prisma:validate`, `npm run build`, `npm run typecheck`, `npm run lint`, `npm run format:check`: passed.
- `npm run test:e2e`: 52 passed, including the three new availability failure cases.
- `npm run test:all`: 110 default tests and 140 PostgreSQL tests passed. The PostgreSQL total includes all 52 API cases, six concurrency cases, 11 resilience cases, and the earlier database/scheduling suites. Temporary databases were created with the actual migration and seed.

The concurrency suite retained exact one-success/nineteen-conflict assertions, enforced alternate-pair recovery in fresh transactions, and direct persisted-state checks for zero resource overlaps and valid assignments. No assertions were weakened. The minute-long load profiles were not repeated for this maintenance change; the earlier 1,000-RPS target failure remains unresolved and must not be presented as production capacity. These checks do not establish behavior under concurrent administrative edits, commit-acknowledgement loss, or a production deployment; those limitations remain documented.

## Historical diagnostic under the withdrawn 10,000-RPS target

Under the former target, before the developer clarified that it applied to separately sized production hardware, executed:

```sh
npm run test:load -- --mode rate --rate 10000 --duration 5 --instances 4 --workload spread --report artifacts/rate-spread-10000-5-baseline.json
```

Exit 1, target failed. Of 50,000 nominally scheduled arrivals: 11,548 started, 38,453 dropped (including boundary scheduling), 2,029 confirmed, 9,297 overload responses, and 222 unexpected/transport outcomes. Request p95 was 2,063.83 ms; p99 was 2,484.28 ms. The generator reached its 1,000-VU limit and connection resets were observed. These are failed local end-to-end results; no single server-side root cause or production ceiling is established.

Direct database verification found 2,029 persisted appointments matching acknowledged successes, zero resource overlaps, and zero invalid associations. The report is retained under ignored artifacts/. No further laptop saturation runs were performed after the production-hardware clarification. The local runner now permits rate 10000 and an explicit VU budget; application capacity limits, transaction/validation behavior, and database constraints remain unchanged.

Verification of the tooling change (all exit 0):

- `npm run typecheck`, `npm run lint`, `npm run format:check`, and `git diff --check`.
- `k6 inspect --execution-requirements` with explicit rate 10000, duration 60, and VU budget 2000: asserted a 10,000/s constant-arrival scenario, 2,000 preallocated/max VUs, at least 600,000 arrivals/successes, and zero-drop/error thresholds. This checks configuration without generating requests.
- `npm run test:load -- --mode rate --rate 10 --vus 20 --duration 1 --instances 2 --workload spread --report artifacts/configurable-vus-smoke.json`: 11 starts and 11 confirmed/persisted rows (duration-boundary iteration included), no overload/errors/drops, zero overlaps or invalid associations. The report records generatorMaxVUs=20.
- After both owned runs, the dedicated test server contained zero remaining scheduler*test*\* databases.

These checks validate the updated generator setting and preserve local correctness evidence. They are not a production capacity test, and no 10,000-successful-bookings/second production result is claimed.

## Fixed database defaults — 2026-11-04

The developer approved moving fixed timeouts out of each booking transaction. Added scripts/configure-database.sql and npm run db:configure, setting only the current role/current database defaults: lock_timeout=250ms, statement_timeout=2s, transaction_timeout=5s. Application transactions no longer send set_config. The shared booking deadline remains; Prisma uses its remaining budget without the earlier one-second safety margin. An actual expired Prisma P2028 after callback entry becomes BOOKING_TIMEOUT; acquisition failures and unrelated closed-transaction bugs remain distinct.

Applied npm run db:configure to the existing development database (exit 0). A fresh connection as scheduler to service_scheduler reported 250ms / 2s / 5s. The development database had zero public tables before/after configuration; an initial appointment-count check failed because the appointments table did not exist. No migration, seed, data reset, or schema change was performed against development. Existing app connections require restart to inherit role defaults.

The integration helper now applies the same SQL after migrations/seed in each verification-owned database, then reconnects. Executed:

- npm run build, npm run prisma:validate, npm run typecheck, npm run lint: exit 0.
- npm run format:check and git diff --check: exit 0. The dedicated test server reported zero remaining scheduler*test*\* databases after verification.
- Focused booking-resilience integration run: 13 passed, including inherited defaults, statement cancellation/restored test overrides, the actual five-second PostgreSQL transaction cap with a longer Prisma timeout, shorter Prisma-budget expiry returning 503/rollback, and an unrelated closed-transaction bug staying unexpected.
- npm run test:all: 110 default tests and 142 PostgreSQL tests passed. The latter includes 52 API cases, six strict concurrency cases, 49 constraint cases, 22 scheduling cases, and 13 resilience cases. Existing one-success/nineteen-conflict, alternative-pair/fresh-transaction, rollback, and final persisted-state assertions remain intact.
- A real HTTP/SQL trace against a freshly migrated/seeded/configured temporary database returned 201 and persisted exactly one row. Eight Prisma query events were captured (six SELECTs, INSERT, COMMIT), with zero set_config/timeout-configuration statements. Driver transaction setup may not appear in this event stream. The first standalone probe failed because ts-node was absent from its child-process PATH; rerunning through npm exec supplied the local binary path and passed. Both probes cleaned up their owned databases.

These checks establish configuration and functional behavior, not a measured throughput improvement. Earlier load results used the earlier timeout policy; no sustained capacity rerun or 10,000-RPS production claim is made.

## Idempotency burst follow-up — 2026-11-04

The subsequent approved idempotency implementation was verified separately from the historical measurements above. The final full suite passed 138 default and 175 PostgreSQL tests, including the 100-request same-key replay case and original strict resource-contention assertions. The three separate-process, distinct-key 100-request burst profiles passed: spread and adjacent intervals each confirmed/persisted 100 bookings and complete request records; the hotspot produced one confirmed row/key record and 99 availability conflicts. No overload, technical errors, dropped arrivals, overlaps, invalid associations, or incomplete key records occurred. No sustained-rate rerun was performed.

See [IDEMPOTENCY — executed evidence](archive/IDEMPOTENCY_HISTORY.md#executed-evidence--2026-11-04) for exact commands, source fingerprint, environment, latency/launch measurements, reports, corrections, and cleanup. Earlier rate results remain historical; no current-source sustained or production capacity is established.

## Final review burst rerun — 2026-11-05

Final review reproduced a load-worker startup regression: the shared HTTP fixture already opened its listener, but the worker attempted to listen again. The spread command failed before generating requests, and a direct diagnostic confirmed ERR_SERVER_ALREADY_LISTEN. The approved correction removes that second start and retains fixture-owned shutdown. A new real child-process integration regression first failed before the fix, then passed after it; the full suite passed 170 default and 215 PostgreSQL/Redis cases. The optional technician-list endpoint/cache remains removed. Safe classified HTTP failure logging is enabled in this candidate.

Working candidate based on commit `e2d4249`; source SHA-256: `19cd263ac0f3a0dbb34874f531e361b4181dc8feb7dcda4ac9c8ad34c4c3f2be`. The digest covers 100 files: all files under src, prisma, scripts, and test, plus package.json, package-lock.json, both tsconfigs, both Vitest configs, .env.example, docker-compose.yaml, and prisma.config.ts. Paths are sorted; each relative path and its bytes are followed by a NUL separator. Documentation and generated reports are excluded. This is a working-source measurement, not a committed-checkout or production claim.

Executed sequentially, all exit 0:

```sh
npm run test:load -- --mode burst --count 100 --workload spread --report artifacts/review-fixes-20261105-spread-100.json
npm run test:load -- --mode burst --count 100 --workload same-resource --report artifacts/review-fixes-20261105-adjacent-100.json
npm run test:load -- --mode burst --count 100 --workload hotspot --report artifacts/review-fixes-20261105-hotspot-100.json
```

| Profile                      | Started | 201 | 409 | 503 / unexpected / dropped | Appointments / complete keys | p95 ms | p99 ms | Client start offsets ms | Result |
| ---------------------------- | ------: | --: | --: | -------------------------- | ---------------------------- | -----: | -----: | ----------------------- | ------ |
| Spread, twenty dealerships   |     100 | 100 |   0 | 0 / 0 / 0                  | 100 / 100                    | 434.04 | 435.97 | 3–20                    | PASS   |
| One pair, adjacent intervals |     100 | 100 |   0 | 0 / 0 / 0                  | 100 / 100                    | 405.72 | 408.85 | 1–20                    | PASS   |
| One pair, identical interval |     100 |   1 |  99 | 0 / 0 / 0                  | 1 / 1                        | 385.77 | 395.30 | 0–21                    | PASS   |

Each profile used two separate Node app processes, ten pool connections and eight active booking slots per process, 128 pending slots, and the existing five-second booking budget. Every request used a distinct idempotency key. Direct PostgreSQL assertions found zero technician/bay overlaps, zero invalid assignments, no incomplete request records, and persisted appointment/key counts matching acknowledgements.

Environment: Apple M2, eight logical CPUs, 16 GiB host RAM, macOS arm64, Node 24.21.0, PostgreSQL 17.6 in Docker, k6 2.3.0. Generator, apps, and database shared the laptop. Connections were warmed through health before a common client barrier; offsets are observed launch times, not exact server simultaneity. JSON application logging was enabled with stdout discarded. Reports remain under ignored artifacts/. Owned app processes and databases were cleaned up. The development database was not reset or migrated.

These runs satisfy the tested 100-request burst criterion. They do not establish sustained throughput, production latency, or a controlled speedup against historical runs. No sustained-rate test or infrastructure change was made; historical failures remain above.

## Capacity tuning — 2026-11-06

The user approved increasing each app process from 8 active / 128 waiting / 10 pool connections to **16 active / 1,024 waiting / 20 pool connections**. Local `.env`, example configuration, validation, current design documentation, and pool-exhaustion coverage were updated. Booking queries, exclusions, idempotency, four allocation attempts, the shared five-second budget, and fixed PostgreSQL timeouts remain unchanged. The separate assessment criterion remains the 100-request burst.

### Method and source

Apple M2, eight logical CPUs, 16 GiB RAM, macOS arm64, Node 24.21.0, PostgreSQL 17.6 in Docker, k6 2.3.0. Apps, generator, and database shared the laptop. Each app ran in a separate Node process with `NODE_ENV=production`, using the existing ts-node fixture worker, JSON logging, ephemeral HTTP listener, and isolated migrated/seeded database. This is not a compiled production deployment or a load-balancer benchmark. No development data was reset or migrated.

The spread workload uses twenty synthetic dealerships with one eligible technician/bay pair each, 1,000 customer/vehicle pairs, and distinct non-overlapping thirty-minute intervals. Every POST uses a new idempotency key. It tests successful booking writes with available capacity, not a sold-out interval, realistic traffic mix, or representative production data volume. Redis does not serve these booking reads/writes.

For rate trials longer than ten seconds, the runner now counts request starts and successful HTTP completions in the middle window: seconds 5 through 55 of a sixty-second arrival stream. Passing requires at least 50,000 confirmations in that window and confirmations at least equal to starts, rejecting a net increase in outstanding work across the window. Traffic continues for five seconds afterward; a fifteen-second drain allowance is excluded from the window. Successful responses follow transaction commit, but this measures HTTP completions rather than exact commit timestamps. It does not promise 1,000 completions in every individual second or bounded backlog at every instant.

All original checks remain: zero dropped arrivals, overload, or unexpected outcomes; all offered requests successful; appointments and complete idempotency records matching acknowledgements; zero resource overlaps or invalid associations. The generator may schedule a boundary iteration. The final generator prepares its entire configured `--vus` budget before traffic; earlier trials started with 1,000 clients and allowed dynamic expansion. This change addresses client-allocation pressure without weakening application or database checks.

Working-source SHA-256 values use the same sorted-path/NUL-separated method described above, covering 101 source/configuration files and excluding documentation and reports:

| Snapshot                                    | SHA-256                                                            |
| ------------------------------------------- | ------------------------------------------------------------------ |
| A: baseline, 8 / 128 / 10                   | `427f5868511cd9b19d4ba5c459af9d4520d3b7cc71ce8f566901d9cbd901d210` |
| B: candidate, 16 / 1,024 / 20               | `37f4c039888f6f23a14ae0c56d0fa18c16e2a5cfd4d8b2c7ce59625f324b5ed3` |
| C: candidate plus middle-window measurement | `4f0a11a6524d757a6cf1592f97a6990be26e1d4ad356088200384f48c8e1fccb` |
| D: candidate plus full client preallocation | `15e08f100ec25fd5d58f518997eb4ea5163567760270c14058388779ab76fe49` |
| E: final harness guard for hotspot profiles | `c7ad07c4b529851e3ea9e19cdec48d1d3df3bc615a4f4740ff5a25435d8e8cc4` |

Snapshot E restricts the new throughput window to profiles expecting successful bookings. A hotspot intentionally expects one confirmation and availability conflicts, so applying a 50,000-confirmation window there would be incorrect. Application source and the measured spread behavior are unchanged from D; the rate trials were not repeated for this guard.

### Retained rate trials

All trials offered 1,000 requests/second. Reports below are retained locally under ignored `artifacts/`, with the prefix `capacity-20261106-` and suffix `.json`. Total confirmations include drain time and must not be divided by the offered duration to infer sustained throughput.

| Report stem                                | Source | Seconds | Processes | Preallocated / maximum clients | Started | Confirmed |   503 | Other | Dropped |   p95 ms | Result            |
| ------------------------------------------ | ------ | ------: | --------: | ------------------------------ | ------: | --------: | ----: | ----: | ------: | -------: | ----------------- |
| baseline-app1-10s                          | A      |      10 |         1 | 1,000 / 1,000                  |  10,001 |     5,362 | 4,639 |     0 |       0 |   352.19 | FAIL              |
| candidate-app1-10s                         | B      |      10 |         1 | 1,000 / 1,000                  |   7,309 |     7,202 |     0 |   107 |   2,692 | 2,203.56 | FAIL              |
| candidate-app2-10s-vus3000                 | B      |      10 |         2 | 1,000 / 3,000                  |  10,013 |    10,013 |     0 |     0 |       0 |   974.56 | PASS, short trial |
| candidate-app2-60s-vus3000                 | C      |      60 |         2 | 1,000 / 3,000                  |  59,834 |    59,834 |     0 |     0 |     167 | 1,260.90 | FAIL              |
| candidate-app4-60s-vus3000                 | C      |      60 |         4 | 1,000 / 3,000                  |  48,161 |    45,391 | 2,770 |     0 |  11,840 | 5,007.62 | FAIL              |
| candidate-app2-60s-preallocated3000        | D      |      60 |         2 | 3,000 / 3,000                  |  60,001 |    60,001 |     0 |     0 |       0 | 1,364.42 | PASS              |
| candidate-app2-60s-preallocated3000-repeat | D      |      60 |         2 | 3,000 / 3,000                  |  60,000 |    57,816 | 2,184 |     0 |       0 | 2,423.62 | FAIL              |

The baseline's 4,639 failures were `BOOKING_BUSY`. The one-process candidate had 107 connection resets; their cause was not isolated, and its generator reached the 1,000-client ceiling. A larger queue increased waiting rather than establishing higher sustained throughput. The short two-process pass had a growing sampled queue and was insufficient evidence by itself.

The first two-process minute trial failed because 167 arrivals were dropped, despite all launched requests succeeding. Its middle window had 49,861 starts and 50,276 confirmations. Four processes performed worse: 2,205 `BOOKING_TIMEOUT` and 565 `SERVICE_UNAVAILABLE` responses, with the generator reaching 3,000 active clients. More app processes and connections did not guarantee more throughput on the shared laptop. These runs do not isolate a single server bottleneck.

With all 3,000 clients preallocated, the two-process minute trial had **50,000 starts and 51,023 confirmations** in its middle fifty seconds. The sampled aggregate queue peaked at 1,182 across both apps, then fell to near zero before arrivals ended; overall p99 was 1,542.20 ms. A queue can grow temporarily even when the middle-window net change is negative. Every retained trial above passed its database invariants, including the failed performance trials.

The identical independent repeat had **49,999 starts and 47,060 confirmations** in its middle window, 2,184 `BOOKING_BUSY` responses overall, and a sampled aggregate queue peak of 2,045. Its p99 was 2,685.56 ms. This repeat rejects a reliable sustained-capacity claim. The settings remain the requested defaults, but neither a larger queue nor a twenty-connection pool guarantees the target. Next steps require profiling transaction/query costs and separating generator/app/database resource pressure on a controlled environment; no such cause is established here.

### Reproduction

Run the existing test services first. Candidate commands set the limits explicitly; the runtime pool is twenty connections in source. Reports from the earlier pool-ten baseline require snapshot A to reproduce.

```sh
npm run db:test:up
BOOKING_MAX_CONCURRENT=16 BOOKING_MAX_PENDING=1024 npm run test:load -- --mode rate --rate 1000 --duration 60 --instances 2 --vus 3000 --workload spread --report artifacts/capacity-20261106-candidate-app2-60s-preallocated3000.json
BOOKING_MAX_CONCURRENT=16 BOOKING_MAX_PENDING=1024 npm run test:load -- --mode rate --rate 1000 --duration 60 --instances 2 --vus 3000 --workload spread --report artifacts/capacity-20261106-candidate-app2-60s-preallocated3000-repeat.json
```

The other table rows used their stated `--duration`, `--instances`, and `--vus` values (1,000 for the first two); baseline overrides were `BOOKING_MAX_CONCURRENT=8 BOOKING_MAX_PENDING=128`. Earlier snapshots used their documented generator behavior. Failed trials, including the final repeat, exited 1; the short pass and successful minute trial exited 0. Fingerprints identify measured working files; reports do not contain a replayable source checkout.

### Correctness and burst regressions

`TEST_REDIS_URL=redis://127.0.0.1:56380 npm run test:all` passed: **171 default tests and 217 PostgreSQL/Redis tests**. Existing strict 20-request contention, alternative-pair allocation, interval, rollback, idempotency, and authoritative-read assertions remain. Pool exhaustion now holds all twenty runtime connections rather than the previous ten, preserving the meaning of that regression.

All three distinct-key, two-process bursts passed on snapshot E with the new limits. Each report uses the prefix `artifacts/capacity-20261106-burst-`:

| Report suffix | Requests | Confirmations / complete keys | Availability conflicts | p95 ms | p99 ms |
| ------------- | -------: | ----------------------------- | ---------------------: | -----: | -----: |
| spread.json   |      100 | 100 / 100                     |                      0 | 326.60 | 328.05 |
| adjacent.json |      100 | 100 / 100                     |                      0 | 338.42 | 339.71 |
| hotspot.json  |      100 | 1 / 1                         |                     99 | 286.48 | 287.10 |

No burst had overload, unexpected errors, dropped arrivals, incomplete keys, invalid associations, or resource overlaps. Commands used `BOOKING_MAX_CONCURRENT=16 BOOKING_MAX_PENDING=1024 npm run test:load -- --mode burst --count 100 --instances 2`, with `--workload spread`, `same-resource`, or `hotspot` and their corresponding `--report` paths. These preserve the assessment's resilience criterion; the failed minute repeat remains a separate capacity limitation.

Final `npm run build`, `npm run prisma:validate`, `npm run typecheck`, `npm run lint`, `npm run format:check`, and `git diff --check` passed. `k6 inspect --include-system-env-vars` verified 3,000 preallocated/maximum clients, strict zero-drop checks, the spread confirmation window, and the hotspot's one-confirmation expectation. Initial tooling attempts omitted the inspect environment flag or asked Prettier to format an unsupported `.env` file; corrected checks passed. These were tooling errors, not successful measurements.

Cleanup verification found zero remaining `scheduler_test_*` databases. The test server's `max_connections` remained 100; no database settings were increased. Existing staged work and `FINAL_REVIEW.md` were preserved, with no commit, push, or deployment.

## Full five-minute capacity attempt — 2026-11-06

**FAIL: the measured setup did not sustain 1,000 successful new bookings/second.** Executed once, without an automatic retry:

```sh
npm run db:test:up
npm run test:capacity -- --report artifacts/capacity-20261106-full-38xgxwta.json
```

The preset offered 1,000 requests/second for 300 seconds, using two app processes and 3,000 preallocated/maximum clients. Limits remained sixteen active bookings, 1,024 waiting requests, and twenty pool connections per process. Environment and source match the preset smoke above: Apple M2, eight logical CPUs, 16 GiB RAM, Node 24.21.0, PostgreSQL 17.6 in Docker, k6 2.3.0; SHA-256 `02f1360c71a0e6f7825fd99f79fe27b5fe90a9fceaa089e32b7f515966d1b0a7`. Generator, apps, and database shared the laptop; no new capacity process was running at the start. Other host activity was not controlled, so this does not isolate a bottleneck or establish a production ceiling.

| Retained evidence                                       |   Count |
| ------------------------------------------------------- | ------: |
| Confirmations in k6's terminal summary, including drain | 123,164 |
| Overload responses in k6's terminal summary             | 176,261 |
| `503 BOOKING_BUSY` in application failure logs          | 141,467 |
| `503 BOOKING_TIMEOUT` in application failure logs       |  28,732 |
| `503 SERVICE_UNAVAILABLE` in application failure logs   |   6,062 |
| `500` responses observed in application failure logs    |       0 |

The generator reached its 3,000-client limit. k6 failed its dropped-arrival, started-request, confirmation, middle-window confirmation, overload, and response-check thresholds. Its terminal summary confirms failure; the exact dropped count, latency percentiles, and middle-window counts are unavailable because the final structured report was not written. Do not divide total confirmations by 300 to claim sustained throughput: they include drain time.

After k6 finished, a post-run verification SQL statement failed with SQLSTATE `57014`, `canceling statement due to statement timeout`. The runner exited 1 before writing its requested final JSON report. **Database invariant verification is incomplete for this run.** Earlier passing invariants are not substituted for missing evidence. At that source version, the runner removed its temporary raw k6 summary during cleanup even if post-run checks failed; the later reporting fix does not recover this run's missing metrics.

The complete terminal output is retained locally as `artifacts/capacity-20261106-full-38xgxwta.log` (SHA-256 `27d00c2d7ba8b2a79b363e80fc7f2e44c85c87517ef2a21eb484909999f18986`). `artifacts/capacity-20261106-full-38xgxwta.failure-summary.json` is explicitly a partial summary derived from that log, not the runner's final report. Unknown metrics are marked unavailable. Cleanup removed this run's owned database, `scheduler_test_2fb3dd999b204ce69f1ce20754c6548c`; a different temporary database was present and was left untouched.

The 503 responses demonstrate controlled rejection/timeout classification, but they are failed booking attempts under this profile. Absence of logged 500s does not establish database correctness or target capacity. No application code, limits, database timeouts, or assertions were changed for this run; staged work and `FINAL_REVIEW.md` remain preserved.

## Report retention fix — 2026-11-06

The runner now saves k6 measurements, configuration, host metadata, and samples before post-run SQL checks. `test/load/write-load-report.ts` writes an unsuccessful, incomplete report first, then records completed verification or a failed verification with a safe error type/SQLSTATE. A verification exception retains the measurements with unavailable invariants and a nonzero command result. Completed checks can still produce `passed: false`; no threshold or database limit was relaxed. The previous five-minute attempt's missing data cannot be reconstructed by this fix.

Executed verification:

- `npm run test:integration -- test/integration/load-report.spec.ts`: three passed. A real PostgreSQL statement timeout (`57014`) verified that the report existed before the query and retained measurements afterward with `passed: false` and `invariants: null`. The connection remained usable. Completed successful and unsuccessful verification results were also retained correctly.
- `npm run test:capacity -- --rate 10 --duration 12 --instances 2 --vus 20 --report artifacts/report-retention-smoke-kp7jk3p4.json`: passed. All 121 requests confirmed and matched persisted appointments/complete keys, including a boundary iteration. The saved report had `verification.status: complete`, k6 metrics, and worker samples; its middle window had twenty starts and twenty confirmations. This is a wiring smoke test, not sustained-capacity evidence.
- `TEST_REDIS_URL=redis://127.0.0.1:56380 npm run test:all`: 171 default and 220 PostgreSQL/Redis tests passed, retaining booking, idempotency, cache, and strict concurrency assertions.
- Build, typecheck, lint, formatting, and whitespace checks passed. Staged work and `FINAL_REVIEW.md` were preserved.

Final reviewed source SHA-256: `fd4de7635c3b2abfe27ab2c31cca91382db16e08bca898d30a5e98d7b5b489c6`, using the same method over 103 files, including the new report writer and regression suite. No five-minute benchmark was repeated, and no new 1,000-bookings/second claim is made. The system-design capacity section now maps additional app instances, read replicas, and message queues to measured needs and their consistency/contract boundaries; none was added to the architecture.
