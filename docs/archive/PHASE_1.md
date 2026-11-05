# Phase 1 foundation record

> Historical planning or verification record; statements apply to their recorded source and date. Use the [current specification](../SPEC.md), [system design](../SYSTEM_DESIGN.md), and [verification summary](../FINAL_REVIEW.md) for current behavior.

Date: 2026-11-02 (Asia/Ho_Chi_Minh).

## Approved scope and decisions

The developer explicitly approved foundation implementation only. `AGENTS.md` now records that boundary while retaining the other engineering rules. `docs/SPEC.md` remains unchanged. No E-commerce files were changed.

Implemented a single NestJS application with configuration, health, and database modules. The only application endpoint is `GET /health`. It reports liveness, not continuous database readiness. Prisma manages the PostgreSQL connection lifecycle; `db:check` performs a real read.

The spec's broader Phase 1 row mentions domain migrations and seeded data. They are deliberately deferred under the latest, narrower foundation instruction: there are no domain models, migrations, seeds, scheduling/allocation functions, appointment APIs, or business-rule implementations. Later phase approval is required. The overall assessment submission and P0 gates are not complete.

Initial toolchain (before the Vitest migration below): macOS arm64, Node 24.21.0, npm 11.19.0, Docker client 28.2.2 / Compose 2.36.2, PostgreSQL 17.6 (aarch64 Alpine), NestJS 11.2.8, TypeScript 5.9.3, Prisma/client/adapter 7.10.1, Jest 30.5.2. Exact direct dependencies and a lockfile are included.

Prisma uses its PostgreSQL adapter and `prisma.config.ts`, with explicit CLI environment loading. No placeholder database tables were added merely to initialize Prisma. TypeScript compiles the application directly; a Nest CLI dependency is unnecessary for this scaffold.

## Executed verification

The final lockfile was also verified with `npm ci` (exit 0). Build, lint,
type-check, all 16 tests, Prisma validation, and the real database query were
rerun successfully after that clean install.

| Command / action                                                                                | Observed result                                                                               |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `npm install`                                                                                   | Initial and patched installs executed; final compatible dependency set installed successfully |
| `npm run build`                                                                                 | Passed: generated Prisma client and compiled application                                      |
| `npm run typecheck`                                                                             | Passed                                                                                        |
| `npm run lint`                                                                                  | Passed after correcting environment narrowing and the untyped Nest HTTP-server boundary       |
| `npm run format` / `npm run format:check`                                                       | Formatting applied to new files; check passed; existing assessment documents excluded         |
| `npm test`                                                                                      | Passed: 2 suites, 16 tests (15 configuration cases and 1 HTTP contract test)                  |
| `npm run prisma:validate`                                                                       | Passed with the intentionally model-free foundation schema                                    |
| `docker compose up -d --wait postgres`                                                          | Passed; dedicated container healthy on 127.0.0.1:55432                                        |
| `docker compose exec -T postgres psql -U scheduler -d service_scheduler -c 'SELECT version();'` | Passed; actual PostgreSQL 17.6                                                                |
| `npm run db:check`                                                                              | Passed: Prisma executed `SELECT 1` against PostgreSQL                                         |
| `DATABASE_URL=postgresql://localhost:1/unreachable npm run db:check`                            | Expected failure: exit 1, safe connection-failure message                                     |
| `DATABASE_URL='' npm run db:check`                                                              | Expected failure: exit 1, safe configuration-failure message                                  |
| `npm start` then `curl --silent --show-error --fail -i http://localhost:3000/health`            | Compiled app started with database module; HTTP 200, JSON `{"status":"ok"}`                   |
| `npm audit --omit=dev --json`                                                                   | Exit 0; zero runtime dependency advisories at verification time                               |
| `npm audit --json`                                                                              | Exit 1; 30 development-tree advisories: 4 low, 26 moderate, 0 high, 0 critical                |

The initial HTTP test could not bind a socket inside the execution sandbox; it was rerun with permitted local socket access. Docker access and real local database checks also required execution outside that sandbox. These are environment restrictions, not instructions for ordinary local development.

