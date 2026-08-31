# layout_plan_commit reaps by watermark without the sync ownership lock — Condensed design (#461)

**Issue:** [EnterpriseBT/portal-ai#461](https://github.com/EnterpriseBT/portal-ai/issues/461) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `layout_plan_commit` reaps stale records by watermark exactly as a connector sync does, but #460's fix (`SyncLockService.withInstanceLock`) covered only `connector_sync`. A BullMQ stall re-delivery can therefore start a second pass of one commit job while the first is still writing, and the later pass's reap deletes the earlier's in-flight rows — the same silent-data-loss mechanism #460 measured at 34K records. Touches `apps/api` only; the job result contract in `@portalai/core` stays unchanged (that is the point of the chosen design).

## Current shape

| Piece | Location | Note |
|---|---|---|
| The unprotected processor | `apps/api/src/queues/processors/layout-plan-commit.processor.ts:51-52` | dispatches to `runCommitDraft` / `runRecommit` with no lock |
| The reap | `apps/api/src/services/layout-plan-draft.service.ts:534-556` (called `:307`, `:511`) | per-entity `softDeleteBeforeWatermark` — the #460 exposure |
| The primitive | `apps/api/src/services/sync-lock.service.ts:72` | `withInstanceLock` — **non-blocking**: `{ acquired: false }` without running `fn` |
| How sync reports superseded | `apps/api/src/queues/processors/connector-sync.processor.ts:88-125` | zeroed counts + `superseded: true`; acceptable because nothing waits on a sync |
| The all-required result | `packages/core/src/models/job.model.ts:250` | `LayoutPlanCommitJobResultSchema` — `connectorInstanceId`, `planId`, `connectorEntityIds`, `recordCounts`, no optional-superseded escape hatch |
| Unconditional result persist | `apps/api/src/queues/jobs.worker.ts:221-240` | whichever pass returns last overwrites the job row's result |
| The waiting consumer | import wizards (file-upload / gsheets / ms-excel workflows) | block on the SSE terminal event and read `connectorEntityIds` to finish |

## Decision — wait for the lock, then echo or run (issue option 3, sharpened)

The issue's three candidates for a superseded pass: (a) a discriminated `{ superseded: true }` result union member; (b) throw a typed error so BullMQ retries; (c) wait for the lock instead of aborting.

- **(a) is wrong here** even as a union member: the pass that loses the lock usually finishes *first*, so its result would transition the job to `completed` and fire the SSE terminal event while the real pass is still writing — the wizard ends on a false "finished with nothing". Sync tolerates this ordering damage (a misreported count); a commit cannot (it erases the entity ids the frontend needs and ends a live wizard). It also forces a `@portalai/core` contract change plus frontend handling.
- **(b) burns retry budget against a wall** — the same objection recorded in `connector-sync.processor.ts:118` — and a retry that eventually wins the lock would re-run a commit that already succeeded.
- **(c) fits the commit's semantics**: unlike a sync, a user is actively blocked, so a delayed commit beats a skipped one. **Chosen**, with one sharpening: after acquiring, the pass re-reads its own job row and **echoes** rather than re-runs when the other pass already finished the work.

Concretely, the processor wraps its dispatch in a new bounded-wait acquire:

1. `SyncLockService.withInstanceLockWait(connectorInstanceId, fn, { timeoutMs, pollMs })` — poll `pg_try_advisory_lock` on the existing `(SYNC_LOCK_NAMESPACE, hashtext(id))` key (same keyspace as sync — deliberate: a commit and a sync reap the same rows, so mutual exclusion across the two job types is a feature, not a collision). Non-blocking `withInstanceLock` stays untouched for sync.
2. On acquire, re-read the job row: **`completed` → return the stored result verbatim** (the worker re-persists an identical payload; no false result, no overwrite); **anything else** (`active` from a dead holder per #464, `pending`, `failed` with budget) → this pass is the legitimate executor: run the commit.
3. On timeout (env `LAYOUT_PLAN_COMMIT_LOCK_WAIT_MS`, default 15 min ≥ any observed commit), throw — `statusForFailedAttempt` (#441) then writes `pending` while budget remains, `failed` when spent. No new ApiCode: this surfaces through the job row's `error`, not an HTTP response.

This answers the issue's three open questions: (1) a superseded pass reports nothing special — it either echoes the real result or becomes the real pass; (2) it never writes a false result, so the worker's unconditional persist at `jobs.worker.ts:221-240` needs **no** opt-out (the escalate-to-full trigger never fires); (3) a draft minting a new instance (`isExistingInstance: false`) keeps the lock — no *other* job can contend on a fresh UUID, but the stall-re-delivered second pass of *this* job is exactly the contender being locked out, so the lock is necessary there too, not merely harmless.

Waiting occupies one of the jobs worker's 2 slots (`jobs.worker.ts:302`) for up to the timeout; acceptable because the zombie holder runs outside BullMQ's slot accounting (that is what a stall re-delivery is) and commit contention is rare by construction.

## Plan — 2 slices

**Slice 1 — bounded-wait acquire on `SyncLockService`.**
- **Files:** `apps/api/src/services/sync-lock.service.ts` — add `withInstanceLockWait` (poll loop over the existing try-acquire, same reserved-connection discipline, releases on settle); `apps/api/src/environment.ts` — `LAYOUT_PLAN_COMMIT_LOCK_WAIT_MS` (default 900000) + poll interval constant in the service.
- **Tests:** extend `apps/api/src/__tests__/services/job-lock.service.test.ts`'s sibling coverage — new unit cases in `apps/api/src/__tests__/services/sync-lock.service.wait.test.ts`: acquires immediately when free; polls then acquires when released mid-wait; times out and throws after `timeoutMs`; always releases on `fn` throw. Run `npm run test:unit -- --testPathPattern sync-lock` from `apps/api/`.

**Slice 2 — wrap the commit processor.**
- **Files:** `apps/api/src/queues/processors/layout-plan-commit.processor.ts` — wrap the `runCommitDraft`/`runRecommit` dispatch in `withInstanceLockWait`; on post-wait acquire, re-read the job row via `DbService.repository.jobs.findById(jobId)` and return the stored result when status is `completed`; keep the existing final-attempt draft rollback semantics outside the echo path (an echoed completion must never trigger rollback). **Sharpened during implementation:** the wait timeout throws a typed `SyncLockWaitTimeoutError`, and the final-attempt draft rollback is skipped for it — a timeout means another execution still *holds* the lock and is writing the very plan/instance rows the rollback would hard-delete; "never owned the work" is not a failure of the work.
- **Tests:** `apps/api/src/__tests__/queues/processors/layout-plan-commit.processor.test.ts` (new, mirroring `revalidation.processor.test.ts`'s ESM-mock shape): lock free → dispatch runs inside the lock; lock held then released with job `completed` → stored result echoed, service **not** called; lock held then released with job `active` → service called (dead-holder takeover); wait timeout → throws and rollback rules unchanged. Run `npm run test:unit -- --testPathPattern layout-plan-commit` from `apps/api/`.

## Smoke (manual, against your dev stack)

1. Normal path unchanged: run a file-upload import end-to-end → commit completes, wizard finishes with entities visible.
2. Contention: in psql, `SELECT pg_advisory_lock(1398361667, hashtext('<instanceId>'));` (ASCII "SYNC" namespace), then trigger a recommit for that instance → the job stays `active`/waiting, no reap occurs while held. **The recommit needs a FRESH, uncommitted upload session** — a successful commit deletes its session's S3 objects and workbook cache (`markSessionCommitted`), so re-upload the file and stop the wizard before its commit step, then POST the recommit with that new `uploadSessionId`.
3. `SELECT pg_advisory_unlock(1398361667, hashtext('<instanceId>'));` (or end the psql session — the lock dies with it) → the waiting commit acquires and completes normally; record counts correct, no rows lost.
4. Timeout path: set `LAYOUT_PLAN_COMMIT_LOCK_WAIT_MS=10000` (restart the dev stack so the env lands), hold the lock through a recommit → the job goes **`failed`** — not `pending`: `layout_plan_commit` is pinned to 1 attempt (`jobs.service.ts:29`) — with the `SyncLockWaitTimeoutError` message in `error`, and **no rollback runs**: the plan, instance, entity, and records all remain intact. Re-trigger the commit manually after releasing the lock.
5. Regression: a plain connector sync on another instance is unaffected (non-blocking path untouched).

## Out of scope

- **Auditing other reapers** — #460 covered `connector_sync`, this covers `layout_plan_commit`; `entity-record-retention-purge` and friends delete by predicate, not watermark, and take no lock by design.
- **A generic "skip result persist" opt-out in `jobs.worker.ts`** — the chosen design makes it unnecessary; revisit only if a future job type genuinely needs a resultless terminal pass.
- **Changing `LayoutPlanCommitJobResultSchema`** — deliberately untouched; the all-required shape is preserved because no pass ever reports a partial/false result.
