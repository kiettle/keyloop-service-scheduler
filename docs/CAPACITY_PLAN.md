# Production capacity requirement — 10,000 bookings/second

Status: **required, not production-verified**. The developer specified successful bookings on sufficiently provisioned production hardware. Local laptop measurements establish neither the required hardware nor a production throughput ceiling. This target does not change the coding challenge's business behavior.

## Workload and success definition

- 10,000 valid booking POSTs/second, each yielding a committed CONFIRMED appointment and HTTP 201. Availability reads, 409s, and 503s do not count toward this target.
- Start with a separate warmup followed by a 60-second measurement window: at least 600,000 scheduled booking requests. Report actual successful completions during that window separately from responses completed during drain. A growing backlog or a long drain must not be presented as sustained throughput.
- Supply enough qualified technicians, bays, and distinct future intervals for every request. An identical interval with one resource pair can yield only one successful booking, regardless of hardware. Run sold-out/hotspot tests separately.
- Exercise the actual API, validation, service duration, allocation, transaction commit, and both PostgreSQL exclusions. No bypass, asynchronous acceptance response, or disabled validation/constraints is permitted.
- Use a declared dealership/resource distribution and representative appointment history. The local runner's synthetic fixtures are a reproducible diagnostic workload, not an agreed production dataset.
- Initial strict acceptance: all scheduled requests launched, every booking successful, no technical errors or overload rejections, and no resource/association invariant violations. Report p95/p99. A production latency SLO and longer soak duration still need agreement.

## Keep the current architecture

Run multiple independent copies of the same NestJS modular monolith behind the deployment's HTTP load balancer, sharing one PostgreSQL writer. Node processes provide application CPU capacity; adding CPU cores to a single application process is not itself a sizing plan. PostgreSQL remains the final source of resource exclusivity across all copies. No Redis, Kafka, distributed locks, or booking microservices are necessary to describe this initial deployment.

The per-process gate remains eight active bookings, 128 pending, and a ten-connection pool. These are process limits, not global limits. A queue absorbs a short burst; it does not supply missing sustainable capacity. Keep admission, request budgets, fresh-transaction retries, and commit-before-success. Do not increase queue size or database connections solely to make a benchmark appear to pass.

No load balancer, cluster manager, database configuration, or external deployment has been added by this capacity plan.

## Calculate capacity from measured service costs

Let R be successful bookings/second. Use mean times, not p95, in these calculations. Retry work must be included.

```text
mean requests in flight = R × mean end-to-end seconds
mean busy DB connections = transaction attempts/second × mean connection-holding seconds
app CPU cores needed = R × CPU seconds/booking ÷ target CPU utilization
app processes needed for admission = ceil(R × mean active-booking seconds ÷ (8 × target utilization))
```

Active-booking time includes transaction work and retry backoff after admission; queue wait is separate. The table below assumes 70% utilization for planning headroom, not a measured optimum:

| Assumed mean active-booking time | Mean active bookings at 10,000/s | Minimum processes from admission alone | Maximum aggregate pool size |
| -------------------------------- | -------------------------------: | -------------------------------------: | --------------------------: |
| 10 ms                            |                              100 |                                     18 |                         180 |
| 20 ms                            |                              200 |                                     36 |                         360 |
| 50 ms                            |                              500 |                                     90 |                         900 |

These are conditional calculations, not hardware recommendations or proof of throughput. For example, an assumed 2 ms of application CPU/booking requires about 29 CPU cores at 70% utilization, independently of the admission calculation. Database CPU, WAL/storage, memory, network latency, connection capacity, and load-generator resources need their own measurements and headroom. Check total pools across all replicas plus operational/read traffic against the database budget. Increasing PostgreSQL max_connections increases resource allocation; it does not guarantee more throughput. See [PostgreSQL connection settings](https://www.postgresql.org/docs/17/runtime-config-connection.html).

After moving timeouts to fixed role/database defaults, one real first-attempt HTTP booking emitted eight Prisma query events: six SELECTs, one INSERT, and COMMIT, with zero timeout-configuration queries. Driver transaction setup may be outside that event stream, so this is not a complete server-side command census. At 10,000 bookings/second this implies at least 80,000 reported SQL operations/second before extra driver work, retries, and other traffic. Measure complete statement counts, transaction residence, CPU/booking, query plans, WAL/IO, and lock waits before choosing hardware or an optimization. This is a reason to benchmark the real write path, not to claim that any sufficiently large server will meet the target automatically.

## Production acceptance procedure

1. Provision an isolated production-equivalent environment with an explicitly recorded app/process count, CPU/RAM, PostgreSQL version/settings, storage, network topology, and representative dataset. Use the same application code and both exclusions. Do not test against customer production data.
2. Run correctness suites first. Confirm both resource exclusions are active and commit/rollback behavior is unchanged.
3. Run load generators separately from the app/database. Increase offered load through control stages such as 1,000, 2,500, 5,000, and 10,000 bookings/second, with a warmup before each measured stage. Use the [k6 constant-arrival-rate executor](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/constant-arrival-rate/) so request starts do not slow automatically when responses slow.
4. Size and preallocate virtual users using iteration duration and headroom. At 10,000/s and an assumed 100 ms mean iteration time, 1,000 VUs are occupied on average; a 1,000-VU ceiling leaves no headroom. The script accepts LOAD_VUS; the local wrapper exposes --vus. A 2,000-VU budget is an illustrative starting point for that assumption, not verified generator capacity. Dropped iterations invalidate the rate test; inspect generator CPU/memory/network before attributing every drop to the server.
5. Record offered starts, successful completions per measured second, status/error counts, latency, active/pending work, connection utilization, CPU, lock waits, query plans, WAL/storage activity, and drain duration. The existing local summary is diagnostic and does not replace production per-second completion/steady-state measurements.
6. Check persisted successes, correct ownership/dealership/qualification/active flags, catalog-derived intervals, and zero technician or bay overlaps. Quiesce the generators before reconciling complete response counts with persisted rows. Investigate ambiguous responses instead of ignoring extra/missing rows.
7. Only accept 10,000 successful bookings/second after repeatable production-equivalent runs meet the target without a growing backlog. If not, locate the limiting service cost and change one thing at a time. Candidate follow-ups are fewer database round trips, targeted query/index improvements, or additional measured application/database capacity. Keep the concrete repositories/use cases and regression tests; no speculative rewrite is approved by a capacity estimate.

## Available tooling and verification boundary

The local runner accepts --rate up to 10000 and --vus up to 10000 (default 1000). It still creates only verification-owned databases and ephemeral local processes; it is not a remote-deployment tool. Defaults remain a 100-request burst, or a 1,000-RPS control when rate mode is chosen without an explicit rate.

```sh
# Local diagnostic workload only; not proof of production capacity.
npm run test:load -- --mode rate --rate 10000 --vus 2000 --duration 60 --instances 4 --workload spread --report artifacts/target-10000.json
```

The 10,000-RPS script configuration is checked with k6 inspect, and a smaller real HTTP run verifies the configurable VU path. The exact minute-long command above has not been executed. A five-second local diagnostic at 10,000 scheduled requests/second, before the production-hardware clarification, failed with generator saturation/overload and transport failures; see [LOAD_RESULTS.md](LOAD_RESULTS.md). It does not establish production capacity. No production environment, deployment credentials, or production acceptance result is available in this repository.
