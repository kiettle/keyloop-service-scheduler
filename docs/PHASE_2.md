# Phase 2 — database and domain modeling

Date: 2026-11-02 (Asia/Ho_Chi_Minh). Scope explicitly approved by the developer: eight Prisma models, database integrity/overlap constraints, reproducible migrations, deterministic seeds, PostgreSQL tests, and schema documentation. Application scheduling, allocation, retries, appointment APIs, and optional workflows are excluded.

## Decisions made before implementation

- Preserve the Phase 1 stack and versions; add no dependencies or application abstractions.
- Use native UUIDs and `timestamptz(3)`, with a separate dealership IANA-zone string.
- Use restrictive foreign keys and explicit qualification records; keep cross-table eligibility policies at the future application boundary as specified.
- Store appointment end time rather than recalculating history from a mutable service catalog.
- Keep CHECKs and both partial exclusion constraints in reviewed migration SQL; Prisma model definitions alone are insufficient.
- Apply the initial migration atomically. Extension privileges, existing overlaps, and index-building locks are migration risks; verify a clean installation first.
- Isolate tests on a separate PostgreSQL service and create a fresh database per run. Never reset the development database.

See [DATABASE.md](DATABASE.md) for the complete enforcement/limitation table, fixture identities, migration design, and operational requirements.

## Implemented files

- `prisma/schema.prisma`: all eight models, UUIDs, mapped SQL names, relationships, enum, required columns, unique keys, timestamps, and baseline indexes.
- `prisma/migrations/20261102000000_initial_domain/migration.sql` and `migration_lock.toml`: reproducible tables, foreign keys, CHECKs, btree_gist, and two `[)` partial GiST exclusions, wrapped in a transaction.
- `prisma/seed-data.ts`, `prisma/seed.ts`, `prisma.config.ts`: transactional insert-missing reference fixtures, stable IDs, and actual Prisma seed command.
- `test/helpers/test-database.ts`, `test/integration/database.spec.ts`, `vitest.integration.config.mts`: separate clean-database integration lane and real SQL assertions.
- `compose.yaml`, `.env.example`: separate test service/connection configuration.
- `package.json`, `vitest.config.mts`, `tsconfig.json`, `eslint.config.mjs`: commands, lane isolation, and checking/linting of seed code.
- `README.md`, `docs/DATABASE.md`, this record, `AGENTS.md`: setup, evidence, limitations, and phase authorization. The assessment spec and Phase 1 application source were not modified.

## Observed verification

Environment: existing Node 24.21.0 / npm 11.19.0, Prisma/client/adapter 7.10.1, Vitest 4.1.11, and PostgreSQL 17.6 (aarch64 Alpine). No dependency versions changed.

| Executed command / action                                                                                                  | Result                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `prisma format` and `prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script --output ...` via npm exec | Schema formatted; base migration generated, then manually extended/reviewed for CHECKs and exclusions |
| `docker compose --profile test up -d --wait postgres-test`                                                                 | Separate tmpfs-backed service healthy on 127.0.0.1:55433                                              |
| Real `prisma migrate deploy` inside integration harness                                                                    | Initial migration applied successfully to each new UUID-named database                                |
| Real `prisma db seed` inside integration harness                                                                           | Seed CLI succeeded; reference data present; no appointments seeded                                    |
| `npm run prisma:validate`                                                                                                  | Passed                                                                                                |
| `npm run build`                                                                                                            | Passed, including generation of the modeled Prisma client                                             |
| `npm run typecheck`                                                                                                        | Passed, including seed and integration TypeScript                                                     |
| `npm run lint`                                                                                                             | Passed                                                                                                |
| `npm run format` / `npm run format:check`                                                                                  | New files formatted; formatting check passed                                                          |
| `TEST_DATABASE_URL=<dedicated test URL> npm run test:all`                                                                  | 17 foundation tests and 47 PostgreSQL integration tests passed                                        |
| PostgreSQL `SELECT version()` on the test server                                                                           | Actual server version 17.6                                                                            |
| PostgreSQL database-catalog check after test cleanup                                                                       | Zero generated `scheduler_test_*` databases remained                                                  |

The 47 database cases cover independent technician and bay conflicts across all five overlap shapes, adjacency before/after, separate resource pairs, cancelled-row predicates, update/restore conflicts, offset equivalence, invalid intervals/durations, all appointment foreign keys and required fields, other relationship FKs, unique VIN/qualification identity, restrictive deletion, rollback verified from another client, historical duration, fixture repeatability, and concurrent direct writes.

The contention case executed 20 writes using two independent Prisma clients: exactly one succeeded, 19 were rejected, exactly one CONFIRMED row remained, and a final overlap join found zero conflicts. Rejections must carry the observed adapter raw-query error and a recognized PostgreSQL exclusion/deadlock code. This proves database-level exclusivity; it does not prove a booking API, automatic allocation, or retry behavior.

## Actual issues found and corrected

The first integration run applied the migration and then reported 11 passing / 34 failing cases. The failing assertion helper assumed raw SQLSTATE was directly in Prisma `meta.code`. Actual raw-query errors from the pinned adapter were Prisma `P2010`, with SQLSTATE in `meta.driverAdapterError.cause.originalCode`. Assertions were corrected using those observed errors and named constraints; subsequent clean-database runs passed. The migration did not need a constraint change to resolve those failures.

A Vitest asymmetric matcher exposed an `any` return to strict ESLint. The contention assertion was changed to verify the raw-error shape and serialized original SQLSTATE without weakening checks to accept arbitrary failures. Final lint passed.

## Limits and remaining work

- No migration or seed was run against the existing development database. Use the documented `npm run db:migrate` and `npm run db:seed` commands when ready to populate it.
- Verification covers clean PostgreSQL 17.6 in Docker. Hosted extension permissions, populated-data migrations, and other server versions are unverified.
- FKs establish existence, not qualification, active status, matching dealership/customer ownership, future start time, or service-derived duration. Those policies remain unimplemented application work.
- CANCELLED is a database status/predicate test, not a cancellation feature. There is no vehicle exclusion, working-hours validation, idempotency, allocation, or application conflict retry.
- New integration databases require CREATEDB permission. A killed test process can leave its generated database behind; normal teardown was verified. The development volume is never reset by the test harness.
- The required API-level concurrency/retry tests and complete Keyloop submission gates remain outstanding.

## Follow-up correctness and simplicity review

Rechecked the models, migration, seeds, test isolation, and documented limitations
against spec sections 3, 4, 8, 9, and 12. No schema or migration correction was
needed, and the seed implementation remained unchanged.

Strengthened the database tests to inspect native UUID and `timestamptz(3)` column
types, verify both resources can be reused after a status change commits, and
prove reseeding preserves an existing appointment and a service-catalog edit.
These exercise database behavior only; no cancellation workflow was added.

Executed `npm run prisma:validate`, build, type-check, lint, formatting checks,
and `TEST_DATABASE_URL=<dedicated test URL> npm run test:all`. All passed: **17
foundation tests and 49 PostgreSQL integration tests**. The integration harness
again applied the migration and executed the seed CLI in a fresh database. These
results supersede the earlier 47-case integration run. No dependencies, layers,
or application features were added during this review.
