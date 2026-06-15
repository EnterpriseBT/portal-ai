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

The minimum viable setup for §1-§3 is a NASA NEO (Near-Earth Object)
entity sourced from the NASA NeoWs API. The exact column names depend
on how the connector mapped them; this doc assumes the schema below.
**Substitute your real column names before running** — they should be
visible via `_meta_columns`.

| Alias | Shape | Used by |
|---|---|---|
| **neos** | Existing entity sourced from `api.nasa.gov/neo/rest/v1`. Columns: `c_id` (number, key), `c_name`, `c_date`, `c_diameter_km_min`, `c_diameter_km_max`, `c_diameter_m_min`, `c_diameter_m_max`, `c_diameter_miles_min`, `c_diameter_miles_max`, `c_diameter_feet_min`, `c_diameter_feet_max`, `c_absolute_magnitude_h` | §1, §2, §3, §4 (source) |
| **neo_summary** | New entity with `c_diameter_avg_km` (numeric), `c_id` as the upsert key. Created during §2a. | §2, §3, §4 (target) |
| **mock toolpack** | `apps/api/src/scripts/mock-toolpack-server.ts` — local Express server advertising four `nasa_diameter_avg_*` webhook tools (fast / expensive / flaky / no-bulk-dispatch). Start via `npm run webhook:toolpack`, register via `POST /api/toolpacks`. | §4 |

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

- [x] Open a portal session on a station that owns the **neos** entity.
- [x] Prompt: **"Show me all the near-earth objects in a table."**
- [x] Agent calls `display_entity_records` (not `sql_query`); one tool call → one widget.
- [x] Table widget appears and renders all rows (any wide cells included) — handle-path queries lift `cellCap` / `payloadCap` so wide cells don't collapse the response.
- [x] Browser DevTools → Network shows a single `GET /api/portal-sql/handle/qh-...?offset=0&limit=5000` returning `{rows, total, offset, limit}` with the full row payload.
- [x] API log prints `portal-sql handle produced` with the correct `rowCount` and `batches`.

> Verified against the live NEO dataset (~8,000 rows) — Phase 1
> signed off. Prior parcels walk (commits `448a37f`, `3019755`,
> `b28c4d0`) was the path's first confirmation.

---

## §2 — SQL transform (Phase 2) — no GIS needed

This walk uses a pure-SQL numeric transform against the **neos**
entity, writing the diameter midpoint (in kilometers) into a new
**neo_summary** entity. No PostGIS / no external dependencies.

### §2a — One-time target setup

- [x] Create a target entity called `neo_summary` on the same station as `neos`. Easiest path: in chat, prompt **"Create a new entity called `neo_summary` with a numeric column `diameter_avg_km`."** The agent will use `connector_entity_create` + `field_mapping_create` to set it up.
- [x] Confirm in `_meta_entities` (via chat: **"Show me _meta_entities"**) that `neo_summary` is listed.
- [x] Confirm in `_meta_columns` the new column's `wide_column_name` is `c_diameter_avg_km`.

> Required a fresh portal session to work around #95 (per-message
> context omitted `connectorInstances`). PR #96 is the long-term fix
> against main.

### §2b — Happy-path transform

- [x] Prompt: **"For every near-earth object, compute the average diameter in kilometers as `(diameter_km_min + diameter_km_max) / 2` and upsert it into `neo_summary.c_diameter_avg_km`, keyed by `c_id`."**
- [x] The agent calls `bulk_transform_entity_records` with:
  - `expression.kind` = `"sql"`
  - `expression.value` = something equivalent to `` `("c_diameter_km_min" + "c_diameter_km_max") / 2.0 AS c_diameter_avg_km` ``
  - `keyField` = `c_id`
- [x] Initial tool response renders a `BulkJobProgressBlock` with `expectedRecords` (~10,299) and an ETA.
- [x] Chat input is locked while the job runs (placeholder copy explains a job is in flight).
- [x] Progress block advances per batch.
- [x] Terminal SSE flips the block to "Done"; chat unlocks; `neo_summary` now has rows with `c_diameter_avg_km` populated and `source_id` matching each NEO's `c_id`.
- [x] Verify in `npm run db:studio` (from `apps/api/`) → the `er__<neo_summary id>` table has the expected rows.
- [x] Spot-check a few rows: `c_diameter_avg_km` should be the arithmetic midpoint of the source row's `c_diameter_km_min` and `c_diameter_km_max`.

