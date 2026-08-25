# Connector-sync terminal state — Condensed design (#441)

**Issue:** [EnterpriseBT/portal-ai#441](https://github.com/EnterpriseBT/portal-ai/issues/441) · Bug · **small / condensed**. Epic child of [#444](https://github.com/EnterpriseBT/portal-ai/issues/444). Folds in [#456](https://github.com/EnterpriseBT/portal-ai/issues/456); [#458](https://github.com/EnterpriseBT/portal-ai/issues/458) (the 90% meter) was split out.

**Why.** The `jobs` row lies about a connector sync in three ways, and every one of them cost real diagnosis time during this epic. It reports `failed` while the worker is still writing; it reports `failed` on a sync whose every record landed; and it records nothing at all when the process is killed mid-run — with `attempts` stuck at `0` throughout, so the DB has no record that a job was ever retried. Single package: `apps/api`. No migration — `jobs.attempts`, `jobs.result` and non-terminal statuses all already exist.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Attempt start | `jobs.worker.ts:146` | `transition(jobId, "active", { progress: 0 })` — does **not** clear `error`, does **not** touch `attempts` |
| In-band failure | `jobs.worker.ts:189-203` | `transition(jobId, "failed", …)` then `throw err` so BullMQ retries — terminal written while 2 attempts remain |
| Transition patch type | `job-events.service.ts:63-71` | `Partial<{progress: number; error: string; result: …}>` — `error` cannot be set to `null`, so it cannot be cleared |
| `completedAt` | `job-events.service.ts:79-80` | Stamped on `completed` **or** `failed` — so a premature `failed` also stamps a false completion time |
| Out-of-band failure | `jobs.worker.ts:226-228` | `worker.on("failed")` **logs only**; nothing reaches the DB |
| Retry budget | `jobs.queue.ts:29-30` | `attempts: 3`, exponential backoff |
| Statuses | `packages/core/src/models/job.model.ts:21-37` | Terminal = `completed`/`failed`/`cancelled`; `pending`/`active`/`stalled`/`awaiting_confirmation` are not |
| Entity lock | `jobs.repository.ts:196` | Keys on `NON_TERMINAL_JOB_STATUSES`, so a retrying job must stay non-terminal or it silently unlocks |

### The reap cascade (#456) — six call sites, and only four should change

| Site | Context | Change? |
|---|---|---|
| `rest-api.adapter.ts:502` | sync | **guard** |
| `google-sheets.adapter.ts:159` | sync | **guard** |
| `microsoft-excel.adapter.ts:162` | sync | **guard** |
| `layout-plan-draft.service.ts:547` | commit | **guard** |
| `entity-record.router.ts:1360` | user deletes one record | leave failing |
| `entity-record.router.ts:1482` | user deletes all records | leave failing |

#456 said "all four call sites"; there are actually six. The two extra are request paths, and they should keep failing loudly: a request can report failure honestly to a caller who can retry, whereas a sync that has already written 397,960 rows cannot un-write them. Recording the distinction rather than blanket-applying the guard.

## Decision 1 — a retrying job stays `pending`, not `failed`

- **A — reuse `pending`.** ✅ **Chosen.** Non-terminal, so the entity lock holds; reads as "queued", which is exactly true (BullMQ has it queued behind a backoff delay); no enum change, no migration, no `packages/core` touch.
- **B — add a `retrying` status.** More expressive, but it is a `pgEnum` + Zod enum + type-checks + migration, and every consumer that switches on status gains a case. That is the `full` threshold for a wording improvement.
- **C — leave it `active`.** Wrong: nothing is running during the backoff, and `startedAt` would be restamped on each attempt.

The terminal `failed` is written **only when the retry budget is spent** — `bullJob.attemptsMade + 1 >= (bullJob.opts.attempts ?? 1)`. `completedAt` then stops being stamped on a job that is about to run again, which today produces a row that is simultaneously "completed at 18:35" and "active at 18:50".

**One case must stay terminal:** `UnrecoverableError` (BullMQ's stall-limit exhaustion) voids the remaining budget rather than consuming one attempt, so it is final on arrival regardless of `attemptsMade`.

## Decision 2 — clear the stale error and record the attempt, at attempt start

`transition(jobId, "active", { progress: 0, error: null, attempts: bullJob.attemptsMade + 1 })`.

Requires widening the patch type to `error: string | null` and adding `attempts: number`. `null` rather than `undefined` deliberately: Drizzle omits `undefined` from a `SET`, so `undefined` would silently keep the old text — which is the bug (`status=active, progress=88, error="Fetch failed: fetch failed"`).

`attemptsMade + 1` because the field means "which attempt is this", so a first run reads `1`, not `0`.

## Decision 3 — a sync that wrote its data has not failed (#456)

Guard the four batch-path cascades and record the degradation instead of throwing — #456's option 2. The result gains `mirrorDegraded?: true`, so **the status reflects the data and the payload reflects the mirror**.

Rejected #456's option 1 (guard and log only): the wide table then keeps rows pointing at soft-deleted records, which is the unbounded growth #327 exists to prevent, and a silent log is not a surface anyone reads. Rejected option 3 (keep failing, with a distinct `ApiCode`): it still reports a successful sync as failed, which is the actual defect.

`mirrorDegraded` lands in the existing `result` JSONB — no migration, and the job-details view already renders on the result's presence (#410's precedent, where a failed batch's `partialFailures` is the only record of why rows failed).

## Decision 4 — an out-of-band death records why

`worker.on("failed")` is the only hook that fires when the in-band `catch` never runs (process kill, stall recovery). It currently logs and stops.

It must be **idempotent**, because it also fires for every failure the in-band catch already handled. So: read the row, and write only when it is still non-terminal — i.e. our `catch` did not run. That distinguishes "the worker recorded its own failure" from "the worker vanished", and the latter is what today records nothing at all.

## Plan — 3 slices

### Slice 1 — the transition seam

**Files** — Edit `services/job-events.service.ts`: patch type gains `error: string | null` and `attempts: number`; `completedAt` stamped on `completed`/`failed` unchanged.

**Tests** — `__tests__/services/job-events.service.test.ts`: (1) `error: null` reaches the DB patch as `null`, not omitted; (2) `error` omitted entirely leaves the column untouched; (3) `attempts` is persisted; (4) the published Redis event still carries `error: null` rather than dropping the field.

### Slice 2 — retry-aware terminal state + attempt record

**Files** — Edit `queues/jobs.worker.ts`: attempt-start transition clears `error` and sets `attempts`; the `catch` chooses `pending` vs `failed` on remaining budget, with `UnrecoverableError` always terminal; `on("failed")` records an out-of-band death when the row is still non-terminal.

**Tests** — `__tests__/queues/jobs.worker.test.ts`: (1) first attempt of 3 fails → row `pending`, error recorded, `completedAt` **not** stamped; (2) last attempt fails → `failed`; (3) `UnrecoverableError` on attempt 1 → `failed` immediately; (4) attempt 2 start clears attempt 1's error and sets `attempts: 2`; (5) a retrying job still matches the entity-lock query; (6) `on("failed")` writes nothing when the row is already terminal; (7) `on("failed")` records the reason when the row is non-terminal; (8) success path unchanged (`completed`, progress 100).

### Slice 3 — the reap-cascade guard (#456)

**Files** — Edit the four batch sites to guard and set `mirrorDegraded`; extend `SyncInstanceResult` (and the sheets/excel/layout-plan equivalents) with the optional field. Leave both `entity-record.router.ts` sites alone, with an in-file note saying why.

**Tests** — extend `__tests__/adapters/rest-api/sync-record-writer.test.ts` and add cases for the sheets/excel/layout-plan paths: (1) a throwing cascade leaves the sync `completed` with every record written; (2) `mirrorDegraded` is set on the result; (3) a succeeding cascade does not set it; (4) the guard logs `…reap-cascade-failed`. Mutation-check each guard the way #440's probe guard was checked.

## Smoke (manual, against your dev stack)

**Preflight: verify the API restarted on this branch by pid time, not by `/api/health`** — it returned 200 from a stale build three times across this epic.

1. **Retry does not write `failed`.** Start a large sync, kill the upstream mid-run (or point the endpoint at a dead host). Expect the row at `pending` with the attempt's error and `attempts: 1`, `completed_at` still null — where today it reads `failed`.
2. **The stale error clears.** When attempt 2 starts, expect `status=active, error=null, attempts=2`. Today it carries attempt 1's text.
3. **The lock holds through the retry.** While the row is `pending`, confirm the connector-instance view still shows the lock alert and Sync/edit/delete stay disabled.
4. **Budget exhaustion is terminal.** Let all 3 attempts fail. Expect `failed`, `attempts: 3`, `completed_at` set.
5. **#456: a sync whose data landed reports `completed`.** `alter table "er__<entity>" rename to "er__<entity>_hidden";` then sync. Expect `completed`, all records in `entity_records`, `mirrorDegraded: true` on the result, and `…reap-cascade-failed` in the log. Rename it back afterwards.
6. **A killed worker records why.** Kill the API mid-sync. After BullMQ's stall recovery, expect the row to carry a reason rather than the silence it records today.

## Out of scope

- The progress meter — #458, split out because an honest denominator needs the contract widened to `apps/web`.
- Resume-from-offset. Slice 3 persists *that* a mirror degraded, not enough state to resume a sync; the ticket's own sizing says resume groundwork escalates to `full`.
- #391 (jobs stranded non-terminal after Redis loss) — same class, different trigger.
- The two request-path cascade sites, which keep failing loudly by decision above.
