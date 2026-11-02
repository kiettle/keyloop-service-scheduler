# Keyloop Service Scheduler

Backend-only submission for Keyloop Scenario A. **Current milestone: Phase 1 foundation only.** Appointment booking, eligibility, allocation, availability, domain models, migrations, seeds, and concurrency protections are not implemented yet. The complete proposed contract is in [docs/SPEC.md](docs/SPEC.md).

## Foundation design

One NestJS process, organized as a modular monolith: `AppModule` composes configuration, `HealthModule`, and `DatabaseModule`. Prisma verifies PostgreSQL with a startup query and disconnects during graceful shutdown. Startup fails if configuration or the database connection is invalid.

`GET /health` returns `200` and `{"status":"ok"}`. This is process liveness, not a continuous database-readiness check. Database connectivity is verified separately with `npm run db:check`; no SQL error or credentials are returned by that script.

The current Prisma schema intentionally has no models. The latest approved scope narrows the spec's Phase 1 description: domain schema, migrations, seeds, and SQL exclusion constraints are deferred to a separately approved phase. There is no migration or seed command to run at this milestone. No scheduling correctness claims can be made yet.

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

Formatting is explicit (`npm run format`); lint and format checks do not modify files. Existing assessment documents are excluded from automatic formatting. For this milestone, test/build scripts and a live app check are recorded in [docs/PHASE_1.md](docs/PHASE_1.md); results apply only to the documented environment and commands.

Stop the app with Ctrl-C. Stop PostgreSQL without deleting its volume:

```sh
npm run db:down
```

Do not remove the volume unless you intend to delete its data. If startup fails, check configuration, `docker compose ps`, host port availability, and `npm run db:check`.

## AI Collaboration Narrative

The developer selected Scenario A, requested critical design reviews, and explicitly approved foundation work only. AI inspected the original assessment and the spec, raised risks around transaction retries and the evidence needed to prove overlap protection, and then created this scaffold within the approved boundary. No E-commerce source was modified or copied into this application. The developer retains ownership of scope and subsequent implementation decisions.

A follow-up review reproduced and corrected two foundation bugs: the original development runner omitted Nest constructor metadata, and the Prisma adapter created its pool lazily, so a startup query was needed to verify connectivity. Phase 1 verification consists of commands actually executed, documented in the milestone record. Unit/health tests are separate from real PostgreSQL connectivity checks. Domain constraints, booking behavior, concurrency tests, the final system design document, and the required 5–10 minute video remain future work. This narrative will be updated using real review findings and test results as implementation progresses.
