# Large data operations during a portal session — Discovery

**Issue:** [EnterpriseBT/portal-ai#85](https://github.com/EnterpriseBT/portal-ai/issues/85)

**Why this exists.** Both directions of data flow break at high cardinality, and both fail invisibly.

- **Writes.** Agent-driven entity-record tools (`entity_record_create`, `entity_record_update`, `entity_record_delete`) cap at 100 items per call via Zod. The motivating case — *"compute acreage for each of 100k parcels and store the result in a join table"* — can't even be expressed in the current shape.
- **Reads.** Every `sql_query` (and `visualize` / `visualize_tree`, which compose on top) is implicitly wrapped to `LIMIT 501`, every cell truncated past 500 chars, and the whole response collapsed past 100KB of payload. A 10k-point scatter plot doesn't render; *it silently renders empty*, because the cap collapses `rows` away and the visualizer dutifully injects `[]` into the spec's `data.values`.

The infrastructure to do better partially exists: BullMQ workers, SSE-driven progress, the data-locking convention, and a display-block mechanism that already supports surfacing side-channel UI from a tool result. What's missing is the bridge from the agent's tool-call surface to that async / streaming pipeline. This doc proposes the bridge for both directions, names the new tools / job types / response shapes / SSE event shapes needed to ship them, and walks the smoke targets end-to-end. **This is the discovery that does X-Y-Z: profile where the bottleneck sits on each side, choose the tool-surface shape per direction, and design the bridge such that the writes track and the reads track share most of their infrastructure.**

**Pins are out of scope.** The original draft proposed a "pin = live re-executing widget" reframe that tangled deeply with reads (handle envelope, streaming render, query trace replay) and with writes (pinning a mid-job histogram). Both were scope creep. v1 keeps pins on today's snapshot semantics — the silent-empty-chart bug stays for legacy pins, and any improvement to pin UX is a separate issue (filed alongside this one for the trace-based pin design that the discovery explored before being pulled out). No `portal_results` schema changes ship from this discovery.

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

**The critical observation:** the `resolveDisplayBlock()` path is the natural bridge for reads — render a chart widget whose data is fetched by query handle from the UI, never passing through the agent's context. Writes use the *same* path differently: a `bulk-job-status` block that ticks progress text in place during the job, then a terminal *follow-up message* injected by the portal containing the result chart as a normal display block. No mid-job data widget; the chat thread is locked from user input while the job runs (same UX as waiting for any agent response), and the chart appears at terminal time in a fresh message, animating in via `vega.changeset` against the cached final dataset. Race conditions from a mid-job live widget (lock-vs-read-back conflicts, partial-state pins, cancel teardown, batch-visibility surprises) are designed out.

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

**Lean (reads): A.** `resolveDisplayBlock()` already does this; we add a `query-result-data` display-block kind that fetches by handle and streams in.

**Lean (writes): A in shape, but the block is status-only during the job and the chart is a *second* block posted in a follow-up message at terminal.** No live data widget mid-job. The bulk-tool result returns a `bulk-job-status` block bound to the job id; it ticks counters via SSE (`12,547 / 50,000 records written`) but renders no chart and accepts no pinning. On terminal, the portal injects a follow-up assistant message into the thread containing whatever display block(s) the agent prepared at dispatch time (typically a chart over the target wide table). That chart mounts empty and animates in via `vega.changeset` against the cached final dataset — same "materialize" feel as the read side, but triggered at arrival rather than during the job.

#### S2 — Agent ergonomics after dispatching a long-running operation

- **A. Agent blocks** until terminal.
- **B. Agent continues**; portal listens for the terminal SSE event and re-prompts the agent with the result.
- **C. Hybrid:** synchronous "started" return; agent decides per-call to wait or continue.

**Lean: B for writes (with chat-thread input locked at the UI), immediate-return for reads.**

For writes: the bulk tool returns immediately with the job id; the agent posts a final "I'll let you know when this finishes" message and yields the floor. The portal then **disables new user input on the chat thread until the job is terminal** — same surface as waiting for any other agent response. The agent doesn't "block" in the LLM-context sense (no expensive idle context held open for 17 minutes), but the user-facing chat behavior is identical to a long agent turn. On terminal, the portal injects a synthetic user-role message ("Job X completed. recordsProcessed: 50000, recordsFailed: 23.") into the agent's context, and the agent generates a follow-up assistant message — typically with a chart over the target wide table inline. Input unlocks when that follow-up is posted.

For reads: the data is available to the UI immediately via the handle, the agent moves on with what it already knows (row count, schema, truncation status), and the chat thread stays unlocked since reads don't lock entities.

#### S3 — Lock interaction

Writes need entity locks (existing pattern). Reads don't; PostgreSQL `statement_timeout` is the analogue for runaway queries.

- **Writes lean: target entity only.** Sibling primitive `assertConnectorEntityUnlocked(entityId)` of the existing `assertConnectorInstanceUnlocked`. Reads on either source or target stay open while the bulk job runs.
- **Reads lean: per-query `statement_timeout`.** Cap a single query's wall-clock at, say, 30 seconds. No lock, no job; just kill long queries and surface the failure to the agent so it can retry with a tighter SQL.

#### S4 — Incremental UI rendering

- **A. Status-then-arrival (writes).** During the job, a status block ticks counters in place (`12,547 / 50,000 records written`). On terminal, a fresh follow-up message containing the result chart is injected; the chart mounts empty and animates in via `vega.changeset().insert(rows)` against the cached final dataset, filling in over ~2–3 seconds. Same "materialize" feel as a streaming render, but triggered when the user actually cares (job done) rather than during a long job the user isn't watching.
- **B. Incremental render via SSE (reads).** Server cursors the PG result and emits batches; UI appends each delta as it lands via `vega.changeset().insert(rows)`. Cached final state in Redis for re-open.

**Lean: A for writes, B for reads.**

The earlier draft of this doc leaned B for both directions and rendered a live data widget *during* the bulk job. That introduced real race conditions:

- **Lock-vs-read-back.** The agent's tool-result widget shows partial data, but the target entity is locked — if the user asks a follow-up like "how many of those have acreage > 5?", the agent's read fails with `ENTITY_LOCKED_BY_JOB`. The widget says one thing; the agent says another.
- **Mid-build pinning.** If pinning were enabled mid-job, the pin captures a partial state that re-renders differently next time.
- **Cancel teardown.** Live widget has to reconcile "we received batch 47, then a `cancelled` terminal event" — non-trivial state transition.
- **Batch-visibility surprises.** Other reads on the same wide table in the same conversation see committed-but-not-final state, giving inconsistent counts.

Shifting writes to A removes all four. Reads stay on B because reads ARE the thing being asked for — there's no lock, no half-committed state, and the data is available immediately.

| | A — status + arrival (writes) | B — incremental SSE (reads) |
|---|---|---|
| Feels alive | ✅ at arrival | ✅ during stream |
| Mid-op race surface | None | N/A (no concurrent mutation) |
| Server complexity | Existing per-batch SSE used for status counters only; row payload not broadcast | Medium — cursor + emit-and-cache |
| Client complexity | Low for status; chart is a normal mount-and-load | Medium — manage incremental state per widget type |
| Final-state re-open | Trivial — chart's data IS the final snapshot | Need to cache the final state separately |

**Backpressure / batching policy.** Writes-side SSE carries status counters only (one event per batch commit ≈ every few hundred ms); payload size is bounded by the counter shape, no row data. Reads-side SSE cursors through the PG result and emits batches when (a) 1000 rows have accumulated OR (b) 250ms has elapsed since the last emit. Either trigger flushes a batch; whichever comes first. Keeps the UI's re-render rate bounded.

**Widget-specific incremental support** (applies to reads-side streaming render and to writes-side terminal-arrival animation):

- *Table:* trivially append rows.
- *Bar chart, line chart, scatter:* Vega-Lite supports incremental updates via `vega.changeset().insert(rows)` against a named dataset. Spec must declare `data: { name: "primary" }` rather than `data: { values: [] }`; the renderer attaches the changeset stream after mount.
- *Tree / treemap / hierarchical:* incremental is harder — the layout depends on the full dataset. Lean: batch arrivals client-side, debounce re-layout to every 500ms.
- *Map (per #84):* points / polygons append cleanly to a MapLibre layer; clustering / heatmap layers re-bucket on each batch.

#### S5 — Error UX: surface every error + recommend a next action

**First-order rule for this entire surface: every failure mode surfaces to the user, every surfaced error includes a recommendation of what to do next.** The silent-empty-chart bug (the read-side payload-collapse the new design already fixes) is the canonical anti-pattern we're escaping from. Don't reintroduce it on the write side.

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

1. **The UI** — display blocks, the chart/table widget, and the bulk-job status block all render an MUI `<Alert>` with the `message` as the title and the `recommendation` as the body. Severity matches the kind (warning for recoverable, error for terminal). The `code` is rendered as the chip-style suffix already used by `FormAlert` so the user can quote it in a support thread.
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
| `BULK_JOB_BATCH_TIMEOUT` (per-batch wall clock) | bulk-job status block, terminal follow-up | "The transform takes longer per batch than expected. Try a smaller `batchSize`, or simplify the expression." |
| `BULK_JOB_MAX_RECORDS_EXCEEDED` | bulk tool | "The source has 2,134,000 records (max 1,000,000). Split the operation with a WHERE filter on the source." |
| `BULK_JOB_CANCELLED` | bulk-job status block, terminal follow-up | "Cancelled at 47,000 / 100,000. Re-run the job to finish (already-committed records are idempotent — they won't double-write)." |
| `BULK_JOB_PARTIAL_FAILURE` (some records failed validation/upsert) | bulk-job status block, terminal follow-up | "47,000 records written, 3 failed. The failed records' source ids are in the details. Inspect them and retry, or accept the partial." `details: { failures: [{ sourceId, error }] }` |
| `READ_HANDLE_EXPIRED` (24h TTL, user views old handle) | chart widget | "The chart's data has expired from cache. Re-run the original query to refresh." `details: { expiredAt, originalSql }` |
| `READ_STREAM_INTERRUPTED` (SSE drop mid-render) | chart widget | "The data stream was interrupted. Reload to refetch from cache." |

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

For "acreage from geometry" / "centroid from polygon" / "normalized address" / "distance to nearest hospital" / "extract entities from raw text via LLM" / arbitrary computation provided by a custom toolpack (per #65 / #84):

- **A. SQL projection at the wide table** (fastest, single statement, requires SQL-expressible operations + PostGIS for spatial).
- **B. Server-side per-record tool dispatch** — bulk job invokes a registered tool once per record. Works for arbitrary computation: HTTP API lookups, sandboxed JS from a custom toolpack, geocoding services, LLM-per-record enrichment.

**Lean: both, first-class in v1.** The `expression` discriminator is `{ kind: "sql", value: string } | { kind: "tool", ref: string, args?: Record<string, unknown> }`. SQL is the fast path for SQL-expressible operations; tool dispatch is the only path for "anything else" — and "anything else" covers the bulk of agent-driven workflows once custom toolpacks ship per #65. Deferring tool dispatch would force the agent to enumerate records inline for any compute the SQL function set doesn't cover, which is the exact failure mode the proposal exists to fix.

The mechanics of tool dispatch (contract, batching, concurrency, rate limiting, failure surfacing) are substantive enough to need their own section — see *Per-record tool dispatch* below.

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

## Per-record tool dispatch (the non-SQL case)

The SQL-projection path covers operations like `ST_Area(geometry) / 4047` cleanly, but it can't express:

- **External API lookups per record** (geocoding, currency conversion at point-in-time, third-party enrichment).
- **Custom-toolpack invocations** — once #65 ships, an organization can register their own tools doing arbitrary computation. Some of those make sense to apply per-record (compute a credit-risk score from a row's columns; normalize an address through the org's own normalizer; classify a free-text column via the org's domain-specific model).
- **LLM enrichment per record** — sentiment, entity extraction, summarization on a `notes` column. Each call is its own model invocation; can't be a single SQL statement.
- **Built-in tools that wrap geometry / financial / statistical computation** beyond what's in PostgreSQL (the #84 GIS toolpack's `compute_distance_to_nearest`, `point_in_polygon`, `buffer`, etc.).

For 50k+ records, none of these can be inline tool calls per S4's reasoning. They need bulk-job dispatch.

### Dispatch contract

A tool can opt into being a target of `bulk_transform` by declaring a `bulkDispatch` field on its `ToolpackTool` metadata (`packages/core/src/registries/builtin-toolpacks.ts:42-47`):

```ts
interface ToolpackTool {
  name: string;
  description: string;
  parameterSchema: Record<string, unknown>;
  examples?: ToolpackToolExample[];
  bulkDispatch?: {
    /** Max concurrent invocations the bulk processor will run at once.
     *  External-API tools cap low (5-10) to respect rate limits;
     *  pure-compute tools (turf.js distance math, sandboxed JS) can
     *  go higher (50-100). */
    maxConcurrency: number;
    /** Per-call wall-clock cap. Calls past this are aborted and
     *  recorded as a partial failure for that record. */
    timeoutMs: number;
    /** Optional org-wide rate limit, in calls per second. The bulk
     *  processor applies a token bucket. Used by tools that wrap a
     *  third-party API with metered access. */
    ratePerSec?: number;
    /** Whether the tool's per-record output is idempotent given the
     *  same record + args. Affects resumability semantics (W3). */
    idempotent: boolean;
  };
}
```

**Opt-in is deliberate.** A tool that makes external paid API calls or has side effects shouldn't get accidentally fanned-out 50k-wide by a curious agent. Tools without `bulkDispatch` are rejected at the bulk-tool route with an S5 envelope: *"This tool isn't bulk-dispatchable. Recommendation: ask the tool's author to add `bulkDispatch` metadata, or compose this operation with an SQL projection first."*

### Per-batch mechanics

The bulk-transform processor branches on `expression.kind`:

- **`"sql"`:** existing batched `INSERT INTO target_wide SELECT … FROM source_wide LIMIT batchSize OFFSET N` path.
- **`"tool"`:** load batch of N records via cursor; invoke the tool per record with `pLimit(maxConcurrency)`; collect `{ keyField, result | error }` tuples; upsert the successes into the target wide table (`INSERT … VALUES`-style, generated from results); record failures in a per-job `partialFailures[]` accumulator.

Pseudocode:

```ts
const limit = pLimit(tool.bulkDispatch.maxConcurrency);
const tokens = tool.bulkDispatch.ratePerSec
  ? new TokenBucket(tool.bulkDispatch.ratePerSec)
  : null;

for (const batch of cursorBatches(sourceQuery, batchSize)) {
  const results = await Promise.all(
    batch.map((record) =>
      limit(async () => {
        if (tokens) await tokens.acquire();
        try {
          const result = await withTimeout(
            tool.invoke(record, expression.args),
            tool.bulkDispatch.timeoutMs,
          );
          return { key: record[keyField], result };
        } catch (err) {
          return { key: record[keyField], error: toApiUserError(err) };
        }
      }),
    ),
  );
  await upsertSuccesses(targetEntity, results, keyField);
  emitBatchSseEvent({ recordsProcessed, totalRecords, rows: successRows });
  collectFailures(results);
}
```

Per-tool concurrency is bounded by `maxConcurrency`; the per-batch wall-clock cap from W4 is the backstop ("if a batch takes longer than 10× typical, the job aborts with a clear failure").

### Time / cost estimation up-front

For SQL projection, the pre-flight EXPLAIN gives the agent + user a useful estimate ("expectedRecords / records-per-second"). Tool dispatch is wildly variable — an external geocoding API at 10 req/s on 50k records is ~83 minutes, whereas a pure-compute turf.js distance calculation at 100 concurrent is ~5 minutes. The agent has no way to know.

Lean: tools declare a `costHint` (qualitative) and the bulk-tool route computes an ETA from `recordCount / (maxConcurrency × estimatedMsPerCall)`:

```ts
bulkDispatch: {
  // …
  estimatedMsPerCall?: number;  // typical per-call duration; for ETA
  costHint?: "cheap" | "metered" | "expensive";  // pricing tier
}
```

The tool-call response to the agent includes the ETA + a `costHint` echo so the agent can confirm with the user before launching a 90-minute job (*"This will take about 1h 30min and uses metered Mapbox API calls. Proceed?"*). For costHint `expensive`, the route can require an explicit `acknowledgeCost: true` field on the tool-call to force the agent through a confirmation gate.

### Read-side: deriving columns for a visualization

The agent can't `visualize` directly off a tool's per-record output — there's no SQL view to query. Two composition paths:

- **A. Two-step.** Agent dispatches `bulk_transform` to materialize the derived column to a target entity, then `visualize`s the target. Persistent; reusable across multiple charts; works with the read-side handle/streaming pipeline as-is.
- **B. One-shot fused** (future). A `map_and_visualize` tool pipelines: per-record tool call → result accumulated into the chart's data stream → SSE delivers the chart. No persisted intermediate.

**Lean: A for v1.** It's composable, reuses every existing decision, and the agent can word the workflow as two distinct steps ("first I'll compute the distances; then I'll chart them"). B is a real optimization for the "one-off visualization derived from a custom compute" case; defer until the two-step pattern's friction is concrete.

### Failure surfacing for tool dispatch

Tool calls fail more diversely than SQL ones (API rate limit, transient network, malformed input, the tool itself throws). The per-record dispatcher catches and classifies into the S5 envelope. The terminal bulk-job result's `partialFailures` array carries:

```ts
{
  sourceKey: string;
  error: ApiUserError;  // { code, message, recommendation, details? }
}
```

The `bulk-job-status` block surfaces the partial-failure count live (*"47,000 written, 1,247 failed"*) — counters only, no inline list. At terminal, the agent's follow-up message includes a failure-table display block listing the per-record errors with a "retry failed only" affordance — kicking off another bulk_transform scoped to just the failed source keys.

### Custom toolpacks (#65 integration)

Once organizations can register their own toolpacks, the `bulkDispatch` metadata is part of the registration contract: a custom tool author marks their tool as bulk-dispatchable + declares concurrency / rate limits. The bulk-tool route doesn't need to know whether the tool is built-in or org-registered; the dispatch contract is the same.

This is the path through which an org's domain logic (proprietary scoring, internal API enrichment, custom geospatial calculations) lights up at 50k-record scale without the org's authors having to write a job processor.

## Tradeoff comparison

| | UI surface (S1) | Agent ergonomics (S2) | Lock (S3) | Incremental render (S4) | Error UX (S5) | Tool surface — writes (W1) | Cancel (W2) | Resume (W3) | Per-record compute (W5) | Read data path (R1) | Handle lifecycle (R2) | Storage (R3) | Sampling (R4) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Lean | Display block (status-only for writes, data widget for reads) | Continue + chat-locked (W) / immediate-return (R) | Target entity (W) / `statement_timeout` (R) | Status-then-arrival (W) / SSE deltas → UI append (R) | `ApiUserError` envelope to UI + agent | Declarative SQL | Stop at batch | Idempotent re-run | **Both SQL + tool dispatch first-class in v1** | Handle + streaming | Session-scoped | Redis | Implicit + system-prompt nudge |
| Spreads to spec | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |

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
4. UI renders a `bulk-job-status` display block tied to the jobId — counters + ETA, no chart. SSE subscription opens. Agent posts a final assistant message ("Importing 100,000 parcels — I'll let you know when it finishes.") and yields the floor. The portal disables new user input on the chat thread.
5. Processor runs batched `INSERT INTO target_wide SELECT … FROM source_wide LIMIT 1000 OFFSET N` per batch. **Per batch commit**, it emits `{ _eventType: "batch", recordsProcessed: N, totalRecords: 100000, batchDurationMs }` over the SSE channel. Counters only — no row payload.
6. The `bulk-job-status` block updates the counter text in place as each batch event arrives. No chart, no `vega.changeset` mid-job.
7. On terminal, the portal injects a synthetic user-role message into the agent's context (`Job <id> completed. recordsProcessed: 100000, recordsFailed: 0, durationMs: …`). Agent generates a follow-up assistant message in the thread. The follow-up typically calls `visualize("SELECT acreage FROM parcel_metrics", { mark: "bar", … })` and the resulting chart block animates in via `vega.changeset().insert(rows)` against the (now-final) target wide table — same materialize feel as the read side, at arrival rather than during the job. Input unlocks when the follow-up posts.

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

### Smoke C — write via custom tool: 50k parcels, distance to nearest hospital

1. User: *"For each parcel, compute the distance to the nearest hospital and store it in a `parcel_hospital_distance` entity keyed by parcel_id."*
2. Distance-to-hospital is NOT SQL-expressible without a join against a hospitals table that the org may not have. They've registered (per #65) or built-in (per #84) a `compute_distance_to_nearest_hospital(parcel) → { distance_km, hospital_name }` tool that hits an external geospatial API. The tool declares `bulkDispatch: { maxConcurrency: 10, timeoutMs: 5000, ratePerSec: 50, idempotent: true, estimatedMsPerCall: 200, costHint: "metered" }`.
3. Agent dispatches:
   ```
   bulk_transform_entity_records(
     sourceEntityId: "ce-parcels-…",
     targetEntityId: "ce-parcel-hospital-distance-…",
     expression: { kind: "tool", ref: "compute_distance_to_nearest_hospital" },
     keyField: "parcel_id",
     batchSize: 1000,
     acknowledgeCost: true,  // because the tool declared costHint: "metered"
   )
   ```
4. Pre-flight: tool exists, `bulkDispatch` set, target unlocked. Route computes ETA: `50000 / (10 × 5 per second) = ~17 minutes`. Returns immediately to the agent: `{ jobId, expectedRecords: 50000, estimatedSeconds: 1020, costHint: "metered" }`. Agent surfaces the cost + ETA to the user: *"This will take about 17 minutes and uses metered API calls. I'll let you know when it finishes."* Status block mounted; portal locks the chat thread.
5. Processor loads batches of 1000 records via cursor. For each batch: invokes the tool 10 concurrently (capped by `maxConcurrency`); token bucket bounds total throughput at 50 calls/sec. Successful results are upserted in one statement per batch; failed records collected in `partialFailures[]`.
6. Per-batch SSE event fires after each commit: `{ recordsProcessed: N, totalRecords: 50000, batchDurationMs: 20000, failureCount: 3 }`. Counters only — no row payload. The `bulk-job-status` block updates "47,000 / 50,000 written, 23 failed" in place. No mid-job histogram.
7. On terminal: SSE final event carries `{ recordsProcessed: 49977, recordsFailed: 23, durationMs: 998000, partialFailures: [...] }`. Portal injects a synthetic user-role message; agent generates a follow-up assistant message. That follow-up typically contains (a) a chart block over the target wide table (live histogram of `distance_km`, animates in via `vega.changeset`), and (b) a paginated failure-table block over `partialFailures[]` with a "retry failed only" affordance. Clicking "retry failed only" dispatches a follow-up `bulk_transform` scoped to the 23 failed source keys (same chat-lock cycle).
8. The agent can now visualize the derived data normally: `visualize("SELECT distance_km FROM parcel_hospital_distance", { mark: "bar", … })` — the read-side handle/streaming pipeline takes it from there. (In practice, step 7's follow-up already calls this.)

## Recommendation

### Writes track

1. **New tool** `bulk_transform_entity_records` added to **`ENTITY_MANAGEMENT_PACK`** in `packages/core/src/registries/builtin-toolpacks.ts`. Wired in `tools.service.ts:419-…` alongside `entity_record_create` and gated on the existing `hasWrite` station-capability check (`apps/api/src/services/tools.service.ts:421-426`). **Not** in `DATA_QUERY_PACK` — even though the SQL-projection expression reads from the source, the operation produces writes and must be gated accordingly. Parameters: `sourceEntityId, targetEntityId, expression, keyField, batchSize?, acknowledgeCost?`. Expression is `{ kind: "sql", value: string } | { kind: "tool", ref: string, args?: object }` — **both shapes ship in v1**.
2. **New JobType** `bulk_transform`. Metadata declares `targetEntityId` as the locked entity; result carries `recordsProcessed, recordsFailed, durationMs, partialFailures[]`.
3. **New processor** `apps/api/src/queues/processors/bulk-transform.processor.ts`. Drives the batched UPSERT loop; branches on `expression.kind` for the per-batch payload (SQL projection vs tool dispatch). Emits per-batch custom SSE events carrying counters and committed-row payload; honors the cancel flag.
4. **New SSE event** `{ _eventType: "batch", recordsProcessed, totalRecords, batchDurationMs, failureCount? }` → `job:batch`. **Counters only — no row payload.** The previous draft proposed broadcasting committed batch rows so the UI could render them live; that path is removed alongside the live data widget (S4 lean A).
5. **New lock primitive** `JobLockService.assertConnectorEntityUnlocked(entityId)` + sibling repository method.
6. **New display block** `bulk-job-status` (frontend: `apps/web/src/components/BulkJobStatusBlock.component.tsx`). Renders a **status-only** block: counters (records processed / total / failed), ETA, and the SSE-driven progress text — no chart, no data view. Failure count surfaces inline; the failure list itself appears only at terminal time (in the agent's follow-up message, as a separate display block).
7. **Chat-thread input lock** during a running bulk job. UI state derived from the open SSE channel for the job id (or from the `bulk-job-status` block's terminal flag). On terminal, input unlocks once the agent posts its follow-up message. Same UX as waiting for any other long agent turn.
8. **Portal follow-up injection** on terminal SSE; new helper in `portal.service.ts`. Synthesizes a user-role message into the agent's context with the terminal result payload; the agent's follow-up assistant message typically contains a chart block over the target wide table (uses the read-side handle/streaming pipeline, animates in via `vega.changeset` against the cached final dataset) and, if applicable, a failure-table block.

### Tool-dispatch track (non-SQL per-record compute)

8a. **`bulkDispatch` metadata on `ToolpackTool`** (`packages/core/src/registries/builtin-toolpacks.ts:42`). Opt-in field with `{ maxConcurrency, timeoutMs, ratePerSec?, idempotent, estimatedMsPerCall?, costHint? }`. Tools without this field are rejected from `expression: { kind: "tool" }` dispatch at the bulk-tool route — with an S5 envelope explaining how to add it.
8b. **Dispatcher** `apps/api/src/queues/processors/bulk-transform-tool.dispatcher.ts` (a helper invoked by the bulk-transform processor when `expression.kind === "tool"`). Loads each batch via cursor, fans out via `pLimit(maxConcurrency)` + optional token bucket for `ratePerSec`, applies `withTimeout(timeoutMs)` per call, collects success / failure tuples, upserts successes by `keyField`.
8c. **Cost-acknowledgement gate.** Tools declared `costHint: "expensive"` require the agent to pass `acknowledgeCost: true` in the tool-call. Route rejects without it and surfaces the S5 envelope: *"This operation calls a costly tool. Confirm with the user, then retry with `acknowledgeCost: true`."* `"metered"` shows the cost in the ETA response; agent surfaces to user before launching but doesn't gate.
8d. **Per-record-failure surfacing.** Bulk-job result's `partialFailures: [{ sourceKey, error: ApiUserError }]` array carries per-record errors. The agent's terminal follow-up message includes a paginated failure-table display block; "retry failed only" affordance on that block dispatches a follow-up `bulk_transform` scoped to those source keys.
8e. **`compute_distance_to_nearest_hospital` smoke target** (or whichever GIS tool from #84 is the v1 vehicle) — adopts `bulkDispatch` metadata to validate the dispatcher end-to-end on a real-world tool with rate limits.

### Reads track

8. **Modify existing tools in `DATA_QUERY_PACK`** — `sql_query`, `visualize`, `visualize_tree` keep their slots in the data-query pack but their **internals** rewire to return a query-handle envelope instead of raw rows. Backward compat: when `rowCount <= 100`, still embed `rows` inline (cheap small reads stay fast). When `rowCount > 100`, return `{ queryHandle, rowCount, schema, sampled, samplePeek }`; the data streams to the UI and accumulates in Redis. No new tools added to this pack.
9. **Two endpoints** for the handle:
    - `GET /api/portal-sql/handle/:handleId/stream` — SSE stream emitting batches of ~1000 rows (or every 250ms, whichever first) as the PG cursor walks the result. Used for the first render. Server-side: cursor on a read-only transaction with `statement_timeout` applied; emit-and-cache pattern.
    - `GET /api/portal-sql/handle/:handleId?offset=&limit=` — paged snapshot endpoint serving from Redis. Used for re-open (resize, scroll back, panel re-mount).
10. **Redis-backed handle storage.** TTL 24h, keyed by `{ portalId, handleId }`. Eviction policy: LRU. Populated either as the SSE stream emits (concurrent write) or in a single shot when the cursor completes.
11. **New display block** `query-result-data`. Carries handle + spec; UI opens the SSE stream on mount and appends per batch via `vega.changeset().insert(rows)` (chart) or React state (table). On the SSE channel closing, the widget switches to the snapshot endpoint for any further data access.
12. **Sampling logic** in `PortalSqlService`: above `SAMPLING_THRESHOLD` (lean: 50000 rows), apply `TABLESAMPLE BERNOULLI` (or `ORDER BY random() LIMIT N` for deterministic small samples) and mark `sampled: true` in the response envelope.
13. **Per-mark cap table** in the `visualize` / `visualize_tree` tool descriptions. Surfaced to the agent so it can plan around it.
14. **`statement_timeout`** on every portal-SQL transaction. Lean: 30s. Caught as a typed error; surfaced to the agent so it can retry with a tighter query or apply aggregation.
15. **Vega-Lite spec rewrite** at the visualize-tool layer. The agent emits a spec authored against `data: { values: [] }`; the server rewrites it to `data: { name: "primary" }` before returning to the UI, so the renderer can apply changesets. Document in the tool description so the agent doesn't need to know.

### Error-UX track (cross-cutting)

16. **Universal `ApiUserError` envelope** `{ code, message, recommendation, details? }`. Every error path in every new tool / route / display block emits this shape. The agent and the UI both consume it.
17. **`FormAlert`-style rendering** in every new display block — `bulk-job-status`, `query-result-data` — surfacing both the `message` and the `recommendation`. No "loading..." → blank state; either it renders data, renders progress, or renders the envelope.
18. **Informational envelopes** for non-error degradations (sampling, aggregation hint, per-mark cap fallback) — same shape with `severity: "info"`. Widget surfaces them subtly (footer chip, not modal alert) but always visibly.
19. **Pre-flight error checks** in the bulk-tool route — lock check, max-records check, EXPLAIN validation — all run before the job is enqueued so the error surfaces immediately, not as a job-failed terminal event 30 seconds later.

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
7. **Backpressure on the SSE stream** (reads): if the UI is slow to drain (laggy network, paused tab), the server's emit-and-cache loop could outpace the client. Lean: cache always wins (server keeps writing batches to Redis), the SSE channel drops the slowest consumer if buffer exceeds a threshold; client re-syncs via the snapshot endpoint on reconnect. (Writes-side SSE carries counters only, no backpressure concern.)
8. **Vega-Lite spec compatibility** (reads + writes terminal chart): we rewrite the agent's spec to use a named dataset for changesets. Are there spec patterns the rewrite can't handle (e.g. specs that already declare named datasets, multi-source compositions)? Audit during implementation.
9. **Quota / billing**: a 1M-record bulk job is real compute; a 100k-row read materialized to Redis costs memory; SSE streams keep connections open. Per-org budgets out of scope here.
10. **Error envelope back-compat** (cross-cutting): existing tools and routes don't all emit the `recommendation` field. Lean: required field on every NEW surface in this proposal; existing surfaces grow the field opportunistically rather than as a blocking back-compat sweep.
11. **Tool-internal rate limits vs server-side `ratePerSec`** (tool dispatch): if a tool wraps an API with a quota the server can't see (e.g. customer's own Mapbox key has 5 req/s limit), how do we surface the rate-limit failure? Lean: the tool's per-call error path returns a typed `RATE_LIMITED` error, the dispatcher catches it and backs off + retries with exponential delay (cap N tries per record). Open: do we expose tool-internal backoff state to the user / agent?
12. **Sub-tool dispatch depth** (tool dispatch): if a bulk-dispatched tool's per-record handler itself calls another tool — possibly another bulk-dispatchable one — what's the recursion contract? Lean: hard cap at depth 1; recursive bulk dispatch (a bulk job inside a bulk job) is rejected with an S5 envelope. Audit when implementing whether any legitimate use case is blocked.
13. **Cost-acknowledgement UX through the agent** (tool dispatch): for `costHint: "expensive"` tools, the route requires `acknowledgeCost: true` and the agent surfaces a confirmation question to the user. The agent currently has no first-class affordance for "ask the user a yes/no before taking action." Need to confirm the existing portal-message flow supports this naturally, or add a system-prompt addition. Likely fine.
14. **Chat-thread unlock latency** (writes): the input lock releases when the agent posts its terminal follow-up. If the follow-up takes 10s to generate (a chart + a failure table), the user sees "locked" for 10s after the SSE terminal event arrives. Acceptable, but worth a status hint in the locked-input affordance ("Generating follow-up…").

## What this doesn't decide

- **PostGIS** — staying in JSONB for geometry (per #84). Acreage SQL in Smoke A assumes PostGIS; if it's not in place, the smoke uses the deferred `{ kind: "tool", ref: "compute_area" }` shape. Either way, the bulk-job mechanism is orthogonal.
- **Sandboxed JS** (W1 option C) — gated, deferred. Re-evaluate when ≥3 use cases surface that SQL projection can't express.
- **Distributed sharding** — single worker pool in v1.
- **Quota / billing** — flagged in open question 9.
- **Cross-portal handle sharing** (reads) — handles are portal-scoped; sharing a chart across portals is a copy operation, not a handle reference.
- **Pins.** Untouched by this discovery. Today's snapshot semantics (silent-empty-chart bug, no freshness) stay as-is. The "live re-executing trace-based pin" design space — including the trace replay engine, args-with-refs language, tool-pinnability flag, and the legacy-pin compatibility cut — is filed as a separate issue. No `portal_results` schema or route changes ship from here.

## Next step

Spec at `docs/LARGE_DATA_OPS.spec.md` codifies the wire contracts: `BulkTransformToolSchema`, `BulkTransformMetadataSchema`, `BulkTransformResultSchema`, new SSE event types, query-handle response envelope, handle-fetch endpoint contract. Plan at `docs/LARGE_DATA_OPS.plan.md` slices the work, roughly:

- (1) writes: JobType + schemas + lock primitive
- (2) writes: processor + cancel-flag + per-batch SSE (counters only) — SQL path only
- (3) writes: tool + EXPLAIN validation + portal follow-up injection on terminal
- (4) writes: `bulk-job-status` display block (status-only, counters via SSE) + chat-thread input lock + smoke against the acreage target (Smoke A)
- (4a) writes — tool dispatch: `bulkDispatch` metadata on `ToolpackTool`; dispatcher with `pLimit` + token bucket + `withTimeout`; cost-acknowledgement gate
- (4b) writes — tool dispatch: per-record-failure surfacing in the terminal follow-up + "retry failed only" affordance; smoke target against the GIS distance-to-nearest tool (Smoke C)
- (5) reads: query-handle envelope + Redis storage + snapshot endpoint
- (6) reads: SSE streaming endpoint (cursor-driven, emit-and-cache)
- (7) reads: `sql_query` / `visualize` / `visualize_tree` rewired for the envelope; Vega-Lite spec rewrite for named datasets
- (8) reads: sampling + statement_timeout + per-mark cap table
- (9) reads: streaming display block (mount SSE → append on each batch → fall back to snapshot on stream close) + smoke against the scatter-plot target
- (10) cross-cutting: `ApiUserError` envelope shape canonicalized; error-renderer in every new display block; pre-flight checks on the bulk-tool route

Each slice is independently shippable; writes track and reads track can land in parallel — they share the display-block-resolver seam, and the error envelope is referenced by both but blocks neither. **Pins are filed as a separate issue** (see "What this doesn't decide" above); no slice in this plan touches `portal_results`.
