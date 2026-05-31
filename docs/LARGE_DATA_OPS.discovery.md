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

### Pinned results — how the design affects them

| Concern | Where | What it does |
|---|---|---|
| Model | `packages/core/src/models/portal-result.model.ts:13-31` | `portal_results` table; `content: z.record(z.string(), z.unknown())` JSONB column carries the full block payload at pin time |
| Pin route | `apps/api/src/routes/portal-results.router.ts:166-191` | Walks `messages[i].blocks[blockIndex]`, copies `{ type, content }` straight into `portal_results.content` — **content is a snapshot at pin time**, including data |
| Pinnable types | same file, `PINNABLE_BLOCK_TYPES` | `text`, `vega-lite`, `vega`, `data-table` |
| View | `apps/web/src/components/PinnedResultsList.component.tsx`, `DataResult.component.tsx` | Renders `content` directly; for vega-lite, the spec's `data.values` already holds the rows that were live at pin time |

Today this works because **the rows are embedded in the spec**: when the user pins a 200-row scatter plot, the spec's `data.values` carries those 200 rows and they survive forever in the JSONB column. Source data can change, the connector entity can be re-synced, and the pinned chart still renders exactly what the user pinned.

**The new design breaks that.** Under R1's data-handle pattern + S4's streaming render, the chart at the moment of pinning holds *a handle + a spec authored against a named dataset*. The actual rows live in Redis (24h TTL) and in the wide-table column store. If the pin operation copies the current display block verbatim, the pinned content becomes:

```json
{ "queryHandle": "qh-xyz", "rowCount": 13427, "schema": [...], "spec": {...named-dataset-spec...} }
```

…with the rows stored separately under the handle id. **24 hours later, the handle is gone.** The pinned chart now references a missing handle; if the UI 404s on the handle endpoint, we're back to silent empty chart — the exact failure mode the new design was supposed to kill.

Design space:

- **P1. Pin re-executes the query.** Save the SQL + spec; re-run on view. Always-fresh data, tiny storage. But source may have changed (the pin loses "this is what I saw" semantics); expensive queries re-paid per view; sampled results may differ across views.
- **P2. Pin snapshots all rows inline.** Materialize the cached handle into `portal_results.content` at pin time; same shape as today. Pros: exact reproduction; works forever. Cons: a 50k-row pin = ~10MB JSONB blob; pinning is heavy; JSONB column bloats.
- **P3. Pin promotes the Redis handle to a durable store.** New `portal_result_data` table (or S3 blob) keyed by `portal_result_id`. Pin copies the cached rows there; view reads from there. Pros: cheap pin storage layer separate from `portal_results`; durable; same access pattern. Cons: new infra; cleanup story (soft-delete of pin cascades to data); two tables to keep consistent.
- **P4. Hybrid: small results inline, large results in the durable handle store.** Under a threshold (lean: same 100-row boundary used for the inline-vs-handle split in tool results), pin works exactly as today (rows in JSONB). Above the threshold, pin promotes to `portal_result_data`. The view path branches on which one the row is using.

**Lean: P4 (hybrid).** Preserves the today-behavior for small pins (no change to how 95% of pins work — text, small tables, charts of aggregated SQL output). Adds the durable handle path for the new "large dataset visualization" case. The pin operation is heavier for large results (one-time copy from Redis to Postgres + small wide-table query if Redis has evicted), but that's the price of "pin the chart of 13k points so my colleague can open it next Monday."

Concrete implementation sketch:

- New table `portal_result_data` with `{ portalResultId (PK, FK), rows (JSONB), rowCount, schema, columnDataTypes }`.
- Pin route: when the pinned block carries a `queryHandle`, fetch the cached rows from Redis. If Redis missed (TTL elapsed) OR if the result was sampled, re-execute the original SQL against the live data — and surface that to the user ("the cached data had expired; the pin snapshots a fresh run against the live source"). Then write rows to `portal_result_data` and remove the handle from the pinned `content` (replace with a `dataSource: "pinned-store"` marker).
- View route: when `portal_results.content` carries `dataSource: "pinned-store"`, the route joins `portal_result_data` and inlines the rows into the spec's `data.values` (or returns them alongside for the UI to compose). Otherwise fall through to today's path.
- Soft-delete of `portal_results` cascades to `portal_result_data` via the existing soft-delete machinery.

