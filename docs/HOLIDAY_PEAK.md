# Holiday booking surge measurements — 2026-11-05

For a quick review, read [Result](#result) and [Interview interpretation and limits](#interview-interpretation-and-limits). The detailed tables and reproduction commands retain the evidence behind those conclusions.

## Result

On the tested shared laptop, one prestarted app process confirmed a 100-request burst, two confirmed a 250-request burst, and four confirmed a 500-request burst. The two larger successful configurations each passed twice. Smaller configurations returned explicit BOOKING_BUSY responses once admission filled. PostgreSQL resource, ownership, duration, idempotency, and appointment-day checks passed even in the failed load profiles.

These are synthetic local burst experiments with separate app processes and one PostgreSQL writer. They demonstrate bounded admission and the benefit of additional prestarted application workers for these workloads. They are not production sizing, sustained-throughput, autoscaling, or monetary cost measurements.

## Workloads and unchanged safeguards

- **Holiday appointment day:** twenty fixture dealerships, two qualified active technicians and two active bays each, and sixteen 30-minute slots from 08:00 to 16:00 UTC on 2035-01-15. Capacity is 640 appointments. Requests cycle across dealerships and slots, with at most two requests per dealership/slot at the tested sizes. All 100, 250, or 500 requests therefore have sufficient eligible appointment capacity; every request must confirm for a strict pass. SQL verifies that persisted intervals stay inside the specified day window.
- **Popular time:** 250 distinct booking intents compete for one technician and one bay at an identical interval. Strict pass requires one confirmation, 249 NO_AVAILABILITY conflicts, and one complete persisted appointment/key record.
- Every request uses a distinct UUID v4 idempotency key. Clients make one booking attempt each, without retries that could conceal rejected arrivals. Expected availability conflicts are not counted as successful bookings.
- Each process retains eight active booking slots, 128 pending slots, a ten-connection pool, four allocation attempts, and a 5,000 ms shared booking budget. PostgreSQL keeps the existing exclusions and 250 ms lock / 2 s statement / 5 s transaction defaults. No queue/pool limit, validation rule, exclusivity constraint, or success criterion was relaxed.
- The single-process, two-process, and four-process configurations are prestarted before traffic. This is a comparison of manually chosen capacity, not an automatic scaling transition during traffic.

The day window is a benchmark fixture, not a new holiday calendar or opening-hours feature. The load factory injects its existing fixed clock at midnight on the fixture date. Real business opening hours remain outside scope.

## Method and source

Environment: Apple M2, eight logical CPUs, 16 GiB host RAM, macOS arm64, Node 24.21.0, PostgreSQL 17.6 in Docker, k6 2.3.0. Generator, apps, and database share one laptop. PostgreSQL reports max_connections=100; application pool limits are ten per process, not a promise that all pool connections are continuously open.

Workers use the real AppModule, HTTP validation, use cases, Prisma transactions, and database constraints, bootstrapped through the existing Nest test factory and ts-node with NODE_ENV=production. They are not compiled production binaries or separate hosts. In particular, measured worker memory includes test/bootstrap/compiler overhead and is unsuitable for production memory sizing.

Each run owns a migrated, seeded, configured database and ephemeral loopback app processes. HTTP connections are warmed through health, then clients release from a common clock barrier. Actual launch offsets are reported below; exact simultaneous server arrival is not claimed. JSON application logging is enabled; stdout is discarded and stderr is retained in the local run logs. No hosted network, proxy, load balancer, or external log collector is benchmarked.

The final runs sample workers and PostgreSQL every 100 ms. Queue values below are sampled aggregate observations, not exact instantaneous maxima. Sampling can miss short events, and worker messages and database snapshots are not atomic together.

After each holiday-day burst drains, k6 checks health and authoritative availability for an unused next-day interval through every app instance. These read-only probes must succeed; they create no extra appointments. They demonstrate post-burst liveness/read recovery, not a separate post-overload booking-write test. The popular-time profile has no additional recovery phase.

Final measured working-source SHA-256: `4f9caa9eaccad8b8d805cdcc9e209b46c9a5ddbc6e312a7da13762e61d788a38`, based on commit e2d4249 plus existing staged and working changes. The digest covers 100 files: all files under src, prisma, scripts, and test, plus package.json, package-lock.json, both tsconfigs, both Vitest configs, .env.example, docker-compose.yaml, and prisma.config.ts. Sorted relative paths and file bytes each end with a NUL separator. Documentation/reports are excluded. This is a working-source result, not a remote-checkout claim.

## Final burst results

All rows started exactly the requested number of booking requests. There were no booking transport/unexpected errors, BOOKING_TIMEOUT, BOOKING_CONTENTION, SERVICE_UNAVAILABLE, invalid assignments, incomplete keys, resource overlaps, or appointments outside the holiday window. Every acknowledged confirmation matched a persisted appointment and complete key record. Strict failures remain failures even though database integrity held.

| Workload              | Requests | App processes | Confirmed / persisted | Availability conflicts | BOOKING_BUSY | Warmup failures | All-response p95 ms |  p99 ms | Client start offsets ms | Strict result |
| --------------------- | -------: | ------------: | --------------------: | ---------------------: | -----------: | --------------: | ------------------: | ------: | ----------------------- | ------------- |
| Holiday day           |      100 |             1 |                   100 |                      0 |            0 |               0 |              291.17 |  295.67 | 12–31                   | PASS          |
| Holiday day           |      250 |             1 |                   137 |                      0 |          113 |              98 |              331.97 |  342.36 | 17–39                   | FAIL          |
| Holiday day           |      250 |             2 |                   250 |                      0 |            0 |               0 |              944.77 |  952.71 | 1–22                    | PASS          |
| Holiday day           |      500 |             2 |                   272 |                      0 |          228 |               0 |              790.97 |  852.97 | 3–54                    | FAIL          |
| Holiday day           |      500 |             4 |                   500 |                      0 |            0 |               0 |             1204.37 | 1223.05 | 9–93                    | PASS          |
| Popular time          |      250 |             2 |                     1 |                    249 |            0 |               0 |              482.21 |  487.12 | 2–29                    | PASS          |
| Holiday day, repeat 2 |      250 |             2 |                   250 |                      0 |            0 |               0 |              905.56 |  915.95 | 2–12                    | PASS          |
| Holiday day, repeat 2 |      500 |             4 |                   500 |                      0 |            0 |               0 |             1848.39 | 1934.25 | 4–97                    | PASS          |

Latency includes all booking responses, including quick rejections in failed profiles. A lower mixed-response percentile does not make a rejecting configuration faster at successfully booking the whole workload. The 500-request/four-process p95 varied from 1.20 to 1.85 seconds across two trials; no numeric production latency SLO has been agreed.

The failed 250-request/one-process trial also observed 98 health warmup connection resets. Those are separately counted, fail the profile, and are preserved in its log. Their root cause was not isolated. They do not change the independently observed 137 confirmations and 113 BOOKING_BUSY booking responses. More workers also change connection handling and scheduling; this experiment does not isolate a single explanation for every difference.

Sampled aggregate active/pending maxima in the first final trials were 8/92 for 100 requests on one process, 8/128 for 250 on one, 16/234 for 250 on two, 16/256 for 500 on two, and 32/400 for 500 on four. The rejected configurations reached their configured pending bounds. Up to one lock waiter was sampled in the 500-request/four-process trial; this is not proof that other brief waits never occurred. All holiday-day post-burst health/availability probes passed, including after overload.

## Reproduction and retained reports

Start the dedicated test services with npm run db:test:up. k6 2.3.0 must be available. The runner never targets a public URL or resets development data. Run each profile separately; overloaded profiles intentionally exit 1 and still write reports.

```sh
npm run test:load -- --mode burst --count 100 --instances 1 --workload holiday --report artifacts/holiday-20261105-holiday-100-app1-sample100.json
npm run test:load -- --mode burst --count 250 --instances 1 --workload holiday --report artifacts/holiday-20261105-holiday-250-app1-sample100.json
npm run test:load -- --mode burst --count 250 --instances 2 --workload holiday --report artifacts/holiday-20261105-holiday-250-app2-sample100.json
npm run test:load -- --mode burst --count 500 --instances 2 --workload holiday --report artifacts/holiday-20261105-holiday-500-app2-sample100.json
npm run test:load -- --mode burst --count 500 --instances 4 --workload holiday --report artifacts/holiday-20261105-holiday-500-app4-sample100.json
npm run test:load -- --mode burst --count 250 --instances 2 --workload hotspot --report artifacts/holiday-20261105-hotspot-250-app2-sample100.json
```

Repeat the successful 250/two-process and 500/four-process commands with `-repeat2` before `.json` in their report paths to preserve both trials. Original reports and captured .log files are retained under ignored artifacts/. Report thresholds require all confirmations when appointment capacity exists, exact one-confirmation contention, zero 503/unexpected outcomes, successful warmup, and successful holiday-day recovery reads. Actual SQL invariants are also required. A failed target is not relabeled as a pass because overload was controlled.

Holiday mode accepts burst profiles only and at most 640 requests, protecting the declared sufficient-capacity scenario. CLI checks rejected rate mode and 641 requests before database creation. This guard is not a production traffic limit; the existing general stress/rate profiles retain their separate meanings.

## Initial trials retained

Before the final instrumentation, the first four trials used one-second sampling and source SHA-256 `66f27168a0eefb656bbbb541b31c39041a89a43ae2d372bc9ffa2f4a2b6869ad`, using the same digest definition. That sampler missed much of the subsecond queue activity. Warmup failures were visible in k6 output/aggregate HTTP metrics but were not yet separately counted/gated, and there was no post-burst recovery phase. These diagnostic reports remain alongside the final results:

| Report prefix under artifacts/ | Requests / processes | Confirmed | BOOKING_BUSY |  p95 ms | Original result |
| ------------------------------ | -------------------- | --------: | -----------: | ------: | --------------- |
| holiday-20261105-day-100-app1  | 100 / 1              |       100 |            0 |  715.41 | PASS            |
| holiday-20261105-day-250-app1  | 250 / 1              |       136 |          114 |  440.32 | FAIL            |
| holiday-20261105-day-250-app2  | 250 / 2              |       250 |            0 |  734.92 | PASS            |
| holiday-20261105-day-500-app2  | 500 / 2              |       272 |          228 | 1321.70 | FAIL            |

The initial 250/one-process run additionally showed six health warmup resets. Every initial run passed its database/day-window invariants. Instrumentation and local conditions differed between initial/final trials; do not claim that faster sampling caused a latency improvement.

## Interview interpretation and limits

The useful engineering point is that appointment capacity and request-processing capacity are separate. Adding application workers does not make one bay accept overlapping appointments: the popular-time trial still confirmed exactly one. For a day with sufficient appointment capacity, additional prestarted workers allowed the tested larger burst to complete, while the smaller configuration shed excess work explicitly and recovered for reads afterward.

This supports investigating a modest normal configuration and temporarily supplying more application capacity before a predictable peak. It does not prove an autoscaler can react fast enough: startup/provisioning delay, real workload distribution, database pressure, latency objectives, availability needs, and provider billing still need deployment-specific measurements. All processes here shared one host, so process counts are not dollar costs or evidence of savings. Keep the modular monolith and one PostgreSQL writer; aggregate pools must fit its connection budget.

No sustained-rate profile, cloud deployment, infrastructure purchase, production-capacity claim, or automatic scaling implementation was added. The original 100-request assessment criterion and twenty-request regression remain unchanged. Earlier failed rate trials remain in [LOAD_RESULTS](LOAD_RESULTS.md).
