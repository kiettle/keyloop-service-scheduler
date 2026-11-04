> Historical planning guide from 2026-11-02. For the current implementation, setup, and submission status, use [README](README.md) and [FINAL_REVIEW](docs/FINAL_REVIEW.md). The prospective checklist below is retained as development history.

> Current goal revision — 2026-11-04: keep the 100-request burst resilience criterion (100 confirmations with sufficient eligible resource/time capacity; one confirmation and 99 availability conflicts for one contested pair/interval) and the mandatory 20-request regression. Sustained 1,000 successful bookings/second is an unverified future stretch goal, not submission acceptance or a verified Keyloop traffic requirement. Historical measurements do not establish current-source or production capacity. See [capacity guidance](docs/CAPACITY_PLAN.md).

# Keyloop Scenario A — Start Here (Developer's Guide)

**Date:** Monday, 2 November 2026  
**Target submission:** Friday, 6 November 2026  
**Purpose:** A short guide for **you** to understand and defend the project.  
**Companion:** `docs/SPEC.md` is the detailed implementation contract for Codex. Do not substitute this guide for the full spec when implementing or testing.

## 1. The problem in plain English

A car owner wants to book a service at a dealership. The appointment consumes **two resources at the same time**: a **service bay** (the physical place where the car is worked on) and a **technician qualified to perform that service**. Both must be free for the **entire duration**. On success, save the appointment and the resources assigned to it.

**Example:** A customer books a 60-minute tire replacement at 10:00. The system finds a qualified technician and a free bay for **10:00–11:00**. If either resource is unavailable, it must not confirm the appointment.

The challenge's three required outcomes are: (1) accept the vehicle, service, dealership and desired time; (2) check both resources for the full duration; and (3) persist the confirmed appointment with customer, vehicle, technician and bay.

## 2. The five facts you should be able to explain

1. **Duration comes from `ServiceType`.** The API caller should not choose an arbitrary duration.
2. **Qualified ≠ available.** A technician must be qualified *and* not already booked during the requested interval.
3. **Availability is time-dependent.** Do not use a single `isAvailable` boolean; compare the requested interval against confirmed appointments.
4. **Two resource constraints matter.** An appointment must not overlap another confirmed appointment for the same technician **or** bay.
5. **Concurrent booking is the hardest part.** Two customers can both observe the last bay as free. PostgreSQL must prevent conflicting confirmations even if the API checks race.

For half-open time intervals `[start, end)`, two bookings overlap if:

`existing.start < requested.end && existing.end > requested.start`

Therefore 10:00–11:00 and 11:00–12:00 **do not overlap**.

## 3. Proposed booking journey

1. Receive `{ customerId, vehicleId, dealershipId, serviceTypeId, startAt }`.
2. Validate the IDs, ownership and service type; compute `endAt` using the service's duration.
3. Find active, qualified technicians and active bays **at the requested dealership** that have no overlapping confirmed appointments.
4. Choose a technician and bay, attempt to create a confirmed appointment in a database transaction.
5. Let PostgreSQL enforce resource non-overlap with exclusion constraints; on conflict, rollback and reconsider availability within a bounded retry policy.
6. Return **201** with the confirmed appointment, or a clear failure response without saving a partial appointment.

A separate availability endpoint may help demonstrate the feature, but its result is **not a reservation**. Always check again during booking.

## 4. Core domain objects

| Entity | What it means |
|---|---|
| `Customer` | Person requesting service |
| `Vehicle` | Car owned by the customer |
| `Dealership` | Where service occurs |
| `ServiceType` | Kind of service and its expected duration |
| `Technician` | Worker tied to a dealership |
| `TechnicianQualification` | Services a technician can perform |
| `ServiceBay` | Physical service location tied to a dealership |
| `Appointment` | Confirmed time interval and its customer, vehicle, service, technician and bay |

## 5. Architecture: keep it boring on purpose

**NestJS + TypeScript + PostgreSQL + Prisma**, in a **single modular backend**.

- **Controller:** HTTP request/response and validation.
- **Application/use case:** booking workflow and resource selection.
- **Domain:** interval and qualification business rules.
- **Infrastructure:** queries, transactions, PostgreSQL constraints.

Use **real PostgreSQL integration tests** for concurrency. Mocks alone cannot prove double-booking prevention.

Do **not** spend time on React, Kafka, microservices, Redis, payments or notifications. They are not required.

