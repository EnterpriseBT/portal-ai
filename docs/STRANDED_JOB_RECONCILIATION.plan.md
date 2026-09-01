# Stranded-job reconciliation — Plan

**TDD-sequenced implementation of the conditional terminal transition, the absence∧staleness sweep, its boot + interval wiring, and the lock alert's age + stuck-hint surface.**

Spec: `docs/STRANDED_JOB_RECONCILIATION.spec.md`. Discovery: `docs/STRANDED_JOB_RECONCILIATION.discovery.md`. Issue: #391. Builds on the shipped job machinery (#441/#464 transitions, `JOB_LOCK_KEYS` lock queries) — no core-package or schema changes anywhere in this ticket.

Four slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `fix/stranded-job-reconciliation`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd apps/api && npm run test:unit && npm run test:integration
cd apps/web && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — primitive, then the logic that composes it, then the wiring, then the surface:

- **Slice 1** — `transitionIfNonTerminal`: the concurrency guarantee everything else leans on; pure API-service change, callable by nothing yet.
- **Slice 2** — the finder + `JobReconciliationService`: the whole sweep, unit- and integration-proven, still invoked by nothing.
- **Slice 3** — env vars + boot/interval wiring: the sweep goes live; smallest slice, isolated so a wiring problem can't be confused with a logic one.
- **Slice 4** — web: `formatAgo` + the lock-alert age/stuck-hint; independent of 1–3 at compile time, last because its copy references behavior slices 1–3 make true.

---

## Slice 1 — `JobEventsService.transitionIfNonTerminal`

The guarded terminal write: first terminal writer wins; SSE publish best-effort.

**Files**

