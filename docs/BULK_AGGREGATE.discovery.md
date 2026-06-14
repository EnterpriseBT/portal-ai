# bulk_aggregate — reduce N records to a single value — Discovery

**Issue:** [EnterpriseBT/portal-ai#100](https://github.com/EnterpriseBT/portal-ai/issues/100)

**Why this exists.** Some agent tasks ask for a single value computed across a large dataset — "total acreage of all parcels," "average diameter across all NEOs." Today the agent either runs an inline `sql_query` (blocks its turn until the query returns) or chains `bulk_transform` → `sql_query` (writes a derived column it doesn't want, needs a throwaway target entity). Neither fits "compute one number async without persisting anything."

This is the primitive that reduces N source records down to a scalar (or small object) on the jobs queue, persists the value in the job's terminal envelope, and never writes to a target entity. It is primitive #3 of the five named in [`LARGE_DATA_OPS_GENERALIZATION.discovery.md`](./LARGE_DATA_OPS_GENERALIZATION.discovery.md) — that doc's Decision 5 already fixed its output as scalar-or-small-object (many-result outputs compose via `bulk_transform` into a side entity + `bulk_query`), and its Decision 4 already leaned "reads don't lock." This doc inherits both and decides the rest.

**Tool purity killed `fold_tool` (the issue's proposed second aggregator).** The issue proposed a `fold_tool` aggregator: a tool invoked per record as `(accumulator, row) → accumulator`. That violates [`feedback_tool_purity`](../README.md) — a tool is a pure, record- and data-agnostic function whose output has no inherent relationship to anything else; the *agent* decides what the output means. `fold_tool` bakes the reduction contract *into the tool*: the tool is forced to accept an `accumulator` and return "the next accumulator," so it now knows it is being used in a fold. A reducer is not a tool and must not be smuggled into the toolpack. We considered preserving the use case via a *map (pure tool) + reduce (built-in)* split, but the built-in reducers that keep the tool pure (`sum/avg/min/max/count`) are exactly SQL's aggregate functions — they add nothing over the SQL path. **Decision: `bulk_aggregate` is SQL-only.** Per-row values SQL can't compute (LLM/API/JS) are produced by `bulk_transform` (pure tool → derived column), then aggregated by `bulk_aggregate` SQL over that column — the composition the parent discovery already endorses. This deliberately diverges from the issue's two-aggregator shape down to one.

## The current shape

`bulk_aggregate` is a near-sibling of `bulk_transform`: same tool→route→job→processor spine, but it runs **one SQL query** and writes nothing — no per-record loop, no target entity, no `writes[]`.

### Toolpack registration

| Concern | Location |
|---|---|
| Toolpack wire contract (`name`, `description`, `parameterSchema`) | `packages/core/src/contracts/toolpack.contract.ts:1-88` |
| `ALL_TOOL_PACKS` + `BUILTIN_TOOL_NAMES` registry | `apps/api/src/services/tools.service.ts:153-223` |
| `buildAnalyticsTools()` — instantiates each tool when `data_query` is enabled | `apps/api/src/services/tools.service.ts:408-497` |
| Tool definition pattern (`slug`, `schema` getter, `build()` → `ai.tool`) | `apps/api/src/tools/sql-query.tool.ts:13-20`; `apps/api/src/tools/bulk-transform-entity-records.tool.ts` |

A new tool adds a class, registers its slug in `BUILTIN_TOOL_NAMES`, and is instantiated in `buildAnalyticsTools()` under the `data_query` pack.

### `bulk_transform` end-to-end — the template, and the composition partner

| Stage | Location |
|---|---|
| Tool (input schema, pre-flight EXPLAIN, cost-ack, enqueue) | `apps/api/src/tools/bulk-transform-entity-records.tool.ts` |
| Service (`explainExpression`, `fetchSourceBatch` w/ `whereSqlFragment`, org-scope guard) | `apps/api/src/services/bulk-transform.service.ts:74-97` |
| Metadata + result schemas | `packages/core/src/models/job.model.ts:321-393` |
| Processor (SQL vs tool-dispatch loop) | `apps/api/src/queues/processors/bulk-transform.processor.ts:37-98` |

`bulk_transform` is both the structural template for `bulk_aggregate` (mirror its tool/route/job/processor shape and its EXPLAIN pre-flight) **and** its composition partner: when a per-row value needs a tool, the agent runs `bulk_transform` (pure tool → derived column), then `bulk_aggregate` SQL over that column. `bulk_aggregate` itself never dispatches tools, so it does **not** touch the parallel `dispatchBatch` (`bulk-transform-tool.dispatcher.ts`) at all.

### Jobs queue + worker + envelope persistence

| Concern | Location |
|---|---|
| BullMQ `async-jobs` queue | `apps/api/src/queues/jobs.queue.ts:1-18` |
| Processor registry (one handler per job type) | `apps/api/src/queues/processors/index.ts:1-24` |
| Worker → `JobEventsService.transition(status, { result })` | `apps/api/src/queues/jobs.worker.ts:118-198` |
| Terminal `result` patched onto the job row + Redis pub/sub | `apps/api/src/services/job-events.service.ts:63-97` |
| `TERMINAL_JOB_STATUSES` (`completed`/`failed`/`cancelled`) | `packages/core/src/models/job.model.ts:31-35` |

The job row's `result` is already `z.record(...).nullable()` (`job.model.ts:470`) — persisting `{ result, recordsProcessed, durationMs }` needs no row schema change, only a new per-type `ResultSchema`.

### Job model — adding a type

`JobTypeEnum` (`job.model.ts:37-44`), `JobTypeMap` (`:405-424`), and `JOB_TYPE_SCHEMAS` (`:430-460`) are the three touchpoints; the JSDoc at `:397-403` spells out the four-step recipe. TypeScript fails the build if any is left incomplete.

### Data-locking

`JobLockService` (`apps/api/src/services/job-lock.service.ts:1-99`) + `jobs.repository.ts:59-93` match non-terminal jobs by JSON-extracting lock keys from metadata. `bulk_transform`'s metadata comment is the precedent: *"sourceConnectorEntityId: Source entity to scan; read-only during the job, **no lock**"* (`job.model.ts:322-323`). Aggregate has no target at all and reads only, so it declares no lock keys.

### Smoke doc

`docs/LARGE_DATA_OPS.smoke.md` runs §1 (read path) → §2 (SQL transform) → §3 (locking/cancel) → §4 (tool-dispatch) → §5 (post-conditions). The aggregate walk slots in as a new section mirroring §2's SQL structure.

## The design space

### Decision 1 — Supporting non-SQL aggregation: composition vs. a new tool variant

Resolved in the framing above and confirmed with the issue author: SQL covers every aggregate whose per-row input is a column or a SQL expression over columns. The only gap is aggregating a value SQL can't *produce* (LLM score, external-API result, domain JS).

- **A — Compose.** `bulk_aggregate` is SQL-only. Non-SQL maps go through `bulk_transform` (pure tool → derived column) then `bulk_aggregate` SQL over the column.
- **B — `tool_map` + built-in reducer.** A second aggregator does pure-tool map + worker-owned reduce in one job, no persisted intermediate. Earns its place only when the reducer can't be SQL — but the tool-pure reducers (`sum/avg/min/max/count`) *are* SQL aggregates, so B's marginal value is just "skip the throwaway column."
- **C — `fold_tool`.** Rejected outright: violates tool purity (see framing).

| | A: compose | B: tool_map | C: fold_tool |
|---|---|---|---|
| Tool purity | Preserved | Preserved | **Violated** |
| Adds over SQL | Nothing (SQL only) | Avoids one throwaway column | — |
| Primitive surface | Smallest | +1 aggregator variant | +1 aggregator variant |

**Lean: A (SQL-only + compose)** — selected. Smallest honest primitive; the throwaway-column cost falls on the rare non-SQL-aggregate case, and that path already exists as composition. B is a future addition (additive — a new discriminated `kind`) if persist-free tool aggregation ever becomes a hot path.

### Decision 2 — Source locking: no lock vs. read-lock

The issue says "reads-only lock on source." The parent generalization discovery (Decision 4) and `bulk_transform`'s own metadata both say reads **don't** lock.

| | A: no lock | B: read-lock |
|---|---|---|
| Consistency with shipped primitives | Matches transform/query | Diverges |
| New lock machinery | None | Reader/writer lock classes |
| Determinism under concurrent writes | Best-effort | Strong |

**Decided: A (no lock)** — confirmed with the issue author. No shipped primitive locks on read; introducing a reader/writer distinction for one read-only primitive is disproportionate. The spec flags the divergence from the issue body so it's reviewed, not silent.

### Decision 3 — `recordsProcessed` accounting

The SQL aggregate returns one row, so `recordsProcessed` isn't `1` — it's the number of source rows scanned.

- **A — Inject `COUNT(*) AS __records_processed`** into the projection alongside the agent's expression. One query, atomic count; the processor strips the helper alias out of the persisted `result`.
- **B — Separate `SELECT COUNT(*)`** with the same WHERE. Two queries; races a concurrent write.

**Lean: A.** One query, atomic, no second round-trip.

## Tradeoff comparison

|  | D1: SQL-only + compose | D2: no lock | D3: COUNT injection |
|---|---|---|---|
| Spread to spec | Yes | Yes | Yes |
| Diverges from issue text | **Yes** (drops `fold_tool`) | **Yes** (issue says "lock") | No |
| New infra vs. mirror transform | Mirror (minus writes) | Mirror | Mirror |

## Recommendation

1. Add `bulk_aggregate` to `JobTypeEnum`, with `BulkAggregateMetadataSchema` (`sourceConnectorEntityId`, optional `sourceFilter.whereSqlFragment`, `expression: string` — the SQL aggregate projection) and `BulkAggregateResultSchema` (`result: z.unknown()` — any bounded serializable JSON value; `recordsProcessed`; `durationMs`). Wire `JobTypeMap` + `JOB_TYPE_SCHEMAS`. No `writes[]`, no `targetConnectorEntityIds`, no tool/fold variant.
2. New `BulkAggregateEntityRecordsTool` (`data_query` pack): pre-flight EXPLAINs the aggregate expression (reusing `bulk-transform.service`'s `explainExpression` + org-scope guard); enqueues the job. No target validation, no cost-ack gate (one query).
3. New `bulk-aggregate.processor.ts`: runs one org-scoped `SELECT {expression}, COUNT(*) AS __records_processed FROM {sourceTable} WHERE <org guard> [AND {whereSqlFragment}]`; strips `__records_processed` into `recordsProcessed`; returns the remaining projection as `result`. Postgres scans the wide table in a single pass — large-dataset handling is the DB's job, **not** app-level batching (Decision 4 below). Enforce a result-size cap so an unbounded `ARRAY_AGG`/`JSON_AGG` can't write a multi-MB job row — fail the job with a clear message rather than persisting it.
4. Source is **not** locked (Decision 2); metadata declares no lock keys.
5. Terminal envelope `{ result, recordsProcessed, durationMs }` persists via the existing `JobEventsService.transition` path — no job-row schema change.
6. Add the aggregate walk as a new section of `docs/LARGE_DATA_OPS.smoke.md` (total NEO count + sum-of-diameters, both via SQL), mirroring §2.

### Decision 4 — Why the job wrapper, given it's one query

The motivation is **large-dataset handling, not unblocking the agent's turn** (confirmed with the issue author). A SQL aggregate over a multi-million-row `er__*` wide table can run for seconds-to-minutes; running it inside the agent's request path risks an HTTP/turn timeout and ties up a request connection for the duration. The job wrapper runs the scan off the request path and lets a runaway aggregate be **cancelled mid-flight** — cancel here must cancel the *in-flight query* (`pg_cancel_backend` / connection abort), not merely flip the job row to `cancelled`. A statement timeout is the backstop. SQL still does the heavy lifting in one pass; the wrapper is purely about executing that one heavy query safely and cancellably.

## Resolved (was: open questions)

All three resolved with the issue author; recorded here for the spec.

1. **Source locking.** Issue #100 says "reads-only lock on source"; the parent doc says reads don't lock. **Resolved: no lock** (Decision 2). The spec flags the divergence from the issue body.
2. **Why a job for one query.** **Resolved: large-dataset handling, not agent-turn unblocking** (Decision 4). The aggregate over a huge wide table can run for minutes; the job runs it off the request path and makes the in-flight query cancellable. Cancel must abort the running query, not just the job row; a statement timeout backstops it.
3. **Result value shape.** **Resolved: any bounded serializable JSON value** — scalar, object (multi-alias projection like `SUM(c_area) AS total, AVG(c_age) AS avg_age`), or array (`ARRAY_AGG`/`JSON_AGG`). Aligns with [`feedback_tool_output_shape_is_arbitrary`](../README.md). Bounded by the result-size cap (Recommendation 3). Note the reconciliation with the parent doc's "scalar-or-small-object": a small grouped array *in the envelope* (for the agent to reason over) is fine; many-row results meant for *live rendering* still go through `bulk_query`, not here.

## What this doesn't decide

- **`tool_map` aggregator (Decision 1B).** Deferred — additive later (a new discriminated `kind`) if persist-free aggregation over tool-derived values becomes a hot path. For now it composes via `bulk_transform` + `bulk_aggregate`.
- **`fold_tool` (Decision 1C).** Rejected permanently on tool-purity grounds, not deferred.
- **Streaming N-results / per-group regression.** Out of scope by the parent doc's Decision 5 — composes via `bulk_transform` into a side entity + `bulk_query`. `bulk_aggregate` stays scalar-or-small-object.
- **Frontend surfacing.** Whether a `BulkJobProgressBlock`-style widget renders the scalar inline is a separate UI ticket; the agent reads the value from the envelope.

## Next step

Write `docs/BULK_AGGREGATE.spec.md` (the metadata/result Zod contracts, the SQL processor algorithm + `__records_processed` handling, the EXPLAIN pre-flight, lock declaration) and `docs/BULK_AGGREGATE.plan.md` (TDD slices). The plan slices roughly as: (1) job-model schemas + type wiring; (2) tool + route pre-flight + enqueue; (3) SQL processor + `__records_processed` + envelope persistence; (4) smoke section + docs. Each slice independently green-testable, all on this `feat/bulk-aggregate` branch.
