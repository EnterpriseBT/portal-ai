# Large Data Operations Smoke Suite

Manual smoke test plan covering bulk reads (Phase 1), SQL transforms (Phase 2), chat lock + cancel (Phase 3), and tool-dispatch transforms with retry-failed-only (Phase 4). Issue: [#85](https://github.com/EnterpriseBT/portal-ai/issues/85).

Run **§Preflight** once before any other section; the rest can be walked top-to-bottom.

---

## Preflight

### Environment

- [x] `git checkout docs/bulk-writes && git pull --ff-only`
- [x] `npm install && npm run build --workspace=packages/core` (the `BulkTransformMetadataSchema` shape changed; the API needs the rebuilt core dist).
- [x] `cd apps/api && npm run db:push && npm run db:seed && cd ../..` to bring the local DB in sync with the dual-schema (Drizzle + Zod) for the new `sourceFilter` field.
- [x] `npm run dev` boots cleanly (API `:3001`, web `:3000`, core storybook `:7006`).
- [x] Redis is reachable; BullMQ workers attach without retry errors in the API log.
- [x] Auth0 dev tenant works — login lands on `/dashboard`.

### Swagger sanity

- [x] `http://localhost:3001/api-docs` loads.
- [x] **Portal SQL** tag is present and exposes `GET /api/portal-sql/queries/:handle/snapshot` and the SSE stream endpoint.
- [x] Response schemas reference registered components by `$ref` — open one of the new endpoints (`RunningJob`, `PortalRunningJobsResponse`, `BulkJobTerminalEvent`, `QueryHandleSnapshotResponse`, `QueryHandleStreamEvent`, `RowsByIdRequestBody`, `RowsByIdResponse`) and confirm the schema isn't inlined.

### Fixtures

| Alias | Shape | Used by |
|---|---|---|
| **source-small** | Connector entity with ~50 rows | Phase 2 SQL sanity, Phase 3 lock visibility |
| **source-medium** | Connector entity with ~1500 rows | Phase 2 progress, Phase 4 dispatch ETA |
| **source-large** | Connector entity with ~15000 rows | Phase 2 max-records, Phase 3 cancel |
| **target-derived** | Empty connector entity that accepts a `c_acreage` or `c_score` derived column, with `source_id` as the upsert key | Phase 2 + 4 writes |
| **stub-tool-fast** | Toolpack tool with `bulkDispatch: {maxConcurrency: 10, timeoutMs: 5_000, idempotent: true, estimatedMsPerCall: 50}` | Phase 4 dispatch |
| **stub-tool-flaky** | Same as fast but throws for source keys matching `p-%99` (or similar) | Phase 4 partial failures + retry |
| **stub-tool-expensive** | Same as fast but `costHint: "expensive"` | Phase 4 cost gate |
| **non-bulk-tool** | Toolpack tool **without** `bulkDispatch` metadata | Phase 4 not-dispatchable rejection |

Log in as two dev users in separate orgs — the cross-org lock assertion in §3 needs the second.

### Reset between runs

- [x] Cancel any leftover `pending` / `active` `bulk_transform` jobs before re-running a flow (otherwise the lock alert will block the next enqueue).
- [x] `npm run db:studio` from `apps/api/` is handy for inspecting the target wide table's rows after each pass.

---

## §1 — Live hydration (Phase 1, read path)

The shipped implementation uses **`display_entity_records`** as the dedicated
"render this entity as a single live table" tool, and **`sql_query`** for
analytical queries — the latter returns a query-handle envelope when results
exceed `INLINE_ROWS_THRESHOLD` (100 rows). Both render through the same
`QueryResultDataBlock` snapshot-fetch path.

- [x] Open a portal session on a station that owns a ~5k-row entity (parcels).
- [x] Prompt: **"Show me all the parcels in a table."**
- [x] Agent calls `display_entity_records` (not `sql_query`); one tool call → one widget.
- [x] Table widget appears and renders all rows (geometry blobs included) — handle-path queries lift `cellCap` / `payloadCap` so wide cells don't collapse the response.
- [x] Browser DevTools → Network shows a single `GET /api/portal-sql/handle/qh-...?offset=0&limit=5000` returning `{rows, total, offset, limit}` with the full row payload.
- [x] API log prints `portal-sql handle produced` with the correct `rowCount` and `batches`.

---

## §2 — SQL transform (Phase 2)

- [ ] Prompt: **"Compute the acreage of every parcel in source-medium and upsert it into target-derived as `c_acreage`. Use `ST_Area(geometry::geography) / 4047`."**
- [ ] Initial tool response is a `BulkJobProgressBlock` with `expectedRecords` and ETA (e.g. "Importing 1500 records. ETA 8s.").
- [ ] Chat input is locked while the job runs (placeholder copy explains a job is in flight).
- [ ] Progress bar / histogram advances per batch (visible in the chat).
- [ ] Terminal SSE flips the block to "Done"; chat unlocks; `target-derived` now has rows with `c_acreage` set, `source_id` matching source keys.
- [ ] **Re-run the same prompt.** Row count on target stays stable; `synced_at` advances (verifies `ON CONFLICT (source_id) DO UPDATE`).
- [ ] **Invalid SQL test:** prompt **"Compute `bogus_func(x)` into `c_x` on target-derived."** Tool returns `BULK_JOB_EXPRESSION_INVALID`; agent surfaces the pgError detail; no job appears in the jobs table.
- [ ] **Max-records guard:** prompt against **source-large** with the count above `MAX_BULK_RECORDS`. Tool returns `BULK_JOB_MAX_RECORDS_EXCEEDED`; no job is enqueued.

---

## §3 — Chat lock, entity lock, cancel (Phase 3)

- [ ] Start a transform against **source-large** (long enough to take ≥30s).
- [ ] In a second tab as the **same** user, open the `target-derived` connector-entity detail view. Expected: MUI `<Alert severity="info">` listing the running `bulk_transform` job with a "started X ago" timestamp; edit + delete are visibly disabled with a tooltip pointing at the running job.
- [ ] Try to enqueue another `bulk_transform` targeting `target-derived` from the original chat. Expected: API rejection with HTTP 409 + `ENTITY_LOCKED_BY_JOB`; the agent surfaces the lock and explains the wait.
- [ ] Log in as a **different org's** user; open their dashboard. Expected: no visibility of the running job; their own entity flows are unaffected (org isolation).
- [ ] In the original chat, click **Cancel** on the progress block.
- [ ] Job status flips to `cancelled` within a batch; terminal SSE arrives; chat unlocks; lock alert on the target dismisses without a manual refetch.
- [ ] Rows committed before cancel remain in `target-derived` (per spec — no rollback).

---

## §4 — Tool-dispatch path (Phase 4)

### §4a — Happy path

- [ ] Register **stub-tool-fast** on the station's toolpack.
- [ ] Prompt: **"Run stub-tool-fast against every record in source-medium and store the result in target-derived as `c_score`."**
- [ ] Tool returns `BulkJobProgressBlock` with an ETA derived from `estimatedMsPerCall × expectedRecords / (maxConcurrency × 1000)` — not the generic 5ms/record heuristic.
- [ ] API logs show no more than `maxConcurrency` (10) in-flight tool calls at once.
- [ ] On completion, `target-derived` has `c_score` populated for every source key; jobs table row carries `committedRows` and `batchDurationMs` in `result`.

### §4b — Cost gate

- [ ] Replace the bound tool with **stub-tool-expensive**; prompt the same flow.
- [ ] First attempt: tool returns `BULK_DISPATCH_COST_NOT_ACKNOWLEDGED`; the agent asks the user to confirm.
- [ ] Confirm in chat; the agent retries with `acknowledgeCost: true`; job enqueues.

### §4c — Not bulk-dispatchable

- [ ] Bind **non-bulk-tool**; prompt the same flow.
- [ ] Tool returns `BULK_DISPATCH_TOOL_NOT_BULK_DISPATCHABLE` with the recommendation to add a `bulkDispatch` block; no job appears in the jobs table.

### §4d — Partial failures + retry-failed-only

- [ ] Bind **stub-tool-flaky**; run against source-medium.
- [ ] On completion, terminal envelope has a non-empty `partialFailures` array.
- [ ] Chat renders a `BulkFailuresTableBlock` listing each failed `sourceKey` + error code + recommendation; expand a row to see details.
- [ ] Pagination works (10 / 25 / 50 rows per page).
- [ ] Click **"Retry failed only"**. Expected: a synthetic user message appears in the chat naming the failed keys.
- [ ] The agent re-invokes `bulk_transform_entity_records` with `sourceFilter.whereSqlFragment` scoping to those keys (inspect via API logs or the new job's metadata).
- [ ] The retry job processes **only** the previously failed records; successful retries land in `target-derived` via UPSERT; the new job's `partialFailures` is empty (or smaller).

---

## §5 — Verify post-conditions

- [ ] **DB inspection** (`npm run db:studio` from `apps/api/`): `target-derived` rows have `c_*` columns populated; `source_id` matches the source key; `synced_at` reflects the latest run.
- [ ] **Jobs table**: every completed / cancelled / failed `bulk_transform` row carries the expected `result` shape (`committedRows`, `partialFailures`, `batchDurationMs`).
- [ ] **Lock release**: no `bulk_transform` job is left in `active` / `pending` / `awaiting_confirmation`; the target entity's detail view shows no lock alert.

---

## Unit-test baseline

- [ ] `npm run test:unit --workspace=apps/api -- --testPathPattern=bulk-transform` — **25 / 25 passing**
- [ ] `npm run test:unit --workspace=apps/api -- --testPathPattern=bulk-query` (Phase 1 path)
- [ ] `npm run type-check` clean across the monorepo
- [ ] `npm run lint` clean

## What "green" looks like

- One full SQL transform end-to-end: read ETA → live progress → terminal SSE → rows visible in Drizzle Studio
- One full tool-dispatch end-to-end: concurrency cap observed → cost gate trips and clears → failures surface → retry-failed-only converges
- Lock alert appears and auto-dismisses via SSE — no manual refresh
- Cancel mid-job leaves committed batches in place and unblocks the chat within one batch
