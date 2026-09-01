# Stranded-job reconciliation after Redis loss — Discovery

**Issue:** [EnterpriseBT/portal-ai#391](https://github.com/EnterpriseBT/portal-ai/issues/391)

**Why this exists.** Only two things ever move a `jobs` row to a terminal status: the worker's own success/failure paths (`jobs.worker.ts:231-283`), which require the BullMQ job to exist, and an explicit `POST /api/jobs/:id/cancel`. When the Redis keyspace is lost mid-flight (ElastiCache node replacement; locally `FLUSHALL`), the BullMQ entry vanishes, no worker will ever touch the job again, and the DB row stays `active` forever — holding its `JOB_LOCK_KEYS` entity lock and showing the user an alert that promises "paused until it finishes." The escape hatch (cancel) exists but nothing leads anyone to it, and each affected entity must be found and unstuck by hand. This is live in app-dev today; #383 makes the trigger rarer in prod, not gone. This is the reconciliation layer that gives every stranded job a path back to terminal, and the surface that stops promising completion for work that is already dead.

## The current shape

### Terminal transitions and boot

| Piece | Location | Note |
|---|---|---|
| Worker creation | `jobs.worker.ts:172`, called at module scope in `index.ts:19` | connects at import time, before `start()` |
| Terminal transitions | `jobs.worker.ts:231-247` (success via `classifyBatchOutcome`), `:266-283` (failure via `statusForFailedAttempt:163-171`) | both require a live BullMQ delivery |
| #464 lost-execution pre-read | `jobs.worker.ts:196-215` | catches a re-*delivered* job; useless after a FLUSHALL (nothing re-delivers) |
| `worker.on("failed")` | `jobs.worker.ts:321-366` | fires only when a worker receives a failed event — same gap |
| Boot hooks | `index.ts:54-70` | two fire-and-forget startup sweeps already exist (`registerMaintenanceSchedulers`, `FileUploadSessionService.sweepStaleUploads`) — the natural home for a boot reconcile; `reconcileAll()` (`index.ts:30`) is the *blocking* variant precedent |

### The single writer, the cancel shape, and correlation

`JobEventsService.transition` (`job-events.service.ts:63-118`) is the one status writer: patches the row (always bumps `updated`) then publishes to Redis pub/sub → SSE, so open views refresh. `JobsService.cancel` (`jobs.service.ts:116-142`) already tolerates a vanished BullMQ job — it removes the Bull entry only `if (job.bullJobId)` and swallows the failure — which is exactly the tolerance a reconciler needs. Correlation is `jobs.bull_job_id` (`jobs.table.ts:53`, nullable; written post-enqueue at `jobs.service.ts:81-83`, so **null during a brief insert→enqueue window**). The only `queue.getJob()` call in the codebase today is inside `cancel` (`jobs.service.ts:134`).

### Status model and lock queries

`TERMINAL_JOB_STATUSES = [completed, failed, cancelled]` (`job.model.ts:32-36`). `NON_TERMINAL_JOB_STATUSES = [pending, active, awaiting_confirmation, stalled]` (`jobs.repository.ts:29-34`) drives every `findRunning*` lock query. Two facts matter: **nothing in the tree ever writes `status='stalled'`** (it exists only in enums, a StatusBadge color, and prose — a dead status that would nonetheless hold locks), and `awaiting_confirmation` is a *legitimate* non-terminal state whose BullMQ entry may be gone on purpose (the pass completed; a confirm enqueues the next one).

### Heartbeat raw material

`bullJob.updateProgress(n)` → `jobs.worker.ts:307-313` → `JobEventsService.updateProgress` (`job-events.service.ts:147-160`) writes `{ progress, updated: now }` to the row. So `jobs.updated` is a **de-facto heartbeat** for every progress-reporting processor — with caveats: `sql_query`, `dissolve_precompute`, and `bulk_transform` don't call `updateProgress`, and a long single batch can go quiet for minutes.

### Surfaces

| Piece | Location | Note |
|---|---|---|
| Lock alert copy | `ConnectorInstanceLockAlert.component.tsx:44-48` | "paused until it finishes"; pure UI, uses only `type` today |
| Age already in hand | `RunningJobSummarySchema` (`connector-instance.contract.ts:194-200`), `toSummary` (`job-lock.service.ts:40-48`) | carries `startedAt` + `created`, unrendered — CLAUDE.md's Async-Job rules already *require* a "started X ago" timestamp |
| Cancel affordances | `JobDetail.view.tsx:36,71-83`; `BulkJobProgressBlock.component.tsx:220-231,262,350-357` | `sdk.jobs.cancel` → `POST /api/jobs/:id/cancel` (`jobs.router.ts:397-410`) |
| Admin surface | `admin.router.ts:137-180` | `GET /api/admin/maintenance` maps BullMQ `returnvalue` → `recentRuns` — a maintenance job's summary appears with zero route changes |
| Operator CLIs | `devops-cli`/`admin-cli` command dirs | no job-related commands exist; anything here is greenfield |

## The design space

### Decision 1 — what *detects* a stranded job

**A. BullMQ existence check** — for each non-terminal row, `queue.getJob(bullJobId)`; missing ⇒ stranded. Precise for the FLUSHALL case, but has a fatal edge alone: after a keyspace loss the *executor keeps running in-process* — the Bull entry is gone while the processor promise is still writing. Reaping on absence alone could release locks under a live writer (the #441 lesson) or mark `failed` a job whose zombie pass later completes.

**B. Staleness threshold on `jobs.updated`** — anything non-terminal untouched for N minutes is presumed dead. No BullMQ dependency, but three processors never heartbeat and slow batches go quiet, so alone it either false-positives or needs a very generous N.

**C. Both, conjunctively** — stranded ⇔ Bull entry **missing** AND `updated` older than a staleness window. The absence check supplies precision; the staleness window protects the in-flight zombie (it is still bumping progress, or at minimum recently did).

| | A alone | B alone | C (conjunction) |
|---|---|---|---|
| FLUSHALL detection | immediate | after N min | after N min |
| Zombie-writer safety | ✗ reaps under a live pass | ✓ (if it heartbeats) | ✓ |
| Non-heartbeating job types | ✓ | ✗ false positives | ✓ (absence still required) |
| New machinery | none | none (column exists) | none |

**Lean: C.** Absence is necessary, staleness is the guard; both signals already exist with no schema change. Non-heartbeating types are covered because absence is still required, and the zombie case is covered because a live pass either heartbeats or finishes inside the window.

### Decision 2 — what *runs* the sweep

**A. Boot-time only** (`start()`, fire-and-forget beside `sweepStaleUploads`) — catches every deploy/restart, misses a mid-life Redis loss until the next deploy.

**B. Repeatable maintenance job** (`upsertJobScheduler`, the retention-purge precedent) — but the scheduler itself *lives in the keyspace that just died*: after a FLUSHALL the repeatable job is gone until the next boot re-registers it. The reconciler would depend on the exact dependency whose failure it exists to repair.

**C. In-process `setInterval` in the API process** — no Redis dependency at all; the sweep runs every N minutes regardless of keyspace state. Costs: multiple ECS instances each run it (needs concurrent-safety), and its run summary doesn't appear in `GET /api/admin/maintenance` (which reads BullMQ history) without extra wiring.

| | A boot | B maintenance queue | C interval |
|---|---|---|---|
| Survives the failure it repairs | restart-only | ✗ scheduler dies with Redis | ✓ |
| Multi-instance behavior | one pass per instance boot | single (queue concurrency 1) | concurrent sweeps — must be idempotent |
| Admin visibility | log line | free via `/api/admin/maintenance` | needs a surface |
| Precedent | `sweepStaleUploads` | `ledger-retention-purge` | none |

**Lean: A + C** — boot pass plus an in-process interval. B's self-dependency is disqualifying for this particular job (it is fine for retention purges, whose trigger isn't Redis dying). Concurrent sweeps are made safe by Decision 3's conditional transition; visibility comes from a structured log summary plus the jobs themselves (each reaped row carries the reason).

### Decision 3 — what a reaped job *becomes*

**A. `failed` with a distinctive error** (e.g. "Lost after a Redis failure — the queue no longer holds this job"), written through `JobEventsService.transition` so SSE fires and open views refresh. **B. `cancelled`** — but nobody cancelled it, and `cancelled` skips `completedAt` (`job-events.service.ts:100-102`), muddying the audit trail. **C. Repurpose the dead `stalled` status** — but `stalled` is deliberately non-terminal and lock-holding (`jobs.repository.ts:22-28`); repurposing it inverts its meaning everywhere.

**Lean: A.** `failed` is the truthful status for work that will never complete; the transition must be **conditional** (`UPDATE … WHERE status NOT IN (terminal)` semantics) so a concurrent sweep, a racing zombie completion, or a user cancel can never be overwritten — last-writer-wins is exactly what #464's lore warns against.

### Decision 4 — the surface while the window is open

Even a correct sweep leaves minutes during which the user stares at a promise. The lock alert already receives `startedAt`/`created` and renders neither — while the Async-Job rules require a "started X ago" timestamp.

**Lean: do the surface regardless (issue direction 4):** render "started X ago" always; past a staleness threshold, append "this job may be stuck" with a link to the job detail view, where the existing Cancel affordance lives. Contract-free (fields already on `RunningJobSummary`), and honest during the sweep's window.

## Tradeoff comparison

| | D1: absence ∧ staleness | D2: boot + interval | D3: conditional `failed` | D4: aged alert + stuck link |
|---|---|---|---|---|
| Spread to spec | Yes — the predicate + windows | Yes — service + wiring | Yes — transition contract | Yes — alert props/copy |
| Schema change | none | none | none | none |
| Packages | api | api | api + core (copy?) | web (+core if summary copy moves) |

## Recommendation

1. New `JobReconciliationService.sweepStrandedJobs()` (`apps/api`): select non-terminal rows (excluding `awaiting_confirmation` — open question 1) whose `updated` is older than `JOB_STRANDED_THRESHOLD_MS`; for each, `getJobsQueue().getJob(bullJobId)`; if absent (or `bullJobId` null past the same threshold), transition to `failed` with a fixed, greppable reason via a **conditional** terminal write; return `{ scanned, reaped, skipped }` as the structured log summary.
2. Run it fire-and-forget in `start()` after `connectDatabase()` (the `sweepStaleUploads` shape) **and** on an in-process interval (`JOB_STRANDED_SWEEP_INTERVAL_MS`, default ~5 min) — deliberately not on the maintenance queue, whose scheduler dies with the keyspace it would be repairing.
3. Make the terminal write concurrent-safe: the transition applies only while the row is still non-terminal, so N ECS instances sweeping at once, a zombie completion, and a user cancel all compose without last-writer-wins.
4. Lock alert: render "started X ago" (required by the Async-Job rules, already in the payload); past the staleness threshold, add "this job may be stuck" + a link to the job's detail view where Cancel already lives.
5. Leave `POST /api/jobs/:id/cancel` as-is — it remains the manual path and the sweep reuses its missing-Bull tolerance.

## Open questions

1. **Is `awaiting_confirmation` sweepable?** Its BullMQ entry may be legitimately absent while the user decides, so the absence predicate false-positives. **Lean: exclude it from the sweep entirely** and record why in the service header; if confirmation-abandonment turns out to matter it is its own ticket with its own (age-based, much longer) policy.
2. **Threshold values.** Too short reaps slow single-batch work; too long leaves users staring. **Lean: `JOB_STRANDED_THRESHOLD_MS` default 15 min, sweep interval 5 min, env-tunable** — the longest observed quiet period (a 400K sync batch) is minutes, not tens of minutes, and the threshold only applies when the Bull entry is *also* gone.
3. **Should the sweep double-check `pending` rows?** A `pending` row with a vanished Bull entry will never be picked up — same strand, different status. **Lean: yes, include `pending` and `stalled`; same predicate covers them** (the insert→enqueue null-`bullJobId` window is protected by the staleness threshold).
4. **Does the stuck-hint threshold on the frontend share the backend's value?** **Lean: no hard coupling** — the alert hints at ~the same magnitude (hardcoded or env-exposed later); a hint that appears slightly before or after the sweep acts is harmless, and plumbing config to the client is not worth it here.

## Enterprise-scale considerations

- **Concurrency & correctness** — Lean: the conditional terminal transition is the whole story: multi-instance sweeps, zombie completions, and user cancels all race, and the guard makes every ordering converge (a terminal row is never overwritten). The sweep itself is read-then-conditional-write; no advisory lock needed.
- **Accuracy & auditability** — Lean: the reaped row *is* the record — `failed` + a fixed reason string + `completedAt`, distinguishable from organic failures by the reason; the sweep's `{scanned, reaped}` summary is a structured log line. No separate ledger warranted.
- **Failure modes** — Lean: fail-open on every dependency — an unreachable Redis during the sweep means `getJob` throws and that row is *skipped* (never reaped on error: absence must be positively observed); a DB error skips the pass. The sweep degrades to "nothing happens", which is today's behavior.
- **Scale & unbounded growth** — Lean: the candidate set is non-terminal rows older than the threshold — bounded by worker concurrency (2) plus strandings, i.e. tens, not thousands; one `getJob` per candidate is trivial. No pagination needed; cap the per-pass reap count defensively anyway.
- **Multi-tenancy** — Lean: the sweep is system-scoped by nature (Redis loss is not per-org); reaped rows keep their `organizationId`, and per-org lock queries release naturally. N/A beyond that.
- **Contract stability** — Lean: no API contract changes; the alert's new copy consumes fields already in `RunningJobSummary`. A future operator command (`portalai jobs …`) can call the same service.
- **Data lifecycle** — Lean: thresholds are operational windows (env-tunable), not business periods — appropriate here; reaped rows age out with the jobs table as today. N/A for billing alignment.

## What this doesn't decide

- **A CLI/operator bulk path** (`portalai jobs stuck|reconcile`) — the sweep removes the need it was imagined for; greenfield CLI surface deferred until an operator actually wants one.
- **Confirmation-abandonment policy for `awaiting_confirmation`** — excluded from the sweep (open question 1); its own ticket if it matters.
- **Adding heartbeats to `sql_query` / `dissolve_precompute` / `bulk_transform`** — not needed for correctness under the conjunction predicate; worth doing someday for better progress UX, separately.
- **Removing the dead `stalled` status** — tempting cleanup, but touching the status enum is contract churn unrelated to this fix.
- **#383-style infra hardening** — orthogonal; this ticket makes the app honest regardless of how rare the trigger becomes.

## Next step

`docs/STRANDED_JOB_RECONCILIATION.spec.md` (the sweep predicate + conditional-transition contract, env vars, the alert's copy/props) and `.plan.md`. Likely slices: (1) `JobReconciliationService` + conditional transition, unit-tested; (2) boot + interval wiring, integration-tested against a real DB with a fabricated stranded row; (3) the lock-alert age + stuck-hint surface; (4) smoke.
