# bulk_aggregate — Smoke Suite

Manual smoke test plan for [#100](https://github.com/EnterpriseBT/portal-ai/issues/100) — the `bulk_aggregate_records` `data_query` tool. Covers the SQL-only aggregate run as a `bulk_aggregate` job (off the request thread, `READ ONLY` + 120s `statement_timeout`, org-scoped), the inline await (subscribe to the job-events channel), the terminal envelope `{ result, recordsProcessed, durationMs }`, the no-write / no-lock invariants, the result-size cap, and cancel parity with the write tools.

**Branch under test:** `feat/bulk-aggregate` (PR [#111](https://github.com/EnterpriseBT/portal-ai/pull/111)).

Run **§Preflight** once before any section. The rest can be walked top-to-bottom; each section is independent after preflight. All boxes are `[ ]` — tick as you verify.

Filing bugs: open an issue against `EnterpriseBT/portal-ai`, set type `Bug`, link this file's section in the issue body (template at the bottom).

---

## Preflight

### Environment

- [x] `git checkout feat/bulk-aggregate && git pull --ff-only`
- [x] `npm install && npm run build --workspace=packages/core` — `job.model.ts` added `BulkAggregate*` schemas + a new `JobType`; the API needs the rebuilt core dist.
- [x] `cd apps/api && npm run db:migrate && cd ../..` — migration `0062_add-bulk-aggregate-job-type.sql` adds the `bulk_aggregate` value to the `job_type` pg enum. Confirm it applies cleanly (`ALTER TYPE … ADD VALUE`).
- [x] `npm run dev` boots cleanly (API `:3001`, web `:3000`).
- [x] Redis is reachable; BullMQ workers attach without retry errors in the API log (the `bulk_aggregate` processor is registered).
- [x] Auth0 dev tenant works — login lands on `/dashboard`.

### Tool sanity

- [x] The station under test has the **`data_query`** toolpack enabled (this is where `bulk_aggregate_records` lives, alongside `sql_query`).
- [x] In an agent transcript (or `http://localhost:3001/api-docs`), confirm the `bulk_aggregate_records` tool is offered and its input schema exposes: `sourceConnectorEntityId` (string), `expression` (string), and optional `sourceFilter.whereSqlFragment`. There is **no** `writes`, `targetConnectorEntityId`, `keyField`, `batchSize`, `acknowledgeCost`, or `fold_tool` / aggregator union.

### Fixtures

`bulk_aggregate` is a **read** — it needs only a source entity, no targets and no webhook toolpack.

| Alias | Shape | Used by |
|---|---|---|
| **neos** | A NEO source entity with a meaningful row count (≥ a few thousand if you want the async/large-dataset behavior to be visible). Numeric columns, e.g. `c_diameter_km_max` (numeric), and a categorical/numeric column to filter on. Use the same NEO fixture as `LARGE_DATA_OPS.smoke.md` §Preflight. | all sections |

The agent resolves `sourceConnectorEntityId` and the `c_*` wide-column names via `station_context` (#97). The smoke prompts say things like "average diameter" without naming `c_diameter_km_max` — confirm the agent reads the real column from `station_context`, not from the prompt verbatim.

### Reset between runs

- [x] No special reset needed — `bulk_aggregate` writes nothing. Cancel any leftover `pending`/`active` `bulk_aggregate` jobs before re-running cancel tests so the job list is clean.
- [x] `npm run db:studio` (from `apps/api/`) — handy for inspecting the `jobs` table `result` column after a run.

---

## §1 — Happy path (the core flow)

### §1a — Count via SQL

- [x] Prompt: **"How many near-earth objects are there?"**
- [x] The agent calls `bulk_aggregate_records` with `expression: "COUNT(*) AS total"` against the neos entity (inspect the tool-call panel).
- [x] The agent **answers with the number in the same turn** (it does not just say "a job is running" and stop).
- [x] In `db:studio` → `jobs`: a `bulk_aggregate` row exists, `status = completed`, and `result` is `{ result: { total: <n> }, recordsProcessed: <n>, durationMs: <ms> }`. `result.total` equals `recordsProcessed` for a pure `COUNT(*)`.

### §1b — Sum + average via multi-alias SQL (object result)

- [ ] Prompt: **"What's the total and average estimated diameter across all NEOs?"**
- [ ] Tool call uses a single `expression` with two aliases, e.g. `"SUM(c_diameter_km_max) AS total, AVG(c_diameter_km_max) AS avg_diameter"`.
- [ ] The answer matches a manual check: `SELECT SUM(c_diameter_km_max), AVG(c_diameter_km_max) FROM "er__<neos-id>" WHERE organization_id = '<org>'` (run in `db:studio`).
- [ ] The job row's `result.result` is an **object** keyed by both aliases (`{ total, avg_diameter }`); `recordsProcessed` equals the full neos row count (the scanned count, **not** `1`).

### §1c — Min / max

- [ ] Prompt: **"What's the largest NEO by diameter?"** (or min).
- [ ] Tool call uses `MAX(c_diameter_km_max) AS max_diameter`; the agent reports the value. (A "which NEO" follow-up should go through `sql_query`/`display`, not aggregate — aggregate returns the value, not the row.)

---

## §2 — Scoped aggregate (`whereSqlFragment`)

- [ ] Prompt a filtered question: **"What's the average diameter of NEOs larger than 1 km?"**
- [ ] The tool call carries `sourceFilter.whereSqlFragment` (e.g. `"c_diameter_km_max > 1"`); the `expression` is the aggregate.
- [ ] `recordsProcessed` reflects **only the filtered rows** (smaller than §1b's full count); the value matches a manual `… WHERE organization_id = '<org>' AND (c_diameter_km_max > 1)`.

---

## §3 — Result shapes (scalar / object / array)

Per the discovery, `result` is any bounded serializable JSON value.

- [ ] **Scalar-ish:** a single-alias aggregate (`COUNT(*) AS total`) → `result.result` is `{ total: n }` (a one-key object — SQL rows are always keyed; this is expected).
- [ ] **Object:** multi-alias (§1b) → object with multiple keys.
- [ ] **Array:** prompt a small grouped aggregate that the agent expresses with `JSON_AGG` / `ARRAY_AGG` (e.g. **"give me the count of NEOs per orbit class"** if such a column exists) → `result.result` is a bounded array. Confirm it stays small (a handful of groups); large grouped output belongs in `bulk_materialize` (#112) + `bulk_query`, not here.

---

## §4 — Async / large-dataset behavior

The motivation is large-dataset handling, not unblocking the agent. Verify the work runs as a job, off the request thread.

- [ ] On a sufficiently large neos entity, while §1b runs, the API stays responsive to other requests (open another portal tab; it loads).
- [ ] The aggregate is a `bulk_aggregate` job row (not an inline `sql_query`); `durationMs` in the result reflects real scan time.
- [ ] The agent's turn completes only **after** the value is in hand — it answers with the number, not a "still computing" placeholder (the tool awaits the terminal envelope).

---

## §5 — Cancel (parity with the write tools)

Cancel is the generic `JobsService.cancel` path; the awaiting tool unblocks on the cancelled event; the in-flight query is bounded by the 120s `statement_timeout`.

### §5a — Cancel via the jobs route

- [ ] Start a slow aggregate (a heavy `expression` over the full entity, or temporarily lower `BULK_AGGREGATE_STATEMENT_TIMEOUT` locally to make timing easy). While it's `active`, `POST /api/jobs/<id>/cancel`.
- [ ] The job row transitions to `cancelled`. The awaiting tool **unblocks promptly** (does not hang for the full timeout); the agent surfaces a `BULK_JOB_CANCELLED` message.
- [ ] No entity rows changed anywhere (it's a read).

### §5b — Cancel by aborting the turn

- [ ] Start a slow aggregate, then stop/abort the agent turn in the UI.
- [ ] The tool's `abortSignal` fires `JobsService.cancel`; the job ends up `cancelled` (or `completed` if it finished first — both acceptable). Confirm no orphaned `active` job is left behind.

### §5c — Timeout backstop

- [ ] Force an aggregate to exceed `statement_timeout` (heavy expression on a big table, or lower the constant). The job ends `failed` with `BULK_AGGREGATE_TIMEOUT`; the agent surfaces the "narrow the filter / coarser aggregate" recommendation.

---

## §6 — Pre-flight + error matrix

Each of these should fail with the right code; §6a fails **before** any job is enqueued.

### §6a — Invalid expression (pre-flight EXPLAIN)

- [ ] Prompt the agent to aggregate a non-existent column (e.g. **"sum the column `c_zombie` across all NEOs"**, phrased so it doesn't auto-correct).
- [ ] Expected: `BULK_AGGREGATE_EXPRESSION_INVALID` with the PG error in `details.pgError`. **No `bulk_aggregate` job row appears** in the table (rejected at pre-flight).

### §6b — Unknown source entity

- [ ] Drive a call with a `sourceConnectorEntityId` that doesn't belong to the org (craft via API if the agent won't). Expected: `CONNECTOR_ENTITY_NOT_FOUND`; no job enqueued.

### §6c — Result too large

- [ ] Prompt an unbounded `ARRAY_AGG` / `JSON_AGG` that would serialize past 1 MB (e.g. **"return every NEO's id as a JSON array"** on a large entity — this is a misuse the cap is meant to catch).
- [ ] Expected: the job runs, then **fails** `BULK_AGGREGATE_RESULT_TOO_LARGE`; the agent surfaces the "use a coarser aggregate or materialize + bulk_query" recommendation. Nothing is persisted to any entity.

---

## §7 — No-write / no-lock invariants

These are the defining properties of an aggregate vs. a transform.

- [ ] After any §1–§3 run, **no entity wide table changed** — the neos rows are untouched and no new target rows exist anywhere (`bulk_aggregate` never writes).
- [ ] During an active aggregate, the source entity's detail view shows **no lock alert** — reads don't lock. Edit/delete affordances on the source remain enabled.
- [ ] Concurrently: start an aggregate on the neos entity and, while it runs, start a `bulk_transform` (or edit) on the same entity. The transform/edit is **not** blocked by the aggregate (the aggregate holds no lock).
- [ ] The `bulk_aggregate` job's metadata has **no** `targetConnectorEntityIds` / `writes` / lock keys (inspect in `db:studio`).

---

## §8 — Post-conditions

- [ ] **Jobs table**: every completed `bulk_aggregate` row carries `result = { result, recordsProcessed, durationMs }`; cancelled/failed rows carry an `error`. None is left non-terminal after the suite.
- [ ] **No drift**: re-running the same aggregate prompt yields the same value (modulo any real data change) and creates a fresh job each time — there is nothing to "re-use" since nothing is persisted.
- [ ] **Tool isolation**: `sql_query` still works for ad-hoc queries; the agent picks `bulk_aggregate_records` for "how many / total / average / min / max over the whole dataset" prompts and `sql_query` for row-returning queries. (Spot-check that the agent doesn't route a normal "show me the 10 biggest NEOs" through aggregate.)

---

## Sign-off checklist

After every section above is green:

- [ ] §1 (happy path) — count, sum/avg object result, min/max; agent answers inline; job row shaped correctly.
- [ ] §2 (scoped) — `whereSqlFragment` narrows `recordsProcessed` and the value.
- [ ] §3 (result shapes) — scalar/object/array all round-trip within the cap.
- [ ] §4 (async) — runs as a job off the request thread; agent answers only after the value lands.
- [ ] §5 (cancel) — route cancel + turn-abort both unblock the tool; timeout backstop fires.
- [ ] §6 (errors) — invalid expression / unknown source / result-too-large all fire with the right codes.
- [ ] §7 (invariants) — no writes, no lock, no lock keys in metadata.
- [ ] §8 (post-conditions) — job rows shaped per the spec; tool routing is sane.

After every box ticked: report ready-to-merge in the PR thread, or file follow-up bugs against any failing case.

---

## Bug-filing template

```
**Section:** §<X> — <name>
**Step:** <which step>
**Expected:** <what the smoke doc says should happen>
**Got:** <agent transcript, screenshots, db row inspections>
**Repro:** <prompt + any preconditions>
**Job id / Entity id:** <from db:studio>
```
