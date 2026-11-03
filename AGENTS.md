# Agent Instructions — Keyloop Unified Service Scheduler

## Mission
Build a reviewable, reliable **backend-only** submission for **Keyloop Technical Assessment, Scenario A: Unified Service Scheduler**. Prioritize correctness, understandable design, testability, and evidence-based decisions over feature count. Act as a critical senior engineer: explain trade-offs, identify flawed assumptions, and verify your work.

## Source of truth and precedence
1. The original Keyloop challenge PDF (if present in the repository) defines mandatory assessment requirements.
2. `docs/SPEC.md` contains the implementation specification (currently **v2.0**). If stored under a different name, locate it; do not assume the file exists.
3. Approved architecture decisions and the user's latest explicit instructions determine implementation scope.
4. This file gives operating guidance; it does not override the challenge or an explicit user instruction.

If sources disagree, report the conflict rather than silently resolving it. Separate **Keyloop requirements**, **proposed assumptions**, and **optional enhancements**.

## Current mode: PHASE 3 READ-ONLY SCHEDULING APPROVED
The user has approved Phases 1–2 and Phase 3 read-only scheduling logic. Use `docs/SPEC.md` as the specification, subject to this explicit phase boundary.

Allowed: backend NestJS/TypeScript scaffolding, PostgreSQL Docker Compose, Prisma configuration and connection lifecycle, validated environment variables, `.env.example`, `GET /health`, tests, linting/formatting, setup/verification documentation, the eight specified Prisma models, reviewed SQL migrations and constraints, deterministic seeds, real PostgreSQL integration tests, service interval calculation, resource eligibility reads, deterministic candidate selection, and an internal availability use case.

Not yet authorized: appointment writes/reservations, transactional booking, retries, appointment/availability HTTP APIs, idempotency, cancellation APIs, or optional features. Those require a later explicit phase approval. Review and planning for later phases remain read-only. All other engineering, integrity, testing, and change-preservation rules below remain in effect.

The user's existing E-commerce project is **reference material only**. You may inspect its architecture, transaction handling, tests, and NestJS patterns, but must not edit it or transplant its domain assumptions into the scheduler. If asked to review the spec, produce findings and concrete suggested edits; do not implement fixes automatically.

After explicit approval, implement only the approved scope, incrementally, with tests and verification.

## Required product behavior (P0)
- Accept an appointment request for a **customer, vehicle, dealership, service type, and desired start time**.
- Derive service duration from the service type; compute the end time server-side.
- Automatically assign one **active, service-qualified technician** and one **active service bay** from the requested dealership.
- Check each resource for the **entire appointment interval** using half-open `[startAt, endAt)` semantics.
- Atomically persist a **CONFIRMED** appointment linking customer, vehicle, dealership, service type, technician, and bay.
- Prevent overlapping confirmed appointments for **either** the technician **or** bay, including concurrent requests and multiple app instances.
- Return clear validation, not-found, availability-conflict, and unexpected-error responses.
- Supply meaningful unit tests, PostgreSQL integration tests, and concurrency tests.

Do not confuse an availability read with a reservation. The create operation must perform authoritative validation and allocation.

## Architectural boundaries
- Preferred stack: **TypeScript, NestJS, PostgreSQL, Prisma**, Docker Compose, and **Vitest** (selected by the user). Deviations require a reason.
- Use a **modular monolith**. Keep HTTP controllers thin, application orchestration explicit, business rules testable, and persistence details in infrastructure.
- Design clear module boundaries, but avoid boilerplate abstractions, a generic repository framework, or premature microservices.
- Prefer typed DTOs, validated input, narrow interfaces, descriptive names, and consistent error responses.
- Do not add Redis, Kafka, event sourcing, Kubernetes, notifications, full authentication, or a React frontend without approved scope changes.
- Use existing repository conventions when appropriate; do not copy E-commerce-specific complexity into this project.

