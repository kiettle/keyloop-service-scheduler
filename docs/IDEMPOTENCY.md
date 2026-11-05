# Durable appointment booking idempotency

This is an approved project enhancement rather than an original Keyloop requirement. It protects one booking intent across double submissions, network retries, and lost commit acknowledgements using the existing PostgreSQL database. It adds no cache, broker, deployment, or frontend.

## Client contract

`POST /api/v1/appointments` requires exactly one UUID v4 `Idempotency-Key` header. Header names and UUID casing are case-insensitive; keys normalize to lowercase. GET endpoints do not require keys. The body and header are always validated; unknown body fields remain rejected.

| Situation                                                        | Response                                       | Persisted effect                                      |
| ---------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------- |
| New key and successful booking                                   | 201; Idempotency-Replayed: false               | One confirmed appointment and complete request record |
| Same successful key and equivalent body                          | 201; Idempotency-Replayed: true; original body | No additional booking                                 |
| Same successful key and changed body                             | 409 IDEMPOTENCY_KEY_REUSED                     | No additional booking                                 |
| Missing, invalid, or repeated header                             | 400 VALIDATION_ERROR                           | No key consumed                                       |
| Failed or rolled-back booking                                    | Existing safe error contract                   | No key consumed                                       |
| Concurrent duplicate remains blocked until shared budget expires | 503 BOOKING_TIMEOUT; Retry-After: 1            | No additional booking; retry the same key             |

Each response carries the current HTTP attempt's `x-request-id`; saved bodies contain only the public appointment fields. Successful keys never expire. Only a successful commit binds a key permanently: a failed attempt may later succeed using the same key, and no business-error response is cached.

Frontend clients generate a key once per booking intent, for example with `crypto.randomUUID()`, and share it across duplicate submits and retries. Preserve the key until an uncertain outcome is resolved. Do not generate a new key for each HTTP attempt. Different keys are independent intents, even with identical payloads; this feature does not enforce vehicle non-overlap or guarantee response delivery. No frontend implementation is included.

Keys are globally scoped to this endpoint because this assessment has no authenticated principal. All five request fields participate in the fingerprint; reusing a successful key for another customer/dealership is rejected. Keys do not provide authorization. A future authenticated API must authorize the caller before replay and define principal scoping explicitly.

## Data and transaction design

The ninth Prisma model, `AppointmentBookingRequest`, maps to `appointment_booking_requests`. Its additive migration preserves the original domain tables, data, seeds, and both resource exclusions. Existing appointments need no backfill. Apply `npm run db:migrate`; no database reset is required or performed by this feature.

The UUID key is the primary key. A fixed-order SHA-256 fingerprint includes `v1:POST:/api/v1/appointments`, the four lowercased UUIDs, and `startAt` serialized to UTC milliseconds. JSON field order, UUID casing, equivalent offsets, and equivalent fractional precision do not change the intent. Changing any normalized field changes the fingerprint.

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

Defaults are sixteen active operations, 1,024 pending requests, twenty pool connections, and a five-second booking budget per app process. Database defaults remain 250 ms lock, 2 s statement, and 5 s transaction timeout. Cleanup, commit, and network overhead mean these are not a strict HTTP-response deadline. Queued cancellations leave no claim; an already executing request may still commit. A connection failure during commit is not automatically replayed by the server; the client retries with its original key to discover the result.

Successful records remain indefinitely with their appointment. There is no TTL, processing lease, cleanup job, or automatic deletion. Indefinite retention has a storage cost and would need an explicit operational policy before a real deployment. Logs distinguish creation, replay, and key mismatch using request and appointment IDs; they do not log raw keys, request bodies, or saved responses.

## Verification

The dedicated [PostgreSQL/HTTP suite](../test/integration/booking-idempotency.spec.ts) covers sequential and concurrent replay, normalization, all five changed fields, 100 same-key requests across two instances, rollback at three transaction stages, failed-key reuse, changed catalog/time replay, lost-response recovery after app restart, real key-lock expiry/recovery, queue disconnect, header validation, corrupt-state safety, and actual SQL constraints. Unit tests cover orchestration and canonicalization/snapshot guards. Original resource-contention assertions use distinct keys and remain unchanged.

Recorded execution results are linked below. Historical performance reports in [LOAD_RESULTS](LOAD_RESULTS.md) predate this feature unless explicitly labeled otherwise. No sustained-rate capacity is inferred from correctness or burst tests.

The latest recorded suite results are summarized in [FINAL_REVIEW](FINAL_REVIEW.md). The [implementation and compatibility history](archive/IDEMPOTENCY_HISTORY.md) retains exact commands, source fingerprints, failed checks, and historical burst results.
