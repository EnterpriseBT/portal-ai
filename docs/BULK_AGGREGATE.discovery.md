# bulk_aggregate — fold across N records to a single value — Discovery

**Issue:** [EnterpriseBT/portal-ai#100](https://github.com/EnterpriseBT/portal-ai/issues/100)

**Why this exists.** Some agent tasks ask for a single value computed across a large dataset — "total acreage of all parcels," "average diameter across all NEOs." Today the agent either runs an inline `sql_query` (blocks its turn until the query returns) or chains `bulk_transform` → `sql_query` (writes a derived column it doesn't want, needs a throwaway target entity). Neither fits "compute one number async without persisting anything."

This is the primitive that folds N source records down to a scalar (or small object) on the jobs queue, persists the value in the job's terminal envelope, and never writes to a target entity. It is primitive #3 of the five named in [`LARGE_DATA_OPS_GENERALIZATION.discovery.md`](./LARGE_DATA_OPS_GENERALIZATION.discovery.md) — that doc's Decision 5 already fixed its output as scalar-or-small-object (many-result outputs compose via `bulk_transform` into a side entity + `bulk_query`), and its Decision 4 already leaned "reads don't lock." This doc inherits both and decides the rest.

## The current shape

`bulk_aggregate` is a near-sibling of `bulk_transform`: same tool→route→job→processor spine, minus the target-write half. Everything below already exists.

### Toolpack registration

| Concern | Location |
|---|---|
| Toolpack wire contract (`name`, `description`, `parameterSchema`) | `packages/core/src/contracts/toolpack.contract.ts:1-88` |
| `ALL_TOOL_PACKS` + `BUILTIN_TOOL_NAMES` registry | `apps/api/src/services/tools.service.ts:153-223` |
| `buildAnalyticsTools()` — instantiates each tool when `data_query` is enabled | `apps/api/src/services/tools.service.ts:408-497` |
| Tool definition pattern (`slug`, `schema` getter, `build()` → `ai.tool`) | `apps/api/src/tools/sql-query.tool.ts:13-20`; `apps/api/src/tools/bulk-transform-entity-records.tool.ts` |

A new tool adds a class, registers its slug in `BUILTIN_TOOL_NAMES`, and is instantiated in `buildAnalyticsTools()` under the `data_query` pack.

### `bulk_transform` end-to-end — the template to mirror

| Stage | Location |
|---|---|
| Tool (input schema, pre-flight EXPLAIN, cost-ack, enqueue) | `apps/api/src/tools/bulk-transform-entity-records.tool.ts` |
| Service (`explainExpression`, `fetchSourceBatch` w/ `whereSqlFragment`, UPSERT) | `apps/api/src/services/bulk-transform.service.ts:74-97` |
| Expression union (`sql` / `tool`, both carry `writes[]`) | `packages/core/src/models/job.model.ts:301-316` |
| Metadata + result schemas | `packages/core/src/models/job.model.ts:321-393` |
| Processor (dispatches to `runToolDispatchLoop` / `runSqlBatchLoop`) | `apps/api/src/queues/processors/bulk-transform.processor.ts:37-98` |
| Per-record tool fan-out (`dispatchBatch`) | `apps/api/src/queues/processors/bulk-transform-tool.dispatcher.ts:94-170` |

**Critical detail for the fold:** `dispatchBatch` runs records **in parallel** — `Promise.allSettled` over the batch behind a `pLimit(maxConcurrency)` (`bulk-transform-tool.dispatcher.ts:106-143`). Each call is independent; order doesn't matter; failures are collected per-row and the row is skipped. A fold is the opposite: `(accumulator, row) → accumulator` is **sequential and stateful** — call K+1 needs call K's output. The dispatcher cannot be reused for `fold_tool` as-is; this is the central design decision below.

### Jobs queue + worker + envelope persistence

| Concern | Location |
|---|---|
| BullMQ `async-jobs` queue | `apps/api/src/queues/jobs.queue.ts:1-18` |
| Processor registry (one handler per job type) | `apps/api/src/queues/processors/index.ts:1-24` |
| Worker → `JobEventsService.transition(status, { result })` | `apps/api/src/queues/jobs.worker.ts:118-198` |
| Terminal `result` patched onto the job row + Redis pub/sub | `apps/api/src/services/job-events.service.ts:63-97` |
| `TERMINAL_JOB_STATUSES` (`completed`/`failed`/`cancelled`) | `packages/core/src/models/job.model.ts:31-35` |

The terminal envelope's `result` field is already `z.record(...).nullable()` on the job row (`job.model.ts:470`) — persisting `{ result, recordsProcessed, durationMs }` needs no schema change to the row, only a new per-type `ResultSchema`.

### Job model — adding a type

`JobTypeEnum` (`job.model.ts:37-44`), `JobTypeMap` (`:405-424`), and `JOB_TYPE_SCHEMAS` (`:430-460`) are the three touchpoints; the JSDoc at `:397-403` spells out the exact four-step recipe. TypeScript fails the build if any of the three is left incomplete.

### Data-locking

`JobLockService` (`apps/api/src/services/job-lock.service.ts:1-99`) + `jobs.repository.ts:59-93` match non-terminal jobs by JSON-extracting lock keys from metadata (`metadata->>'connectorInstanceId'`, or `?|` array-overlap on `targetConnectorEntityIds`). Note `bulk_transform`'s own metadata comment: *"sourceConnectorEntityId: Source entity to scan; read-only during the job, **no lock**"* (`job.model.ts:322-323`). Aggregate has no target at all, so it declares no write-lock keys.

### Smoke doc

`docs/LARGE_DATA_OPS.smoke.md` runs §1 (read path) → §2 (SQL transform) → §3 (locking/cancel) → §4 (tool-dispatch) → §5 (post-conditions). The new aggregate walk slots in as a new section mirroring §2 (SQL kind) + §4 (tool kind) structure.

## The design space

### Decision 1 — `fold_tool` execution: sequential fold vs. parallel map-reduce

The `(acc, row) → acc` contract is sequential. But sequential over a 100k-row entity, one tool call at a time, is slow.

- **A — Sequential fold.** Thread the accumulator through one call at a time, batch-by-batch, in key order. Matches the issue's contract verbatim. A new `fold` loop in the processor (not `dispatchBatch`), with no concurrency.
- **B — Parallel map-reduce.** Require the agent to supply an associative `combine(a, b)` alongside the per-row map; fan out the map with the existing dispatcher, reduce pairwise. Fast, but changes the issue's contract, doubles the schema, and pushes associativity correctness onto the agent.
- **C — SQL-only for high-N; fold capped.** Keep fold sequential (A) but cap its source count at a modest N (e.g. 50k) at pre-flight; tell the agent to use `kind:"sql"` for larger sets.

| | A: sequential | B: map-reduce | C: sequential + cap |
|---|---|---|---|
| Matches issue contract | Yes | No (needs `combine`) | Yes |
| Throughput at 1M rows | Poor | Good | N/A (rejected at pre-flight) |
| Schema complexity | Low | High | Low |
| Correctness burden on agent | None | Associativity | None |

**Lean: A, with C's cap as a guardrail.** The SQL path already covers high-N numeric aggregates fast; `fold_tool` exists for *domain-specific reducers* (the agent has a JS/tool reducer SQL can't express), where N is typically moderate. Keep it sequential and correct, cap source rows at pre-flight with a message pointing to `kind:"sql"` for bigger sets. Map-reduce (B) is a clean follow-up if a real workload needs a large non-SQL fold.

### Decision 2 — Source locking: no lock vs. read-lock

The issue says "reads-only lock on source." The parent generalization discovery (Decision 4) and `bulk_transform`'s own metadata both say **reads don't lock** — source is scanned read-only, no lock acquired.

- **A — No lock.** Consistent with `bulk_transform` and `bulk_query`. A concurrent write to the source mid-aggregate just means the number reflects rows as they were read (batch-cursor snapshot-ish).
- **B — Read-lock the source.** Block writes to the source entity while aggregating so the number is a clean snapshot. Requires a new lock-key class (`sourceConnectorEntityId` as a *read* key) and a reader/writer distinction the lock service doesn't have today.

| | A: no lock | B: read-lock |
|---|---|---|
| Consistency with shipped primitives | Matches transform/query | Diverges |
| New lock machinery | None | Reader/writer lock classes |
| Result determinism under concurrent writes | Best-effort | Strong |

**Lean: A (no lock) — reconcile the issue toward its parent doc.** The issue's "reads-only lock" wording predates the generalization discovery's explicit "reads don't lock" call. Introducing a reader/writer lock distinction for one primitive is disproportionate, and no shipped primitive locks on read. Flag this in the issue/spec as an intentional reconciliation. (See Open Question 1.)

### Decision 3 — `fold_tool` failure semantics: abort vs. skip

`bulk_transform` collects a failed row as a `partialFailure` and **skips** it — fine, because each row's write is independent. A fold is stateful: silently skipping row K still produces a number, but it's a *wrong* number the agent can't detect.

- **A — Abort on first failure.** Fail the job; envelope carries the failing `sourceKey` + error. The agent sees an explicit failure, not a quietly-wrong total.
- **B — Skip + report.** Continue folding, collect `partialFailures[]`, surface `recordsFailed`. Resilient but the `result` silently excludes failed rows.
- **C — Agent picks** via `onError: "abort" | "skip"` (default `abort`).

**Lean: A for v1 (abort).** A fold's result is meaningless if an arbitrary subset was dropped without the agent knowing. Strictness is the safe default; C's opt-in skip is a cheap follow-up if a use case wants it. (Contrast: the SQL kind can't partially fail — it's one query that either returns or errors.)

### Decision 4 — `recordsProcessed` for the SQL kind

`fold_tool` counts rows folded naturally. The SQL kind returns one aggregate row, so `recordsProcessed` isn't `1` — it's the number of source rows the aggregate scanned.

- **A — Inject `COUNT(*) AS __records_processed`** into the projection alongside the agent's expression. One query, exact count.
- **B — Separate `SELECT COUNT(*)`** with the same WHERE. Two queries; simpler to compose but races a concurrent write.

**Lean: A.** One query, atomic count, no second round-trip. The processor strips `__records_processed` out of the `result` object before persisting so the envelope carries only the agent's aggregate.

## Tradeoff comparison

|  | D1: sequential fold | D2: no lock | D3: abort on failure | D4: COUNT injection |
|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes |
| Diverges from issue text | No | **Yes** (issue says "lock") | No | No |
| New infra vs. mirror transform | Mirror | Mirror | Mirror | Mirror |

## Recommendation

1. Add `bulk_aggregate` to `JobTypeEnum`, with `BulkAggregateMetadataSchema` (`sourceConnectorEntityId`, optional `sourceFilter.whereSqlFragment`, `aggregator` discriminated union of `{kind:"sql", expression}` and `{kind:"fold_tool", ref, args?, initial}`, optional `acknowledgeCost`, `batchSize`) and `BulkAggregateResultSchema` (`result: z.unknown()`, `recordsProcessed`, `durationMs`, optional failure fields). Wire `JobTypeMap` + `JOB_TYPE_SCHEMAS`.
2. New `BulkAggregateEntityRecordsTool` (`data_query` pack): pre-flight EXPLAINs the SQL expression / validates the fold tool is registered + bulk-dispatchable, runs the cost-ack gate for metered/expensive fold tools, enqueues the job. No target-entity / `writes[]` validation.
3. New `bulk-aggregate.processor.ts`: `kind:"sql"` runs one org-scoped `SELECT {expression}, COUNT(*) AS __records_processed FROM {sourceTable} WHERE <org guard> [AND {whereSqlFragment}]`; `kind:"fold_tool"` runs a **sequential** fold loop over source batches, threading `initial` → accumulator, aborting on first per-record failure. Reuse `bulk-transform.service`'s `fetchSourceBatch` + org-scope guard; do **not** reuse the parallel `dispatchBatch`.
4. Source is **not** locked (Decision 2); no `targetConnectorEntityIds` in metadata.
5. Terminal envelope `{ result, recordsProcessed, durationMs }` persists via the existing `JobEventsService.transition` path — no job-row schema change.
6. Add the aggregate walk as a new section of `docs/LARGE_DATA_OPS.smoke.md` (total NEO count via SQL; sum-of-diameters via fold tool), mirroring §2 + §4.

## Open questions

1. **Issue text vs. parent doc on source locking.** Issue #100 says "reads-only lock on source"; the generalization discovery says reads don't lock. **Lean: no lock** — reconcile toward the parent doc and the shipped convention; call it out explicitly in the spec so the divergence from the issue body is intentional and reviewed, not silent.
2. **Fold result size cap.** A `fold_tool` could accumulate an unbounded structure (agent folds rows into a growing array) that bloats the job row. **Lean: cap the serialized `result` at a fixed size (reuse `bulk_apply`'s 10MB-class cap from the generalization doc); if exceeded, fail the job with a clear message rather than persisting a giant row.**
3. **Does `fold_tool` need bounded concurrency at all?** Sequential means `maxConcurrency:1` effectively. **Lean: yes, sequential — but keep the per-call timeout from `dispatchBatch` so one hung tool call fails the job instead of stalling it forever.**
4. **`initial` validation.** `initial: unknown` can't be type-checked against the (unknown) accumulator shape. **Lean: pass it through unvalidated; it's the agent's contract with its own fold tool, and pre-flight can't know the reducer's type.**
5. **Cost gate for the SQL kind.** SQL aggregates are one cheap query — does the cost-ack gate apply? **Lean: no for `kind:"sql"` (one query, near-instant); yes for `kind:"fold_tool"` when the tool declares `costHint: metered|expensive`, reusing the existing `acknowledgeCost` path.**

## What this doesn't decide

- **Parallel map-reduce fold (Decision 1B).** Deferred — no current workload needs a large non-SQL fold; revisit if one appears. Adding `combine` later is additive to the `fold_tool` variant.
- **`onError: skip` for folds (Decision 3C).** Deferred behind the strict-abort default; cheap to add when a use case wants partial folds.
- **Streaming N-results / per-group regression.** Out of scope by the parent doc's Decision 5 — those compose via `bulk_transform` into a side entity + `bulk_query`. `bulk_aggregate` stays scalar-or-small-object.
- **Frontend surfacing.** The aggregate's terminal value is read by the agent from the envelope; whether a `BulkJobProgressBlock`-style widget should also render the scalar inline is a separate UI ticket.

## Next step

Write `docs/BULK_AGGREGATE.spec.md` (the metadata/result Zod contracts, the SQL + fold processor algorithms, the pre-flight + cost-ack rules, lock declaration) and `docs/BULK_AGGREGATE.plan.md` (TDD slices). The plan slices roughly as: (1) job-model schemas + type wiring; (2) tool + route pre-flight + enqueue; (3) SQL-kind processor + `__records_processed`; (4) sequential `fold_tool` processor + abort-on-failure + size cap; (5) smoke section + docs. Each slice is independently green-testable, all on this `feat/bulk-aggregate` branch.