## Data integrity and concurrency — non-negotiable
- Enforce foreign keys, required columns, positive service durations, and `startAt < endAt`.
- Validate vehicle/customer ownership, technician/service qualifications, active flags, and dealership scoping.
- Protect **technician non-overlap** and **bay non-overlap** at the database layer. Preferred design: PostgreSQL `tstzrange(start_at, end_at, '[)')` + GiST exclusion constraints, scoped to blocking appointment statuses; use a reviewed SQL migration and `btree_gist` as needed.
- A regular `SELECT` followed by `INSERT`, an in-memory mutex, or a transaction **without sufficient locking/constraints** is not acceptable protection.
- Retry genuine allocation conflicts only within a bounded policy and a **new transaction**; distinguish resource exhaustion from transient contention and unexpected DB failures. A failed transaction must leave no partial confirmed booking.
- No constraint or application check should incorrectly block adjacent appointments.
- Keep database writes and transaction duration minimal; never assume Prisma schema alone describes SQL-specific constraints.

## Testing and evidence
- Test **success and failure paths**, including invalid IDs/timestamps, past times, customer/vehicle mismatch, unqualified or inactive technicians, inactive bays, wrong-dealership resources, and unavailable resources.
- Test overlap cases: partial, full, contained, identical, and adjacent intervals.
- Test persistence, rollback, and constraint violations using **real PostgreSQL**, not SQLite or mocked database calls.
- Required contention demonstration: **20 parallel valid bookings for one technician and one bay at the same interval -> exactly one confirmed appointment**; verify database state, not only HTTP statuses.
- Test resource alternatives: where two eligible technicians and two bays exist, competing requests should be able to occupy distinct pairs under a supported retry strategy.
- Use isolated fixtures and deterministic assertions; do not rely on arbitrary sleeps.
- Run relevant tests after each approved phase. Never claim success, coverage, or performance numbers without observed results. Report commands executed, outcome, and anything unverified.

## Working method
1. **Read first:** inspect the task, applicable spec, relevant code, migrations, tests, and repository status before proposing changes.
2. **Analyze:** list ambiguities, invariants, failure modes, scope, and trade-offs. Challenge risky assumptions.
3. **Plan:** for nontrivial work, give a short plan mapping changes to acceptance criteria and tests.
4. **Implement only when authorized:** make the smallest coherent changes; avoid unrelated refactors or dependencies.
5. **Verify:** run formatting/lint, unit tests, integration tests, and concurrency tests as applicable. Use the project's actual scripts rather than inventing commands.
6. **Report:** summarize changed files, design rationale, test evidence, outstanding risks, and spec deviations.

Preserve existing user changes. Do not delete, reset, overwrite, reformat broadly, commit, push, or change branches without an explicit reason or instruction. Ask before destructive actions.

## Review mode output contract
When asked to review the draft specification, return:
1. Overall assessment and readiness.
2. Critical issues with severity, rationale, and concrete fixes.
3. Missing or contradictory acceptance criteria and test cases.
4. Architecture and domain-model improvements with trade-offs.
5. Concurrency, transaction, and reliability risks.
6. Scope cuts or additions necessary for the assessment.
7. Proposed spec amendments, with exact replacement text where helpful.
8. Decision: **APPROVE**, **APPROVE WITH CHANGES**, or **REVISE BEFORE IMPLEMENTATION**.

Do not modify the E-commerce project or generate scheduler code during this review.

## Documentation and AI accountability
- Final submission requires `README.md`, a system design document (architecture, components, data flow, technologies, observability, design-phase AI usage), an AI Collaboration Narrative in the README, tests, and a **5–10 minute** demonstration video.
- Document real design alternatives, limitations, and nontrivial decisions (especially database constraints and retry behavior).
- Keep a truthful record of AI assistance, review findings, corrections, commands actually run, and unresolved issues. Never invent AI mistakes or test results for the narrative.
- Prefer reproducible seed data, documented local setup, and OpenAPI/cURL examples over building an unnecessary client application.

## Priority and stopping rules
- **P0 first:** correct booking, qualifications, full-duration allocation, atomic persistence, database-enforced concurrency correctness, tests, and required documentation.
- **P1 only after P0:** availability endpoint, retrieval, Swagger, idempotency, enhanced logs.
- **P2 only by agreement:** cancellation, rescheduling, working hours, shift calendars, alternative slots, sophisticated scheduling.
- If a design flaw threatens double-booking or data integrity, surface it immediately. Do not conceal it behind a green unit-test suite.
