# Keyloop Scenario A — implementation specification

**Version 2.0 — consolidated current contract, 5 November 2026.** This describes the implemented backend and approved scope. It replaces the phase-by-phase planning presentation; the [original planning specification](archive/SPEC_PLANNING.md) remains available as history.

## Assessment requirements and scope

The recorded Scenario A requirements are:

| Requirement                                                                             | Implementation                                                      |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **K-R1:** Request service for a vehicle, dealership, and desired time                   | Booking POST with customer, vehicle, dealership, service, and start |
| **K-R2:** Find a qualified technician and service bay available for the entire duration | Authoritative eligibility/overlap queries and database exclusions   |
| **K-R3:** Persist a confirmed appointment linking customer, vehicle, and both resources | Atomic PostgreSQL persistence and retrieval after restart           |

The chosen submission is backend-only: NestJS, TypeScript, Prisma, and PostgreSQL, with Swagger as the API client. Required deliverables are setup/build/test instructions, automated business tests, a system-design document, a dedicated README AI Collaboration Narrative, and a 5–10 minute demonstration video. The original assessment PDF is not present in this checkout; the source wording was not independently rechecked during this documentation cleanup.

Idempotency, shared Redis reference caching, lookup/history endpoints, and local burst criteria are approved project additions. They are not additional Keyloop traffic or feature requirements. Operating boundaries remain in [AGENTS.md](../AGENTS.md).

## Domain rules

- Clients supply only customerId, vehicleId, dealershipId, serviceTypeId, and startAt. The server chooses the technician/bay and derives the exclusive end from the service duration.
- The vehicle must belong to the customer. All references must exist, and the service type must be active.
- A technician must be active, qualified for the service, and belong to the requested dealership. A bay must be active and belong to that dealership. All active bays support all services.
- Services are global and have positive whole-minute durations. Each technician/bay belongs to one dealership; qualifications are explicit many-to-many records.
- New bookings start strictly after the server's current instant. Use an injected clock in tests. No operating-hours or shift rules are implemented.
- CONFIRMED appointments block both resources for the whole half-open interval `[startAt, endAt)`. Adjacency is permitted. CANCELLED is stored/testable but has no write API.
- Existing appointments retain their stored start/end after catalog changes. There is no vehicle-overlap exclusion.
- Reference data is seeded and controlled; concurrent administrative resource/catalog changes are outside the supported workflow.

PostgreSQL enforces references, required fields, positive durations, valid intervals, and two independent resource exclusion constraints. Eligibility and ownership remain authoritative application checks. See [DATABASE](DATABASE.md) for the nine models, SQL rules, migration risks, and deterministic fixtures.

## API contract

Business routes use `/api/v1`, JSON, and UUID identifiers. Response timestamps are ISO 8601 UTC strings with millisecond precision. Swagger at `/docs` and OpenAPI at `/docs-json` describe the executable schemas.

| Method and route                                     | Result                                                                                   |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `POST /api/v1/appointments`                          | 201 confirmed appointment, or original successful response on replay                     |
| `GET /api/v1/appointments/:id`                       | 200 persisted public appointment; malformed ID is 400, unknown ID is 404                 |
| `GET /api/v1/dealerships/:dealershipId/availability` | 200 derived interval, availability boolean, and eligible free-resource counts            |
| `GET /api/v1/service-types`                          | 200 active global service array: id, name, durationMinutes; name then ID ascending       |
| `GET /api/v1/customers`                              | 200 customer page: id, name; name then ID ascending                                      |
| `GET /api/v1/customers/:customerId/vehicles`         | 200 owned-vehicle page: id, customerId, vin, make, model; ID ascending                   |
| `GET /api/v1/dealerships`                            | 200 dealership page: id, name, timeZone; name then ID ascending                          |
| `GET /api/v1/customers/:customerId/appointments`     | 200 public appointment page; startAt then ID descending, all stored statuses/past/future |
| `GET /health`                                        | 200 process liveness; not continuous database readiness                                  |

There is no technician-list or bay-list endpoint. Clients cannot supply resource IDs, duration, endAt, or status when booking. Lookups provide IDs to copy into Swagger; they do not create dynamic dropdowns. Customer discovery is an unauthenticated demo convenience, not a production authorization design.

### Booking and retrieval

POST requires exactly one UUID v4 `Idempotency-Key` header and the following body. Choose a future time for a new booking:

```json
{
  "customerId": "20000000-0000-4000-8000-000000000001",
  "vehicleId": "30000000-0000-4000-8000-000000000001",
  "dealershipId": "10000000-0000-4000-8000-000000000001",
  "serviceTypeId": "40000000-0000-4000-8000-000000000001",
  "startAt": "2035-01-15T10:00:00.000Z"
}
```

