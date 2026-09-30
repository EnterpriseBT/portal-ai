# SQL session relation boundary — Smoke Suite

This is the manual smoke test for [#660](https://github.com/EnterpriseBT/portal-ai/issues/660), PR 1 (the application-layer hotfix). It covers:
- agent SQL is parsed with Postgres's own grammar (`libpg-query`), and may reference **only the caller's session views** (granted curated views + `_meta_*`);
- only allowlisted functions (with an explicit PostGIS list) and no schema-qualified names;
- `DISCARD TEMP` at the start of every SQL session;
- pinned map pipelines are re-validated on every tile serve (dissolve included) and every dissolve precompute;
- `transform_entity_records` fragments are scalar over the source row, and its entities are org-checked.

**Branch under test:** `fix/660-sql-session-relation-boundary` (PR [#661](https://github.com/EnterpriseBT/portal-ai/pull/661)). PR 2 (the DB reader role, AC7) is **not** covered here.

Run **§Preflight** once. After that the sections are independent.

Tags: untagged steps are agent-walkable in the browser (`/smoke-walk`). `— manual` means a human confirms. `— backend` means an API/DB check outside the browser (walked with a bearer token from the e2e storageState, `@@auth0spajs@@…` → `body.access_token`, against the API on `:3001`, or `psql` against the local DB).

Agent answers are non-deterministic, so each agent step tells the agent to run **exactly** the given SQL and asserts on what the tool result and the reply may and may not contain. Open the tool-call panel to confirm the SQL the agent actually sent matches.

---

## Preflight

### Environment

- [ ] `git checkout fix/660-sql-session-relation-boundary && git pull --ff-only`
- [ ] `npm install` (swaps `node-sql-parser` for `libpg-query@17.7.4` in `apps/api`). **There is no migration and no core change.**
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`), with no `libpg-query` load error in the API log. If `:3001` is a stale orphaned instance (file edits don't reload), boot a fresh API on an alternate port for the backend steps.
- [ ] The e2e identities are present: `npm run --workspace @portalai/e2e e2e:auth:all` (owner `qa@…`, admin, member `e2e-member@…`). Switch the browser identity with `npm run --workspace @portalai/e2e e2e:use <member|admin|owner>`, then close and re-open the browser.

### Fixtures

The agent walk seeds these with a throwaway script and **removes them afterwards**; every row is named or keyed `SMOKE-660` / `smoke660_*`.

| Piece | Shape |
|---|---|
| Parcels entity (e2e-fixture org) | `smoke660_parcels`: `parcel_id`, `owner`, `geom` (polygon). Rows `P1 / "Hidden Owner A"`, `P2 / "Hidden Owner B"`, with polygons near (0,0) |
| Target entity (e2e-fixture org) | `smoke660_target`: `parcel_id`, `label` (empty), for §5 |
| Other org | **"SMOKE-660 Other Org"** with entity `smoke660_secret`: one row `secret = "OTHER-ORG-SECRET"`. Note its `er__<id>` table name for §2 |
| Station | **"SMOKE-660 Station"**, linked to the parcels instance, with the **`data_query`** and GIS packs enabled; member access |
| Views | `smoke660_parcel_geo` (projection `parcel_id`, `geom`: **no** `owner`), `smoke660_parcels_full` (all columns) |
| Member grants | `read curated_view` on `smoke660_parcel_geo` only |
| Pins | Two map pins on the station (polygons, `tiled: true`), owned by the member: **Pin A** pipeline `SELECT "c_geom" AS geom, "c_parcel_id" FROM smoke660_parcel_geo`; **Pin B** pipeline `SELECT "c_geom" AS geom, "c_owner" FROM "er__<parcels id>"` (the pre-#660 leak shape, written straight to `portal_results` since the tool would now refuse it) |

### Reset between runs

- [ ] Re-run the seed script, which deletes and re-creates the `SMOKE-660` rows. Start each agent step in a **new** portal session unless the step says otherwise.

---

## §1 — Granted views and ordinary SQL still work (AC6)

- [ ] As **member**, in a new session on **SMOKE-660 Station**, ask: *"Run sql_query with exactly: `SELECT c_parcel_id FROM smoke660_parcel_geo ORDER BY 1`."* Expected: two rows, `P1` and `P2`.
- [ ] Same session: *"Run sql_query with exactly: `SELECT EXTRACT(year FROM now()) AS y, position('a' IN 'cat') AS p, trim(both FROM '  x  ') AS t, 'abc' SIMILAR TO 'a%' AS s`."* Expected: one row (`y` = the current year, `p` = 2, `t` = `x`, `s` = true). No `PORTAL_SQL_FORBIDDEN`. These SQL-standard forms are the grammar's `pg_catalog` rewrites (code-review F1).
- [ ] Same session: *"Run sql_query with exactly: `WITH a AS (SELECT c_parcel_id FROM smoke660_parcel_geo) SELECT * FROM a UNION ALL (WITH b AS (SELECT 'x' AS c_parcel_id) SELECT * FROM b)`."* Expected: three rows (`P1`, `P2`, `x`). CTEs inside a UNION branch resolve (code-review F3).
- [ ] Same session: *"Run sql_query with exactly: `SELECT c_parcel_id, ST_Area(c_geom) AS area, ST_AsText(ST_Centroid(c_geom)) AS c FROM smoke660_parcel_geo`."* Expected: two rows with a numeric area and a `POINT(...)` centroid.
- [ ] Same session: *"What columns does smoke660_parcel_geo have? Use the _meta views if you need to."* Expected: the agent can describe `parcel_id` and `geom` (via `station_context` or a `_meta_*` query); no error.
- [ ] Ask a natural GIS question: *"Show the parcels on a map."* Expected: a map renders with the two parcels (the pushdown/visualize path still works).

## §2 — Relations outside the session views are rejected (AC1, AC3)

For each step, as **member** in a session on SMOKE-660 Station, ask *"Run sql_query with exactly: `<SQL>`"*. Expected for all: the tool result is an error reading **`unknown entity: <name>`** or **`schema-qualified relation not allowed`** (or `PORTAL_SQL_FORBIDDEN`), no rows come back, and the reply contains none of `OTHER-ORG-SECRET`, `Hidden Owner A`, `Hidden Owner B`.

- [ ] Another org's table: `SELECT * FROM "er__<smoke660_secret id>"` → `unknown entity`.
- [ ] Own org's raw table (bypassing the projection): `SELECT c_owner FROM "er__<smoke660_parcels id>"` → `unknown entity`.
- [ ] App table: `SELECT count(*) FROM entity_records` → `unknown entity: entity_records`.
- [ ] Ungranted view: `SELECT c_owner FROM smoke660_parcels_full` → `unknown entity: smoke660_parcels_full` (the same wording as a view that doesn't exist).
- [ ] Nonexistent name: `SELECT * FROM no_such_thing_660` → `unknown entity: no_such_thing_660`. Its wording matches the ungranted-view step exactly.
- [ ] Quoted catalog: `SELECT rolname FROM "pg_catalog"."pg_roles"` → `schema-qualified relation not allowed` (or forbidden).
- [ ] Hidden in a subquery: `SELECT c_parcel_id, (SELECT max(secret) FROM "er__<smoke660_secret id>") FROM smoke660_parcel_geo` → `unknown entity`.
- [ ] Hidden in a later sibling CTE: `WITH a AS (SELECT * FROM b), b AS (SELECT 1) SELECT * FROM a` → `unknown entity: b` (a non-recursive CTE can't see a later sibling).
- [ ] — backend. Leftover temp view: with `log_statement = 'all'` on the local Postgres, run any member SQL session. Expected: the session's transaction opens with `DISCARD TEMP` before the view DDL. Then, from a raw `psql` connection, `CREATE TEMP VIEW smoke660_leftover AS SELECT 1` is irrelevant to the API pool, so the name check is the proof: as member, `SELECT * FROM smoke660_leftover` → `unknown entity: smoke660_leftover`.

## §3 — Functions: allowlist, PostGIS list, no settings (AC2)

As **member**, *"Run sql_query with exactly: `<SQL>`"*. Expected for each: `PORTAL_SQL_FORBIDDEN` naming the function, no rows, and no setting changed.

- [ ] `SELECT set_config('statement_timeout', '0', false)` → rejected (`set_config`).
- [ ] `SELECT current_setting('role')` → rejected (`current_setting`).
- [ ] `SELECT "pg_sleep"(1)` → rejected, and it returns immediately (no 1 s wait).
- [ ] `SELECT st_findextent('public', 'er__<smoke660_secret id>', 'c_geom')` → `function not allowed: st_findextent` (security finding, fixed in `1ade8c2c`).
- [ ] `SELECT st_estimatedextent('er__<smoke660_parcels id>', 'c_geom')` → `function not allowed: st_estimatedextent`.
- [ ] `SET role postgres` → rejected (`reserved verb: SET`, from the regex pre-filter that runs before the parser).
- [ ] `SELECT 1; SELECT 2` → rejected (`multi-statement input`, from the regex pre-filter).
- [ ] `SELECT c_parcel_id FROM smoke660_parcel_geo FOR UPDATE` → rejected (`reserved verb: UPDATE`, from the regex pre-filter).
- [ ] `SELECT c_parcel_id FROM smoke660_parcel_geo FOR SHARE` → rejected (`SELECT INTO / FOR UPDATE not allowed`). The regex doesn't match `SHARE`, so this proves the parser's locking-clause check.

## §4 — Pinned map pipelines (AC4)

- [ ] As **member**, open the portal holding **Pin A**. Expected: the map renders both parcels.
- [ ] — backend. As **member**: `GET /api/portal-map/tiles/pin/<Pin A id>/<z>/<x>/<y>.mvt` for a tile covering (0,0) at a high zoom (e.g. z=14). Expected: **200** with a non-empty MVT body.
- [ ] — backend. As **member**: the same request for **Pin B** at high zoom. Expected: **204** (empty tile) and an API log line `tile.pipeline-rejected` naming the pin. Not 200, not 500.
- [ ] — backend. As **member**: the same request for **Pin B** at a low zoom (e.g. z=2) after inserting a `map_dissolve_geometries` row for Pin B's owner/scope (the pre-#660 precompute shape). Expected: **204**. The dissolve serve no longer bypasses the check (code-review F2).
- [ ] — backend. Run the dissolve precompute for **Pin B** (enqueue it, or call the processor from the seed script). Expected: the job ends **failed** with `unknown entity: er__…` in its `error`, **no retries** (`attempts` 1), and `SELECT count(*) FROM map_dissolve_geometries WHERE portal_result_id = '<Pin B id>'` is **0** (the row inserted in the previous step is gone).
- [ ] — backend. Run the dissolve precompute for **Pin A**. Expected: `completed`, with rows in `map_dissolve_geometries` for Pin A.
- [ ] — backend. With `log_statement = 'all'`, request one Pin A tile. Expected: the tile's transaction starts with `DISCARD TEMP` and ends in `ROLLBACK`, not `COMMIT`.

## §5 — `transform_entity_records` (AC5)

As **admin** (the tool is admin-gated), in a new session on SMOKE-660 Station:

- [ ] Ask: *"Use transform_entity_records to set `label` on smoke660_target from smoke660_parcels with the SQL expression `'parcel ' \|\| c_parcel_id`, keyed on parcel_id."* Expected: the preview/EXPLAIN succeeds, and after confirming, the job completes and `smoke660_target` rows read `parcel P1`, `parcel P2`.
- [ ] Ask: *"Use transform_entity_records with the SQL expression `(SELECT max(secret) FROM \"er__<smoke660_secret id>\")` into label."* Expected: rejected before any job is enqueued (no new `jobs` row), with a `PORTAL_SQL_FORBIDDEN`-style message about a sub-select or relation. No target row contains `OTHER-ORG-SECRET`.
- [ ] Ask the same with a **where fragment** `c_parcel_id IN (SELECT secret FROM "er__<smoke660_secret id>")` and a harmless expression. Expected: rejected before EXPLAIN, no job.
- [ ] — backend. Call the tool (or its service) with `targetConnectorEntityId` = `smoke660_secret`'s id (another org). Expected: **not found**; nothing written to the other org's table (`SELECT * FROM "er__<secret id>"` unchanged).

## §6 — Error & edge cases

- [ ] As **member**, ask: *"Run sql_query with exactly: `SELEC c_parcel_id FRM smoke660_parcel_geo`."* Expected: a clean `PORTAL_SQL_FORBIDDEN` (syntax error) the agent relays; the agent may then correct the query and succeed. No 500 in the API log.
- [ ] As **member**, ask: *"Run sql_query with exactly: `SELECT replace(c_parcel_id, 'P', 'Q') FROM smoke660_parcel_geo`."* Expected: note the result. A rejection here is the **pre-existing** regex behaviour (recorded as a known residual, not a regression of this PR).
- [ ] — manual. CI on PR #661 is green (**Unit Tests**, **Integration Tests**, **Static Checks**), including `portal-sql-parse.util.test.ts`, `bulk-transform-sql-gate.integration.test.ts` and the "session relation boundary (#660)" describe.

---

## Sign-off

- [ ] Every section above verified
- [ ] SMOKE-660 fixture removed: pins, dissolve rows, portal, station, toolpack rows, views, grants, entities, instances, the other org, and the wide tables dropped. No `smoke660_*` / `SMOKE-660` rows remain.
- [ ] <date + name>: confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro (exact prompt / SQL / request): · Identifiers (org / station / view / pin ids, portal session id):
