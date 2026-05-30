# Large data operations during a portal session — Discovery

**Issue:** [EnterpriseBT/portal-ai#85](https://github.com/EnterpriseBT/portal-ai/issues/85)

**Why this exists.** Both directions of data flow break at high cardinality, and both fail invisibly.

- **Writes.** Agent-driven entity-record tools (`entity_record_create`, `entity_record_update`, `entity_record_delete`) cap at 100 items per call via Zod. The motivating case — *"compute acreage for each of 100k parcels and store the result in a join table"* — can't even be expressed in the current shape.
- **Reads.** Every `sql_query` (and `visualize` / `visualize_tree`, which compose on top) is implicitly wrapped to `LIMIT 501`, every cell truncated past 500 chars, and the whole response collapsed past 100KB of payload. A 10k-point scatter plot doesn't render; *it silently renders empty*, because the cap collapses `rows` away and the visualizer dutifully injects `[]` into the spec's `data.values`.

The infrastructure to do better partially exists: BullMQ workers, SSE-driven progress, the data-locking convention, and a display-block mechanism that already supports surfacing side-channel UI from a tool result. What's missing is the bridge from the agent's tool-call surface to that async / streaming pipeline. This doc proposes the bridge for both directions, names the new tools / job types / response shapes / SSE event shapes needed to ship them, and walks two smoke targets end-to-end. **This is the discovery that does X-Y-Z: profile where the bottleneck sits on each side, choose the tool-surface shape per direction, and design the bridge such that the writes track and the reads track share most of their infrastructure.**

## The current shape

### Write path (synchronous, capped at 100)

| Concern | Where | What it does |
|---|---|---|
| Tool cap | `apps/api/src/tools/entity-record-create.tool.ts:36-42`, `entity-record-update.tool.ts:27-33`, `entity-record-delete.tool.ts:20-26` | Zod `.max(100)` on `items` — agent **cannot** emit more than 100 per call |
| Transaction | `entity-record-create.tool.ts:145-186` | Single `Repository.transaction()` wraps inserts + wide-table mirror; partial failure rolls everything back |
| Normalization | `apps/api/src/services/normalization.service.ts:54-66` (`normalizeMany`) | Field mappings loaded once per entity, applied per record; 8-step pipeline |
| Wide-table mirror | `entity-record-create.tool.ts:164-184` | Grouped per entity; statement cache via `wideTableStatementCache`; skips if no live columns yet |
| Failure mode | Transactional rollback | All-or-nothing; no resumability |

### Read path (synchronous, three implicit caps, silent-empty-chart on collapse)

| Concern | Where | What it does |
|---|---|---|
| `sql_query` tool | `apps/api/src/tools/sql-query.tool.ts:21-31` | Delegates to `AnalyticsService.sqlQuery` which delegates to `PortalSqlService.runSqlQuery` |
| Implicit `LIMIT` | `apps/api/src/services/portal-sql.service.ts:233` (`applyImplicitLimit`) | Every read SQL wrapped to `LIMIT rowCap + 1` so the truncation flag is set correctly |
| Default caps | `apps/api/src/services/portal-sql-response.util.ts:19-23` | `rowCap: 500`, `cellCap: 500` (per-string), `payloadCap: 100_000` bytes, `truncatedSampleSize: 10` |
| Payload collapse | `portal-sql.service.ts:273-285` | When payload exceeds `payloadCap`, the `rows` field **disappears** from the response; only a 10-row "sample peek" survives in a truncation envelope |
| `visualize` failure mode | `apps/api/src/services/analytics.service.ts:483-491` | When `rows` is absent (payload collapse), Vega-Lite spec gets `data: { values: [] }`. Chart renders empty. No error surfaced to the agent or the user |
| `visualize_tree` failure mode | `analytics.service.ts:509-...` (`visualizeVega`) | Same: empty `values` injected when rows are missing |

The read-side failure mode is *worse* than the write-side: 100-cap is a number the agent can see and reason about, but the payload-collapse failure is invisible from the tool-result envelope unless the agent specifically introspects the truncation flag. The user gets a blank chart and a confused agent.

### Shared async + UI infrastructure (already shipped, ready to extend)

| Concern | Where | What it does |
|---|---|---|
| Worker | `apps/api/src/queues/jobs.worker.ts:76-135` | BullMQ worker, dispatches to a typed processor registry by `job.data.type` |
| Progress | `jobs.worker.ts:119-124` (`updateProgress`) | Aggregate percentage only — forwards to SSE via `JobEventsService` + Redis Pub/Sub |
| Terminal | `jobs.worker.ts:93-102` | `completed` / `failed` / `cancelled` with structured result payload |
| Job types today | `packages/core/src/models/job.model.ts:35-41` | `system_check`, `revalidation`, `connector_sync`, `file_upload_parse`, `layout_plan_commit` |
| Adding a JobType | `job.model.ts:240-287` | 3-step compile-time-checked pattern (enum + metadata schema + result schema + `JobTypeMap` entry) |
| SSE | `apps/api/src/routes/job-events.router.ts:54-136` | `/api/sse/jobs/:id/events` — snapshot on connect, then update events; supports custom event types (`_eventType: "X"` → `job:X`) |
| Entity lock | `apps/api/src/services/job-lock.service.ts:80-95` (`assertConnectorInstanceUnlocked`) | Throws 409 `ENTITY_LOCKED_BY_JOB` if any non-terminal job targets the entity. Routes call this before mutations. Releases on terminal |
| Portal tool-call wiring | `apps/api/src/services/portal.service.ts:99-142` (`handleToolCall` / `handleToolResult`) | Vercel AI SDK loop; `resolveDisplayBlock()` already supports surfacing side-channel UI from a tool result — this is the seam for "tool returned, work still running" AND for "tool returned a query handle, UI fetches the data" |

**The critical observation:** the `resolveDisplayBlock()` path is the natural bridge for *both* directions. Writes use it to render a progress widget that fills in via SSE. Reads use it to render a chart widget whose data is fetched by query handle from the UI, never passing through the agent's context. Same mechanism, different display-block kind.

## Profiling: where's the actual bottleneck?

Same caveat as the previous draft — no spike code yet, reasoning from the surfaces:

### Writes
- **The 100-cap is the hard wall.** The agent can't even try.
- **LLM output tokens** to enumerate 100 records inline ≈ 5k tokens; the agent is already paying tokens to type out data that's in the DB. Lifting the cap to 1000 puts us at ~50k output tokens per call. The agent isn't *supposed* to be doing this; the right answer is "describe, don't enumerate."
- **HTTP tool-call timeout** in the portal pipeline likely caps at 30–120s. Synchronous `createMany(10k)` is fine; 100k crosses the line; 1M is not even close.
- **DB cost** is dominated by the wide-table mirror for high field-mapping cardinality; batch size of 1000 keeps each transaction quick.

### Reads
- **The 500-row cap blocks any chart that wants more than 500 points.** Scatter plot of imported parcels (10k+) → empty. Tree visualization of a categorical hierarchy with 1000+ leaves → empty.
- **The 100KB payload cap collapses even moderately-wide rows** (say 200 chars × 500 rows = 100KB). Any visualization with cell-level detail (parcel address + class + acreage + geometry preview) blows past this on a few hundred rows.
- **The agent is the wrong path for the data.** The agent emits the spec; the UI needs the data. Routing data through the agent's tool-result is an unforced token cost. Direct DB → UI is cleaner and lifts the agent's caps entirely.
- **Practical UI-side rendering limits** for charts: ~50k points for Vega-Lite scatter, ~10k for line, ~5k for treemap (browser-dependent). These are real ceilings; the server should sample or aggregate above them.

The dominant constraint on writes is "the agent can't express the operation" — fix: describe-don't-enumerate. The dominant constraint on reads is "the data shouldn't flow through the agent at all" — fix: query handle + direct UI fetch. Both fixes converge on the same mechanism (display block tied to a tool result that carries a reference, not the data).

## The design space

Some decisions apply to both directions, some are direction-specific. Group accordingly.

### Shared decisions

#### S1 — UI surface for tool results carrying side-channel data

How does the portal communicate the "actual" data the tool result is referencing (progress for writes, rows for reads)?

- **A. Tool-result widget that fills in / fetches on render.** Display block tied to the tool result; renders a widget that pulls from SSE (writes) or fetches by handle (reads).
- **B. Sidecar panel** outside the message thread.
- **C. System-level messages** injected into the timeline per progress milestone.

**Lean: A.** `resolveDisplayBlock()` already does this; we're just adding two new display-block kinds (`bulk-job-progress` for writes, `query-result-data` for reads).

#### S2 — Agent ergonomics after dispatching a long-running operation

- **A. Agent blocks** until terminal.
- **B. Agent continues**; portal listens for the terminal SSE event and re-prompts the agent with the result.
- **C. Hybrid:** synchronous "started" return; agent decides per-call to wait or continue.

**Lean: B for writes, immediate-return for reads.** A long-running write job blocks user UX if the agent waits; portal-orchestrated follow-up is cleaner. Reads return a handle synchronously and don't need a follow-up — the data is available to the UI immediately via the handle, and the agent moves on with what it already knows (row count, schema, truncation status).

#### S3 — Lock interaction

Writes need entity locks (existing pattern). Reads don't; PostgreSQL `statement_timeout` is the analogue for runaway queries.

- **Writes lean: target entity only.** Sibling primitive `assertConnectorEntityUnlocked(entityId)` of the existing `assertConnectorInstanceUnlocked`. Reads on either source or target stay open while the bulk job runs.
- **Reads lean: per-query `statement_timeout`.** Cap a single query's wall-clock at, say, 30 seconds. No lock, no job; just kill long queries and surface the failure to the agent so it can retry with a tighter SQL.

### Write-specific decisions

#### W1 — Tool-surface shape

How does the agent express "do X to every record in entity Y"?

- **A. Declarative bulk tool.** `bulk_transform_entity_records(source, target, expression, keyField)`. Agent says what; server iterates.
- **B. Agent loops over batches.** Smaller upsert tool, agent calls N times. Tokens-per-record are the bottleneck; falls down at ≥10k.
- **C. Sandboxed JS.** Like A with Turing-complete expression. Bigger security surface (`quickjs-emscripten` or `isolated-vm`, per #76 decision 15's gated upgrade path).

| | A (declarative) | B (agent loops) | C (sandboxed JS) |
|---|---|---|---|
| Token cost | O(1) tool calls | O(N) | O(1) |
| Security surface | Bounded by expression language | Already exists | Significant |
| Acreage smoke target fits | ✅ (SQL projection: `ST_Area(geometry::geography) / 4047`) | ✅ slow | ✅ |
| Hardness floor | Limited to what the expression language can do | Same limits as today × N | Anything |

**Lean: A.** SQL projection against the existing wide table is the expression language — already there, the agent already uses it via `sql_query`, the result is a typed records array we know how to upsert. C stays on the shelf until use cases force it.

#### W2 — Cancellation

**Lean: stop-at-batch-boundary.** Set a "cancel requested" flag; current batch finishes; no new batches. Already-committed batches stay. Surface partial-completion stats in the terminal SSE payload. Documented contract: *"cancelled jobs leave the partial result in place; re-running an idempotent operation converges."*

#### W3 — Resumability

**Lean: idempotent-by-key.** Every supported operation upserts on `keyField`. "Resume" == re-run; second run is a no-op for records already done. Reject jobs that don't fit this contract at enqueue.

#### W4 — Resource limits

- **Max records per job:** 1,000,000. Above, fail at enqueue with a hint to split.
- **Batch size:** 1,000. Tunable per job.
- **Concurrent jobs per organization:** 2.
- **Per-batch wall-clock cap:** 10× typical. Backstop for "expression is more expensive than the agent guessed."

#### W5 — Per-record compute

For "acreage from geometry" / "centroid from polygon" / "normalized address" etc.:

- **A. SQL projection at the wide table** (fastest, single statement, requires SQL-expressible operations + PostGIS for spatial).
- **B. Server-side per-record tool dispatch** (slower, works without PostGIS, lets the agent compose registered tools per record).

**Lean: A primary + B fallback.** v1 ships `expression: { kind: "sql" | "tool", value }`; only `"sql"` works in v1, `"tool"` lands in a follow-up.

### Read-specific decisions

#### R1 — Where does the data flow?

- **A. Through the agent.** Today's path. Rows in the tool result; agent passes through to the spec.
- **B. Around the agent (data-handle pattern).** Tool returns a handle + small metadata (row count, schema, sample peek); UI fetches by handle directly from a new endpoint.
- **C. Streamed.** UI opens an SSE / chunked HTTP stream from the handle endpoint; large datasets arrive incrementally.

| | A (through agent) | B (handle + direct fetch) | C (streamed) |
|---|---|---|---|
| Agent token cost (large query) | Catastrophic | Constant | Constant |
| UI rendering ceiling | DB-side cap (500 rows) | UI-side (50k for Vega scatter) | None (streaming-aware widget) |
| Failure mode on large | Silent empty chart | Explicit cap message + sample | Streaming progress |
| Complexity | None (status quo) | New endpoint, handle storage, TTL | Endpoint + streaming protocol |

**Lean: B for v1; door open to C for >50k-row visualizations.** The data-handle pattern lifts the agent's caps (no rows in the tool result) AND fixes the silent-empty-chart bug (the agent sees `{ rowCount: 47213, truncated: false }` and reports that to the user accurately). Streaming (C) is a real follow-up if charts need to render 100k+ points incrementally, but Vega-Lite's practical ceiling makes that rare.

#### R2 — Handle lifecycle

- **A. Ephemeral (per-portal-message).** Handle TTL ~5 minutes; expires after the chart renders.
- **B. Session-scoped.** Handle lives as long as the portal session.
- **C. Durable.** Handle persists; user can re-open the chart later from history.

**Lean: B (session-scoped) for v1, C if the requirement surfaces.** Ephemeral (A) breaks re-renders (user resizes the chart panel and the data is gone). Durable (C) needs a real storage tier and TTL policy. Session-scoped is the simplest path that supports the natural UX. Backing store: Redis with a 24h TTL keyed by `{ portalId, handleId }`.

#### R3 — Where does the data live between query and render?

- **A. Materialize to Redis** keyed by handle id. Fast to serve; bounded by Redis memory.
- **B. Re-execute the SQL on fetch.** Stateless; query runs twice (once for the agent's metadata, once for the UI). Cheap for cached PG queries, painful for expensive ones.
- **C. Materialize to a temp Postgres table** keyed by handle id. Slower to set up, but no Redis-size cap.

**Lean: A.** v1's target is "10k–50k rows for a chart"; Redis comfortably holds that. If the user asks for a 1M-row chart, the right answer isn't "make Redis bigger" — it's sampling or aggregation server-side (R4). C is the right move if/when data-handle storage becomes a primary feature.

#### R4 — Sampling vs full dataset

For visualizations specifically: a scatter plot of 1M points isn't a useful chart. The agent should sample or aggregate.

- **A. Implicit sampling** above a threshold (say 50k rows). Tool returns `{ rowCount: 1_000_000, sampled: true, sampleSize: 50_000 }`; agent knows the chart is a sample and can say so.
- **B. Explicit sampling** as a separate tool param. Agent decides.
- **C. Aggregation-only above threshold.** Force the agent to write aggregating SQL (`SELECT class, COUNT(*) FROM parcels GROUP BY class`) instead of fetching raw rows. UI never gets >threshold raw rows.

**Lean: A + C as a hint.** Implicit sampling means the chart still renders for the runaway case; the agent surfaces "this is a 5% sample" in its response. The agent can be prompted to prefer aggregation explicitly (system-prompt-level guidance) when row count exceeds a threshold. Forcing aggregation (pure C) is too restrictive — sometimes you really do want a 50k-point scatter to see the noise floor.

#### R5 — Visualization-specific row caps

Different mark types have different practical ceilings.

- Vega-Lite scatter: ~50k points (browser hangs past)
- Vega-Lite line: ~10k (line traversal cost)
- Vega-Lite bar: ~5k (DOM cost per bar)
- Vega-Lite tree/treemap: ~10k nodes
- Vega-Lite heatmap: ~100k cells (binned)

**Lean: per-mark caps published in the tool description.** Agent is prompted with the table; it picks an appropriate aggregation strategy based on row count and mark type. Past the cap, sampling kicks in (R4). No silent empty chart.

## Tradeoff comparison

| | UI surface (S1) | Agent ergonomics (S2) | Lock (S3) | Tool surface — writes (W1) | Cancel (W2) | Resume (W3) | Per-record compute (W5) | Read data path (R1) | Handle lifecycle (R2) | Storage (R3) | Sampling (R4) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Lean | Display block | Continue (W) / immediate-return (R) | Target entity (W) / `statement_timeout` (R) | Declarative SQL | Stop at batch | Idempotent re-run | SQL primary + tool fallback | Data handle | Session-scoped | Redis | Implicit + system-prompt nudge |
| Spreads to spec | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |

Every lean composes cleanly with the next.

## Smoke walkthroughs

### Smoke A — write: 100k parcels, compute acreage

1. User: *"For every parcel, compute its acreage and store it in a parcel_metrics entity keyed by parcel_id."*
2. Agent recognizes high cardinality, dispatches:
   ```
   bulk_transform_entity_records(
     sourceEntityId: "ce-parcels-…",
     targetEntityId: "ce-parcel-metrics-…",
     expression: { kind: "sql", value: "ST_Area(geometry::geography) / 4047 AS acreage" },
     keyField: "parcel_id",
     batchSize: 1000,
   )
   ```
3. Tool route validates, calls `assertConnectorEntityUnlocked(targetEntityId)`, EXPLAINs the expression, enqueues a `bulk_transform` job, returns `{ jobId, expectedRecords: 100000, estimatedSeconds: 180 }`.
4. UI renders `bulk-job-progress` display block tied to the jobId; SSE subscription opens.
5. Processor runs batched `INSERT INTO target_wide SELECT … FROM source_wide LIMIT 1000 OFFSET N` per batch; emits `{ _eventType: "batch", recordsProcessed: N, totalRecords: 100000 }` per batch commit.
6. Widget updates in-place; on terminal, portal injects a synthetic message into the agent's context for follow-up.

### Smoke B — read: 10k-point scatter plot of parcel acreage vs assessed value

1. User: *"Show me a scatter plot of parcel acreage vs assessed value for residential parcels."*
2. Agent dispatches:
   ```
   visualize(
     sql: "SELECT acreage, assessed_value FROM parcel_metrics WHERE class = 'Residential'",
     vegaLiteSpec: { mark: "point", encoding: { x: {field: "acreage", type: "quantitative"}, y: {field: "assessed_value", type: "quantitative"} } }
   )
   ```
3. Tool route executes the SQL; rows materialize to Redis under a fresh `queryHandle`; response to the agent is `{ queryHandle: "qh-xyz", rowCount: 13427, schema: [{name: "acreage", type: "number"}, {name: "assessed_value", type: "number"}], sampled: false, truncated: false, samplePeek: [/* first 10 rows */] }`. Note: no 13427 rows in the agent's context.
4. Agent's response renders as a portal message with a `query-result-data` display block carrying the handle + the Vega-Lite spec.
5. UI receives the display block, fetches `/api/portal-sql/handle/qh-xyz` to get the rows, populates `data.values` in the spec client-side, renders the chart.
6. Above 50k rows: sampling kicks in implicitly; agent sees `{ rowCount: 1_000_000, sampled: true, sampleSize: 50_000 }` and says "rendered as a 5% sample because the full dataset has 1M points." Past per-mark cap: agent steered toward aggregation via system-prompt guidance.

## Recommendation

### Writes track

1. **New tool** `bulk_transform_entity_records`. Parameters: `sourceEntityId, targetEntityId, expression, keyField, batchSize?`. Expression is `{ kind: "sql", value: string }` for v1; `{ kind: "tool", ref: string }` deferred.
2. **New JobType** `bulk_transform`. Metadata declares `targetEntityId` as the locked entity; result carries `recordsProcessed, recordsFailed, durationMs, partialFailures[]`.
3. **New processor** `apps/api/src/queues/processors/bulk-transform.processor.ts`. Drives the batched INSERT/UPSERT loop, emits per-batch custom SSE events, honors the cancel flag.
4. **New SSE event** `{ _eventType: "batch", recordsProcessed, totalRecords, batchDurationMs }` → `job:batch`.
5. **New lock primitive** `JobLockService.assertConnectorEntityUnlocked(entityId)` + sibling repository method.
6. **New display block** `bulk-job-progress` (frontend: `apps/web/src/components/BulkJobProgressBlock.component.tsx`).
7. **Portal follow-up injection** on terminal SSE; new helper in `portal.service.ts`.

### Reads track

8. **New tool wrappers** — modify `sql_query`, `visualize`, `visualize_tree` to return a query-handle envelope instead of the raw rows. Backward compat: when `rowCount <= 100`, still embed `rows` inline (cheap small reads stay fast). When `rowCount > 100`, return `{ queryHandle, rowCount, schema, sampled, samplePeek }` and the data goes to Redis.
9. **New endpoint** `GET /api/portal-sql/handle/:handleId` returning the materialized rows (with paging support: `?offset=&limit=`).
10. **Redis-backed handle storage.** TTL 24h, keyed by `{ portalId, handleId }`. Eviction policy: LRU.
11. **New display block** `query-result-data`. Carries handle + spec; UI fetches rows + renders. Existing chart renderer plugs in via this new block.
12. **Sampling logic** in `PortalSqlService`: above `SAMPLING_THRESHOLD` (lean: 50000 rows), apply `TABLESAMPLE BERNOULLI` (or `ORDER BY random() LIMIT N` for deterministic small samples) and mark `sampled: true` in the response envelope.
13. **Per-mark cap table** in the `visualize` / `visualize_tree` tool descriptions. Surfaced to the agent so it can plan around it.
14. **`statement_timeout`** on every portal-SQL transaction. Lean: 30s. Caught as a typed error; surfaced to the agent so it can retry with a tighter query or apply aggregation.

### Resource limits

- `MAX_BULK_RECORDS = 1_000_000` (writes)
- `DEFAULT_BULK_BATCH = 1_000`
- `MAX_CONCURRENT_BULK_PER_ORG = 2`
- `READ_HANDLE_TTL = 24h`
- `SAMPLING_THRESHOLD = 50_000` (reads)
- `STATEMENT_TIMEOUT = 30s` (reads)

## Open questions (deferred to implementation)

1. **Wide-table mirror vs entity-records canonical write order** (writes): v1's SQL path INSERTs directly into the target's wide table, bypassing entity-records provenance. Lean during implementation: write to entity-records first, let the reconciler mirror — canonical but slower. Decide based on the audit/provenance requirements (does the agent later want to query "which job inserted this record?").
2. **Source-entity snapshot semantics** (writes): bulk job reads `LIMIT/OFFSET` per batch against the live wide table; if the source mutates mid-run the result is per-batch-consistent but not globally consistent. Document, but consider whether some flows need a global snapshot (e.g. via a CTE or a materialized view at job start).
3. **Per-record-tool-dispatch** (writes): the `expression: { kind: "tool", ref: "compute_area" }` shape. In-process function call vs sub-job per batch?
4. **Handle ownership across users** (reads): if user A creates a query handle and user B opens the same portal, does the handle resolve? Lean: portal-scoped, not user-scoped (the handle is part of the portal state). But document.
5. **Handle invalidation on source data change** (reads): if a connector sync runs between the agent fetching the handle and the user re-opening the chart, the handle data is stale. Tradeoff: serve cached (faster, possibly stale) vs re-execute (fresh, slower). Lean: serve cached; surface "last refreshed N minutes ago" in the chart corner.
6. **Streaming (R1 option C)**: when does the 50k-row Redis ceiling become a real constraint? Probably not v1; flag.
7. **Statement-timeout failure UX** (reads): when a 30s query times out, the agent sees a typed error and gets to retry. What's the agent prompt look like so it retries *productively* (tighter SQL, aggregation) rather than the same query? Probably a system-prompt addition.
8. **Quota / billing**: a 1M-record bulk job is real compute; a 100k-row read materialized to Redis costs memory. Per-org budgets out of scope here.

## What this doesn't decide

- **PostGIS** — staying in JSONB for geometry (per #84). Acreage SQL in Smoke A assumes PostGIS; if it's not in place, the smoke uses the deferred `{ kind: "tool", ref: "compute_area" }` shape. Either way, the bulk-job mechanism is orthogonal.
- **Sandboxed JS** (W1 option C) — gated, deferred. Re-evaluate when ≥3 use cases surface that SQL projection can't express.
- **Distributed sharding** — single worker pool in v1.
- **Streaming reads** (R1 option C) — deferred until 50k-row Redis storage proves insufficient.
- **Quota / billing** — flagged in open question 8.
- **Cross-portal handle sharing** (reads) — handles are portal-scoped; sharing a chart across portals is a copy operation, not a handle reference.

## Next step

Spec at `docs/LARGE_DATA_OPS.spec.md` codifies the wire contracts: `BulkTransformToolSchema`, `BulkTransformMetadataSchema`, `BulkTransformResultSchema`, new SSE event types, query-handle response envelope, handle-fetch endpoint contract. Plan at `docs/LARGE_DATA_OPS.plan.md` slices the work, roughly:

- (1) writes: JobType + schemas + lock primitive
- (2) writes: processor + cancel-flag + per-batch SSE
- (3) writes: tool + EXPLAIN validation + portal follow-up
- (4) writes: display block + smoke against the acreage target
- (5) reads: query-handle envelope + Redis storage + fetch endpoint
- (6) reads: `sql_query` / `visualize` / `visualize_tree` rewired for the envelope
- (7) reads: sampling + statement_timeout + per-mark cap table
- (8) reads: display block + smoke against the scatter-plot target

Each slice is independently shippable; writes track and reads track can land in parallel since they only share the display-block-resolver seam.