For writes specifically: pinning the `bulk-job-progress` widget at terminal is effectively pinning a chart of the target entity's recently-written records. Same path as a read-side pin under P4 — the widget already has a query (against the target entity's wide table) for its live view; at pin time we promote that to the same durable store. No special-case write-pin logic needed.

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

#### S4 — Incremental UI rendering (live data, not a progress bar)

The UI should NOT show a spinner-then-result for either direction. Both the bulk-write progress widget AND the read-side chart/table should render *the data itself* as it arrives — bars filling in column-by-column, points appearing on a scatter plot, table rows appending live, the user watching the operation materialize in real time.

- **A. Spinner-then-result.** Show a progress bar (% done) during the operation; render the chart / refreshed table at terminal. Simplest. Loses the "alive" feeling.
- **B. Incremental render: SSE deltas → UI append.** Server emits batches via SSE; UI maintains the rendered widget's data state, appending each delta as it lands. Writes: each committed batch is broadcast with the row payload (or a row-ref list the UI looks up). Reads: each query result batch is broadcast as it streams from PG. Chart re-renders on each delta via Vega-Lite's `vega.changeset` API (or the analogous mechanism for whichever renderer is in use).
- **C. Polling.** UI re-fetches the full dataset every N seconds. Cheap server, expensive client; the chart "flickers" rather than animating.

| | A (spinner) | B (incremental SSE) | C (polling) |
|---|---|---|---|
| Feels alive | ❌ | ✅ | Half — flicker, not animate |
| Server complexity | Low | Medium (per-batch broadcast already exists for writes; new for reads) | Low |
| Client complexity | Low | Medium (manage incremental state per widget type) | Medium (refetch + diff) |
| Renders ≥50k smoothly | N/A (terminal one-shot) | Depends on widget — Vega-Lite handles ~1k incremental updates/sec; past that, batch | Bad past a few k (full re-render each tick) |
| Final-state re-open | Trivial (cached snapshot) | Need to cache the final state separately to support re-open of the chart | Trivial |

**Lean: B for both directions, with a cached final snapshot for re-open.** The SSE infrastructure for writes already broadcasts per-batch progress events; extending the payload to carry the row data (or row references) is incremental. For reads, the same SSE channel can stream query batches as they arrive from PG. The cached final state (Redis, per R3) is then *what's served when the user re-opens the chart later* — the streaming render is for the first viewing, the cache is the persistence. Same mechanism on both sides; same display-block resolver pattern.

**Backpressure / batching policy.** Per-batch SSE event on writes is naturally rate-limited by the batch commit cadence (one event per ~1000-row commit ≈ every few hundred ms). For reads, the server cursors through the PG result and emits batches when (a) 1000 rows have accumulated OR (b) 250ms has elapsed since the last emit. Either trigger flushes a batch; whichever comes first. Keeps the UI's re-render rate bounded.

**Widget-specific incremental support.**