An initial compatible version set produced high-severity npm audit findings. Patched NestJS and Prisma versions were selected; a scoped Multer 2.5.0 override removed the remaining high finding. A clean dependency resolution was needed after npm rejected an in-place major-tooling update; no force/legacy-peer-dependency bypass was used. Full audit findings in the development toolchain remain unresolved; no zero-advisory claim is made for the entire dependency tree.

The app used for the live smoke check was stopped afterward. PostgreSQL and its named data volume remain available; `npm run db:down` stops the service without deleting the volume. No existing database or container was modified.

## Files

Modified: `AGENTS.md` (phase authorization and current spec version reference).

Created:

- Application: `src/main.ts`, `src/app.module.ts`, `src/config/environment.ts`, `src/database/database.module.ts`, `src/database/prisma.service.ts`, `src/health/health.module.ts`, `src/health/health.controller.ts`.
- Database setup: `docker-compose.yaml` (named `compose.yaml` during this phase), `prisma/schema.prisma`, `prisma.config.ts`, `scripts/check-database.cjs`.
- Tests: `test/environment.spec.ts`, `test/health.spec.ts`, `jest.config.cjs` (initial config, subsequently removed).
- Tooling: `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.build.json`, `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`, `.gitignore`, `.npmrc`, `.nvmrc`.
- Configuration/documentation: `.env.example`, `README.md`, this record. An ignored local `.env` was copied from the example for verification.

## Remaining work

Domain schema and reviewed SQL migrations, seeds, booking and availability, qualifications, resource exclusion constraints, error classification/retries, PostgreSQL integration/concurrency tests, final system design, and submission video remain unimplemented. Review findings from earlier phases have not been silently applied to the spec. Future implementation should resolve those findings within its own explicit authorization.

## Follow-up simplicity and correctness review

A later review tested the documented development command and database-unavailable startup, which the initial checks had not covered. It reproduced two bugs:

1. `tsx` did not emit Nest constructor metadata, so `start:dev` failed to inject `ConfigService`. Replaced it with pinned `ts-node` 10.9.2 under Node's built-in watch mode. There is still one development command and no additional watcher framework.
2. Prisma's PostgreSQL adapter initialized its pool lazily: `$connect()` did not prove a server connection. The compiled app incorrectly started with an unreachable database. Startup now executes `SELECT 1` and disconnects on initialization failure.

Added `test/database-startup.spec.ts`, using the real Prisma driver and Nest initialization hooks against an unreachable local port. Final checks after the fixes: build, lint, type-check, and all **17 tests across 3 suites** passed. The corrected development app started against PostgreSQL and served HTTP 200 with `{"status":"ok"}`. A compiled-process negative check exited **1**, without timing out or reaching the listening state, when PostgreSQL was unreachable. The real `db:check` query also passed.

No new application features, domain abstractions, or scheduling code were introduced. The previous 16-test record describes the initial milestone; these follow-up results supersede it for the corrected foundation.

Node watch mode was also exercised: touching the health controller triggered a
restart, and the restarted development process again served the correct health
response. The development process was stopped after verification. Formatting
checks passed after the documentation updates.

## Vitest migration

The developer selected Vitest as the sole test runner. Removed `jest`, `ts-jest`,
`@types/jest`, and `jest.config.cjs`; updated the lockfile, test commands, README,
AGENTS.md stack choice, and the corresponding stack row in the spec. Existing
verification results above are historical; current tests run under Vitest 4.1.11.

All three test files import their Vitest APIs explicitly. TypeScript now includes
only Node ambient types, so there is no reliance on global Jest or Vitest types.
`vitest.config.mts` uses the standard Nest-compatible SWC transform to preserve
constructor decorator metadata. The newest SWC native binary failed to load on
this Mac; pinned `@swc/core` 1.15.3 with `unplugin-swc` 2.0.0 passed the tests.

Executed after migration: `npm test` (3 files, 17 tests passed), `npm run test:unit`
(15 passed), `npm run test:http` (1 passed), build, type-check, lint, and formatting
checks (all passed). `npm ls jest ts-jest @types/jest --all` showed an empty tree.
Installation reported 13 moderate dependency advisories and no high/critical
findings. No production application code or business features changed.
