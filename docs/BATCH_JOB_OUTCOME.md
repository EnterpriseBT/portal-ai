# Batch job outcome — Condensed design (#410)

**Issue:** [EnterpriseBT/portal-ai#410](https://github.com/EnterpriseBT/portal-ai/issues/410) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** A `bulk_geocode` job that geocoded **0 of 10** rows reported `Completed`. Every row's work sits inside a per-row `try/catch`, so the terminal status reflects *"the loop did not throw"* rather than the outcome — a total provider outage is externally indistinguishable from complete success. That is not hypothetical: it is why **app-dev's geocoding was broken indefinitely with nobody noticing**, and it took a smoke check written specifically to distrust job status to surface it.

The ticket was filed against `bulk_geocode`. The survey found the defect is **not** geocode-specific, and that fixing it generically is *cheaper* than fixing it once. Packages touched: `@portalai/core` (schemas + classifier), `apps/api` (two processors + the worker).

## Current shape

| Piece | Location | Note |
|---|---|---|
| Terminal status | `apps/api/src/queues/jobs.worker.ts:134-137` | **One choke point.** Every processor's return flows through a hardcoded `transition(jobId, "completed", …)` |
| Batch processors | `bulk-geocode.processor.ts`, `bulk-transform.processor.ts` | The only two of nine with a per-item failure notion; the other seven are all-or-nothing |
| Result schemas | `job.model.ts:355-394`, `:426-441` | **Already duplicated** — both declare `recordsProcessed`, `recordsFailed`, `partialFailures`, `partialFailuresOmitted` |
| `bulk_transform`'s own outcome | `bulk-transform.processor.ts:161,175` | Its only throws are pre-flight (missing `stationId`, tool not found) — never outcome-based, so **it has the same bug** |

**Two callers, one shared defect, and a result shape already copy-pasted twice.** That clears the "no speculative infra" bar: this consolidates something that exists twice, it does not invent a framework for a hypothetical third.

### The trap a naive generic rule falls into

`recordsProcessed` means different things in the two job types that share the name:

| Processor | `recordsProcessed` | Total-failure shape |
|---|---|---|
| `bulk_geocode` | `geocoded + cached + failed` — **attempted** | `{processed: 10, failed: 10}` |
| `bulk_transform` | `+= rowsCommitted` — **committed only** | `{processed: 0, failed: 10}` |

So the obvious rule — `recordsFailed === recordsProcessed` → failed — is correct for geocode and **silently misses transform**, where the equality can never hold. A generic fix built on that field would look like it worked and cover only half the callers.

## Decision — classify at the worker, from an explicit success count

**One shared schema, one classifier, one call site.**

1. **`BatchOutcomeFieldsSchema`** in `job.model.ts`, spread into both per-type result schemas: the four fields they already duplicate, **plus an optional `recordsSucceeded`**. The outcome then follows from the contract rather than from a field whose meaning drifted.

   **Optional, not required — deliberately.** `jobs.result` rows already exist in dev *and* production without this field, and a required member would fail to parse every historical row on the job-details page. So the field is optional and the classifier treats **absence as "cannot tell" → `completed`**: behavior changes only for jobs created after this ships, no backfill is needed, and an old row still renders. The cost is that a batch processor which forgets to set it silently keeps the old behavior — paid for by asserting in each processor's own tests that it is set, which is where a new batch job type would notice.
2. **`classifyBatchOutcome(result)`** — a pure function in core: returns `"failed"` only when `recordsSucceeded` is **present** and `recordsSucceeded === 0 && recordsFailed > 0`; otherwise `"completed"`. **Keyed on the result's shape, not on a job-type allowlist**, so a future batch job type is covered the day it lands and cannot forget to opt in.
3. **`jobs.worker.ts:135`** calls the classifier instead of passing the literal `"completed"`.

**Deliberately not chosen:**

- **Fixing `bulk_geocode` alone** — leaves the identical bug in `bulk_transform` and leaves the duplication.
- **A new `completed_with_errors` status** — the more principled model, but it widens `JobStatus`, and every SSE consumer and frontend `switch` on status becomes a change site. Too wide a blast radius for this bug. *Partial* failure stays `completed`, which is honest: `ADDRESS_UNRESOLVED` on a few rows genuinely is a completed job, and treating it as failure would be its own false alarm.
- **Reconciling `recordsProcessed` to one meaning** — tempting, but geocode's comment ties it to the progress widget's snapshot recovery, so changing it is a frontend-visible change riding along in a bug fix. Add `recordsSucceeded` and leave `recordsProcessed` per-type; note the drift in the schema so nobody builds on it.

## Plan — 2 slices

**Slice 1 — the contract and the classifier (core).**

- **Tests** (`packages/core/src/__tests__/models/job.model.test.ts`, and a new `packages/core/src/__tests__/models/batch-outcome.test.ts`): a result with `recordsSucceeded: 0, recordsFailed: 10` → `"failed"`; `5/5` → `"completed"`; `0/0` (an empty batch — nothing attempted, nothing failed) → `"completed"`; a **non-batch** result (`connector_sync`, `revalidation`) → `"completed"`, untouched; a legacy batch result with `recordsSucceeded` **absent** → `"completed"` (no backfill); both per-type schemas accept it when present. Run; fail.
- **Files** — Edit `packages/core/src/models/job.model.ts` (extract `BatchOutcomeFieldsSchema`, add `recordsSucceeded`, spread into both result schemas). New `packages/core/src/models/batch-outcome.util.ts` (`classifyBatchOutcome`).
- Green, then lint + type-check.

**Slice 2 — populate it and wire the worker (api).**

- **Tests** (extend `apps/api/src/__tests__/queues/bulk-geocode.processor.test.ts` and `apps/api/src/__tests__/queues/processors/bulk-transform.processor.test.ts`; new worker case under `apps/api/src/__tests__/queues/`): `bulk-geocode` sets `recordsSucceeded = geocoded + cached`; `bulk-transform` sets it from committed rows; a worker test asserting an all-failed batch result transitions to **`failed`** and a partial one to `completed`. Run; fail.
- **Files** — Edit both processors (set `recordsSucceeded`); edit `jobs.worker.ts:135` to classify.
- Green, then `npm run lint && npm run type-check`.

**Cross-slice note:** the `bulk_transform` SSE notification at `jobs.worker.ts:85-104` takes an explicit `status` argument — check it receives the classified value, not a second hardcoded `"completed"`.

## Smoke (manual, against your dev stack)

1. **app-dev's Mapbox token still carries the URL restriction** that made prod fail — so app-dev is a live total-failure fixture. Run a bulk geocode there: the job must now end **`failed`**, not `Completed`.
2. Remove the restriction, re-run: the job ends `completed` with coordinates in `entity_records`.
3. A batch with *some* bad addresses ends **`completed`** with `recordsFailed > 0` — partial failure is not a failed job.
4. A `bulk_transform` where every target rejects ends **`failed`**.
5. A `connector_sync` and a `revalidation` still end `completed` exactly as before — the seven non-batch types are unaffected.

## Out of scope

- **`completed_with_errors`** as a status (see Decision).
- Reconciling `recordsProcessed`'s two meanings — noted in the schema, not changed here.
- Alerting built on job outcomes. Worth having, but only once the status is trustworthy; that is this ticket.
- Removing app-dev's Mapbox URL restriction — an operator action, and useful as a fixture for step 1 first.
