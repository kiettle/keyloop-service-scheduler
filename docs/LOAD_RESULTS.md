# Booking load verification — 2026-11-03

Current goal revision — 2026-11-04: retain the 100-request burst resilience criterion; treat 1,000 successfully committed bookings/second as an unverified future stretch goal, not submission acceptance. The former 10,000-bookings/second requirement is withdrawn. All measurements and executed-command records below are historical local diagnostics from their stated source/configuration snapshots, not current-source or production capacity measurements. No load tests were rerun for this documentation-only revision. See [CAPACITY_PLAN.md](CAPACITY_PLAN.md) for evidence boundaries and future benchmarking.

The production-oriented concurrency implementation is verified functionally. **The sustained 1,000-RPS performance target is NOT MET on the measured laptop configuration.** Default two-process capacity passed the 500-RPS / 60-second control; all final 100-request burst shapes passed. No rate failure is treated as a pass.

## Environment and scope

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

A failed target intentionally exits nonzero. The runner owns fresh UUID-named databases and ephemeral loopback app processes, records results before cleanup, and never resets the developer database. Keep failed reports when comparing runs. The historical prototype and implementation rationale are in [CONCURRENCY_PROPOSAL.md](CONCURRENCY_PROPOSAL.md).

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
