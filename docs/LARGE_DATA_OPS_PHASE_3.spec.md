# Large data operations — Phase 3: Reads track — Spec

**Phase 3 ships the reads flow end-to-end. After Phase 3 lands, `sql_query` / `visualize` / `visualize_tree` return a query-handle envelope when the result set is large; the UI subscribes to an SSE channel keyed by the handle and the chart fills in batch-by-batch as the PG cursor walks; the cached final state in Redis serves re-opens; sampling kicks in implicitly above 50k rows; `statement_timeout` kills runaway queries; Vega-Lite specs are rewritten so the renderer can apply changesets. Smoke B — 13k-point scatter plot of parcel acreage vs assessed value — fills in over ~2–3 seconds without the agent ever seeing the rows. Phase 3 also picks up the `rowIds` fallback for Phase 2's oversized-batch case via a per-entity row-fetch endpoint that composes on the read-side cache.**

Discovery: `docs/LARGE_DATA_OPS.discovery.md`. Phase 1: `docs/LARGE_DATA_OPS_PHASE_1.{spec,plan}.md` (wire contracts). Phase 2: `docs/LARGE_DATA_OPS_PHASE_2.{spec,plan}.md` (writes-SQL). Issue: [#85](https://github.com/EnterpriseBT/portal-ai/issues/85).

## Scope

### In scope

1. **`PortalSqlHandleService`** (`apps/api/src/services/portal-sql-handle.service.ts`, new). Owns the lifecycle of a query handle: produce, stream, cache, snapshot, expire. Backed by Redis under keys `portal-sql:handle:{handleId}:meta` (envelope) and `portal-sql:handle:{handleId}:batches:{batchIndex}` (per-batch row chunks). TTL = `READ_HANDLE_TTL_MS` (24h from Phase 1). On `producer.run(sql, opts)`:
   - Open a PG cursor inside a read-only transaction with `SET LOCAL statement_timeout = STATEMENT_TIMEOUT_MS`.
   - Walk in batches via `FETCH N`; for each batch, write the rows into Redis under the next batch index AND publish them to the Pub/Sub channel `portal-sql:handle:{handleId}:stream`.
   - When the cursor exhausts, write the final meta envelope (with `rowCount`, `schema`, `sampled`, `samplePeek` derived from batches 0+1) and close the channel with a `complete` event.
   - On `statement_timeout`: emit a typed `PORTAL_SQL_TIMEOUT` error to the channel + persist as the envelope's terminal state.

2. **Two HTTP endpoints** (new file `apps/api/src/routes/portal-sql-handle.router.ts`):
   - `GET /api/portal-sql/handle/:handleId/stream` — SSE. Subscribes to the per-handle Pub/Sub channel; replays cached batches that are already in Redis (so a late-mounting client doesn't miss the first batches), then forwards live batches until `complete`.
   - `GET /api/portal-sql/handle/:handleId` (optional `?offset=&limit=`) — JSON snapshot. Reads the cached batches from Redis, returns paginated row data. Limit capped server-side at 5,000 rows per response.

3. **`sql_query` tool rewires** (`apps/api/src/tools/sql-query.tool.ts`). Inside `execute`:
   - Run the existing parse + view-binding logic from `PortalSqlService.runSqlQuery`.
   - If the result row count `≤ INLINE_ROWS_THRESHOLD` (100): inline rows as today.
   - If `> INLINE_ROWS_THRESHOLD`: produce a handle (delegating to `PortalSqlHandleService`), return the `QueryHandleEnvelope` from Phase 1. The agent sees rowCount + schema + a 10-row peek; the rows themselves never enter the context window.

4. **`visualize` + `visualize_tree` tool rewires** (`apps/api/src/tools/visualize.tool.ts`, `visualize-tree.tool.ts`). Same handle-or-inline decision; in either case, the tool returns the Vega-Lite spec + (when handle path) the handle envelope. The spec is **rewritten** at the tool layer before return: `data: { values: [] }` → `data: { name: "primary" }` so the renderer can apply changesets. The tool descriptions document the per-mark caps so the agent steers users toward aggregation when row counts would render unreadably (e.g. 50k-point scatter → use a hex-bin or aggregate).

5. **Vega-Lite spec rewrite utility** (`apps/api/src/utils/vega-spec-rewrite.util.ts`, new). Pure function `rewriteForNamedDataset(spec, datasetName = "primary"): VegaLiteSpec`. Handles the common single-source case; for already-named-dataset specs, no-op. Audited at implementation against the existing test corpus in `visualize.tool.test.ts`.

6. **Sampling** (in `PortalSqlHandleService.producer`). Above `SAMPLING_THRESHOLD` (50000 rows from Phase 1), the producer wraps the user SQL: `SELECT * FROM (<user_sql>) _src ORDER BY random() LIMIT <SAMPLE_SIZE>`. Marks `sampled: true` and sets `sampleSize` in the envelope. `SAMPLE_SIZE` constant added (lean: 50000 — match the threshold).

7. **`statement_timeout` enforcement.** Producer runs the query in a transaction starting with `SET LOCAL statement_timeout = 30000` (from `STATEMENT_TIMEOUT_MS`). PG cancels any statement past the limit; the catch in the producer translates `57014` (query_canceled) into `PORTAL_SQL_TIMEOUT` with a recommendation. Note: `statement_timeout` applies per-statement; with a cursor, each `FETCH` is its own statement, so the timeout applies to per-batch fetches rather than total query runtime. Acceptable for v1 — runaway queries trip on the initial `DECLARE … FOR <user_sql>`.

8. **Per-mark cap table in tool descriptions.** A `MARK_CAPS` constant in `apps/api/src/tools/visualize.tool.ts` exposes the per-mark thresholds (lean: scatter/point 50000, bar 1000, line 5000, area 5000); the tool's `description` string surfaces them so the agent factors them into spec choice. No runtime enforcement in Phase 3; the agent decides via system-prompt awareness. (Hard runtime enforcement is a follow-up if telemetry shows it matters.)

9. **`query-result-data` display block** (`apps/web/src/components/QueryResultDataBlock.component.tsx`, new). Carries the handle envelope + the (rewritten) Vega-Lite spec. On mount:
   - Open the SSE stream at `/api/portal-sql/handle/:id/stream`.
   - Per `data` event: append rows via `vega.changeset().insert(rows)` (chart) or to React state (table).
   - On `complete` event: close the SSE.
   - On resize / re-mount: fall back to the snapshot endpoint `GET /api/portal-sql/handle/:id` and re-render against the cached final dataset.
   - On `READ_HANDLE_EXPIRED` error envelope: render the universal `ApiUserError` block.

10. **Update `vega-lite` display block consumer.** The existing `vega-lite` block previously carried inline rows in `content.data.values`. The new consumer detects when the block content carries a `queryHandle` (set by the rewritten `visualize` tool) and mounts the `QueryResultDataBlock` instead of inlining. Legacy blocks (no `queryHandle`) keep today's render path — no migration needed.

11. **`rowIds` fallback for writes** (closes the Phase 2 deferral). New endpoint `POST /api/connector-entities/:entityId/rows-by-id` returns `{ rows: Row[] }` for a given set of `record_id`s, projecting all `c_*` columns (subject to entity read capability + org scope). Phase 2's `BulkJobProgressBlock` is extended (small follow-up edit) to handle `job:batch` events where `rowIds` is set instead of `rows`: it issues this endpoint and merges the result into its rendered view.

12. **Smoke B — acceptance integration test.** New integration test `apps/api/src/__tests__/__integration__/portal-sql-handle-smoke-b.integration.test.ts`:
   - Seed 13,000 synthetic parcels into a wide table.
   - Drive `visualize` with a scatter-plot SQL that selects acreage + assessed_value.
   - Assert: tool returns a handle envelope; the SSE channel emits batches that sum to 13,000 rows; the snapshot endpoint returns the same rows; the rewritten spec uses `data: { name: "primary" }`; the spec's row data never appears in the tool result the agent sees.
   - Manual smoke: visualize a 13k-row scatter against a real dev portal; observe the chart fill in over ~2–3 seconds.

### Out of scope

- **Hard runtime enforcement of per-mark caps.** Phase 3 ships the per-mark thresholds as system-prompt guidance; if the agent emits a 100k-point scatter, the chart simply renders slowly (and the cap doc surfaces the issue). Hard enforcement (auto-aggregate / refuse-to-render) is a follow-up.
- **Cross-portal handle sharing.** Handles are portal-scoped (or session-scoped within the portal). Sharing a chart across portals is a copy operation, not a handle reference.
- **Cache invalidation on connector sync.** A handle's cached data is "as of when the cursor walked." If a connector sync fires mid-cache, the handle stays stale until TTL. Surfaces as "last refreshed N minutes ago" in the chart corner (open question 5 in the discovery). Phase 3 ships the timestamp; intelligent invalidation deferred.
- **Per-tab / per-window SSE channels.** One SSE channel per handle id; multiple subscribers (e.g. two browser tabs) share the same broadcast.
- **`visualize_tree` incremental layout.** Tree / treemap / hierarchical specs render after the full dataset arrives — incremental insertion would re-layout the whole tree per batch. The widget accumulates rows in a buffer and runs the layout once on `complete`. Document in the spec; not "incremental render" the way charts are.
- **Backwards-migration of pinned charts to use handles.** Today's pins keep their inline-rows semantics (snapshot); the live-trace pin work in #92 is when this shape changes.
- **Reads against multiple sources composed at view time.** The SQL the agent emits IS the source; any join / union is in the agent's SQL, not in the handle's render path.

## Concept changes

### Query-handle envelope (recap from Phase 1)

```ts
{
  queryHandle: "qh-7e2a…",            // opaque id
  rowCount: 13_427,
  schema: [{ name: "acreage", type: "numeric" }, { name: "assessed_value", type: "numeric" }],
  sampled: false,
  truncated: false,
  samplePeek: [/* first 10 rows */],
}
```

`samplePeek` is intentionally capped at 10 rows (Phase 1 spec). The agent sees the row count, the schema, and a flavor — not the data. The actual rows flow from API → UI via the handle, never through the agent context window.

### `PortalSqlHandleService` shape

```ts
// apps/api/src/services/portal-sql-handle.service.ts

interface ProduceOptions {
  portalId: string;
  organizationId: string;
  sql: string;
  spec?: VegaLiteSpec;  // when reads come from `visualize`/`visualize_tree`; persisted alongside envelope for re-open
}

interface ProduceResult {
  envelope: QueryHandleEnvelope;
}

class PortalSqlHandleService {
  async produce(opts: ProduceOptions): Promise<ProduceResult>;
  async getSnapshot(handleId: string, range: { offset: number; limit: number }): Promise<{ rows: unknown[]; total: number }>;
  // SSE consumers subscribe to the Pub/Sub channel directly via the route layer
}
```

Implementation sketch:
- `produce` opens a transaction, sets `statement_timeout`, declares a cursor for the user SQL (with the sampling wrap when `rowCount > SAMPLING_THRESHOLD`).
- Pre-walk the cursor for the first 10 rows → `samplePeek`. Then full walk in batches.
- Each batch: serialize to JSON, write to Redis key `portal-sql:handle:{id}:batches:{i}`, publish to `portal-sql:handle:{id}:stream` channel with `data` event.
- On exhaustion: write meta envelope. Publish `complete` event.
- On error: publish `error` event with `ApiUserError` envelope; persist the envelope's terminal state.

Production order matters: the meta envelope (with `rowCount`) lands AFTER the cursor exhausts. The agent's tool-result gets a partial envelope (the rowCount is from a `SELECT COUNT(*)` pre-flight against the unsampled query) so the tool can return synchronously. The cursor walk happens server-side after the tool returns; the UI's SSE subscription picks up the batches as they emit.

### Sampling

Logic:
```ts
const rowCount = await preflightCount(sql);
if (rowCount > SAMPLING_THRESHOLD) {
  const sampledSql = `SELECT * FROM (${sql}) _src ORDER BY random() LIMIT ${SAMPLE_SIZE}`;
  return { sql: sampledSql, sampled: true, sampleSize: SAMPLE_SIZE };
}
return { sql, sampled: false };
```

Trade-off: `ORDER BY random() LIMIT N` is O(n log n) — exactly what we're trying to avoid. But `TABLESAMPLE BERNOULLI` only works on tables, not arbitrary queries (the user SQL might be a join / aggregate). The pragmatic call for v1 is the deterministic version; flag in spec § Risks for a follow-up if the random-sort is slow in practice.

### `statement_timeout` semantics

`SET LOCAL statement_timeout = 30000` applies to each statement within the transaction. With a cursor:
- `DECLARE handle CURSOR FOR <user_sql>` is one statement — must declare in < 30s.
- `FETCH 1000 FROM handle` is each its own statement — each must complete in < 30s (cheap per fetch).

This means: pathological queries that take 60s to plan/execute trip on the DECLARE. Pathological per-batch FETCHes (e.g. each FETCH triggers a sort scan) also trip. Acceptable v1 behavior. Document in the recommendation: `PORTAL_SQL_TIMEOUT` → "Query exceeded 30s. Try adding a WHERE filter, a tighter date range, or aggregating the source."

### Spec rewrite for changesets

The agent emits Vega-Lite specs against `data: { values: [...] }` (or `data: { values: [] }` when waiting for rows). The renderer applies `vega.changeset` against a *named* dataset only. Rewrite:

```ts
function rewriteForNamedDataset(spec: VegaLiteSpec, name = "primary"): VegaLiteSpec {
  // Single-source spec (most charts):
  if ("data" in spec && spec.data && "values" in spec.data) {
    return { ...spec, data: { name } };  // drop inline values; renderer attaches dataset by name
  }
  // Multi-source spec — `datasets: { foo: [...], bar: [...] }`:
  if ("datasets" in spec) {
    // Multi-source isn't supported by the rewrite in Phase 3; pass through unchanged.
    // Renderer falls back to inline-rows path (the chart won't stream; full data must arrive at once).
    return spec;
  }
  // Already named-dataset:
  return spec;
}
```

The Phase 3 rewrite handles the dominant single-source case. Multi-source specs pass through unrewritten and the chart waits for the full dataset (handled by the renderer accumulating all batches before rendering, or by the visualize tool inlining rows when it detects multi-source).

### `query-result-data` display block content shape

```ts
{
  type: "query-result-data",
  content: {
    queryHandle: "qh-7e2a…",
    spec: VegaLiteSpec,           // rewritten for named dataset
    columnConfig?: ColumnConfig,  // for `data-table` shape; new in Phase 3
    fallbackPolicy: {
      reopenViaSnapshot: true,    // when SSE channel is closed at mount, fetch snapshot instead
    },
  },
}
```

### `rowIds` write-fallback endpoint

```http
POST /api/connector-entities/:entityId/rows-by-id

Request:
{
  ids: ["rec-…", "rec-…", ...]
}

Response:
{
  rows: [
    { _record_id: "rec-…", c_acreage: 3.7, c_assessed_value: 240_000, ... },
    ...
  ]
}
```

Scoped to the org + the entity's read capability (existing primitive). Capped at 1000 ids per request (rejects past that with `BULK_DISPATCH_TOO_MANY_IDS` — new ApiCode or `BAD_REQUEST` with `details.maxIds`; lean: add new code for clarity).

## Surface

### `packages/core/src/constants/large-data-ops.constants.ts` (edit)

- Add `SAMPLE_SIZE = 50_000` and `MAX_ROWS_BY_ID = 1_000`.
- Add `MARK_CAPS: Record<MarkType, number>` (scatter 50k, bar 1k, line 5k, area 5k).

### `apps/api/src/services/portal-sql-handle.service.ts` (new)

- `PortalSqlHandleService` class with `produce`, `getSnapshot`.
- Redis-backed storage + Pub/Sub publish.

### `apps/api/src/routes/portal-sql-handle.router.ts` (new)

- `GET /api/portal-sql/handle/:handleId/stream` — SSE.
- `GET /api/portal-sql/handle/:handleId` — paged snapshot.
- Wire into the existing `protectedRouter` mount.

### `apps/api/src/utils/vega-spec-rewrite.util.ts` (new)

- `rewriteForNamedDataset(spec, datasetName)`.

### `apps/api/src/tools/sql-query.tool.ts` (edit)

- After running the parse + view-binding, branch on `rowCount`:
  - `≤ INLINE_ROWS_THRESHOLD`: inline rows (today's path).
  - `> INLINE_ROWS_THRESHOLD`: produce a handle, return the envelope.

### `apps/api/src/tools/visualize.tool.ts` (edit)

- Same branch as `sql_query`. Plus: rewrite the agent's spec via `rewriteForNamedDataset` before returning. Tool result includes `{ spec, queryHandle?, rowCount, schema, samplePeek }`.
- Update the tool's `description` string to surface the per-mark caps and the handle-envelope behavior (so the agent knows row counts past the cap should be aggregated, and what `samplePeek` means).

### `apps/api/src/tools/visualize-tree.tool.ts` (edit)

- Same shape as `visualize`. Note in the tool description that tree specs accumulate the full dataset before rendering (no per-batch layout update).

### `apps/api/src/routes/connector-entities.router.ts` (edit) or new sibling

- `POST /api/connector-entities/:entityId/rows-by-id` — Phase 3's row-fetch endpoint for the writes-side `rowIds` fallback.

### `apps/api/src/constants/api-codes.constants.ts` (edit)

- Add `BULK_DISPATCH_TOO_MANY_IDS` (used by the row-by-id endpoint).
- `PORTAL_SQL_TIMEOUT` already added in Phase 1 — no new entry, just wire the producer's error path.
- `READ_HANDLE_EXPIRED` already in Phase 1 — wire the snapshot endpoint's miss path.

### `apps/web/src/components/QueryResultDataBlock.component.tsx` (new)

- The new display block. Reads handle + spec from content; opens SSE; fills in via `vega.changeset` (chart) or React state (table); falls back to snapshot on remount.

### `apps/web/src/components/VegaLiteBlock.component.tsx` (edit)

- Detect `content.queryHandle` and mount `QueryResultDataBlock` instead of inlining. Legacy blocks (no handle) keep today's path.

### `apps/web/src/components/BulkJobProgressBlock.component.tsx` (edit)

- Handle `job:batch` events where `rowIds` is set: dispatch a `rows-by-id` fetch and merge results into the rendered buffer. Closes Phase 2's deferral.

### `apps/web/src/api/portal-sql.api.ts` (new or edit)

- `useAuthQuery` for the snapshot endpoint.
- SSE subscription helper for the stream endpoint.

## Tests

### Unit — `PortalSqlHandleService`

1. **`produce` writes batches to Redis under sequential keys.**
2. **Each batch publish includes the row payload.**
3. **`complete` event publishes after cursor exhaustion.**
4. **`statement_timeout` is set inside the transaction.** (Verify via SQL inspection or mock.)
5. **Sampling kicks in when row count > `SAMPLING_THRESHOLD`** — `sampled: true`, `sampleSize: SAMPLE_SIZE` set on the envelope.
6. **PG query-canceled (57014) maps to `PORTAL_SQL_TIMEOUT`** with the right recommendation.
7. **`getSnapshot` returns paged rows from Redis.**
8. **Returns `READ_HANDLE_EXPIRED` when no batches exist for the handle id.**

### Unit — `rewriteForNamedDataset`

9. **Rewrites `data: { values: [...] }` to `data: { name: "primary" }`.**
10. **Pass-through for already-named specs.**
11. **Pass-through for multi-source `datasets: { … }` specs** (with a documented caveat).

### Unit — `sql_query` rewires

12. **Returns inline rows when count ≤ `INLINE_ROWS_THRESHOLD`.**
13. **Returns handle envelope when count > `INLINE_ROWS_THRESHOLD`.**
14. **Envelope's `samplePeek` is capped at 10 rows.**

### Unit — `visualize` rewires

15. **Returns spec + handle envelope when handle path taken; spec is rewritten.**
16. **Description mentions the per-mark caps + how to interpret `samplePeek`.**
17. **Multi-source specs trigger pass-through; falls back to inline rows when row count > threshold** (documented degradation).

### Unit — `visualize_tree`

18. **Tree specs follow the same rewires; widget contract notes no incremental layout.**

### Route — `portal-sql-handle.router`

19. **SSE stream replays cached batches then forwards live ones.**
20. **Snapshot endpoint returns paged rows.**
21. **Snapshot endpoint returns `READ_HANDLE_EXPIRED` for an expired handle.**
22. **Both endpoints reject requests outside the user's portal scope.**

### Route — `rows-by-id`

23. **Returns rows for a valid id set.**
24. **Rejects request with > `MAX_ROWS_BY_ID` ids.**
25. **Rejects request when the entity isn't read-capable for the org.**

### Unit — `QueryResultDataBlock`

26. **Mounts SSE on first render.**
27. **Appends rows via `vega.changeset` on each `data` event.**
28. **Falls back to snapshot endpoint on remount.**
29. **Renders `READ_HANDLE_EXPIRED` envelope on expired-handle error.**

### Integration — Smoke B

30. **End-to-end**: seed 13,000 parcels; dispatch `visualize` for the scatter plot; assert handle envelope returned; SSE batches sum to 13,000; snapshot endpoint matches; spec is rewritten; agent's tool result doesn't contain raw rows.

## Acceptance criteria

- [ ] `PortalSqlHandleService` produces, streams, and snapshots handles end-to-end; tests 1–8 pass.
- [ ] Vega spec rewrite handles the single-source case; tests 9–11 pass.
- [ ] All three read tools return handles when row count exceeds the threshold; tests 12–18 pass.
- [ ] Two HTTP endpoints serve stream + snapshot with auth + scope checks; tests 19–22 pass.
- [ ] `rows-by-id` endpoint serves the writes-fallback case with proper limits + scoping; tests 23–25 pass.
- [ ] `QueryResultDataBlock` mounts SSE, fills via changeset, falls back to snapshot, renders error envelope; tests 26–29 pass.
- [ ] Smoke B (test 30) passes against a seeded dataset.
- [ ] `BulkJobProgressBlock` extended to consume `rowIds` events via the new endpoint — closes Phase 2's deferral.
- [ ] `npm run type-check` clean.
- [ ] `npm run test:unit` + `:integration` green across apps/api and apps/web.
- [ ] Manual smoke: visualize a 13k-row scatter against a dev portal; observe the chart fill in over ~2–3 seconds.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| `ORDER BY random() LIMIT N` is O(n log n) and slow for very large sources. | Acceptable for v1 — sampling triggers above 50k rows where the user has already opted into "approximate." If real-world latency is bad, swap to `TABLESAMPLE BERNOULLI` for table-only queries or pre-compute a sampled materialized view. Flag in open questions. |
| `statement_timeout` resets per-FETCH and doesn't bound total walk time. | Document explicitly. The DECLARE timeout is the strong gate. For pathological per-batch fetches, total walk time can exceed 30s — surface as `READ_STREAM_INTERRUPTED` when client disconnects, but the cache still fills. Acceptable. |
| Redis memory pressure under many concurrent large handles. | TTL 24h + per-org concurrent-handle cap (new constant; lean: 10 active handles per org). New `READ_HANDLE_LIMIT_EXCEEDED` ApiCode for the over-limit case. |
| Vega spec rewrite breaks an existing chart shape we haven't audited. | Pre-implementation: audit the existing `visualize.tool.test.ts` corpus for shape variants. Tests 9–11 lock the documented cases; weird shapes pass through unrewritten and degrade to inline-rows (a slower render, not a broken one). |
| SSE channel stays open after client disconnect, leaking memory. | The Pub/Sub channel is broadcast-only; subscribers come and go. The producer's emit-and-cache loop runs against Redis regardless of subscribers. On `complete`, the channel is closed; clients reconnect via snapshot. |
| Multi-source Vega specs degrade silently to inline-rows. | Tool description documents the limitation. Real-world telemetry decides whether multi-source rewrite is needed. |

**Rollback**: revert the merge commit. The new endpoints and frontend block are gone; the rewired tools fall back to their pre-Phase-3 inline-rows behavior (the old `runSqlQuery` path still exists in `PortalSqlService` and stays load-bearing for the inline case). `PortalSqlHandleService` becomes orphan code; remove cleanly. Redis keys age out via TTL; nothing to clean.

## Cross-references

- `docs/LARGE_DATA_OPS.discovery.md` — § Smoke B, § Reads track recommendation.
- `docs/LARGE_DATA_OPS_PHASE_1.spec.md` — `QueryHandleEnvelopeSchema`, resource-limit constants, `READ_HANDLE_EXPIRED` / `PORTAL_SQL_TIMEOUT` codes.
- `docs/LARGE_DATA_OPS_PHASE_2.spec.md` — `BulkJobProgressBlock`'s `rowIds` deferral that Phase 3 closes.
- `apps/api/src/services/portal-sql.service.ts` — existing read path; the rewires fold in here.
- `apps/api/src/services/portal-sql-response.util.ts` — existing row/cell/payload caps; coexist with the new envelope path until the inline-rows surface deprecates.
- `apps/api/src/routes/job-events.router.ts` — model for the new SSE route.
- `CLAUDE.md` § SQL Guidance — system-prompt context the agent reads.