> §2b shipped on live NEO data (~10,299 rows). Path to green
> required these mid-walk fixes:
> - `d93ccca` — SQL projection alias parser (split INSERT cols from values)
> - `06381f6` — write `entity_records` first, then wide table via CTE
> - `fee52c7` — pre-flight: validate `keyField` against source columns
> - `b407aa8` — tool description: tell agent where to find connectorEntityIds
> - `9ffdff1` + `6a9f2de` — `station_context` tool + always-attached pack (#97)
> - `489990c` — pre-flight: validate projection aliases against target columns
> - `3c45d8b` — backfill UI counters from terminal snapshot result

### §2c — Re-run idempotency

- [x] Re-run the same prompt. Row count on `neo_summary` stays stable; `synced_at` advances (verifies `ON CONFLICT (entity_record_id) DO UPDATE`).

### §2d — Error paths

- [x] **Invalid SQL test:** prompt **"Compute `bogus_func("c_diameter_km_min")` into `c_x` on neo_summary."** Tool returns `BULK_JOB_EXPRESSION_INVALID`; agent surfaces the pgError detail; no job appears in the jobs table.
- [x] **Max-records guard:** seed an entity with more than `MAX_BULK_RECORDS` rows (or temporarily lower the constant) and re-run. Tool returns `BULK_JOB_MAX_RECORDS_EXCEEDED`; no job is enqueued. *(Skip if you don't have a fixture this large.)*

---

## §3 — Chat lock, entity lock, cancel (Phase 3)

Reuses the §2 transform — should be long enough to observe locks
and cancel mid-job if the neos entity has more than a few hundred rows.

- [x] Re-run the §2b prompt. While the job is in flight, in a **second tab** as the same user, open the `neo_summary` connector-entity detail view. Expected: MUI `<Alert severity="info">` listing the running `bulk_transform` job with a "started X ago" timestamp; edit + delete are visibly disabled with a tooltip pointing at the running job.
- [x] Try to enqueue another `bulk_transform` targeting `neo_summary` from the original chat. Expected: API rejection with HTTP 409 + `ENTITY_LOCKED_BY_JOB`; the agent surfaces the lock and explains the wait.
- [x] Log in as a **different org's** user; open their dashboard. Expected: no visibility of the running job; their own entity flows are unaffected (org isolation).
- [x] In the original chat, click **Cancel** on the progress block.
- [x] Job status flips to `cancelled` within a batch; terminal SSE arrives; chat unlocks; lock alert on `neo_summary` dismisses without a manual refetch.
- [x] Rows committed before cancel remain in `neo_summary` (per spec — no rollback).

> If the NEO row count is small enough that the job finishes before
> you can grab the lock alert, ask the agent to widen the projection
> (multiple derived columns at once) or paginate through additional
> NeoWs date ranges to grow the source dataset.

---

## §4 — Tool-dispatch path (Phase 4) — webhook toolpack mock

Phase 4 dispatches a **per-record tool call** rather than an SQL
projection. We exercise it against the in-repo mock toolpack server
at `apps/api/src/scripts/mock-toolpack-server.ts`, which advertises
four `nasa_diameter_avg_*` tools varying their `bulkDispatch`
declaration to cover §4a–d.

### §4 setup — run the mock and register it

- [x] **Start the mock**:
  ```bash
  cd apps/api
  MOCK_TOOLPACK_SIGNING_SECRET=whsec_<paste-after-registration> \
    npm run webhook:toolpack
  ```
  Listens on `http://localhost:4100` by default. Override with `PORT=…`. Latency per call defaults to 50 ms (`MOCK_TOOLPACK_LATENCY_MS`); flaky-mode failure cadence is `c_id % 20 === 0` (`MOCK_TOOLPACK_FLAKY_MOD`).
- [x] **Register the toolpack** via `POST /api/toolpacks` (or the UI) with:
  - `endpoints.schema` = `http://localhost:4100/schema`
  - `endpoints.runtime` = `http://localhost:4100/runtime`
  - `endpoints.metadata` = `http://localhost:4100/metadata`
  The registration response includes the freshly-generated `signingSecret`. Restart the mock with that value in `MOCK_TOOLPACK_SIGNING_SECRET` so its HMAC verifier accepts subsequent requests.
- [x] **Attach the toolpack to your station** (UI: edit station → add toolpack, picking the `org:<id>` ref).
- [x] **Confirm the agent sees it**: ask the agent **"list tools containing 'nasa'"**. Expected: `nasa_diameter_avg_fast`, `nasa_diameter_avg_expensive`, `nasa_diameter_avg_flaky`, `nasa_diameter_avg_no_bulk`.

Tools advertised by the mock:

| Name | `bulkDispatch` | Behavior |
|---|---|---|
| `nasa_diameter_avg_fast` | yes, default | `{c_diameter_avg_km}` from `(min+max)/2`. |
| `nasa_diameter_avg_expensive` | yes, `costHint: "expensive"` | Same body as fast; trips the §4b cost gate. |
| `nasa_diameter_avg_flaky` | yes | Throws for every 20th `c_id` — exercises §4d partial failures. |
| `nasa_diameter_avg_no_bulk` | **no** | Same body but no `bulkDispatch` field → §4c reject. |

### §4a — Happy path

- [x] Prompt: **"Run `nasa_diameter_avg_fast` against every NEO and store the result in `neo_summary.c_diameter_avg_km`."**
- [x] Tool returns `BulkJobProgressBlock` with an ETA derived from `estimatedMsPerCall × expectedRecords / (maxConcurrency × 1000)` — not the generic 5 ms/record heuristic.
- [x] Mock server logs show no more than `maxConcurrency` (default 10) overlapping `/runtime` POSTs at once.
- [x] On completion, `neo_summary.c_diameter_avg_km` is populated for every source key; the jobs row carries `committedRows` and `batchDurationMs` in `result`.

> §4a shipped on live NEO data (~10,299 records, deduped by `c_id`).
> The asteroid id lives in `source_id` (metadata column) on each
> target row, but isn't mirrored to a queryable wide-column on
> `neo_summary` — today's primitive writes only the single
> `targetColumn`. The multi-write `writes[]` generalization in **#99**
> covers that case; deferred there.
>
> Path to green required these mid-walk fixes:
> - `6e2ec30` — wire bulkDispatch through webhook toolpacks
> - `e6a21b3` — thread stationId into job metadata (pre-flight/worker drift)
> - `32dab3d` — spread source row at top of tool input + document `expression.args`
> - `873fd4c` — upsertSuccesses via entity_records CTE + drop unknown keys (#98)
> - `70a3393` — tool returns one value, agent supplies `targetColumn` (closed #98)
> - `ffcf980` — dedupe duplicate keyField values per batch (NEO `c_id` repeats across close-approach rows)

### §4b — Cost gate

- [x] Prompt the same flow against `nasa_diameter_avg_expensive`.
- [x] First attempt: tool returns `BULK_DISPATCH_COST_NOT_ACKNOWLEDGED`; the agent asks the user to confirm.
- [x] Confirm in chat; the agent retries with `acknowledgeCost: true`; job enqueues.

### §4c — Not bulk-dispatchable

- [x] Prompt the same flow against `nasa_diameter_avg_no_bulk`.
- [x] Tool returns `BULK_DISPATCH_TOOL_NOT_BULK_DISPATCHABLE` with the recommendation to add a `bulkDispatch` block; no job appears in the jobs table.

### §4d — Partial failures + retry-failed-only

- [x] Prompt the same flow against `nasa_diameter_avg_flaky`.
- [x] On completion, terminal envelope has a non-empty `partialFailures` array (~5% of records by `c_id % 20`).
- [x] Chat renders a `BulkFailuresTableBlock` listing each failed `sourceKey` + error code + recommendation; expand a row to see details.
- [x] Pagination works (10 / 25 / 50 rows per page).
- [x] Click **"Retry failed only"**. Expected: a synthetic user message appears in the chat naming the failed keys.
- [x] The agent re-invokes `bulk_transform_entity_records` with `sourceFilter.whereSqlFragment` scoping to those keys (inspect via API logs or the new job's metadata).
- [x] The retry job processes **only** the previously failed records; successful retries land in `neo_summary` via UPSERT; the new job's `partialFailures` is empty (or smaller).

---

## §5 — Aggregate to a single value (#100)

`bulk_aggregate_records` reduces N source records to one value via a SQL
aggregate run as a job — no writes, no lock (reads-only). The tool runs
the scan off the request thread under a 120s `statement_timeout`, awaits
the terminal envelope (subscribing to the job-events channel), and
returns `{ result, recordsProcessed, durationMs }` inline so the agent
answers in the same turn.

### §5a — Count via SQL

- [ ] Prompt: "How many NEOs are there?"
- [ ] The agent calls `bulk_aggregate_records` with `expression: "COUNT(*) AS total"` against the `neos` entity.
- [ ] The agent answers with the count; the jobs table has a completed `bulk_aggregate` row whose `result` is `{ result: { total: <n> }, recordsProcessed: <n>, durationMs: <ms> }`.

### §5b — Sum + average via multi-alias SQL

- [ ] Prompt: "What's the total and average estimated diameter across all NEOs?"
- [ ] The agent calls `bulk_aggregate_records` with `expression: "SUM(c_diameter_km_max) AS total, AVG(c_diameter_km_max) AS avg_diameter"`.
- [ ] The answer matches a manual `SELECT SUM(c_diameter_km_max), AVG(c_diameter_km_max) FROM er__<neos> WHERE organization_id = '<org>'`; `recordsProcessed` equals the neos row count.

### §5c — Scoped aggregate

- [ ] Prompt a filtered question ("…for NEOs larger than 1 km").
- [ ] The tool call carries `sourceFilter.whereSqlFragment`; `recordsProcessed` reflects only the filtered rows.

### §5d — Error + cancel paths

- [ ] Invalid expression (e.g. a non-existent column) → tool returns `BULK_AGGREGATE_EXPRESSION_INVALID` at pre-flight; no job appears in the jobs table.
- [ ] A deliberately huge `ARRAY_AGG` / `JSON_AGG` result → job fails `BULK_AGGREGATE_RESULT_TOO_LARGE`.
- [ ] Cancel a running aggregate via `POST /api/jobs/:id/cancel` (or abort the turn) → the awaiting tool unblocks and the job row is `cancelled`. The in-flight query is bounded by the 120s `statement_timeout` (same best-effort cancel as the write tools).

---

## §6 — Verify post-conditions

- [x] **DB inspection** (`npm run db:studio` from `apps/api/`): `neo_summary` rows have `c_diameter_avg_km` populated; `source_id` matches the source key (`c_id` from neos); `synced_at` reflects the latest run.
- [x] **Jobs table**: every completed / cancelled / failed `bulk_transform` row carries the expected `result` shape (`committedRows`, `partialFailures`, `batchDurationMs`).
- [ ] **Aggregate jobs**: every completed `bulk_aggregate` row carries `result = { result, recordsProcessed, durationMs }`; no `bulk_aggregate` row holds a target/lock key, and none is left non-terminal.
- [x] **Lock release**: no `bulk_transform` job is left in `active` / `pending` / `awaiting_confirmation`; the target entity's detail view shows no lock alert.

---

## Unit-test baseline

- [x] `npm run test:unit --workspace=apps/api -- --testPathPattern=bulk-transform` — **25 / 25 passing**
- [x] `npm run test:unit --workspace=apps/api -- --testPathPattern=bulk-query` (Phase 1 path)
- [x] `npm run type-check` clean across the monorepo
- [x] `npm run lint` clean

## What "green" looks like

- One full SQL transform end-to-end: read ETA → live progress → terminal SSE → rows visible in Drizzle Studio
- One full tool-dispatch end-to-end: concurrency cap observed → cost gate trips and clears → failures surface → retry-failed-only converges
- Lock alert appears and auto-dismisses via SSE — no manual refresh
- Cancel mid-job leaves committed batches in place and unblocks the chat within one batch
