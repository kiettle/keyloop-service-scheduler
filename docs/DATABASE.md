# Database and domain model

Phase 2 introduced persistence and database constraints. [Phase 3](PHASE_3.md) adds read-only eligibility queries and deterministic candidate selection. There are no booking/availability APIs, reservations, application retries, cancellation workflows, or administrative endpoints. The only HTTP endpoint remains `/health`.

## Model and relationships

- Dealership owns technicians and bays; each resource belongs to one dealership.
- Customer owns vehicles; VIN is globally unique.
- ServiceType has an integer duration greater than zero and an active flag.
- TechnicianQualification is an explicit many-to-many join with `(technician_id, service_type_id)` as its primary key.
- Appointment holds required references to customer, vehicle, dealership, service type, technician, and bay, plus start/end and status.

All entity IDs are native UUIDs generated server-side by PostgreSQL's `gen_random_uuid()` unless supplied explicitly. The qualification join uses two UUID foreign keys as its composite identity. SQL names use snake_case; Prisma names use camelCase. All timestamps are `timestamptz(3)` to match JavaScript millisecond precision. Dealership time zone is a separate IANA-zone string for future local calendar rules; the database does not validate that string against an IANA registry.

Foreign keys use RESTRICT on deletion and ID updates. This protects referenced data/history rather than silently cascading deletions. Updating/removing reference data is not exposed in this phase. Foreign-key indexes support joins/reference checks, including cancelled history; dealership/resource active filters have compound indexes. Additional performance tuning needs real query plans once allocation exists.

## Integrity enforcement

| Rule                                                                                                 | Authority                                                            |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Required columns, entity references, VIN uniqueness, unique qualification pair                       | SQL NOT NULL, foreign keys, unique index/composite primary key       |
| Positive service duration                                                                            | PostgreSQL INTEGER plus `service_types_positive_duration` CHECK      |
| `startAt < endAt`                                                                                    | `appointment_valid_interval` CHECK                                   |
| No overlapping confirmed appointments for a technician                                               | `no_overlapping_technician_appointments`                             |
| No overlapping confirmed appointments for a bay                                                      | `no_overlapping_bay_appointments`                                    |
| Qualification, active status, matching resource dealership and customer/vehicle ownership at booking | Future application validation; ordinary FKs establish existence only |
| End time derived from the service duration, future start time, valid API input                       | Future application validation                                        |

Both exclusion constraints are immediate/non-deferrable and use `tstzrange(start_at, end_at, '[)')`. They independently reject equal-resource overlapping intervals, including direct inserts and updates from different clients. Intervals ending exactly when another begins are accepted. `btree_gist` supplies UUID equality for these GiST constraints. See PostgreSQL's [range constraint documentation](https://www.postgresql.org/docs/17/rangetypes.html#RANGETYPES-CONSTRAINT) and [btree_gist documentation](https://www.postgresql.org/docs/17/btree-gist.html).

Only `CONFIRMED` blocks either resource. `CANCELLED` is represented to verify partial-constraint behavior; no cancellation feature is implemented. A cancelled row retains all associations and interval checks. Changing it back to confirmed must satisfy both exclusions. There is deliberately no vehicle-overlap exclusion, matching spec assumption A-17. All bays are interchangeable in the proposed P0 design.

An appointment stores its scheduled start and end, so catalog duration changes do not rewrite history. There is no cross-table CHECK linking its length to today's service duration. There are no triggers for eligibility or active flags. Reference data must remain controlled; concurrent administrative changes require a later reviewed policy. `updatedAt` is maintained by Prisma writes; arbitrary SQL updates must set it explicitly if required. SQL fixtures use fixed intervals solely to test temporal relationships, independent of the current clock.

## Migrations and operational risks

`prisma/migrations/20261102000000_initial_domain/migration.sql` creates all eight tables, foreign keys/indexes, the status enum, CHECKs, and both exclusions in one explicit transaction. `migration_lock.toml` selects PostgreSQL. The base DDL was generated using Prisma migrate diff, then reviewed and extended with SQL-only constraints.

Run `npm run db:migrate` (`prisma migrate deploy`) against the intended database. No migration reset, drop, or development-data deletion is part of setup. On failure, inspect Prisma's migration status and the actual error; do not mark a failed migration applied without resolving its cause. Future schema changes require new reviewed migrations; do not edit an already deployed migration.