- Edit: `apps/api/src/services/job-events.service.ts` — the new method beside `transition` (per the spec's exact signature/semantics).
- Extend: `apps/api/src/__tests__/services/job-events.service.transition.test.ts`.

**Steps**

1. **Tests (spec cases 1–4).** Non-terminal row → writes + stamps `completedAt` on `failed` + publishes + `true`; terminal row → `false`, unchanged, no publish; publish throw → still `true` with a warn; patch semantics (error string, `updated`) match `transition`. Run; fail.
2. **Implement** via `jobs.updateWhere(and(eq(id), notInArray(status, TERMINAL_JOB_STATUSES)), dbPatch)`; publish only when a row came back, inside try/warn. Green.
3. Lint + type-check.

**Done when:** cases 1–4 pass; nothing calls the method yet.

**Risk:** none — additive method, existing `transition` untouched.

---

## Slice 2 — finder + `JobReconciliationService`

The sweep itself: candidates by `COALESCE(updated, created)` staleness, per-candidate BullMQ existence check, fail-open on error, capped reap.

**Files**

- Edit: `apps/api/src/db/repositories/jobs.repository.ts` — `findStrandedCandidates(olderThanMs, limit, client?)` (statuses `pending|active|stalled`, COALESCE staleness, `notDeleted`, oldest-first, LIMIT).
- New: `apps/api/src/services/job-reconciliation.service.ts` — `STRANDED_JOB_REASON`, `StrandedSweepSummary`, `sweepStrandedJobs()`, `MAX_REAP_PER_PASS`; header records the zombie-executor rationale and the `awaiting_confirmation` exclusion.
- New: `apps/api/src/__tests__/services/job-reconciliation.service.test.ts` (ESM mocks: `db.service`, `jobs.queue`, `job-events.service` — and nothing that opens a real socket, #377).
- New: `apps/api/src/__tests__/__integration__/services/job-reconciliation.integration.test.ts`.

**Steps**

1. **Unit tests (spec cases 5–10).** Missing Bull entry → reaped with the reason; `bullJobId: null` → reaped; existing entry → scanned only; `getJob` throw → skipped; conditional-write `false` → skipped; summary arithmetic + the cap reaches the finder. Run; fail.
2. **Implement** the finder + service. Green.
3. **Integration tests (spec cases 11–16).** Stale `active` row with bogus `bullJobId` → `failed` + reason + `completedAt` + **lock released** (`findRunningForConnectorInstance` empty — the acceptance criterion in miniature); fresh row untouched; stale `awaiting_confirmation` untouched; terminal untouched (+ `transitionIfNonTerminal` returns `false` against it); `updated = NULL` pending row reaped via COALESCE; finder honors limit + soft-delete. Note: `getJobsQueue().getJob(<bogus id>)` against the test Redis returns `undefined` naturally — no mocking in this layer. Run; fail → implement any gaps → green.
4. Lint + type-check.

**Done when:** cases 5–16 pass; the service exists but nothing schedules it.

**Risk:** the integration tests share the test Redis with BullMQ — use obviously-bogus bull ids (`stranded-test-<uuid>`) so no collision with real queue entries is possible.

---

## Slice 3 — env + boot/interval wiring

The sweep goes live: once at boot, then every interval tick, fail-open, `unref()`'d.

**Files**

- Edit: `apps/api/src/environment.ts` — `JOB_STRANDED_THRESHOLD_MS` (default 900000), `JOB_STRANDED_SWEEP_INTERVAL_MS` (default 300000).
- Edit: `apps/api/.env.example` — both vars documented **(the env-parity guard is a required check — #453's CI failure)**.
- Edit: `apps/api/src/index.ts` — fire-and-forget boot sweep + `setInterval(...).unref()` beside the existing startup sweeps (`:53-70` shape).

**Steps**

1. **Tests.** The env-parity guard (`env-example-parity.test.ts`) is the failing test for the vars — run it after the `environment.ts` edit, before the `.env.example` one, to see it red then green. The `index.ts` wiring is process-lifecycle code with no unit seam (same as the existing sweeps) — covered by slice 2's direct-call tests plus the smoke; state that explicitly rather than fabricating a test.
2. **Implement** env + `.env.example` + wiring. Green.
3. Lint + type-check; boot the API locally once to confirm the startup log line ("stranded-job sweep" summary) appears.

**Done when:** parity guard green; local boot logs one sweep summary; the interval timer doesn't hold test processes open (`.unref()`).

**Risk:** forgetting `.unref()` — jest/integration runs would hang; the #377 lesson says catch this by running the touched suites and watching for the force-exit warning.

---

## Slice 4 — web: `formatAgo` + lock-alert age/stuck hint

The surface that stops promising completion: per-job "started X ago", stuck hint + View-job link past 15 min.

**Files**

- New: `apps/web/src/utils/relative-time.util.ts` — `formatAgo(epochMs, nowMs?)`.
- New: `apps/web/src/__tests__/relative-time.util.test.ts`.
- Edit: `apps/web/src/components/ConnectorInstanceLockAlert.component.tsx` — per-job line with age; `STALE_JOB_HINT_MS` module constant; stale jobs append the hint + `Link to={`/jobs/${job.id}`}` (string-literal `to`, `MuiLink component="span"` — the routing rules); soften the closing copy when any job is stale.
- Extend: `apps/web/src/__tests__/ConnectorInstanceLockAlert.test.tsx`.

**Steps**

1. **Tests (spec cases 17–21).** `formatAgo` buckets (<60s / min / h / d); alert shows "started X ago" per job with no hint when fresh; stale job gets the hint + link href `/jobs/<id>`; mixed list hints only the stale one; existing null-when-empty + label-join behavior preserved. Run; fail.
2. **Implement** util + alert changes. Green.
3. Lint + type-check; full `npm run test:unit` in `apps/web` (both alert consumers — ConnectorInstance and EntityDetail views — share the component, so their suites must stay green).

**Done when:** cases 17–21 pass; web suite green.

**Risk:** the alert renders inside the shared test router-less harness — the `Link` must not require a route match (string-literal `to` is fine; avoid `useSearch`-style hooks per the routing rules).

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 | conditional terminal transition | spec cases 1–4 |
| 2 | finder + sweep service (unit + integration) | cases 5–16; lock-release proven |
| 3 | env + boot/interval wiring | parity guard; boot log; no held handles |
| 4 | `formatAgo` + alert age/stuck hint | cases 17–21; web suite green |

## Cross-slice notes

- **No core rebuild needed** — this ticket never touches `packages/core`, a first for this session's tickets; skip the stale-dist ritual.
- **#377 discipline:** slice 2's unit test file mocks every module that could reach `getRedisClient`; slice 3's `.unref()` is the timer-shaped version of the same rule — after slices 2–3, run the touched api suites and confirm no `failed to exit gracefully` line.
- **Doc-sync check (same PR):** the lock alert's copy is user-facing — after slice 4, re-check `faq.util.ts`/glossary for any "jobs always finish"-flavored claims (none found at discovery, re-verify); `CLAUDE.md`'s Async-Job section says "Locks release when the job reaches a terminal status … No manual unlock paths" — **append one sentence** noting the reconciliation sweep (#391) as the automatic path for stranded jobs, since the convention doc is a listed surface.
- **The `updated` column is load-bearing both ways:** the sweep reads it as a heartbeat and `transitionIfNonTerminal` bumps it — a reaped row can't be re-matched by a later pass (it's terminal), but keep the ordering in mind if the predicate ever changes.

## Next step

Implementation starts on this branch — slice 1, tests-first, one commit per slice — once you confirm the plan.
