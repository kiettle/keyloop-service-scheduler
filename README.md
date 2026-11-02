# Keyloop Service Scheduler

Backend-only submission for Keyloop Scenario A. **Current milestone: Phase 2 database and domain modeling.** The eight domain models, migrations, reference seeds, and database overlap protections are implemented. Appointment booking, eligibility checks, allocation, availability, and appointment APIs remain unimplemented. The complete proposed contract is in [docs/SPEC.md](docs/SPEC.md).

## Foundation design

One NestJS process, organized as a modular monolith: `AppModule` composes configuration, `HealthModule`, and `DatabaseModule`. Prisma verifies PostgreSQL with a startup query and disconnects during graceful shutdown. Startup fails if configuration or the database connection is invalid.

`GET /health` returns `200` and `{"status":"ok"}`. This is process liveness, not a continuous database-readiness check. Database connectivity is verified separately with `npm run db:check`; no SQL error or credentials are returned by that script.

The Prisma schema defines Dealership, Customer, Vehicle, ServiceType, Technician, TechnicianQualification, ServiceBay, and Appointment. Reviewed SQL adds CHECK constraints and independent partial GiST exclusions for technician and bay overlaps. See [docs/DATABASE.md](docs/DATABASE.md) for enforcement boundaries, migration risks, fixture IDs, and test evidence. Database constraint tests do not prove application allocation or retry behavior.

## Prerequisites and pinned tools

- Node.js **24.21.0** (`nvm install && nvm use` reads `.nvmrc`).
- npm **11.19.0** (package manager used to produce the lockfile).
- Docker Engine with Docker Compose v2.
- PostgreSQL image **17.6-alpine**; local app connects through port **55432** by default.

Direct packages are exact-pinned in `package.json`, with transitive versions in `package-lock.json`. NestJS **11.2.8**, TypeScript **5.9.3**, and Prisma/client **7.10.1** use a straightforward CommonJS setup. Prisma 7 uses the PostgreSQL driver adapter and `prisma.config.ts`; environment loading is explicit for CLI commands. Patched versions were selected after an initial dependency audit. A scoped override pins Nest's Multer dependency to 2.5.0 to address its reported denial-of-service advisory; there are no upload endpoints. Future major upgrades require separate compatibility verification. Vitest is the single test runner. Tests import their APIs explicitly; the SWC test transform preserves Nest decorator metadata, following the [NestJS Vitest recipe](https://docs.nestjs.com/recipes/swc#vitest). The build uses TypeScript directly; no global Nest CLI is needed.

## Local setup

From the repository root:

```sh
nvm install
nvm use
cp .env.example .env
npm ci
npm run prisma:generate
npm run db:up
npm run prisma:validate
npm run db:migrate
npm run db:seed
npm run db:check
npm run build
npm start
```

In another terminal:

```sh
curl --fail http://localhost:3000/health
```

For development after initial setup (Node watch mode with ts-node preserves the decorator metadata Nest needs for dependency injection):

```sh
npm run start:dev
```

`.env` is ignored. Example credentials are disposable local development values, not production credentials. Compose binds PostgreSQL only to `127.0.0.1` and uses its own named volume. Keep `DATABASE_URL` aligned with the `POSTGRES_*` values. URL-encode special characters in database credentials. Changing database credentials in `.env` does not change an already initialized volume; use a fresh database/volume or explicitly administer that database.

`PORT` must be an integer from 1 to 65535; `NODE_ENV` is development, test, or production; `DATABASE_URL` must be a PostgreSQL URL with a host and database. The Prisma PostgreSQL adapter bounds connection acquisition to five seconds.

## Verification

```sh
npm run build
npm run typecheck
npm run lint
npm run format:check
npm test
npm run prisma:validate
npm run db:check
```

`npm test` runs configuration unit tests, an isolated HTTP contract suite for the health module, and a real-driver regression proving startup rejects an unreachable database. These tests do not require a running PostgreSQL server; the startup-failure regression uses an unreachable local port. They do not claim to verify booking constraints or transactional behavior. `npm run db:check` executes an actual `SELECT 1` through Prisma against the configured database and exits nonzero on failure. `npm run test:unit` and `npm run test:http` select individual suites.

Database integration checks run separately against the dedicated test service:

```sh
# Add TEST_DATABASE_URL from .env.example to an existing .env first.
npm run db:test:up
npm run test:integration
```

Each integration run creates a fresh UUID-named database, applies committed migrations using `prisma migrate deploy`, runs `prisma db seed`, tests real SQL writes, and drops only its own database afterward. `TEST_DATABASE_URL` is required and must name `service_scheduler_test` on the dedicated test server (default port 55433); the test role needs permission to create databases. No reset or truncation runs against the developer database. `npm run test:all` runs both suites when the test server is available. Stop/remove the test container with `docker compose --profile test rm --stop --force postgres-test`; it has disposable tmpfs storage.

Use `npm run db:migrate` and `npm run db:seed` for local development after schema changes. Seed reruns insert missing fixtures without overwriting existing edits or deleting appointments. Do not use `prisma db push` as a replacement for migrations: it cannot reconstruct the SQL-only overlap constraints.

Formatting is explicit (`npm run format`); lint and format checks do not modify files. Existing assessment documents are excluded from automatic formatting. Foundation history is recorded in [docs/PHASE_1.md](docs/PHASE_1.md), and database verification in [docs/PHASE_2.md](docs/PHASE_2.md); results apply only to the documented environment and commands.

Stop the app with Ctrl-C. Stop PostgreSQL without deleting its volume:

```sh
npm run db:down
```

Do not remove the volume unless you intend to delete its data. If startup fails, check configuration, `docker compose ps`, host port availability, and `npm run db:check`.

## AI Collaboration Narrative

The developer selected Scenario A, requested critical design reviews, and approved foundation work, then database/domain modeling as a separate phase. AI inspected the original assessment and the spec, raised risks around transaction retries and the evidence needed to prove overlap protection, and then created this scaffold within the approved boundary. No E-commerce source was modified or copied into this application. The developer retains ownership of scope and subsequent implementation decisions.

A follow-up review reproduced and corrected two foundation bugs: the original development runner omitted Nest constructor metadata, and the Prisma adapter created its pool lazily, so a startup query was needed to verify connectivity. Phase 1 verification consists of commands actually executed, documented in the milestone record. Unit/health tests are separate from real PostgreSQL connectivity checks. Phase 2 adds actual migration, seed, constraint, and competing-SQL-write verification. Its first test run exposed an incorrect assumption about the Prisma adapter error shape; assertions were corrected against observed PostgreSQL SQLSTATEs. Application booking behavior, allocation/retry tests, the final system design document, and the required 5–10 minute video remain future work. This narrative will be updated using real review findings and test results as implementation progresses.