## 6. What "good" looks like to an interviewer

A strong demo shows these four cases:

1. **Success:** a valid request returns a confirmed appointment with technician and bay.
2. **No qualification:** available technicians who are not qualified cannot be assigned.
3. **Overlap:** an occupied technician or bay is never reused for an overlapping time.
4. **Concurrency:** with one technician and one bay, 20 simultaneous requests for the same interval result in **exactly one saved appointment**. This is an expected result to verify, not a benchmark we've run yet.

Bonus if time allows: when there are two technicians and two bays, two concurrent requests can both succeed by choosing different resources.

## 7. Decisions to lock before implementing

The following are **our assumptions**, not extra rules from Keyloop:

- **Backend only:** no full UI; Swagger/cURL is enough to demonstrate functionality.
- **Automatic assignment:** clients do not choose the bay or technician.
- **Service duration:** fixed per service type and calculated by the server.
- **All active bays interchangeable** for now; technician qualification matters.
- **Business hours and cancellation:** deferred and documented as limitations.
- **No auth in demo:** document that production would require it.
- **Availability:** query the real database; the booking write is authoritative.

The most important open engineering choice is **how the transaction, PostgreSQL exclusion constraints and retry logic work together**. Have Codex review this carefully before implementation. A retry cap can stop contention, so "two available pairs always produce two successes" may require more careful candidate selection/locking than a naive deterministic first-pair retry.

## 8. What to complete TODAY — Monday, Nov 2

**Suggested 2–3 focused hours.** The goal today is to **finish design decisions and get a working skeleton**, not finish the whole scheduler.

- [ ] **20 min — Understand the domain.** Read sections 1–7 of *this* guide. Be able to explain why qualification, duration, and non-overlap matter.
- [ ] **30–40 min — Get a critical Codex review.** Ask Codex to review `docs/SPEC.md` against the challenge, especially database constraints, transaction/retry correctness, API validation, and tests. **Review only; do not modify the existing E-commerce project.**
- [ ] **30 min — Decide the MVP.** Lock backend-only, NestJS/Postgres/Prisma, automatic allocation, fixed durations, and which enhancements to defer. Record significant corrections in the spec.
- [ ] **45–75 min — Start a separate Keyloop repository.** Create NestJS project, Docker Compose PostgreSQL, Prisma configuration and initial schema/migration. Avoid copying unrelated E-commerce code.
- [ ] **20–30 min — Verify setup.** Clean startup, successful migration, seed command (if ready), and one smoke test. Capture actual outputs.

**Today's definition of done:** You can explain the booking problem in ~2 minutes; the critical review is recorded; the MVP decisions are fixed; the new repo starts and connects to PostgreSQL. If time is tight, prioritize understanding + review + schema over optional APIs.

**Important:** The earlier `AGENTS.md` was prepared in **Review Only** mode. Explicitly authorize implementation (and adjust those instructions) only **after** the specification review is accepted.

## 9. Remaining schedule

| Day | Focus | Checkpoint |
|---|---|---|
| **Tue, Nov 3** | Models, validation, booking API, resource selection, exclusion constraints | One booking works; overlap blocked |
| **Wed, Nov 4** | Real DB integration tests, 20-request concurrency test, retry/failure handling | No double-booking; tests green |
| **Thu, Nov 5** | Availability/read endpoints, Swagger, README, architecture design, AI story, record video | Reproducible demo and deliverables ready |
| **Fri, Nov 6** | Fresh-clone verification, final check, submit | Submit without relying on last-minute coding |

## 10. Codex prompt to use today

> Read `AGENTS.md` and `docs/SPEC.md`. Work in **review mode** only. Compare the proposed design against Scenario A in the Keyloop assessment. Focus on resource overlap prevention, database constraints, transaction and retry correctness, and whether the acceptance criteria prove the required behavior. Return a prioritized list of concrete issues and exact proposed changes. Do not edit any files and do not modify my E-commerce project.

After reviewing the findings, approve or revise the spec, then move Codex to implementation mode in the **new** Keyloop repository.

## 11. Quick self-check (answer aloud)

- What exactly does the customer submit, and what does the server decide?
- Why is `isAvailable: true` insufficient for scheduling?
- When do two time intervals overlap?
- What happens if two requests simultaneously choose the same bay?
- Why are database integration tests necessary here?

If you can answer these questions clearly, you have enough understanding to begin implementation. You do **not** need to memorize the full Codex specification.