- *Table:* trivially append rows.
- *Bar chart, line chart, scatter:* Vega-Lite supports incremental updates via `vega.changeset().insert(rows)` against a named dataset. Spec must declare `data: { name: "primary" }` rather than `data: { values: [] }`; the renderer attaches the changeset stream after mount.
- *Tree / treemap / hierarchical:* incremental is harder — the layout depends on the full dataset. Lean: batch arrivals client-side, debounce re-layout to every 500ms.
- *Map (per #84):* points / polygons append cleanly to a MapLibre layer; clustering / heatmap layers re-bucket on each batch.

#### S5 — Error UX: surface every error + recommend a next action

**First-order rule for this entire surface: every failure mode surfaces to the user, every surfaced error includes a recommendation of what to do next.** The silent-empty-chart bug (the read-side payload-collapse the new design already fixes) is the canonical anti-pattern we're escaping from. Don't reintroduce it on the write side or in the pinned-results store.

Universal error envelope across all new tools, jobs, and endpoints in this proposal:

```ts
interface ApiUserError {
  code: string;                  // machine-readable, in the existing ApiCode enum
  message: string;               // human-readable summary
  recommendation: string;        // actionable next step in plain English
  details?: Record<string, unknown>; // structured context (lockingJob, expiredAt, ...)
}
```

The envelope is delivered to **two consumers**:

1. **The UI** — display blocks, the chart/table widget, the pinned-result viewer, and the bulk-job progress widget all render an MUI `<Alert>` with the `message` as the title and the `recommendation` as the body. Severity matches the kind (warning for recoverable, error for terminal). The `code` is rendered as the chip-style suffix already used by `FormAlert` so the user can quote it in a support thread.
2. **The agent** — the same envelope appears in the tool result so the agent can react. Recommendations are written assuming the agent might be the actor that takes the next step ("retry with a tighter LIMIT" → the agent can do that immediately; "ask the user to confirm the lock should be cancelled" → the agent surfaces the question rather than retrying).

Per-error-class recommendations (representative, not exhaustive):

| Error | Surface | Recommendation (to user + agent) |
|---|---|---|
| `REST_API_TRANSFORM_SUGGEST_FAILED` (from #76) | already correct shape — uses this rule | (existing) |
| `PORTAL_SQL_PARSE_ERROR` | read tool, agent + UI | "Review the SQL and retry. Agent: paste the syntax error verbatim." |
| `PORTAL_SQL_TIMEOUT` (statement_timeout) | read tool, agent + UI | "Query exceeded 30s. Try adding a WHERE filter, a tighter date range, or aggregating the source." |
| `PORTAL_SQL_PAYLOAD_TOO_LARGE` (legacy collapse path, kept for back-compat) | read tool | "The result was too large to inline. Use the handle endpoint, or filter the query down." |
| `BULK_JOB_TARGET_LOCKED` (new sibling of ENTITY_LOCKED_BY_JOB) | bulk tool, UI | "Target entity is locked by another bulk job (started 2 min ago). Wait, or cancel that job first." `details: { lockingJobId, lockingJobType, startedAt }` |
| `BULK_JOB_EXPRESSION_INVALID` (EXPLAIN failed) | bulk tool, agent + UI | "Your SQL expression failed validation. Fix the type / column mismatch and retry." `details: { pgError }` |
| `BULK_JOB_BATCH_TIMEOUT` (per-batch wall clock) | bulk-job progress widget, terminal SSE | "The transform takes longer per batch than expected. Try a smaller `batchSize`, or simplify the expression." |
| `BULK_JOB_MAX_RECORDS_EXCEEDED` | bulk tool | "The source has 2,134,000 records (max 1,000,000). Split the operation with a WHERE filter on the source." |
| `BULK_JOB_CANCELLED` | bulk-job progress widget, terminal SSE | "Cancelled at 47,000 / 100,000. Re-run the job to finish (already-committed records are idempotent — they won't double-write)." |
| `BULK_JOB_PARTIAL_FAILURE` (some records failed validation/upsert) | bulk-job progress widget, terminal SSE | "47,000 records written, 3 failed. The failed records' source ids are in the details. Inspect them and retry, or accept the partial." `details: { failures: [{ sourceId, error }] }` |
| `READ_HANDLE_EXPIRED` (24h TTL, user views old handle) | chart widget, pinned-result viewer | "The chart's data has expired from cache. Re-run the original query to refresh." `details: { expiredAt, originalSql }` |
| `READ_STREAM_INTERRUPTED` (SSE drop mid-render) | chart widget | "The data stream was interrupted. Reload to refetch from cache." |
| `PINNED_RESULT_DATA_MISSING` (pin's durable store row missing/corrupted) | pinned-result viewer | "The pinned chart's data couldn't be loaded. Re-run the original query and pin again." `details: { originalSql, originalSpec }` |
| `PORTAL_RESULT_NOT_FOUND` (pinned thing deleted) | pinned-result viewer | "This pinned result was deleted. Ask in the portal to recreate it." |

The rule applies to **informational degradations** too, not just hard errors. When sampling kicks in (R4) or a per-mark cap (R5) triggers an aggregation rewrite, the response carries an `infos[]` array of the same envelope shape (`severity: "info"`), and the widget surfaces them: *"Rendered as a 5% sample because the full dataset has 1,000,000 rows. Recommendation: ask for an aggregated view to see exact counts."*

**Rule for new code in this proposal:** no new tool, route, or display block ships without each of its error paths producing this envelope and the UI rendering it. The `silent-empty-X` class of failure is banned by contract.

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

**Lean: B + C combined.** The data-handle pattern (B) lifts the agent's caps and fixes the silent-empty-chart bug (the agent sees `{ rowCount: 47213, truncated: false }` and reports that accurately). On top of B, the **first render streams** (C) per S4 — the UI subscribes to an SSE channel keyed to the handle and the server pushes query batches as they arrive from PG; the chart fills in live. When all batches have arrived, the final state is what was cached in Redis (per R3). Re-opening the chart later serves from cache — the streaming render is only for the first viewing.

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

| | UI surface (S1) | Agent ergonomics (S2) | Lock (S3) | Incremental render (S4) | Error UX (S5) | Tool surface — writes (W1) | Cancel (W2) | Resume (W3) | Per-record compute (W5) | Read data path (R1) | Handle lifecycle (R2) | Storage (R3) | Sampling (R4) | Pin storage (P4) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Lean | Display block | Continue (W) / immediate-return (R) | Target entity (W) / `statement_timeout` (R) | SSE deltas → UI append | `ApiUserError` envelope to UI + agent | Declarative SQL | Stop at batch | Idempotent re-run | SQL primary + tool fallback | Handle + streaming | Session-scoped | Redis | Implicit + system-prompt nudge | Inline ≤100 rows; durable handle store > 100 |
| Spreads to spec | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |

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
5. Processor runs batched `INSERT INTO target_wide SELECT … FROM source_wide LIMIT 1000 OFFSET N` per batch. **Per batch commit**, it emits `{ _eventType: "batch", recordsProcessed: N, totalRecords: 100000, batchDurationMs, rows: [...committed batch rows...] }` over the SSE channel (rows payload optional and capped at batch size; toggleable per-job if the rows are too large to broadcast).
6. The `bulk-job-progress` widget renders **a live data view**, not just a percent bar. The user picks a view (bar chart of `acreage` distribution, or a paginated table of latest committed records) when the widget mounts. As each `batch` event lands, the widget calls `vega.changeset().insert(rows)` for chart views or appends to the table state. The user watches the histogram fill in column-by-column, or rows append in real time.
7. On terminal, portal injects a synthetic message into the agent's context for follow-up.

### Smoke B — read: 10k-point scatter plot of parcel acreage vs assessed value

1. User: *"Show me a scatter plot of parcel acreage vs assessed value for residential parcels."*
2. Agent dispatches:
   ```
   visualize(
     sql: "SELECT acreage, assessed_value FROM parcel_metrics WHERE class = 'Residential'",
     vegaLiteSpec: { mark: "point", encoding: { x: {field: "acreage", type: "quantitative"}, y: {field: "assessed_value", type: "quantitative"} } }
   )
   ```
3. Tool route enqueues the query (cursor-backed); response to the agent is **immediate**: `{ queryHandle: "qh-xyz", rowCount: 13427, schema: [{name: "acreage", type: "number"}, {name: "assessed_value", type: "number"}], sampled: false, truncated: false, samplePeek: [/* first 10 rows */] }`. The agent gets row count + schema before the rows have finished streaming server-side. The 13427 rows never enter the agent's context.
4. Agent's response renders as a portal message with a `query-result-data` display block carrying the handle + the Vega-Lite spec. The spec is authored against a named dataset (`data: { name: "primary" }`) so the renderer can apply changesets.
5. **UI subscribes to** `/api/portal-sql/handle/qh-xyz/stream` (SSE). Server cursors the PG query, emitting batches of ~1000 rows (or every 250ms, whichever first). Each batch is a `data` event carrying the rows array. The scatter plot mounts empty; as the first batch arrives, ~1000 points appear; the next batch adds another ~1000; the chart fills in over ~2-3 seconds for 13k rows. Same batches accumulate in Redis under the handle id for later re-open.
6. After the cursor exhausts, server closes the SSE channel; the cached snapshot in Redis is the final state. If the user resizes the chart or re-opens the portal message later, the widget falls back to `GET /api/portal-sql/handle/qh-xyz` (the snapshot endpoint) — no re-streaming needed.
7. Above 50k rows: sampling kicks in implicitly; agent sees `{ rowCount: 1_000_000, sampled: true, sampleSize: 50_000 }` and surfaces "rendered as a 5% sample because the full dataset has 1M points." Past per-mark cap: agent steered toward aggregation via system-prompt guidance.

## Recommendation

### Writes track

1. **New tool** `bulk_transform_entity_records`. Parameters: `sourceEntityId, targetEntityId, expression, keyField, batchSize?`. Expression is `{ kind: "sql", value: string }` for v1; `{ kind: "tool", ref: string }` deferred.
2. **New JobType** `bulk_transform`. Metadata declares `targetEntityId` as the locked entity; result carries `recordsProcessed, recordsFailed, durationMs, partialFailures[]`.
3. **New processor** `apps/api/src/queues/processors/bulk-transform.processor.ts`. Drives the batched INSERT/UPSERT loop, emits per-batch custom SSE events carrying both the counters and (optionally) the committed-batch row payload, honors the cancel flag.
4. **New SSE event** `{ _eventType: "batch", recordsProcessed, totalRecords, batchDurationMs, rows? }` → `job:batch`. The `rows` payload is opt-in per job (caps at `BATCH_ROW_PAYLOAD_LIMIT` bytes; large rows fall back to row-id lists for the UI to fetch separately).
5. **New lock primitive** `JobLockService.assertConnectorEntityUnlocked(entityId)` + sibling repository method.
6. **New display block** `bulk-job-progress` (frontend: `apps/web/src/components/BulkJobProgressBlock.component.tsx`). Renders a **live data widget** — bar chart, histogram, or table — that appends per `batch` SSE event via `vega.changeset` (chart) or React state (table). The user picks the view when the widget mounts; the default is a histogram over the most-recently-written column.
7. **Portal follow-up injection** on terminal SSE; new helper in `portal.service.ts`.

### Reads track

8. **New tool wrappers** — modify `sql_query`, `visualize`, `visualize_tree` to return a query-handle envelope instead of the raw rows. Backward compat: when `rowCount <= 100`, still embed `rows` inline (cheap small reads stay fast). When `rowCount > 100`, return `{ queryHandle, rowCount, schema, sampled, samplePeek }`; the data streams to the UI and accumulates in Redis.
9. **Two endpoints** for the handle:
    - `GET /api/portal-sql/handle/:handleId/stream` — SSE stream emitting batches of ~1000 rows (or every 250ms, whichever first) as the PG cursor walks the result. Used for the first render. Server-side: cursor on a read-only transaction with `statement_timeout` applied; emit-and-cache pattern.
    - `GET /api/portal-sql/handle/:handleId?offset=&limit=` — paged snapshot endpoint serving from Redis. Used for re-open (resize, scroll back, panel re-mount).
10. **Redis-backed handle storage.** TTL 24h, keyed by `{ portalId, handleId }`. Eviction policy: LRU. Populated either as the SSE stream emits (concurrent write) or in a single shot when the cursor completes.
11. **New display block** `query-result-data`. Carries handle + spec; UI opens the SSE stream on mount and appends per batch via `vega.changeset().insert(rows)` (chart) or React state (table). On the SSE channel closing, the widget switches to the snapshot endpoint for any further data access.
12. **Sampling logic** in `PortalSqlService`: above `SAMPLING_THRESHOLD` (lean: 50000 rows), apply `TABLESAMPLE BERNOULLI` (or `ORDER BY random() LIMIT N` for deterministic small samples) and mark `sampled: true` in the response envelope.
13. **Per-mark cap table** in the `visualize` / `visualize_tree` tool descriptions. Surfaced to the agent so it can plan around it.
14. **`statement_timeout`** on every portal-SQL transaction. Lean: 30s. Caught as a typed error; surfaced to the agent so it can retry with a tighter query or apply aggregation.
15. **Vega-Lite spec rewrite** at the visualize-tool layer. The agent emits a spec authored against `data: { values: [] }`; the server rewrites it to `data: { name: "primary" }` before returning to the UI, so the renderer can apply changesets. Document in the tool description so the agent doesn't need to know.

### Pinned-results track

16. **New table `portal_result_data`** keyed by `portalResultId` with `{ rows: jsonb, rowCount, schema, columnDataTypes }`. Lives in `apps/api/src/db/schema/portal-result-data.table.ts`. Soft-delete cascades from `portal_results`.
17. **Pin route extension** (`apps/api/src/routes/portal-results.router.ts`) — when the pinned block carries a `queryHandle`, branch on row count: `<=100` inline as today; `>100` fetches rows from Redis (or re-executes the SQL if Redis missed) and writes them to `portal_result_data`, replacing the handle in `content` with `{ dataSource: "pinned-store" }`.
18. **View route extension** — when `content.dataSource === "pinned-store"`, join `portal_result_data` and inline rows into the spec before returning.
19. **Re-execution-on-Redis-miss UX:** if the user pins a result whose handle has just expired, the pin operation re-runs the SQL against the live source. Surface that to the user via the S5 envelope (`severity: "info"`, recommendation: "Pinned data is fresh from the source — the original chart's cached data had expired."). Do NOT silently re-execute.

### Error-UX track (cross-cutting)

20. **Universal `ApiUserError` envelope** `{ code, message, recommendation, details? }`. Every error path in every new tool / route / display block emits this shape. The agent and the UI both consume it.
21. **`FormAlert`-style rendering** in every new display block — `bulk-job-progress`, `query-result-data`, pinned-result viewer — surfacing both the `message` and the `recommendation`. No "loading..." → blank state; either it renders data, renders progress, or renders the envelope.
22. **Informational envelopes** for non-error degradations (sampling, aggregation hint, per-mark cap fallback) — same shape with `severity: "info"`. Widget surfaces them subtly (footer chip, not modal alert) but always visibly.
23. **Pre-flight error checks** in the bulk-tool route — lock check, max-records check, EXPLAIN validation — all run before the job is enqueued so the error surfaces immediately, not as a job-failed terminal event 30 seconds later.

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
6. **Statement-timeout failure UX** (reads): when a 30s query times out, the agent sees a typed error and gets to retry. What's the agent prompt look like so it retries *productively* (tighter SQL, aggregation) rather than the same query? Probably a system-prompt addition.
7. **Backpressure on the SSE stream** (reads + writes): if the UI is slow to drain (laggy network, paused tab), the server's emit-and-cache loop could outpace the client. Lean: cache always wins (server keeps writing batches to Redis), the SSE channel drops the slowest consumer if buffer exceeds a threshold; client re-syncs via the snapshot endpoint on reconnect.
8. **Per-batch row payload size cap** (writes): the bulk-job SSE event carries committed-batch rows so the widget can render them live. If batch rows are large (geometry blobs, JSONB), the payload could blow past sensible SSE event sizes. Lean: cap at `BATCH_ROW_PAYLOAD_LIMIT` (lean: 256 KB); past the cap, emit row-id lists only and let the widget fetch by id from the wide table.
9. **Vega-Lite spec compatibility** (reads): we rewrite the agent's spec to use a named dataset for changesets. Are there spec patterns the rewrite can't handle (e.g. specs that already declare named datasets, multi-source compositions)? Audit during implementation.
10. **Quota / billing**: a 1M-record bulk job is real compute; a 100k-row read materialized to Redis costs memory; SSE streams keep connections open. Per-org budgets out of scope here.
11. **Pinned-store size cap** (pins): a 50k-row pin written to `portal_result_data` is ~10MB; multiplied across an org's pinning culture this can grow fast. Lean: per-pin row cap (lean: 100k rows) enforced at pin time; pins exceeding it produce an envelope: *"This chart is too large to pin in full. Recommendation: ask for an aggregated view, or pin a representative sample."* No silent truncation.
12. **Pin-time re-execution semantics** (pins): when Redis has evicted the handle's data and we re-execute, the new run may produce a slightly different result than the user saw at pin-click time (source data may have moved). Lean: surface as info envelope. Open: is there a stricter contract some flows need ("snapshot exactly what was on screen, fail if we can't")?
13. **Error envelope back-compat** (cross-cutting): existing tools and routes don't all emit the `recommendation` field. Lean: required field on every NEW surface in this proposal; existing surfaces grow the field opportunistically rather than as a blocking back-compat sweep.

## What this doesn't decide

- **PostGIS** — staying in JSONB for geometry (per #84). Acreage SQL in Smoke A assumes PostGIS; if it's not in place, the smoke uses the deferred `{ kind: "tool", ref: "compute_area" }` shape. Either way, the bulk-job mechanism is orthogonal.
- **Sandboxed JS** (W1 option C) — gated, deferred. Re-evaluate when ≥3 use cases surface that SQL projection can't express.
- **Distributed sharding** — single worker pool in v1.
- **Quota / billing** — flagged in open question 10.
- **Cross-portal handle sharing** (reads) — handles are portal-scoped; sharing a chart across portals is a copy operation, not a handle reference.

## Next step

Spec at `docs/LARGE_DATA_OPS.spec.md` codifies the wire contracts: `BulkTransformToolSchema`, `BulkTransformMetadataSchema`, `BulkTransformResultSchema`, new SSE event types, query-handle response envelope, handle-fetch endpoint contract. Plan at `docs/LARGE_DATA_OPS.plan.md` slices the work, roughly:

- (1) writes: JobType + schemas + lock primitive
- (2) writes: processor + cancel-flag + per-batch SSE (counters first)
- (3) writes: per-batch SSE extended with row payload (or row-ref lists past payload cap); spec rewrite for changeset support
- (4) writes: tool + EXPLAIN validation + portal follow-up
- (5) writes: live-data display block (chart + table view variants) + smoke against the acreage target
- (6) reads: query-handle envelope + Redis storage + snapshot endpoint
- (7) reads: SSE streaming endpoint (cursor-driven, emit-and-cache)
- (8) reads: `sql_query` / `visualize` / `visualize_tree` rewired for the envelope; Vega-Lite spec rewrite for named datasets
- (9) reads: sampling + statement_timeout + per-mark cap table
- (10) reads: streaming display block (mount SSE → append on each batch → fall back to snapshot on stream close) + smoke against the scatter-plot target
- (11) pins: `portal_result_data` table + soft-delete cascade; pin route extension for size-aware storage; view route extension
- (12) cross-cutting: `ApiUserError` envelope shape canonicalized; error-renderer in every new display block; pre-flight checks on the bulk-tool route

Each slice is independently shippable; writes track, reads track, and pins/error tracks can land in parallel — the writes/reads tracks share the display-block-resolver seam, and the error envelope is referenced by all of them but blocks none.
