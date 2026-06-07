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
| **bulk_dispatch_smoke_stub** | Dev-only per-record stub tool with `bulkDispatch` metadata, four modes (fast / expensive / flaky / no-bulk-dispatch). **Not yet committed** — see §4 setup. | §4 |

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

- [ ] Re-run the §2b prompt. While the job is in flight, in a **second tab** as the same user, open the `neo_summary` connector-entity detail view. Expected: MUI `<Alert severity="info">` listing the running `bulk_transform` job with a "started X ago" timestamp; edit + delete are visibly disabled with a tooltip pointing at the running job.
- [ ] Try to enqueue another `bulk_transform` targeting `neo_summary` from the original chat. Expected: API rejection with HTTP 409 + `ENTITY_LOCKED_BY_JOB`; the agent surfaces the lock and explains the wait.
- [ ] Log in as a **different org's** user; open their dashboard. Expected: no visibility of the running job; their own entity flows are unaffected (org isolation).
- [ ] In the original chat, click **Cancel** on the progress block.
- [ ] Job status flips to `cancelled` within a batch; terminal SSE arrives; chat unlocks; lock alert on `neo_summary` dismisses without a manual refetch.
- [ ] Rows committed before cancel remain in `neo_summary` (per spec — no rollback).

> If the NEO row count is small enough that the job finishes before
> you can grab the lock alert, ask the agent to widen the projection
> (multiple derived columns at once) or paginate through additional
> NeoWs date ranges to grow the source dataset.

---

## §4 — Tool-dispatch path (Phase 4) — needs a stub tool

Phase 4 dispatches a **per-record tool call** rather than an SQL
projection. To exercise it without GIS or any external API, we need a
synthetic stub tool registered on the toolpack with
`bulkDispatch` metadata. The stub is **not yet committed** — see the
"Setup" subsection.

### §4 setup — register a smoke stub tool

The stub is a per-record arithmetic transform with a deliberate sleep
so the concurrency cap is observable, plus four modes that cover the
§4 cases via input args:

| Mode | Behavior |
|---|---|
| `"fast"` (default) | Returns `{ c_diameter_avg_km }` = midpoint of the row's `c_diameter_km_min` / `c_diameter_km_max`; ~50 ms per call. |
| `"expensive"` | Same as fast but the tool declares `costHint: "expensive"`. |
| `"flaky"` | Throws for ~5% of source keys (e.g. when `c_id % 20 === 0`). |
| `"no-bulk-dispatch"` | A second tool registration without `bulkDispatch` metadata, for §4c. |

File to add: `apps/api/src/tools/bulk-dispatch-smoke-stub.tool.ts`,
wired into the `data_query` toolpack for development environments
only (gate on `NODE_ENV !== "production"`). Track as a separate
commit before walking §4.

### §4a — Happy path

- [ ] Bind the stub in `"fast"` mode.
- [ ] Prompt: **"Run `bulk_dispatch_smoke_stub` against every NEO and store the result in `neo_summary.c_diameter_avg_km`."**
- [ ] Tool returns `BulkJobProgressBlock` with an ETA derived from `estimatedMsPerCall × expectedRecords / (maxConcurrency × 1000)` — not the generic 5 ms/record heuristic.
- [ ] API logs show no more than `maxConcurrency` in-flight tool calls at once (default 10).
- [ ] On completion, `neo_summary.c_diameter_avg_km` is populated for every source key; the jobs row carries `committedRows` and `batchDurationMs` in `result`.

### §4b — Cost gate

- [ ] Bind the stub in `"expensive"` mode; prompt the same flow.
- [ ] First attempt: tool returns `BULK_DISPATCH_COST_NOT_ACKNOWLEDGED`; the agent asks the user to confirm.
- [ ] Confirm in chat; the agent retries with `acknowledgeCost: true`; job enqueues.

### §4c — Not bulk-dispatchable

- [ ] Bind the stub's `"no-bulk-dispatch"` registration; prompt the same flow.
- [ ] Tool returns `BULK_DISPATCH_TOOL_NOT_BULK_DISPATCHABLE` with the recommendation to add a `bulkDispatch` block; no job appears in the jobs table.

### §4d — Partial failures + retry-failed-only

- [ ] Bind the stub in `"flaky"` mode; run against neos.
- [ ] On completion, terminal envelope has a non-empty `partialFailures` array.
- [ ] Chat renders a `BulkFailuresTableBlock` listing each failed `sourceKey` + error code + recommendation; expand a row to see details.
- [ ] Pagination works (10 / 25 / 50 rows per page).
- [ ] Click **"Retry failed only"**. Expected: a synthetic user message appears in the chat naming the failed keys.
- [ ] The agent re-invokes `bulk_transform_entity_records` with `sourceFilter.whereSqlFragment` scoping to those keys (inspect via API logs or the new job's metadata).
- [ ] The retry job processes **only** the previously failed records; successful retries land in `neo_summary` via UPSERT; the new job's `partialFailures` is empty (or smaller).

---

## §5 — Verify post-conditions

- [ ] **DB inspection** (`npm run db:studio` from `apps/api/`): `neo_summary` rows have `c_diameter_avg_km` populated; `source_id` matches the source key (`c_id` from neos); `synced_at` reflects the latest run.
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
