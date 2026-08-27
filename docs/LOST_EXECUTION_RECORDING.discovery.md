# Lost-execution recording — Discovery

**Issue:** [EnterpriseBT/portal-ai#464](https://github.com/EnterpriseBT/portal-ai/issues/464)

**Why this exists.** When a connector-sync worker is killed mid-run (SIGKILL, container suspend), BullMQ's stalled checker **re-delivers** the job — it resets progress `90 → 0` and starts a second execution — without emitting a `failed` event and without incrementing `attemptsMade`. #441 put its out-of-band recording in `worker.on("failed")`, but that handler runs *inside a worker process*, so a killed process never runs its own, and a first stall re-delivers rather than fails. The result measured in #460's smoke walk: a job that ran twice reports `attempts: 1`, `error: (none)`, `completed` — the DB holds no evidence an execution was lost. The data is fine (#460's advisory lock and the watermark reap converge), but the **diagnostic surface every future sync bug is read through is silent about a redone execution**. This is the fix that makes a lost execution leave a mark.

## The current shape

### The attempt lifecycle in the worker

| Piece | Location | Behavior |
|---|---|---|
| Active transition (top of every execution) | `apps/api/src/queues/jobs.worker.ts:186-196` | `transition(jobId, "active", { progress: 0, error: null, attempts: attemptsMade + 1 })` |
| In-band catch | `apps/api/src/queues/jobs.worker.ts:239-268` | Formats error, transitions to `failed`/`pending`, rethrows |
| `statusForFailedAttempt` | `apps/api/src/queues/jobs.worker.ts:162-170` | `failed` on `UnrecoverableError` or spent budget, else `pending` |
| `worker.on("failed")` (#441 out-of-band) | `apps/api/src/queues/jobs.worker.ts:299-327` | Reads the row; if not already terminal/`pending`, records `"Attempt ended without recording a reason (…)"`. **Cannot fire for a killed process or a first stall re-delivery.** |

The key observation for the fix: a **fresh, non-lost** execution always finds its row in `pending` — either the `pending` written at creation, or the `pending` a prior failed attempt chose (`statusForFailedAttempt`). The row is `active` at the top of a new execution **only** when a prior execution set it `active` (`job-events.service.ts:92` stamps `startedAt`) and then died without any terminal or `pending` transition. That is precisely — and only — the lost-execution case, and it is knowable in-process by the execution that picks the work up next.

### The single DB-writing path

`JobEventsService.transition` (`apps/api/src/services/job-events.service.ts:63-111`) is the only writer of job status/attempts/error. Its `patch` type (lines 66-84) whitelists `progress | error | result | attempts`; it builds `dbPatch`, stamps `startedAt` on `active` (line 92), calls `DbService.repository.jobs.update` (line 97), then publishes a Redis event (lines 100-109). A new `lostExecutions` field must join the patch whitelist. There is no job-specific status writer — the worker uses inherited `findById` / `update` (`apps/api/src/db/repositories/jobs.repository.ts:36-244`, base `update` at `base.repository.ts:277`).

### The dual-schema surface a new column touches

| Layer | Location | Change |
|---|---|---|
| Drizzle table | `apps/api/src/db/schema/jobs.table.ts:52` (`attempts`) | Add `lostExecutions: integer("lost_executions").notNull().default(0)` |
| Zod model | `packages/core/src/models/job.model.ts:633-646` (`JobSchema`) | Add `lostExecutions: z.number()` |
| drizzle-zod glue | `apps/api/src/db/schema/zod.ts:169-176` | Generated from the table — no per-column edit |
| Type guards | `apps/api/src/db/schema/type-checks.ts:303-316` | Bidirectional `IsAssignable` — stays green iff both sides above move together |
| Migration | `apps/api/drizzle/` (latest `0082_…`; next `0083`) | `db:generate` emits `ALTER TABLE "jobs" ADD COLUMN "lost_executions" integer DEFAULT 0 NOT NULL;` — never hand-numbered |

### The frontend surface

`apps/web/src/views/JobDetail.view.tsx:109-110` renders `${job.attempts} / ${job.maxAttempts}` in a `MetadataList` (Status, Job ID, Type, Progress, Created/Started/Completed; error in a `PageSection`). `JobSchema` flows to the client through `packages/core/src/contracts/job.contract.ts` (GET embeds it), so a new model field reaches `JobDetail` with no contract edit — it reads `attempts` straight off the fetched `job`, and `lostExecutions` would read the same way.

### Tests

`apps/api/src/__tests__/queues/jobs.worker.retry.test.ts` is the relevant suite — its `Worker` mock records event callbacks into a `listeners` map, mocks `JobEventsService.transition` and `DbService.repository.jobs.findById` (`mockFindById`), and has a `job(attemptsMade, max)` helper fabricating a BullMQ job. Today it drives the captured `failed` handler directly (which is why the untestable-in-process kill path was never covered). New tests drive the **processor's active-transition path** with a pre-existing `active` row and assert the `lostExecutions` increment.

## The design space

### Decision 1 — Where to detect the lost execution

**A. In the worker processor** — read the row before the `active` transition; if `row.status === "active"`, this execution is a re-delivery of a lost one.
**B. Inside `JobEventsService.transition("active")`** — have the writer detect the prior status and self-increment.

| | A (worker) | B (transition) |
|---|---|---|
| Owns re-delivery semantics | Worker already does (#441 attempts logic) | Leaks a worker concept into a generic writer |
| Extra read | One `findById` at processor top | transition would need a pre-read it doesn't do today |
| Blast radius | One function | Every `active` transition, everywhere |

**Lean: A.** The worker already owns the `active` transition and the 1-based `attempts` write; the "am I resuming?" question belongs next to them. `transition` stays a dumb writer that persists whatever patch it's handed.

### Decision 2 — How to store the count

The ticket's `## Sizing` already settled this against three alternatives, and the survey confirms each is wrong:

- **Overload `attempts`** — user-facing: `JobDetail.view.tsx:110` renders it as `"1 / 3"`, so counting executions there would show `"5 / 3"`.
- **`metadata` jsonb** — that column is the job's *input*; runtime observations there are a smell every reader must be warned about.
- **`error` text** — would paint a failure on a job that succeeded — the exact defect #441 fixed.

**Decision: a real `lost_executions integer not null default 0` column** on `jobs`, mirrored as `lostExecutions: z.number()` on `JobSchema`. This is the dual-schema workflow (table + model + migration together), which is why the ticket is `full`.

### Decision 3 — Atomicity of the increment

**A. Read-then-write** — the processor reads the row once (it needs `status` and `lostExecutions` anyway), and passes `lostExecutions: row.lostExecutions + 1` in the `active` patch when `row.status === "active"`.
**B. Atomic conditional SQL** — `SET lost_executions = lost_executions + CASE WHEN status='active' THEN 1 ELSE 0 END` in one statement.

**Lean: A.** BullMQ processes a job on one consumer at a time; a stall re-delivery only happens after the original's lock is presumed dead, so the two executions do not normally overlap. In the pathological false-stall overlap (#460's trigger), the count could be ±1 — acceptable for a **diagnostic** counter, and the actual *data* path is already guarded by #460's advisory lock. B is available with no schema change if concurrent counting ever matters, but it forces a raw SQL expression into the generic `update` patch, which A avoids.

### Decision 4 — When to display it

**A. Always** — a `"Lost executions: 0"` row on every job. **B. Only when `> 0`.**

**Lean: B.** Zero is the overwhelming common case; a row that appears only when nonzero *is* the signal — it stands out exactly when an operator needs it, and keeps the metadata list clean otherwise.

## Tradeoff comparison

| | D1: detect in worker | D2: real column | D3: read-then-write | D4: show when >0 |
|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes |
| New infrastructure | No | No (one column) | No | No |
| Touches a contract | No | Yes (Zod + table) | No | No |

## Recommendation

1. At the top of the worker processor, read the job row once; if `status === "active"`, include `lostExecutions: row.lostExecutions + 1` in the `active` transition patch (else leave it untouched). Wrap the pre-read so a read failure logs and proceeds without incrementing — a diagnostic must never sink a real job.
2. Add `lostExecutions` to `JobEventsService.transition`'s patch whitelist.
3. Add `lost_executions integer not null default 0` to the `jobs` Drizzle table and `lostExecutions: z.number()` to `JobSchema`; generate migration `0083` via `db:generate`.
4. Render a `Lost executions: N` row in `JobDetail.view.tsx`, only when `job.lostExecutions > 0`.
5. Extend `jobs.worker.retry.test.ts` to drive the active-transition path with a pre-existing `active` row and assert the increment (and that a `pending`/fresh row does **not** increment).
6. Update the "Async Job State & Data Locking" paragraph in `CLAUDE.md` (and its `.github/copilot-instructions.md` mirror) to reflect the landed fix — remove the "until #464 lands" hedge.

## Open questions

1. **Does the SSE `JobUpdateEvent` need `lostExecutions`?** The view reads it off the fetched `job`, and the `.root` invalidation on completion refetches. **Lean: no.** The value is read after the fact; keep it off the event payload (which carries no ids/user text) and off the live-stream merge in `JobDetail`.
2. **Should the pre-read reuse an existing row load?** The processor doesn't currently read the row (only `bullJob.data`). **Lean: add one `findById`** at the top — one indexed SELECT per execution is negligible against the work a sync does.
3. **Does the `worker.on("failed")` handler need any change?** No — it fires on genuine failures (which already record via `attempts`/`error`); the lost-execution count is picked up by the *next* execution's start. The two are complementary. **Lean: leave it.**

## Enterprise-scale considerations

- **Concurrency & correctness.** Single-active-consumer makes read-then-write safe; the false-stall overlap yields at most ±1 on a diagnostic counter, and the data path is separately protected by #460's advisory lock. `Lean: read-then-write` (Decision 3).
- **Accuracy & auditability.** This ticket *is* an auditability fix — the column is the durable record that an execution was lost, on the row an operator already reads. `Lean: real column` (Decision 2).
- **Failure modes.** Fail-open on the diagnostic: if the pre-read throws, log and proceed with the active transition without incrementing. Losing a *count* must never cost a real execution. `Lean: fail-open`.
- **Scale & unbounded growth.** One extra SELECT per execution; the counter is bounded by `maxStalledCount` re-deliveries per job. No fan-out, no unbounded growth. `Lean: bounded`.
- **Contract stability.** Additive `NOT NULL DEFAULT 0` column — existing rows read 0, the required Zod field is satisfied, no call site re-plumbs. `Lean: additive`.
- **Multi-tenancy.** `N/A` — a per-job field, no cross-org surface.
- **Data lifecycle.** `N/A` — lives on the `jobs` row and is purged with it under the row's own retention.

## What this doesn't decide

- **Reconciling deaths that never come back** (fix direction 2 in the ticket — a maintenance job comparing `jobs` rows to BullMQ state). Out of scope: it adds a scheduler and polling interval, catches only the never-recovers case that #391 may already own, and this ticket's evidence is a re-delivery, which start-time detection covers directly.
- **Surfacing `lostExecutions` in the jobs *list*** or in alerting. Out of scope — the detail view is where a sync is diagnosed; a list badge is a separate, additive follow-up if it's ever wanted.
- **Changing what `attempts` means.** It stays "BullMQ attempt", rendered `N / max`. Executions get their own field rather than overloading it.

## Next step

`docs/LOST_EXECUTION_RECORDING.spec.md` (the contract: the column, the model field, the detection rule, the display rule) then `docs/LOST_EXECUTION_RECORDING.plan.md`. The plan slices roughly as: (1) schema — column + model + migration + type-guards green; (2) worker detection + `transition` whitelist + unit tests; (3) `JobDetail` display; (4) doc-sync (CLAUDE.md + copilot mirror). Each slice is an independently testable commit.