The public response contains id, customerId, vehicleId, dealershipId, serviceTypeId, technicianId, serviceBayId, startAt, endAt, status, and createdAt. Creation returns CONFIRMED only after commit. Retrieval/history use the same public format; Prisma internals are never exposed.

Successful keys are retained indefinitely and scoped globally to this endpoint because authentication is not implemented. Equivalent payloads normalize UUID casing and UTC timestamps and replay the original saved 201 body with `Idempotency-Replayed: true`; new success has `false`. Changed-payload reuse returns `409 IDEMPOTENCY_KEY_REUSED`. Each HTTP attempt has its own request ID. Failed/rolled-back attempts do not consume keys. Clients keep the original key after an uncertain response; different keys are independent intents. See [IDEMPOTENCY](IDEMPOTENCY.md).

### Availability

Query parameters are serviceTypeId and startAt. The response includes dealershipId, serviceTypeId, startAt, endAt, available, availableTechnicianCount, and availableServiceBayCount. Counts cover only eligible resources free for the complete interval; available requires both counts to be positive. No resource IDs, hold, or reservation are returned. Booking always revalidates in its transaction.

### Pagination

Customers, owned vehicles, dealerships, and history return `{ items, page, limit, hasNext }`. Defaults are page=1 and limit=20, maximum limit=100. Both values must be positive integers. Page must be at most 2,147,483,647, and the offset `(page - 1) * limit` must not exceed 2,147,483,647. Fetch limit+1 rows, trim the extra row, and derive hasNext without a count query.

Known customers with no vehicles/history receive an empty page; unknown customers receive `404 CUSTOMER_NOT_FOUND`. The catalog remains a plain array, including `[]`. Parent-scoped results never include another customer's rows. Offset pages may shift during concurrent inserts and do not promise a fixed snapshot.

### Validation and errors

Validated booking/availability/list DTOs reject unknown fields, repeated scalar parameters, malformed UUIDs, and invalid pagination. Timestamps require real calendar dates, seconds, `Z` or an explicit `±HH:MM` offset, and at most three fractional digits. Missing, malformed, or repeated idempotency headers return 400.

Errors use the consistent shape below. Input validation may add an optional `details` array of safe validation messages inside `error`:

```json
{
  "error": {
    "code": "NO_AVAILABILITY",
    "message": "No qualified technician and service bay are available for the requested interval."
  },
  "requestId": "<server-generated-uuid>"
}
```

| HTTP | Code / meaning                                                                                                                                                                                  |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400  | VALIDATION_ERROR: malformed or unsupported input                                                                                                                                                |
| 404  | CUSTOMER_NOT_FOUND, VEHICLE_NOT_FOUND, DEALERSHIP_NOT_FOUND, SERVICE_TYPE_NOT_FOUND, APPOINTMENT_NOT_FOUND; NOT_FOUND for unknown routes                                                        |
| 422  | INVALID_BOOKING_TIME for a nonfuture new booking; BUSINESS_RULE_VIOLATION for ownership/inactive-service rejection                                                                              |
| 409  | NO_AVAILABILITY for settled exhaustion; IDEMPOTENCY_KEY_REUSED for changed successful-key reuse                                                                                                 |
| 503  | BOOKING_BUSY for admission exhaustion; BOOKING_TIMEOUT for expired work; BOOKING_CONTENTION for unresolved allocation contention; SERVICE_UNAVAILABLE for recognized temporary database failure |
| 500  | INTERNAL_ERROR for unexpected failures, including invalid committed idempotency state                                                                                                           |

Business responses carry x-request-id; retryable 503 responses add `Retry-After: 1`. SQL, stacks, credentials, raw booking keys, and private database details are not exposed. Redis failure never disguises an actual database error.

`BOOKING_BUSY` also covers queued-request cancellation and application shutdown; it does not always mean the pending queue was full. A disconnected caller may receive no HTTP response.

## Atomicity and concurrency

1. Validate syntax, normalize the input/key, and enter the bounded admission gate using the shared deadline.
2. Begin a fresh READ COMMITTED transaction and claim the key before allocation using parameterized INSERT ON CONFLICT (key) DO NOTHING RETURNING.
3. Read a conflicting successful record in a subsequent statement. Replay before dynamic checks, or reject a fingerprint mismatch.
4. For a new claim, validate authoritative business data, choose a pair, and insert CONFIRMED with both exclusions active. Save the response/reference in the same transaction and commit before success.
5. Roll back the entire attempt before allocation-conflict retry. Keep four allocation attempts by default, with jittered waits outside transactions.
6. Claim-only lock timeouts retry after rollback with 25–50 ms jitter within the same deadline, without consuming allocation attempts. Other database errors retain their classification.

