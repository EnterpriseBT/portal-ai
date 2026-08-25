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

## Smoke (manual, against your dev stack) — walked 2026-08-25

**Preflight: verify the API restarted on this branch by pid time, not by `/api/health`** — it returned 200 from a stale build three times across this epic. Verified here: worker started 21:45:55 against a 21:35:30 code commit.

Driven against the `FAIL SMOKE` instance (already pointed at `https://no-such-host-abcxyz.invalid` from #435's walk) for §1–§4, and `Smoke 3` for §5.

1. [x] **Retry does not write `failed`.** One run gave §1, §2 and §4 together. Line 1 below is the *previous* job, left over from #435's walk, and is an exact control for the old behaviour:

   ```
   22:15:11  eaed3a8b  failed   attempts=0  err set  completed=set   <- OLD, the bug
   22:15:28  8f31f855  active   attempts=1  err  -   completed=null
   22:15:36  8f31f855  pending  attempts=1  err set  completed=null  <- §1
   22:15:38  8f31f855  active   attempts=2  err  -   completed=null  <- §2, cleared
   22:15:46  8f31f855  pending  attempts=2  err set  completed=null
   22:15:50  8f31f855  active   attempts=3  err  -   completed=null
   22:15:57  8f31f855  failed   attempts=3  err set  completed=set   <- §4
   ```

2. [x] **The stale error clears.** Above — `err` returns to `-` at each attempt start, and `attempts` walks 1→2→3 where the control sits at 0.

3. [x] **The lock holds through the retry.** **The step as written was impractical and was replaced.** The `pending` windows are only the BullMQ backoff — 2s and 4s — far too short to check a UI by hand, so it was verified at the level that actually matters, probing the same `NOT IN (completed, failed, cancelled)` predicate `JobLockService` uses, 4×/second:

   ```
   22:16:47  status=failed   lock_matches=0   <- released
   22:17:01  status=active   lock_matches=1
   22:17:09  status=pending  lock_matches=1   <- HELD through the retry
   22:17:19  status=pending  lock_matches=1   <- HELD
   22:17:30  status=failed   lock_matches=0   <- released, budget spent
   ```

   Those two `pending` rows would previously have been `failed` → `0` → the lock released on an entity the worker was about to write to.

4. [x] **Budget exhaustion is terminal.** See §1's trace: `failed`, `attempts: 3`, `completed_at` set.

5. [x] **#456: a sync whose data landed reports `completed`.** Wide table renamed away, `Smoke 3` synced (397,960 records, 306 s):

   ```
   completed | progress 100 | attempts 1 | error -
   {"recordCounts":{"created":34000,"deleted":431960,"unchanged":363960},
    "mirrorDegraded": true}
   ```

   Where the same scenario produced `failed` at progress 90 after 482 s before this branch. Table renamed back and verified at 397,960 rows.

   An accidental second control turned up here: the *previous* Smoke 3 job reads `completed | attempts=0` while still carrying `relation "er__dee94e06…"` in its `error` column — a completed job displaying a failure, which is the stale-error half of §2 in another guise. The new row's `error=-` is that fixed.

6. [ ] **A killed worker records why.** **Deferred, not waived.** Killing a worker mid-sync would interleave with the reap behaviour in #460 below, so the run would prove nothing clean about this branch. To be run once #460 is fixed.

### What the walk found that it was not looking for — #460

§5's run exposed **silent data loss that this branch does not cause and does not fix**, filed as [#460](https://github.com/EnterpriseBT/portal-ai/issues/460):

```
watermark 22:40:40.681  pass A       two syncInstance runs, one job,
watermark 22:48:36.717  pass B       attempts never left 1 (a stall re-delivery)

live        363,960  stamped W_B
tombstoned   34,000  stamped W_A, written at 22:49:42
source      397,960
```

BullMQ re-delivered the job during its ~6.5-minute reap phase while the first pass was still flushing writes; the second pass's watermark reap then deleted the first pass's in-flight rows. The result payload looks healthy — `34,000 + 363,960 = 397,960` — because each pass counted its own work correctly, so nothing in the reported numbers reveals the shortfall.

Pre-existing: generation `d22d08cf`, from before this branch, carries the same two-watermark signature.

**The interaction has to be decided rather than assumed.** Before this branch, that run reported `failed`, which triggered a BullMQ retry, and the retry re-wrote all 397,960 records — *the data self-healed while the status lied*. After this branch the status is honest, no retry fires, and the data stays short. That is not a reason to hold this branch: the loss comes from the concurrent pass, and relying on an unrelated crash for an accidental repair is not a safety property. It does mean #460 should not queue behind the rest of the epic, because this branch removes the accident that was masking it.

## Sign-off

- [ ] Every section above verified (or explicitly waived with a reason)
- [ ] ______ (date) — ______ (name) — confirmed against my own running stack

## Out of scope

- The progress meter — #458, split out because an honest denominator needs the contract widened to `apps/web`.
- Resume-from-offset. Slice 3 persists *that* a mirror degraded, not enough state to resume a sync; the ticket's own sizing says resume groundwork escalates to `full`.
- #391 (jobs stranded non-terminal after Redis loss) — same class, different trigger.
- The two request-path cascade sites, which keep failing loudly by decision above.
