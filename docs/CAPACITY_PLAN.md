# Booking resilience, evidence, and future capacity

Status — 2026-11-04: **keep the 100-request burst resilience criterion**. Sustained **1,000 successfully committed bookings/second is an unverified future stretch goal**, not submission acceptance or a verified Keyloop traffic requirement. Historical decision: the former 10,000-bookings/second requirement is withdrawn. The throughput-goal revision was documentation-only and added no new capacity evidence. The subsequent idempotency burst verification is recorded separately below.

## Assessment resilience criterion

- Release 100 independent valid HTTP booking requests from a client barrier; report actual launch spread rather than claiming exact simultaneity.
- With enough qualified technicians, active bays, and distinct eligible resource/time capacity, require 100 HTTP 201 responses and exactly 100 persisted CONFIRMED appointments. The spread and same-resource/non-overlapping-interval profiles exercise this case.
- With one eligible technician and one active bay at an identical interval, require exactly one HTTP 201, 99 HTTP 409 availability conflicts, and one persisted CONFIRMED appointment. This is the hotspot profile.
- Both profiles require valid ownership, dealership, qualification, active flags, catalog-derived intervals, zero technician/bay overlaps, and no overload or technical failures. Keep the mandatory 20-request exact one-confirmation/nineteen-conflict regression and the alternative-pair/fresh-transaction tests.
- Use isolated PostgreSQL fixtures and the actual HTTP validation/allocation/commit path. An availability read is not a reservation. Burst success does not establish sustained throughput or production capacity.

## Evidence and limitations

[LOAD_RESULTS.md](LOAD_RESULTS.md) preserves measured source/configuration details, executed commands, successes, and failed trials. On the earlier measured laptop snapshots, all final 100-request burst shapes passed. The two-process 500-RPS / 60-second control recorded 30,001 confirmations and persisted rows with no overload/errors. The 1,000-RPS minute trials failed their strict target, including the four-process trial with 59,478 confirmations and 523 overload responses.

Those results used synthetic fixtures and shared-host generators, apps, and PostgreSQL; they are neither current-source benchmarks nor production capacity measurements. Subsequent maintenance and timeout changes were not followed by sustained-rate reruns. Historical failed diagnostics under the withdrawn target remain in LOAD_RESULTS; they are not submission blockers and must not be relabeled as passes.

## Keep the current architecture

Keep the NestJS/Prisma modular monolith and one PostgreSQL writer. Database exclusion constraints enforce technician and bay exclusivity across app instances. Conflict-aware insertion, bounded fresh-transaction retries, shared deadlines, and commit-before-success remain. Explicit resource-row locks were replaced; the per-process admission gate protects workload rather than guaranteeing resource exclusivity.

Defaults remain eight active booking operations, 128 pending, and a ten-connection pool per process. A short burst can wait in the bounded queue; this does not supply missing sustainable capacity. Do not increase queue size or pool limits merely to make a benchmark pass. No database distribution, duplication, additional infrastructure, or deployment is required by this goal revision.

## Future stretch investigation

This is optional future work, not a remaining submission requirement:

1. Record source/configuration, hardware, process count, dataset/history size, resource/interval distribution, and logging behavior. Use isolated data, the real HTTP path, and unchanged validation and exclusions. Keep sold-out contention separate from successful-booking throughput.
2. Establish a control at an observed sustainable rate, then increase offered arrivals toward 1,000/second using open-model scheduling. Separate warmup, a 60-second initial measurement window, and drain. Report offered starts and successful completions during the window separately from drain completions; a growing backlog is not sustained throughput. This is not an endurance/soak test.
3. Measure generator limits, dropped arrivals, per-status counts, p95/p99, queue/pool pressure, transaction duration, retries, CPU, query plans, WAL/storage, and lock waits. Measure database connection-holding time separately from time in the admission queue. Production latency SLOs remain unagreed.
4. For a strict stretch pass, launch all scheduled arrivals, with no dropped work, overload, or technical failures, and establish at least 1,000 successful commits/second during the measured window without a growing backlog. Availability reads, 409s, 503s, or completions deferred into drain do not satisfy the goal. Reconcile persisted counts after quiescence and verify all database invariants. Retain failed reports and investigate ambiguous acknowledgements.
5. Optimize only demonstrated bottlenecks, one change at a time, with correctness regressions preserved. Measure round trips, query/index costs, transaction residence, and aggregate connection demand before considering more app processes or database capacity. No infrastructure purchase or deployment is authorized.

The load runner now supplies distinct UUID v4 keys and verifies complete request-record counts alongside appointments; its workload sizes, process/pool settings, and existing success criteria remain unchanged. It owns disposable databases and ephemeral local app processes, not a remote deployment. Its summary reports are diagnostics; establishing steady-state per-window commit throughput would need further measurement before making a capacity claim. A future local diagnostic command is:

```sh
npm run test:load -- --mode rate --rate 1000 --duration 60 --instances 4 --workload spread --report artifacts/stretch-1000.json
```

The command is optional and was not executed for this documentation revision. A configured arrival rate is not proof of successful-booking throughput. See [README](../README.md#booking-capacity-and-load-verification) for the retained burst commands.

## Idempotency follow-up

The approved booking idempotency addition retains all capacity settings and the burst criterion. Ordinary bursts use a different key for each request, preserving resource contention; the dedicated same-key HTTP regression expects one creation and 99 replays. The earlier sustained-rate results remain historical, not evidence for the idempotent path. Current burst verification is recorded in [IDEMPOTENCY](IDEMPOTENCY.md); no sustained-rate rerun is included.