A skipped resource-conflict insertion cannot be acknowledged as success. There are no explicit resource-row/advisory locks, separately committed processing claims, or automatic replay of ambiguous connection failures. Unexpected committed incomplete claims are internal errors.

Defaults are sixteen active bookings, 1,024 pending requests, twenty runtime pool connections, and a five-second shared booking budget per app instance. Fixed PostgreSQL defaults are 250 ms lock, 2 s statement, and 5 s transaction timeouts; Prisma uses the remaining booking budget for each attempt. Queued cancellation releases admission. Running work may commit despite disconnect or late delivery; cleanup/commit/network overhead is not a strict HTTP deadline. See [system design](SYSTEM_DESIGN.md#contention-and-failure-handling).

## Reference caching

Shared Redis caches only active service types and dealership pages. PostgreSQL remains the source of truth. Keys include a deployment/database namespace and version; dealership keys also include normalized page/limit. Use fixed `SET ... EX 300`, valid public-payload guards, and no TTL extension on hits.

Misses, malformed entries, and unavailable Redis fall back to PostgreSQL; successful empty results can be cached. SET failures do not discard successful database responses. Database failures propagate through the existing safe error contract. Redis is not required for startup, scheduling correctness, or idempotency.

After controlled changes commit, replace the complete authoritative catalog or invalidate all dealership pages while preserving unrelated keys. These tested maintenance patterns are best effort and eventually consistent; no update API or automatic synchronization is implemented. Customers, vehicles, history/retrieval, booking, availability, and idempotency remain uncached. See [cache design](SYSTEM_DESIGN.md#redis-caching) and its linked maintenance tests.

## Acceptance criteria

These IDs retain the original P0 traceability. They describe required assertions, not a claim that a new verification ran during editing.

| ID     | Required evidence                                                                                                                                                                 |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-F01 | Valid POST persists one complete confirmed appointment with server-assigned resources and derived duration                                                                        |
| AC-F02 | Invalid references, ownership, or input fail with no partial booking                                                                                                              |
| AC-F03 | Equivalent-offset instants, future-time rules, calendar validation, and adjacent intervals behave consistently                                                                    |
| AC-F04 | Unqualified, inactive, or wrong-dealership resources are never assigned                                                                                                           |
| AC-F05 | Partial, full, contained, identical overlaps are rejected independently for technicians and bays; adjacency/cancelled cases remain valid                                          |
| AC-F06 | Availability covers the whole interval, creates nothing, and is rechecked during booking                                                                                          |
| AC-F07 | Commit survives restart; injected failures roll back appointment/key writes                                                                                                       |
| AC-F08 | Twenty distinct-key requests for one pair yield exactly one confirmation and nineteen availability conflicts; two-pair contention can use alternatives through fresh transactions |
| AC-F09 | Errors remain safe and correctly classified, with request correlation and bounded failure handling                                                                                |
| AC-F10 | README setup/build/test instructions, migrations/seeds, design, AI narrative, and reproducible demo are available                                                                 |

Additional approved regressions cover same-key sequential/concurrent replay, mismatch, rollback, lost-response/restart recovery, claim-wait expiry/recovery, queue cancellation, cached payload validation, cross-instance hits, expiry, refresh/invalidation, and Redis/database failure isolation. A 100-request same-key/two-instance burst persists one booking and returns one creation plus 99 replays under the normal fixture.

The project resilience criterion is a separate 100-request distinct-key burst: all confirm with sufficient resource/time capacity; one pair at one interval yields one confirmation and 99 availability conflicts. Verify persisted counts, complete keys, qualifications, and zero resource overlaps, with no overload/technical failures. Burst success is not sustained throughput. Local holiday experiments retain their own fixture and process limits in [HOLIDAY_PEAK](HOLIDAY_PEAK.md).

## Boundaries and deliverables

No frontend, authentication, cancellation/rescheduling, working hours/shifts, administrative write API, notifications, broker, infrastructure deployment, or CI pipeline is implemented. A future 1,000-successful-bookings/second stretch goal remains unverified and does not block the assessment. Optimization and additional infrastructure require measurements.

The [README](../README.md) covers build/run/test, booking examples, and AI collaboration. The [system design](SYSTEM_DESIGN.md) explains architecture, data flow, technology choices, observability, and design-phase AI use. [FINAL_REVIEW](FINAL_REVIEW.md) distinguishes recorded verification from remaining video/repository handoff steps. Historical proposals and phase instructions in [the archive](archive/README.md) are not the current implementation contract.
