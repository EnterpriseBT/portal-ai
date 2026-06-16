# Compute-tool purity (pure read→compute) — Discovery

**Issue:** [EnterpriseBT/portal-ai#114](https://github.com/EnterpriseBT/portal-ai/issues/114)

**Why this exists.** Built-in compute tools — the statistics, regression, and entity-reading financial tools — currently read entity data themselves. Eighteen of them call `fetchEntityRows(stationData, …)` inside their `execute` closure, then hand the rows to a pure `AnalyticsService` method. They bundle **read + compute**. Custom (org-uploaded) toolpacks run on third-party servers with no backend access, so they can only ever provide pure compute. That leaves a two-tier contract: built-in compute reads the backend, custom compute cannot.

The portal session has three backend-privileged operations — read, write, visualize. Compute is an orthogonal axis: a pure function over data handed to it. This is the refactor that makes every compute tool — built-in and custom — a pure function with one shared contract, confining backend privilege to the read/write/visualize primitives.

## The current shape

### Two `build()` patterns coexist

| Pattern | `build()` signature | Reads backend? | Examples |
|---|---|---|---|
| Read-coupled compute | `build(stationData, organizationId)` | Yes — `fetchEntityRows` in the execute closure | `describe_column` (`describe-column.tool.ts:33`), `correlate`, `aggregate`, `regression`, `forecast`, `technical_indicator` |
| Pure compute (target) | `build()` — no args | No | `npv` (`npv.tool.ts:24`), `irr` (`irr.tool.ts:22`), `tvm`, `xnpv`, `xirr`, `depreciation`, `amortize`, `bond_math` |

The pure financial tools are the model: `build()` takes nothing, the input schema is scalars/arrays (`{ rate, cashFlows }`), and `execute` calls a static `AnalyticsService` method directly.

### The compute core is already pure

The compute logic lives in `AnalyticsService` static methods that already take data as input — `AnalyticsService.describeColumn({ records, column, percentiles })`, `AnalyticsService.regression(...)`, etc. (validated directly with fixture data in `apps/api/src/__tests__/services/analytics.service.test.ts`). **The coupling is only the read in the tool wrapper**, not the algorithm. That makes this refactor mostly mechanical: lift the `fetchEntityRows` call out of the closure and have `records` arrive as input.

### The read path being removed

`fetchEntityRows(stationData, entityKey, columns, organizationId, opts?)` (`apps/api/src/utils/tools.util.ts:41`) resolves the LLM-supplied `entityKey` to a `connectorEntityId` via `stationData.entities`, projects the requested columns, and calls `wideTableRepo.fetchProjectedRows(entityId, columnList, { organizationId, where?, limit? })` (`tools.util.ts:56`). `StationData` is loaded once in `buildAnalyticsTools` via `AnalyticsService.loadStation(...)` (`tools.service.ts:453`) and threaded into every read-coupled tool's `build()`.

### The candidate read primitive

`sql_query` (`apps/api/src/tools/sql-query.tool.ts`) already auto-selects scale: ≤ `INLINE_ROWS_THRESHOLD` (from `@portalai/core/constants`) returns rows inline (`sql-query.tool.ts:40`); above it, `PortalSqlHandleService.produce(...)` stages rows in Redis and returns a handle envelope `{ type: "data-table", queryHandle, rowCount, schema, samplePeek }` (`sql-query.tool.ts:49`). The handle is the natural "data reference" a compute tool could consume without rows ever entering the model context.

### The bulk dispatch path (map-shaped only)

`bulk_transform`'s `dispatchBatch()` (`bulk-transform-tool.dispatcher.ts:94`) invokes a tool **per source row** — it spreads each row into `input = {...staticArgs, ...row, sourceKey, sourceRow}` (`:120`) and calls the executor with concurrency/timeout limits. This is a **map**: one record in, one result out. The 18 statistics/regression tools are **reduce**-shaped — they consume an entire column/series and don't compose across batches (mean-of-means ≠ mean). So the existing dispatcher feeds *map-shaped* compute (per-record enrichment); it is **not** the scale path for reduce-shaped statistics.

## The design space

### Decision 1 — How a pure compute tool receives its data

**A. Inline rows in the input.** Add `records: Record<string,unknown>[]` to the schema; the agent passes rows from a prior `sql_query`. **B. Handle reference.** Input takes the `queryHandle` from `sql_query`; the tool resolves it to rows. **C. Runtime-resolved data reference.** Input accepts a handle (and/or small inline rows); a shared runtime step materializes it into `records` *before* the pure function runs — in-process for built-in tools, by POSTing resolved rows to the webhook for custom tools. The pure function only ever sees `records`.

| | A inline rows | B handle, tool resolves | C runtime-resolved |
|---|---|---|---|
| Pure function sees only `records` | Yes | No (resolve coupling) | Yes |
| Same contract built-in + custom | Yes, but caps at context size | No — webhook can't resolve a handle | Yes — runtime resolves for both |
| Large data (rows not in context) | No | Yes | Yes |
| Backend privilege stays out of the tool | Yes | No | Yes |

**Lean: C.** It's the only option that keeps the function pure, works for large data, and gives built-in and custom tools one agent-facing contract (pass a handle). The read/materialization privilege lives in the runtime wrapper, not the tool.

### Decision 2 — Where data materialization lives

**A. In each tool** (status quo, just swapped to the read primitive). **B. In a shared runtime step** in the execute-wrapping layer (`tools.service.ts`), applied uniformly: resolve `input.handle` → `records`, then call the tool. For custom tools the same step resolves the handle and ships rows in the webhook POST body (`tools.service.ts:331` is where webhook invocation lives).

| | A in-tool | B shared runtime step |
|---|---|---|
| Tool stays pure | No | Yes |
| One code path for built-in + custom | No | Yes |
| Blast radius | 18 closures keep read logic | One helper + thin wrapper |

**Lean: B.** A single `resolveRecords(input, ctx)` seam materializes the data reference once; every compute tool downstream is a pure function. This is the seam the issue calls "the read primitive fetches; compute consumes."

### Decision 3 — What "scale" means for reduce-shaped compute

Reduce-shaped tools (the 18) don't batch-compose. **A. Inline-bounded.** The resolved dataset must fit a row cap; genuinely huge reductions are SQL's job (`bulk_aggregate` already reduces N→1 in SQL). **B. Streaming/batch-composable.** Re-derive each statistic as an incremental aggregate. Enormous effort; many (median, correlation, regression) don't have trivial streaming forms.

**Lean: A.** Pure compute is bounded-inline over a resolved handle; reductions over very large data go to SQL (`bulk_aggregate`). Document the map/reduce split: per-record *map* compute rides the existing dispatcher; *reduce* compute is inline-bounded. This refactor does not try to make statistics streamable.

### Decision 4 — Migration mechanics

Because `AnalyticsService` methods are already pure, each tool's `execute` collapses to `const records = await resolveRecords(input, ctx); return AnalyticsService.method(records, …)`. **A. Big-bang** all 18 in one commit. **B. Per-pack slices** — statistics, then regression, then the entity-reading financial tools — each a green-testable commit.

**Lean: B.** Per-pack slices keep each commit reviewable and let the test simplification (drop `stationData`/repo mocks, render the pure function with fixtures) land incrementally.

## Tradeoff comparison

|  | C (runtime-resolved data) | B (shared materialization step) | A (inline-bounded reduce) | B (per-pack slices) |
|---|---|---|---|---|
| Spread to spec | Yes — defines the input contract | Yes — defines the seam | Yes — defines the row cap | Yes — defines slice order |
| One contract built-in + custom | Yes | Yes | n/a | n/a |
| Keeps tools pure | Yes | Yes | Yes | Yes |

## Recommendation

1. Compute tools accept a **data reference** (a `sql_query` handle), not an entity key; a shared `resolveRecords(input, ctx)` runtime step materializes it into `records` before the pure function runs.
2. Materialization lives **once** in the execute-wrapping layer (`tools.service.ts`), applied uniformly — in-process for built-in tools, as resolved rows in the webhook POST body for custom tools.
3. The pure compute function only ever receives `records` (array of row objects, matching today's `AnalyticsService` signatures) plus its existing scalar params (`column`, `method`, etc.).
4. Pure compute is **inline-bounded** by a row cap; reductions over very large datasets are delegated to SQL (`bulk_aggregate`). Per-record *map* compute continues to ride `bulk_transform`'s dispatcher.
5. Remove `fetchEntityRows` from the tool layer; the read privilege survives only behind the read primitive. Make a **clean cut** — no `{entity, column}` compatibility sugar on compute tools.
6. Migrate per pack (statistics → regression → entity-reading financial), each a green commit; tests render the pure function with fixtures and drop `stationData`/repo mocks.

## Open questions

1. **Input field shape — handle vs inline rows.** Should the contract be handle-only, or `handle | records` so the agent can pass tiny inline datasets directly? **Lean: accept both**, handle as the primary path; `resolveRecords` returns inline `records` untouched and resolves a handle otherwise.
2. **The row cap for inline compute — and its hard ceiling.** Reuse `INLINE_ROWS_THRESHOLD` (=100), or a separate, larger compute cap? Compute data doesn't enter model context (the runtime resolves it), so the ceiling is memory, not tokens. **But the cap is gated by the read primitive:** `PortalSqlHandleService` stages at most `HANDLE_ROW_CAP` (=100,000) rows and flags `truncated: true` beyond that (`portal-sql-handle.service.ts:51`). You cannot pull more than 100k rows out of a handle, so **~100k is the real ceiling for faithful inline pure-compute** regardless of what `COMPUTE_MAX_ROWS` we pick. **Lean: a dedicated `COMPUTE_MAX_ROWS` ≤ `HANDLE_ROW_CAP`**, with a typed `COMPUTE_INPUT_TOO_LARGE` error. A sub-decision the spec must settle: when a handle's `rowCount` exceeds the cap, does the compute tool **hard-error** (forcing the agent to pre-aggregate/sample in SQL) or **compute-on-sample** (the staged sample, with `truncated`/`sampled` surfaced in the result)? **Lean: hard-error** — silent sampling hides correctness loss; the agent should opt into sampling explicitly via `… ORDER BY random() LIMIT n`.

   This ceiling defines the feature's limit case: an **iterative, whole-dataset reduce that SQL can't express** — k-means (`cluster`), Holt-Winters (`forecast`), logistic IRLS, seasonal `decompose`, rank-based correlation — over >100k rows has *no faithful path*. `bulk_aggregate` can't help (not a SQL aggregate); `bulk_transform` can't help (it's a per-record map, not a reduce). The architecture's answer is decomposition: e.g. k-means RFM over 6M customers becomes **sample-reduce** (`sql_query … LIMIT 50000` → `cluster` → 5 centroids) followed by **map-assign at scale** (feed centroids as static args to `bulk_transform`, stream all 6M rows, write a `segment` column). The feature does the map at full scale and the reduce at sample scale; it refuses to silently approximate a full-data iterative reduce — which is the correct behavior, not a gap.
3. **Custom-tool payload limits.** Shipping resolved rows in a webhook POST has a size ceiling. **Lean: same `COMPUTE_MAX_ROWS` cap governs both**; webhook tools that exceed it fail with the same typed error.
4. **Is a new dedicated "read" tool needed, or does `sql_query` suffice?** **Lean: `sql_query` + its handle envelope is the read primitive for v1**; no new tool. The taxonomy pass can rename/repack later.
5. **Does `bulk_aggregate`'s result envelope need to flow into compute?** I.e. compute over an aggregate's output. **Lean: out of scope** — aggregate returns a bounded value the agent already consumes inline; no handle chaining needed yet.

## What this doesn't decide

- **Toolpack reorganization** — splitting `data_query`, giving bulk tools a descriptor home, classification metadata. Deferred to the broader tool-taxonomy investigation (scope; this ticket is the spine that unblocks it).
- **`write` auto-scaling** — collapsing `entity_record_*` + `bulk_transform` into one mode-selecting write operation. Separate decision, separate risk (locking interactions).
- **The `bulk_transform` / `display_entity_records` descriptor-drift bug** — real but independent; its own small ticket.
- **Making statistics streamable** (Decision 3B). Out of scope by size; revisit only if a metered need appears.

## Next step

Write `docs/COMPUTE_TOOL_PURITY.spec.md` (the `resolveRecords` contract, the compute-tool input schema shape, the row cap + error code, and the built-in vs webhook materialization paths) and `docs/COMPUTE_TOOL_PURITY.plan.md` (TDD slices). The plan slices as: (1) `resolveRecords` seam + contract + cap/error, behind the read primitive; (2) flip the statistics pack; (3) flip the regression pack; (4) flip the entity-reading financial tools; (5) delete `fetchEntityRows` from the tool layer and simplify tests. Each slice ships green and independently.
