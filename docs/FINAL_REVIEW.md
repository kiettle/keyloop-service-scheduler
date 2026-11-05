# Verification and submission status

**Reviewed on 5 November 2026.** This page summarizes recorded software checks and the remaining submission checks. The [full verification history](archive/VERIFICATION_HISTORY.md) preserves exact commands, corrections, earlier counts, and source/environment limits. Documentation reviews do not establish new application or performance results.

## Readiness

**The documentation is ready for review.** The tested backend has documented MVP limitations. The video, final submission revision, and reviewer access have **not been verified in this review**. Confirm those items before submitting. This is an assessment submission, with no production-readiness claim.

The original assessment PDF is absent from this checkout. Requirements follow the recorded [specification](SPEC.md#assessment-requirements-and-scope); compare the final deliverables with your original assessment copy.

## Recorded verification

| Check                          | Result and evidence                                                                                                                                                                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full correctness suite, 5 Nov  | **171 default + 216 PostgreSQL/Redis tests passed.** [Reliability record](archive/VERIFICATION_HISTORY.md#reliability-boundary-tests--2026-11-05). Subsequent holiday load-tool edits did not repeat the full suite.                      |
| Build and static checks        | Build, typecheck, lint, formatting, and diff checks passed in the [final-review correction run](archive/VERIFICATION_HISTORY.md#final-review-corrections--2026-11-05). Later focused checks retain their own scope.                       |
| Resource concurrency           | Six real-PostgreSQL cases passed again in the [holiday follow-up](archive/VERIFICATION_HISTORY.md#holiday-peak-measurement--2026-11-05), retaining strict contention, alternatives, adjacency, and database invariants.                   |
| 100-request bursts             | Spread and adjacent-interval profiles each confirmed 100 bookings. One pair at an identical interval produced one confirmation and 99 conflicts. [Commands and source fingerprint](LOAD_RESULTS.md#final-review-burst-rerun--2026-11-05). |
| Holiday experiments            | 250 requests/two processes and 500/four passed twice each. Smaller configurations failed. [Measurements and limitations](HOLIDAY_PEAK.md).                                                                                                |
| Isolated installation and demo | Passed for an earlier source candidate. The [installation record](archive/VERIFICATION_HISTORY.md#fresh-installation-and-demo-evidence) does not verify a new final checkout.                                                             |

Focused suites overlap with `test:all`; their counts are not additional coverage. Local bursts do not establish sustained throughput, automatic scaling, cloud costs, or production capacity. The future goal of 1,000 successful bookings per second remains unverified; [failed rate trials](LOAD_RESULTS.md) remain visible.

## Coverage to review

- **Booking and persistence:** [API](../test/integration/booking-api.spec.ts), [scheduling](../test/integration/scheduling.spec.ts), and [database](../test/integration/database.spec.ts) tests cover validation, ownership, eligibility, full-duration overlaps, adjacency, retrieval, and rollback.
- **Concurrency and recovery:** [Resource contention](../test/integration/booking-concurrency.spec.ts) and [idempotency](../test/integration/booking-idempotency.spec.ts) tests inspect persisted state, alternative-pair retries, real key waiting, restart/lost-response recovery, and 100 same-key requests across instances.
- **Lookups and caching:** [Lookup](../test/integration/booking-lookups.spec.ts), [catalog](../test/integration/service-catalog.spec.ts), and [dealership cache](../test/integration/directory-cache.spec.ts) tests cover parent isolation, pagination, cross-instance hits, expiry, malformed/empty values, maintenance, and failure isolation.
- **Operations:** [HTTP logging](../test/request-logging.spec.ts) and [worker lifecycle](../test/integration/load-worker.spec.ts) tests cover correlated safe failures and fixture-owned startup/shutdown.

Booking still assigns resources automatically and rejects client-supplied assignments. The removed technician-list route returns 404 and is absent from Swagger. Booking, availability, and idempotency use authoritative PostgreSQL data.

## Findings and limitations

Review corrections included Prisma error-metadata assumptions, contention-test expectations, a duplicate load-worker listener start, and missing classified failure logs. Regression checks exposed failures before the relevant fixes. Historical failed trials and unexplained HTTP observations remain in the archive. The holiday 250-request/one-process trial also retained 98 health warmup resets with an unresolved cause.

Authentication, working hours, cancellation, and vehicle-overlap prevention are outside scope. Concurrent administrative reference-data changes are unsupported. Redis is eventually consistent, with no update API or automatic synchronization. Idempotency protects one successful key's booking effect; it does not deduplicate different keys or guarantee response delivery. See [design limitations](SYSTEM_DESIGN.md#verification-and-limitations).

## Submission checklist

1. Review the [README AI narrative](../README.md#ai-collaboration-narrative); use personal statements you can explain and support.
2. Confirm the final submission revision passes the [documented checks](../README.md#build-and-test), distinguishing fresh results from historical evidence.
3. Record the required 5–10 minute video showing the [booking workflow](../README.md#try-a-booking) and including the AI collaboration account.
4. Confirm the repository and video links are available to the reviewer and refer to the intended submission revision. Publication/access are manual checks, not verified here.

## Documentation review

This documentation-only review corrected grammar, navigation, and dense tables. It checked 200 local file/heading links across 23 documents, all nine HTTP routes against the controllers, nine Prisma models, 20 npm script names, 17 shell blocks, three JSON examples, and one TypeScript example. Formatting and diff checks passed. All eight Mermaid blocks, including archived examples, parsed successfully; the four current diagrams rendered and were visually inspected. The ten current Markdown pages were rendered at 1280 px and 768 px without page-level horizontal overflow; detailed measurement tables scroll within their own containers.

Historical measurement tables, archived records, AGENTS.md, non-document files, and the Git index are unchanged. No application test suite, load benchmark, fresh installation, commit, push, or deployment was performed for this review.
