# Phase 3 — Read-only scheduling

## Approved boundary and spec alignment

The user's Phase 3 approval covers internal scheduling logic only. The draft spec's section 14 labels scheduling as Phase 2 (including an availability HTTP API) and atomic booking as Phase 3. The latest explicit approval controls this milestone: neither HTTP APIs nor booking writes, transactions, retries, or idempotency are implemented. The product contract in `SPEC.md` remains the target for later approved work.

Phase 2's 49 PostgreSQL integration tests passed against a newly migrated and seeded database before implementation. No Prisma schema, migrations, seed data, dependencies, or lockfile changes were needed.

## Responsibilities and decisions

- `src/scheduling/check-availability.use-case.ts` validates a future instant with the injected clock, checks dealership existence and an active service type, derives the interval, requests eligible resources, and returns counts plus a selected pair or explicit unavailability.
- `src/scheduling/scheduling.repository.ts` contains concrete Prisma queries. Two context reads and two set-based candidate reads select only needed columns. Technician eligibility includes dealership, active flag, service qualification, and absence of a blocking overlap. Bay eligibility includes dealership, active flag, and absence of a blocking overlap.
- `src/scheduling/resource-allocation.service.ts` independently chooses the smallest eligible technician and bay IDs without mutating the candidate lists. All active bays support all services, so any eligible pair is valid. No pair-search abstraction is needed.
- `src/scheduling/interval.ts` provides pure duration calculation and half-open overlap logic. Arithmetic uses absolute milliseconds. Both queries use `existing.startAt < requested.endAt AND existing.endAt > requested.startAt`, restricted to `CONFIRMED`.
- `src/common/time/clock.ts` supplies the current instant and can be replaced in tests. Fixed test instants are future relative to the injected clock, independent of the machine date.
- `src/scheduling/scheduling.error.ts` provides small application error codes for invalid time, missing dealership/service, and inactive service. Unexpected database errors propagate. Future HTTP code must map these application outcomes to the spec's HTTP error contract (including `BUSINESS_RULE_VIOLATION` for an inactive service).
- `SchedulingModule` imports the existing database module and exports the use case. `AppModule` registers it. There are no scheduling controllers or write methods, repository interfaces, or additional infrastructure.

The internal input is `{ dealershipId, serviceTypeId, startAt: Date }`. The output includes the calculated interval, resource counts, and either `{ available: true, technicianId, serviceBayId }` or `{ available: false, technicianId: null, serviceBayId: null }`. Availability is distinct from invalid/missing input and infrastructure failure.

## Verification

Executed on the existing Node 24 / PostgreSQL 17.6 Docker setup:

```sh
# Before implementation: existing 49 database tests passed.
npm run db:test:up
TEST_DATABASE_URL=postgresql://scheduler_test:local_scheduler_test_password@127.0.0.1:55433/service_scheduler_test npm run test:integration

# After implementation:
npm run build
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:unit
TEST_DATABASE_URL=postgresql://scheduler_test:local_scheduler_test_password@127.0.0.1:55433/service_scheduler_test npm run test:integration
```

The integration harness creates a separate fresh database for each file, applies the committed migration and seed using the real Prisma CLI, and drops only its owned database afterward. No mocked database results are used in integration tests.

- Unit/default tests: 46 passed, comprising 29 new scheduling tests and the existing 17 foundation tests. The unit-only script selects 44 tests; HTTP and startup regression remain in the default suite.
- PostgreSQL integration tests: 71 passed, comprising the existing 49 constraint/seed/concurrent SQL tests and 22 new scheduling tests.
- New SQL tests cover qualified and unqualified technicians, inactive resources, dealership isolation, independent technician and bay conflicts, alternatives, exhausted resources, cancelled appointments, all overlap shapes, both adjacency directions, and equivalent offset instants.
- Repeated checks leave appointment rows unchanged. Actual Prisma query events show exactly four `SELECT` statements per valid check, with no queries per candidate.
- Build, type checking, lint, and formatting checks passed. The initial unit-mock lint errors were corrected before final verification.

## Limits and next-phase obligations

The reads are independent and do not provide a transactionally consistent snapshot. Resources or appointments may change during or immediately after a check. A returned pair is advisory and creates no reservation. Future booking must perform authoritative validation/allocation, persist atomically, rely on both existing database exclusions, and implement the separately reviewed retry policy. The Phase 2 contention test proves database non-overlap, not an application booking workflow.

Raw HTTP UUID syntax and timestamp-offset validation, customer/vehicle ownership, HTTP error mapping, booking concurrency, and retries remain future work. This internal use case checks a parsed `Date`; it cannot determine whether its original string included an offset. Reference data has no administrative write API; concurrent catalog/qualification edits still require the policy described in the spec. Stable ID ordering provides deterministic selection, with no fairness guarantee. No representative-load benchmark or production-host verification was performed.

Phase 3's approved acceptance criteria are satisfied. Phase 4 has not been started.