Risks and limitations:

- The migration role needs schema creation/DDL privileges and permission to install `btree_gist`. It is a trusted extension on standard PostgreSQL, requiring CREATE privilege on the database; managed hosts may impose additional restrictions. Verification used PostgreSQL 17.6 in Docker, not a hosted service.
- Adding exclusions to an existing populated table can fail on overlapping data and take locks during index construction. This initial migration targets a clean schema. Future data repair/migration plans must be reviewed separately.
- Prisma's schema does not express these CHECK/exclusion definitions. Committed SQL migrations are essential; `db push`, or rebuilding solely from the Prisma model, is insufficient. Tests apply actual migrations rather than mirroring the constraints in mocks.
- Exclusion conflicts can wait on another transaction. The observed raw-query error is Prisma `P2010`, with PostgreSQL SQLSTATE in `meta.driverAdapterError.cause.originalCode` (`23P01` for exclusion). The message identifies the named constraint. This shape is specific to the pinned Prisma/adapter versions and raw-query path; ORM model-write errors must be verified when booking is implemented.
- Concurrent database writes can also deadlock (`40P01`). Database constraints add no retries or resource-selection policy; Phase 3's advisory candidate selection does not reserve resources. A future booking operation must classify errors narrowly, roll back, and retry in a new transaction within a bounded policy.
- Database constraints guarantee resource non-overlap; they do not provide request idempotency, fair resource allocation, or complete business validation.

## Deterministic reference fixtures

`npm run db:seed` runs `prisma/seed.ts`, using the transactional `seedDatabase` function. IDs are exported in `prisma/seed-data.ts` and printed by the command. Timestamps are assigned on insertion; deterministic refers to fixture IDs and business values, not identical creation timestamps across databases.

| Fixture                           | ID pattern / values                                                           |
| --------------------------------- | ----------------------------------------------------------------------------- |
| Dealerships A/B                   | `10000000-0000-4000-8000-000000000001/2` (Asia/Ho_Chi_Minh / Europe/London)   |
| Customers 1–3                     | `20000000-0000-4000-8000-000000000001` through `...003`                       |
| Vehicles 1–4                      | `30000000-0000-4000-8000-000000000001` through `...004`; synthetic TEST VINs  |
| Oil / tires / inspection / brakes | `40000000-0000-4000-8000-000000000001` through `...004`; 30/60/90/120 minutes |
| Technicians A1/A2/A3/B1           | `50000000-0000-4000-8000-000000000001` through `...004`                       |
| Bays A1/A2/B1                     | `60000000-0000-4000-8000-000000000001` through `...003`                       |

Customer 1 owns vehicles 1/2, customer 2 owns vehicle 3, customer 3 owns vehicle 4. A1 supports oil/inspection, A2 tires/brakes, A3 oil/tires, B1 oil/inspection. There are 8 qualifications and no seeded appointments. Seed reruns insert missing rows only, preserving existing edits and appointments; conflicting pre-existing IDs/VINs can cause the seed transaction to fail rather than overwrite data.

## PostgreSQL integration verification

Start the separate `postgres-test` Compose profile service with `npm run db:test:up`. It uses port 55433 and tmpfs storage; development uses port 55432 and a named volume. Set `TEST_DATABASE_URL` from `.env.example`, then run `npm run test:integration`.

The harness requires the base database name `service_scheduler_test`; it never substitutes `DATABASE_URL`. Each run generates a new `scheduler_test_<uuid hex>` database, applies the committed migration through the real CLI, runs the real seed CLI, and drops that generated database afterward. The test role needs CREATEDB (the local Compose test role has it). No pre-existing database is reset. The two raw identifier statements use only this internally generated name; no caller-provided SQL is interpolated.

Tests inspect named constraints and actual SQLSTATEs, test all overlap shapes independently for technicians and bays, test adjacency in both directions, status predicates, SQL updates, required fields, all appointment FKs, reference FKs, unique keys, rollback, historical duration, and seed repeatability. A database-level contention test runs 20 inserts through two clients and checks final row count and overlap invariants. This is not an application booking/retry test; application-level concurrency acceptance remains outstanding.
