# bulk_transform Multi-Column Writes — Smoke Suite

Manual smoke test plan for [#99](https://github.com/EnterpriseBT/portal-ai/issues/99). Covers the contract cut from `expression.tool.targetColumn: string` to `writes: BulkTransformWrite[]`, the five `valueFrom` kinds (`tool_result` / `tool_path` / `sql_alias` / `source_column` / `constant`), the per-target write fan-out, the generalized lock semantics (union of `writes[].targetConnectorEntityId`), and per-target failure isolation.

**Branch under test:** `feat/bulk-transform-multi-column-writes` (PR [#108](https://github.com/EnterpriseBT/portal-ai/pull/108)).

Run **§Preflight** once before any section. The rest can be walked top-to-bottom; each section is independent after preflight.

Filing bugs: open an issue against `EnterpriseBT/portal-ai`, set type `Bug`, link this file's section in the issue body.

---

## Preflight

### Environment

- [x] `git checkout feat/bulk-transform-multi-column-writes && git pull --ff-only`
- [x] `npm install && npm run build --workspace=packages/core` — `BulkTransformExpressionSchema`, `BulkTransformMetadataSchema`, and `BulkTransformResultSchema` all changed; the API needs the rebuilt core dist.
- [x] `cd apps/api && npm run db:push && npm run db:seed && cd ../..` — no migrations changed, but `db:push` is the safest way to land any seed/schema drift.
- [x] `npm run dev` boots cleanly (API `:3001`, web `:3000`).
- [x] Redis is reachable; BullMQ workers attach without retry errors in the API log.
- [x] Auth0 dev tenant works — login lands on `/dashboard`.

### Swagger sanity

- [x] `http://localhost:3001/api-docs` loads.
- [x] Open the `bulk_transform_entity_records` tool schema (via the OpenAPI doc or by inspecting a sample tool call in the agent transcript). Confirm:
  - The tool's input no longer exposes a top-level `targetConnectorEntityId`.
  - `expression.tool.writes` is required and is an array of `BulkTransformWrite`.
  - `BulkTransformWrite` declares `targetConnectorEntityId`, `column`, and a `valueFrom` discriminated union with kinds `tool_result | tool_path | sql_alias | source_column | constant`.

### Fixtures

The minimum viable setup is a NASA NEO entity (same as `LARGE_DATA_OPS.smoke.md` §Preflight) plus **two** new target entities and a local webhook toolpack.

| Alias | Shape | Used by |
|---|---|---|
| **neos** | Existing NEO source entity. Columns at minimum: `c_id` (text, key), `c_diameter_km_min` (numeric), `c_diameter_km_max` (numeric). Substitute your real column names if they differ. | All sections (source) |
| **neo_summary** | Target with numeric columns `c_diameter_avg_km`, `c_diameter_avg_miles` (and optionally `c_id_copy`, `c_origin`). Create in §1a. | §1, §2, §4, §5, §6 |
| **neo_provenance** | Target with `c_id_copy` (text) and `c_origin` (text). Create in §3a. Used only for cross-target writes. | §3, §5 |
| **mock toolpack** | `apps/api/src/scripts/mock-toolpack-server.ts`. Start via `npm run webhook:toolpack`, register via `POST /api/toolpacks`. The `nasa_diameter_avg_fast` tool returns `{ km: number, miles: number }` per record — the canonical multi-column tool output. | §2, §3, §5, §6 |

The agent picks `connectorEntityId` / `column` names via `station_context` (#97). When the smoke prompts say "ask the agent to land values into `c_diameter_avg_km` and `c_diameter_avg_miles`," confirm the agent reads those column names from `station_context` rather than from the prompt verbatim — the prompt should say "in km AND miles" without naming the columns.

### Reset between runs

- [x] Cancel any leftover `pending` / `active` `bulk_transform` jobs before re-running a flow — the §5 lock-set sees union locks now, so a stale job from §3 would block §2 unless cancelled.
- [x] `npm run db:studio` (from `apps/api/`) — handy for inspecting both target wide tables after a run.

---

## §1 — Single-write regression (compat with #85 smoke C)

The contract cut is invisible at the user level for the single-write case. This section walks the prior #85 §4 happy path under the new shape; if anything in this section regresses, the cut is broken.

### §1a — Target setup

- [x] In chat, prompt **"Create a new entity called `neo_summary` with two numeric columns `diameter_avg_km` and `diameter_avg_miles`."** Confirm the agent uses `connector_entity_create` + two `field_mapping_create` calls and reports success.
- [x] Verify in chat **"Show me _meta_columns for neo_summary."** The wide-column names should be `c_diameter_avg_km` and `c_diameter_avg_miles`.

### §1b — One-write run

- [x] Prompt: **"For every near-earth object, compute the diameter midpoint in kilometers and store it on `neo_summary`."**
- [x] Agent calls `bulk_transform_entity_records` with `expression.kind === "tool"`, one tool ref, and `writes` of length 1 against `neo_summary`'s `c_diameter_avg_km`. Confirm by inspecting the tool-call panel.
- [x] The bulk-job progress widget appears, ETA is displayed, and the bar advances. After completion: terminal message says `Done — N records written, 0 failed in Xs.`
- [x] Open `neo_summary` in the entity-detail view. `c_diameter_avg_km` is populated for every NEO. `c_diameter_avg_miles` is still `null` (we didn't write to it in this run).
- [x] Re-run the same prompt. Job completes idempotently — same row count, same values. No duplicate `entity_records` rows.

> Path-to-green notes: §1b's first attempt surfaced two bugs in
> `upsertSuccesses` that smoke C had mocked around. Fixed in-line:
> (a) `8e56560` adds explicit `::<pgType>` casts to the wide-table
> INSERT so PG `numeric` columns accept text-quoted JS values (the
> SQL-kind path and tool-kind w/ stringified output were both
> tripping `22P02 invalid input syntax`); (b) `b33b73f` trims the
> per-failure message to the PG cause's short reason and caps
> `partialFailures[]` at 100 entries — the prior pathological run
> generated a 500MB+ result row that locked up the job-details view.

---

## §2 — Multi-write to one target (the headline #99 case)

Two columns derived from one tool call landing on the same target.

- [x] Prompt: **"For every near-earth object, compute the diameter midpoint in BOTH km and miles and store both on `neo_summary`."**
- [x] Inspect the tool call. The `writes` array contains **exactly two entries**, both targeting the same `connectorEntityId`, with `column` set to `c_diameter_avg_km` and `c_diameter_avg_miles`. The `valueFrom` is `tool_path` referencing fields on the tool's output (e.g. `{ kind: "tool_path", path: "km" }`).
- [x] **One job is enqueued, not two.** Inspect the job count via `npm run db:studio` or chat **"Show me the latest bulk_transform jobs"** — there's a single new row.
- [x] The bulk-job progress widget shows one job (not two). ETA scales to N records, not 2N.
- [x] After completion: both `c_diameter_avg_km` and `c_diameter_avg_miles` are populated on every NEO row in `neo_summary`.
- [x] Terminal message reports `Done — N records written, 0 failed in Xs.` `N` matches the NEO count.
- [x] Re-run the same prompt. Both columns refresh on each row idempotently.

> Implementation note: `shapeWritesForRecord` groups both writes under the same `targetConnectorEntityId`, so one `upsertSuccesses` call per batch carries both columns in each success's value.

---

## §3 — Cross-target writes (one job, two wide tables)

The agent writes derived values into a side entity alongside the primary target.

### §3a — Side target setup

- [x] In chat, prompt **"Create a new entity called `neo_provenance` with columns `id_copy` (text) and `origin` (text)."** Confirm `c_id_copy` and `c_origin` appear in `_meta_columns`.

### §3b — Cross-target run

- [x] Prompt: **"For every near-earth object, compute the diameter midpoint in km on `neo_summary`, and also stamp the source id into `id_copy` and the literal string 'bulk_transform' into `origin` on `neo_provenance`."**
- [x] Inspect the tool call. The `writes` array contains **three entries**:
  - Target `neo_summary`, column `c_diameter_avg_km`, `valueFrom: { kind: "tool_path", path: "km" }` (or `tool_result` if the tool returns a single number).
  - Target `neo_provenance`, column `c_id_copy`, `valueFrom: { kind: "source_column", column: "c_id" }`.
  - Target `neo_provenance`, column `c_origin`, `valueFrom: { kind: "constant", value: "bulk_transform" }`.
- [x] **One job is enqueued** — not two, not three. Confirm via the job table.
- [x] The job's persisted metadata has `targetConnectorEntityIds: [<neo_provenance_id>, <neo_summary_id>]` (sorted alphabetically). Inspect via `db:studio` → `jobs` → click the latest row.
- [x] After completion: both wide tables receive rows. `neo_summary.c_diameter_avg_km` is populated; `neo_provenance.c_id_copy` matches each NEO's `c_id`; `neo_provenance.c_origin` is `"bulk_transform"` on every row.
- [x] Terminal message reports a single `N records written` summary.

---

## §4 — Pre-flight rejection matrix

Each of these prompts should be rejected at the tool layer before any job is enqueued. The agent surfaces the rejection as a user-facing message; no progress widget appears.

### §4a — Unknown column on the target

- [x] Prompt: **"For every NEO, compute the diameter midpoint and write it to a column called `c_zombie` on `neo_summary`."**
- [x] Expected: rejection with code `BULK_JOB_EXPRESSION_INVALID`. The error message names `c_zombie` and `neo_summary`'s connector entity id, and lists the actual available columns. No job appears in the table.

### §4b — `sql_alias` references an undeclared alias

- [x] Prompt: **"Run a SQL-kind bulk_transform with `expression.value = 'c_id::text AS my_alias'` and a write that references alias `square_meters`."** (You may need to phrase this as "the SQL projection declares `my_alias`, but the writes reference `square_meters`" so the agent doesn't auto-fix it.)
- [x] Expected: rejection naming the alias `square_meters` and citing the declared aliases (`my_alias`).

### §4c — Declared SQL alias not referenced by any write

- [x] Prompt: **"Run a SQL-kind bulk_transform that projects `c_id::text AS asteroid_id, (c_diameter_km_min + c_diameter_km_max)/2 AS c_diameter_avg_km` and write only `c_diameter_avg_km` from its alias to `neo_summary`."**
- [x] Expected: rejection with `BULK_JOB_EXPRESSION_INVALID` naming the unreferenced alias `asteroid_id`. Message hints to drop the alias from the projection or add a write that references it.

### §4d — `constant` value can't cast to the target column's pgType

- [x] Prompt: **"For every NEO, write the constant string `'hello'` to `c_diameter_avg_km` on `neo_summary`."** (`c_diameter_avg_km` is numeric; "hello" can't cast.)
- [x] Expected: rejection naming the column, the failed cast target type (`numeric`), and the value. No job enqueues. (The check goes through `BulkTransformService.canCastConstant`, which runs a parameterized `SELECT $1::<pgType>` against PG.)

### §4e — `source_column` references a non-existent source column

- [x] Prompt: **"For every NEO, copy the source column `c_zombie` into `c_id_copy` on `neo_provenance`."**
- [x] Expected: rejection naming `c_zombie` as not found on the source entity, and listing the actual available source columns.

### §4f — Expensive tool without acknowledgement

- [x] Prompt: **"For every NEO, run `nasa_diameter_avg_expensive` and land the result into `neo_summary`."**
- [x] Expected: first attempt rejected with `BULK_DISPATCH_COST_NOT_ACKNOWLEDGED`. The agent surfaces the cost estimate to the user and stops. After the user replies "yes proceed", the agent retries with `acknowledgeCost: true` and the job runs. (This is the existing #85 cost gate — confirms slice 2's pre-flight refactor didn't break it.)

---

## §5 — Lock semantics (union of write targets)

The lock query (slice 3) now matches on JSONB array overlap. A job locks every entity in its `writes[].targetConnectorEntityId` set.

### §5a — Single-target lock (regression)

- [x] Trigger a long-running job (use `nasa_diameter_avg_expensive` against the full NEO entity, or any tool with `costHint: "expensive"`).
- [x] While the job is active, navigate to `neo_summary`'s entity-detail view in the web app.
- [x] Expected: the `<EntityLockAlert>` chip appears at the top of the view, naming the running job. Edit/delete affordances on field mappings are disabled with a tooltip pointing at the locking job.
- [x] After the job completes, the lock alert auto-dismisses (within a few seconds — driven by the SSE terminal event).

### §5b — Multi-target lock (the slice 3 case)

- [x] Start a cross-target job from §3b (or a similar three-write multi-target setup). While it's running:
  - [ ] Navigate to `neo_summary`. Lock alert appears, naming the running job.
  - [ ] Open a second tab; navigate to `neo_provenance`. Lock alert appears, naming the same running job.
  - [ ] Both entities are locked **at the same time** by the **same** job. Edit/delete on either is blocked.
- [x] In a third tab, try to enqueue a new bulk_transform that writes to either `neo_summary` OR `neo_provenance`. Expected: the agent surfaces a `BULK_JOB_TARGET_LOCKED` rejection naming **both** blocked entities (when the new job's write set overlaps both) or **one** (when the new job's write set overlaps only one).

### §5c — Disjoint lock (no false-positive)

- [x] While the §5b cross-target job is still running, enqueue a bulk_transform that writes to a **third**, disjoint entity. Expected: it enqueues fine (no lock conflict). Both jobs run; their lock sets don't overlap.

---

## §6 — Per-target failure isolation

When a single job writes to two targets and one target's UPSERT throws, the other target's writes commit anyway. Failures surface in the terminal message and the result row's `partialFailures[]`.

> Inducing a real per-target UPSERT failure mid-flight is awkward without DB surgery. The cleanest approach is to **drop a column** the active job depends on, mid-run — but that's hard to time. The next-cleanest is to **revoke write capability** on one of the target connector instances right before the job starts (the route's authz layer fires `BULK_TRANSFORM_TARGET_UPSERT_FAILED`-equivalents). Use whichever you can produce reliably.

### §6a — Induce + observe

- [x] Set up a cross-target job (e.g. §3b) but **do not run it yet**.
- [x] Disable write capability on `neo_provenance`'s parent connector instance (via the connector-instance edit view → uncheck "write" capability).
- [x] Run the job.
- [x] Expected behavior:
  - The job reaches `completed` (not `failed`) — per-target failures don't fail the whole job.
  - The terminal message lists per-record failures attributed to `neo_provenance` + the specific column that couldn't write (e.g. `c_id_copy`).
  - `neo_summary` rows are populated (target A's writes committed).
  - `neo_provenance` rows are NOT populated (target B's writes failed).
- [x] Re-enable write capability on `neo_provenance` and re-run the job; this time both wide tables populate.

### §6b — Result-row inspection

- [x] Open `db:studio` → `jobs` → click the failed-target run.
- [x] The `result` JSON contains:
  - `recordsProcessed: <N>` (full source count — the source records all completed their pipeline).
  - `recordsFailed: <N>` (one partial failure per source record × failing target).
  - `partialFailures` array — every entry has `targetConnectorEntityId` set to `neo_provenance`'s id, `column` set to a column on that target, and `error.message` describing the cause.
  - The failures count matches the source record count (one-per-record-per-failing-target).

---

## Sign-off checklist

After every section above is green:

- [x] §1 (single-write regression) — both `c_diameter_avg_km` and the run-twice idempotency pass.
- [x] §2 (multi-write same-target) — one job, two columns populated, sub-second per record.
- [x] §3 (cross-target writes) — one job, two wide tables receive rows, `targetConnectorEntityIds` sorted union correct.
- [x] §4 (pre-flight matrix) — all six rejection paths fire with the right codes and named details.
- [x] §5 (lock semantics) — single + multi + disjoint lock cases all behave correctly.
- [x] §6 (per-target failure isolation) — failed target doesn't block the successful target; partial-failures result row is shaped per the spec.

After every box ticked: report ready-to-merge in the PR thread, or file follow-up bugs against any failing case using the issue template.

---

## Bug-filing template

```
**Section:** §<X> — <name>
**Step:** <which step number>
**Expected:** <what the smoke doc says should happen>
**Got:** <what actually happened — agent transcript, screenshots, db row inspections>
**Repro:** <prompt + any preconditions>
**Job ids / Entity ids:** <from db:studio>
```
