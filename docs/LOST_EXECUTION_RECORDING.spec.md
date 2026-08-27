# Lost-execution recording — Spec

Pins the contract for recording a connector-sync (or any job) execution that was lost to process death and silently re-delivered by BullMQ. Builds on [`LOST_EXECUTION_RECORDING.discovery.md`](./LOST_EXECUTION_RECORDING.discovery.md). Issue: [EnterpriseBT/portal-ai#464](https://github.com/EnterpriseBT/portal-ai/issues/464).

## Key decisions (flag for review)

1. **Detect at execution start, in the worker** (discovery D1). A fresh execution finds its row `pending`; it finds it `active` **only** when a prior execution set it active and died without a terminal/`pending` transition. That is the lost-execution signal, and it's knowable in-process by the execution that resumes.
2. **A real `lost_executions` column** (discovery D2), not `attempts`/`error`/`metadata`. `attempts` is user-facing (`N / max`); `error` would paint a failure on a success; `metadata` is the job's input.
3. **Read-then-write increment** (discovery D3). One `findById` at processor top; `lostExecutions: prior.lostExecutions + 1` in the `active` patch when `prior.status === "active"`. Safe under BullMQ single-active-consumer; ±1 under a pathological false-stall is acceptable for a diagnostic counter (the data path has #460's advisory lock).
4. **Fail-open on the diagnostic.** If the pre-read throws, log and proceed with the normal `active` transition without incrementing — a diagnostic must never sink a real execution.
5. **Display only when `> 0`** (discovery D4).

## Scope

### In scope
- `lost_executions` column on `jobs` (Drizzle + Zod model + migration + type-guards).
- Worker detects a resumed-`active` row and increments it, fail-open.
- `lostExecutions` added to `JobEventsService.transition`'s patch whitelist.
- `JobDetail` renders it when nonzero.
- Doc-sync: the "Async Job State & Data Locking" paragraph in `CLAUDE.md` + `.github/copilot-instructions.md` mirror.

### Out of scope
- A maintenance job reconciling deaths that never recover (ticket fix-direction 2; #391 territory).
- Surfacing the count in the jobs *list* or alerting.
- Any change to the meaning of `attempts` or to `worker.on("failed")`.
- Adding `lostExecutions` to the SSE `JobUpdateEvent` payload (discovery Open Q1).

## Surface

### `apps/api/src/db/schema/jobs.table.ts`
Add after `attempts` (line 52), mirroring its shape:
```ts
lostExecutions: integer("lost_executions").notNull().default(0),
```

### `packages/core/src/models/job.model.ts`
Add to `JobSchema` (after `attempts: z.number()`, line 644), mirroring `attempts` (no Zod default — the DB default fills inserts, every selected row carries it):
```ts
lostExecutions: z.number(),
```

### `apps/api/src/db/schema/zod.ts` / `type-checks.ts`
No edits. `JobSelect`/`JobInsert` are generated from the table; the `IsAssignable` guards at `type-checks.ts:306-316` stay green **iff** the table and model above move together (a compile error if either is missed). `JobInsert.lostExecutions` is optional (column has a default), so existing insert-side fixtures are unaffected.

### `apps/api/src/services/job-events.service.ts`
Add `lostExecutions` to the `transition` patch whitelist (the `Partial<{…}>` at lines 66-84):
```ts
lostExecutions: number;
```
No other change — the value flows through `dbPatch` (line 87) to `jobs.update` as-is. It is **not** added to the published `JobUpdateEvent`.

### `apps/api/src/queues/jobs.worker.ts`
In the processor, **before** the opening `active` transition (currently lines 186-196): read the current row via the existing `getDbService()` accessor and, if it is already `active`, carry an incremented count into the transition patch. Fail-open on read error.
```ts
// A row still `active` at the top of an execution means a prior execution
// set it active and died without a terminal/pending transition — a stall
// re-delivery of a lost execution (#464). BullMQ does not increment
// attemptsMade on a re-delivery, so nothing else records it.
let lostExecutionsPatch: { lostExecutions?: number } = {};
try {
  const DbService = await getDbService();
  const prior = await DbService.repository.jobs.findById(jobId);
  if (prior?.status === "active") {
    lostExecutionsPatch = { lostExecutions: prior.lostExecutions + 1 };
  }
} catch (readErr) {
  // Fail-open: a diagnostic read must never sink a real execution.
  logger.error({ jobId, err: readErr }, "Lost-execution pre-read failed");
}

await JobEventsService.transition(jobId, "active", {
  progress: 0,
  error: null,
  attempts: (bullJob.attemptsMade ?? 0) + 1,
  ...lostExecutionsPatch,
});
```
`worker.on("failed")` (lines 299-327) is unchanged — it records genuine failures; the lost-execution count is picked up by the next execution's start.

### `apps/web/src/views/JobDetail.view.tsx`
In the `MetadataList` `items` array (after the `Attempts` item, line 108-111), append a conditional item read straight off the fetched `job` (not the live stream):
```ts
...(job.lostExecutions > 0
  ? [{ label: "Lost executions", value: String(job.lostExecutions) }]
  : []),
```

## Migration
`cd apps/api && npm run db:generate -- --name add-jobs-lost-executions` → `apps/api/drizzle/0083_*.sql` containing:
```sql
ALTER TABLE "jobs" ADD COLUMN "lost_executions" integer DEFAULT 0 NOT NULL;
```
Additive, non-breaking. **No backfill** — existing rows genuinely have no recorded lost executions, and `0` is the correct value. Applied with `npm run db:migrate` (CI: `db:migrate:ci`). Never hand-number the file; `db:generate` emits it and the journal entry.

## Seed
None — not a per-org seeded row.

## TDD test plan

### `apps/api/src/__tests__/queues/jobs.worker.retry.test.ts` (extend)
New `describe("lost-execution recording (#464)")`. The suite already mocks `bullmq`, `JobEventsService.transition` (`mockTransition`), and `DbService.repository.jobs.findById` (`mockFindById`); drive the captured processor `handler` and assert on `openingCall()` (the `active` transition patch):
- **resumes an `active` row → increments**: `mockFindById` → `{ status: "active", lostExecutions: 0 }`; opening patch has `lostExecutions: 1`.
- **carries a prior count forward**: `{ status: "active", lostExecutions: 2 }` → opening patch `lostExecutions: 3`.
- **fresh `pending` row → no increment**: `{ status: "pending", lostExecutions: 0 }` → opening patch has **no** `lostExecutions` key.
- **missing row → no increment**: `mockFindById` → `undefined` → no key (guards the happy path where the row isn't found).
- **read failure fails open**: `mockFindById` rejects → processor still completes, opening `active` transition still fires, **no** `lostExecutions` key, no throw.

### `packages/core/src/__tests__/models/job.model.test.ts` (extend)
- `JobSchema` requires `lostExecutions` (a valid job object parses; omitting it fails `safeParse`). Add `lostExecutions: 0` to any existing job fixture in this file.

### `apps/web/src/__tests__/JobDetailView.test.tsx` (extend)
- Renders `Lost executions: N` when `job.lostExecutions > 0`.
- Does **not** render the row when `job.lostExecutions === 0`.
- Add `lostExecutions: 0` to the existing `Job` fixture(s) so they typecheck.

### Migration
No dedicated test — additive schema-only change; drift is caught by the `type-checks.ts` compile guard.

**Totals ≈ 9 cases** (5 worker + 1 model + 3 view) plus fixture updates.

## Acceptance criteria

- [ ] A job re-executed after its prior execution was killed mid-run reports `lostExecutions ≥ 1`; the DB row holds evidence the execution was redone.
- [ ] `attempts` still renders `N / max` and is unchanged by a re-delivery.
- [ ] A normally-run or normally-retried job reports `lostExecutions === 0`.
- [ ] `JobDetail` shows a `Lost executions` row only when the count is nonzero.
- [ ] A pre-read failure does not fail or stall the job; the `active` transition still fires.
- [ ] `npm run build`, `npm run type-check`, `npm run lint` pass (the dual-schema type-guards prove table ↔ model agreement).
- [ ] `CLAUDE.md` + `.github/copilot-instructions.md` no longer say "until #464 lands".

## Risks & rollback

- **Extra SELECT per execution.** One indexed `findById` at the top of every job. Negligible against sync work; bounded, no fan-out.
- **False-stall overlap miscount.** Two overlapping executions could yield ±1 on the counter. Fail mode is **fail-safe/inaccurate-by-one on a diagnostic**, never data loss — the data path is guarded by #460's advisory lock. Acceptable per Key decision 3.
- **Required Zod field.** `lostExecutions: z.number()` makes it required on `Job`; any object literal typed as `Job` (test fixtures) must add it. Caught at compile time by the type-guards and `type-check`, not at runtime.
- **Rollback**: revert the branch; the additive column can be left in place (unused) or dropped with a follow-up migration — no data depends on it.

## Files touched
- `apps/api/src/db/schema/jobs.table.ts` — column
- `packages/core/src/models/job.model.ts` — `JobSchema` field
- `apps/api/src/services/job-events.service.ts` — patch whitelist
- `apps/api/src/queues/jobs.worker.ts` — pre-read + increment
- `apps/api/drizzle/0083_*.sql` — migration (generated)
- `apps/web/src/views/JobDetail.view.tsx` — display
- `apps/api/src/__tests__/queues/jobs.worker.retry.test.ts` — worker tests
- `packages/core/src/__tests__/models/job.model.test.ts` — model test + fixture
- `apps/web/src/__tests__/JobDetailView.test.tsx` — view tests + fixture
- `CLAUDE.md`, `.github/copilot-instructions.md` — doc-sync

## Next step
`docs/LOST_EXECUTION_RECORDING.plan.md` (`/plan 464`) on this same branch, slicing into ≈4 testable commits: (1) schema — column + model + migration, type-guards/build green; (2) worker detection + `transition` whitelist + worker/model tests; (3) `JobDetail` display + view tests; (4) doc-sync.
