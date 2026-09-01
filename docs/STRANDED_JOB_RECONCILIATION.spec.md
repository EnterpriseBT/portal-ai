# Stranded-job reconciliation — Spec

**Issue:** [EnterpriseBT/portal-ai#391](https://github.com/EnterpriseBT/portal-ai/issues/391) · **Discovery:** `docs/STRANDED_JOB_RECONCILIATION.discovery.md`

Pins the contract for reconciling `jobs` rows stranded non-terminal by a Redis keyspace loss: a conditional terminal transition, a sweep whose predicate is **BullMQ absence ∧ heartbeat staleness**, boot + in-process-interval wiring (deliberately not the maintenance queue), and the lock alert's age + stuck-hint surface.

## Key decisions (flag for review)

1. **Stranded ⇔ absence ∧ staleness** — `queue.getJob(bullJobId)` missing AND `COALESCE(updated, created)` older than the threshold. Absence alone reaps under a live zombie executor; staleness alone false-positives non-heartbeating types.
2. **Boot pass + in-process `setInterval`, not the maintenance queue** — the repeatable scheduler lives in the keyspace whose loss it would repair.
3. **Reaped → `failed`** with a fixed greppable reason, via a new **conditional** transition that never overwrites a terminal row (concurrent sweeps / zombie completions / user cancels all converge).
4. **Fail-open on every dependency**: a `getJob` throw or DB error skips the row/pass — absence must be positively observed; never reap on error. The SSE publish inside the conditional transition is best-effort (Redis may be the thing that is down).
5. **`awaiting_confirmation` is excluded** — its BullMQ entry is legitimately absent while the user decides.
6. **Surface regardless**: the lock alert renders "started X ago" (already required by the Async-Job rules, already in `RunningJobSummary`) and a "may be stuck" link to the job detail view past a hint threshold.

## Scope

### In scope
1. `JobEventsService.transitionIfNonTerminal` — the conditional terminal write (`apps/api`).
2. `JobsRepository.findStrandedCandidates` — the sweep's candidate query (`apps/api`).
3. `JobReconciliationService.sweepStrandedJobs` + the `STRANDED_JOB_REASON` constant (`apps/api`, new service).
4. Boot + interval wiring in `index.ts`; two env vars + `.env.example` entries.
5. Web: `relative-time.util.ts` (`formatAgo`) + `ConnectorInstanceLockAlertUI` age line and stuck hint.

### Out of scope
Operator CLI command · `awaiting_confirmation` abandonment policy · adding heartbeats to `sql_query`/`dissolve_precompute`/`bulk_transform` · removing the dead `stalled` status · admin-surface visibility for the sweep (structured log only; revisit if wanted) · #383 infra.

## Surface

### `JobEventsService.transitionIfNonTerminal` — `apps/api/src/services/job-events.service.ts`

New method beside `transition` (`:63`), same `patch` type:

```ts
/**
 * Like `transition`, but applies ONLY while the row is still non-terminal
 * (#391). Returns `true` when this call performed the transition, `false`
 * when a terminal status already stood — in which case nothing is written
 * and no event is published. The SSE publish on the true path is
 * best-effort: Redis may be the dependency whose failure triggered the
 * caller, and the row is the record of truth.
 */
static async transitionIfNonTerminal(
  jobId: string,
  status: JobStatus,
  patch: Parameters<typeof JobEventsService.transition>[2] = {}
): Promise<boolean>
```

Semantics: build `dbPatch` exactly as `transition` does (always `updated`; `startedAt` on `active`; `completedAt` on `completed|failed`), then `DbService.repository.jobs.updateWhere(and(eq(jobs.id, jobId), notInArray(jobs.status, TERMINAL_JOB_STATUSES)), dbPatch)` (`base.repository.ts:294` — returns the updated rows). Empty result → `false`, no publish. Non-empty → publish the same `JobUpdateEvent` shape `transition` publishes, wrapped in try/`logger.warn` (a publish failure still returns `true`).

### `JobsRepository.findStrandedCandidates` — `apps/api/src/db/repositories/jobs.repository.ts`

```ts
/** Non-terminal rows (excluding awaiting_confirmation — its BullMQ entry is
 *  legitimately absent while the user decides, #391) whose last write is
 *  older than `olderThanMs`. `COALESCE(updated, created)` because a pending
 *  row that was never transitioned has `updated = NULL`. */
async findStrandedCandidates(
  olderThanMs: number,
  limit: number,
  client: DbClient = db
): Promise<JobSelect[]>
```

`WHERE status IN ('pending','active','stalled') AND COALESCE(updated, created) < ${olderThanMs}` + `notDeleted()`, `LIMIT ${limit}`, ordered by `created` (oldest first).

### `JobReconciliationService` — `apps/api/src/services/job-reconciliation.service.ts` (new)

```ts
/** Fixed, greppable reason string written to reaped rows. */
export const STRANDED_JOB_REASON =
  "Stranded: the queue no longer holds this job (Redis data loss); marked failed by the reconciliation sweep.";

export interface StrandedSweepSummary {
  scanned: number;  // candidates matching the staleness predicate
  reaped: number;   // transitioned to failed by this pass
  skipped: number;  // getJob threw, or the conditional write lost the race
}

export class JobReconciliationService {
  static readonly MAX_REAP_PER_PASS = 200;
  static async sweepStrandedJobs(): Promise<StrandedSweepSummary>;
}
```

Per candidate from `findStrandedCandidates(now − environment.JOB_STRANDED_THRESHOLD_MS, MAX_REAP_PER_PASS)`:

- `bullJobId === null` → stranded (the insert→enqueue window is far shorter than the threshold).
- else `await getJobsQueue().getJob(bullJobId)`: **exists → not stranded** (long-running, counted in `scanned` only); **`undefined` → stranded**; **throws → `skipped++`** (fail-open: absence must be positively observed).
- Stranded → `transitionIfNonTerminal(id, "failed", { error: STRANDED_JOB_REASON })`; `true` → `reaped++`, `false` → `skipped++`.

Ends with one structured log line carrying the summary; returns it. The service header records the zombie-executor rationale for the conjunction predicate and the `awaiting_confirmation` exclusion.

### Environment — `apps/api/src/environment.ts` + `apps/api/.env.example`

```ts
JOB_STRANDED_THRESHOLD_MS: parseInt(process.env.JOB_STRANDED_THRESHOLD_MS || String(15 * 60 * 1000), 10),
JOB_STRANDED_SWEEP_INTERVAL_MS: parseInt(process.env.JOB_STRANDED_SWEEP_INTERVAL_MS || String(5 * 60 * 1000), 10),
```

Both documented in `.env.example` (the env-parity guard is a required CI check, learned on #453).

### Boot + interval wiring — `apps/api/src/index.ts`

Inside `start()` beside the existing fire-and-forget sweeps (`:53-70`): one immediate `JobReconciliationService.sweepStrandedJobs()` with `.then(log)/.catch(warn)`, plus `setInterval(...)` at `JOB_STRANDED_SWEEP_INTERVAL_MS` running the same call (each tick `.catch`-logged), with `.unref()` so the timer never holds the process open. Multi-instance safety comes from the conditional transition, not coordination.

### Web — relative time + lock alert

**`apps/web/src/utils/relative-time.util.ts`** (new):

```ts
/** Coarse "started X ago" buckets: "just now" (<60s), "N min ago", "N h ago", "N d ago". */
export function formatAgo(epochMs: number, nowMs?: number): string;
```

**`apps/web/src/components/ConnectorInstanceLockAlert.component.tsx`** — props unchanged (`runningJobs: RunningJobSummary[]`; `startedAt`/`created` already ride the summary). Render changes:

- Each job gets a line: `<label> — started <formatAgo(startedAt ?? created)>` (satisfies the Async-Job rules' "started X ago" requirement; today only the joined labels render).
- Module constant `STALE_JOB_HINT_MS = 15 * 60 * 1000` (deliberately not plumbed from the backend — a hint, not a contract; discovery Q4). When a job's age exceeds it, that job's line appends: "— this job may be stuck. **View job** to check or cancel it." where View job links to `/jobs/${job.id}` (TanStack `Link` with a string-literal `to`, `MuiLink component="span"` per the routing rules) — the detail view already carries the Cancel affordance (`JobDetail.view.tsx:71-83`).
- The closing copy softens from a promise to a report: keep "…paused until {it finishes}" but only claim auto-refresh, not inevitability, when any job is stale.

Both consumers (ConnectorInstance.view, EntityDetail.view from #453) inherit the change with no wiring edits.

## Migration / Seed

None — no schema change (`updated`, `created`, `bull_job_id`, and every status already exist).

## TDD test plan

Run via npm scripts per package.

### Layer 1 — conditional transition (`apps/api/src/__tests__/services/job-events.service.transition.test.ts`, extend)
1. `transitionIfNonTerminal` on a non-terminal row → writes status/stamps (`completedAt` on `failed`), publishes, returns `true`.
2. On a row already `completed` → returns `false`, row unchanged, **no publish**.
3. Publish throws → still returns `true` (row written; warn logged).
4. Patch semantics match `transition` (error string lands; `updated` bumped).

### Layer 2 — sweep unit (`apps/api/src/__tests__/services/job-reconciliation.service.test.ts`, new — ESM mocks for `DbService`, `jobs.queue`, `job-events.service`)
5. Candidate with missing Bull entry → reaped with `STRANDED_JOB_REASON`.
6. Candidate with `bullJobId: null` → reaped.
7. Candidate whose Bull entry exists → not reaped (scanned only).
8. `getJob` throws → `skipped`, not reaped (fail-open).
9. Conditional write returning `false` → counted `skipped`.
10. Summary arithmetic (`scanned/reaped/skipped`) and the `MAX_REAP_PER_PASS` cap passed to the finder.

### Layer 3 — integration (`apps/api/src/__tests__/__integration__/services/job-reconciliation.integration.test.ts`, new)
11. Seed an `active` row with a bogus `bullJobId` and stale `updated` → sweep → `failed`, `error = STRANDED_JOB_REASON`, `completedAt` set; `findRunningForConnectorInstance` no longer lists it (the lock actually releases).
12. Fresh `active` row (recent `updated`) → untouched.
13. `awaiting_confirmation` (stale) → untouched.
14. Terminal row → untouched; `transitionIfNonTerminal` on it returns `false`.
15. `pending` row with `updated = NULL` and stale `created` → reaped (the COALESCE path).
16. `findStrandedCandidates` respects the limit and excludes soft-deleted rows.

### Layer 4 — web (`apps/web/src/__tests__/relative-time.util.test.ts` new; `ConnectorInstanceLockAlert.test.tsx` extend)
17. `formatAgo` buckets: <60s, minutes, hours, days.
18. Alert renders "started X ago" per job (fresh job — no stuck hint).
19. Stale job (started >15 min ago) → "may be stuck" line + a link to `/jobs/<id>`.
20. Multiple jobs: only the stale one carries the hint.
21. Existing behavior preserved: empty list renders null; labels join correctly.

**Totals ≈ 21 cases** (4 + 6 + 6 + 5).

## Acceptance criteria

- [ ] After a simulated Redis loss (`FLUSHALL` mid-job), every stranded row reaches `failed` with `STRANDED_JOB_REASON` within threshold + interval (~20 min at defaults), with no restart and no human action; the entity's lock alert clears and its mutations re-enable.
- [ ] A worker restart alone (boot pass) reconciles stranded rows without waiting for the interval.
- [ ] Legitimately long-running jobs — heartbeating or not — are never reaped while their BullMQ entry exists; `awaiting_confirmation` rows are never touched.
- [ ] A user cancel, a zombie completion, and the sweep can race in any order; the row ends in exactly one terminal status (first writer wins).
- [ ] The lock alert shows "started X ago" for every running job, and a stuck hint + working link to the job detail (where Cancel lives) once a job passes the hint threshold.
- [ ] The sweep never reaps on error: with Redis unreachable it logs and leaves rows untouched.
- [ ] `npm run lint`, `type-check`, and both suites green; `.env.example` documents both new vars (parity guard passes).

## Risks & rollback

| Risk | Mitigation |
|---|---|
| Reaping a live-but-quiet job (long single batch, no heartbeat) | Conjunction predicate: the Bull entry still exists for a live job regardless of heartbeats — existence is checked per candidate; staleness alone never reaps. |
| Zombie executor completes after the sweep reaped its row | The zombie's own terminal write goes through the unconditional `transition` — it overwrites `failed` with `completed` + result, which is *more* truthful; locks were already released. Documented in the service header. |
| Sweep + cancel + N instances race | `transitionIfNonTerminal`'s guarded `updateWhere` — first terminal writer wins, later writers get `false` (tests 9, 14). |
| Redis flapping during the sweep | `getJob` throw → skip (fail-open, test 8); publish failure tolerated (test 3). |
| Interval keeps the process alive in tests/scripts | `.unref()` on the timer; the service is also directly callable without wiring. |
| Threshold mis-tuned | Both values env-tunable; defaults recorded in `.env.example` with rationale. |

**Rollback:** `git revert` — no migration, no contract change; reaped rows stay `failed` (truthful even post-revert).

## Files touched

**`apps/api`** — new: `services/job-reconciliation.service.ts`, unit + integration tests; edit: `services/job-events.service.ts`, `db/repositories/jobs.repository.ts`, `environment.ts`, `.env.example`, `index.ts`, `__tests__/services/job-events.service.transition.test.ts`.

**`apps/web`** — new: `utils/relative-time.util.ts` + test; edit: `components/ConnectorInstanceLockAlert.component.tsx`, `__tests__/ConnectorInstanceLockAlert.test.tsx`.

No core package changes, no migration, no new dependency.

## Next step

`docs/STRANDED_JOB_RECONCILIATION.plan.md` — likely four slices: (1) `transitionIfNonTerminal` (Layer 1); (2) repository finder + `JobReconciliationService` (Layer 2 + integration 11–16); (3) env + boot/interval wiring; (4) the web surface (Layer 4). Each a green commit on this branch.
