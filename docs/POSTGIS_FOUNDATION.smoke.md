# postgis-foundation — Smoke Suite

Manual smoke test for [#316](https://github.com/EnterpriseBT/portal-ai/issues/316) — the PostGIS substrate: `geometry` as a typed, SRID-4326, GiST-indexed wide-table column, fail-closed import audit + reprojection, the pre-flighted `json ↔ geometry` transition, the `ST_AsMVT` tile endpoint, and the agent's `ST_*` surface. **Branch under test:** `feat/postgis-foundation` (PR [#326](https://github.com/EnterpriseBT/portal-ai/pull/326)).

> #316 is the **substrate** for the GIS epic; the user-visible map widget ships in #314. So most steps here are exercised through the **agent chat**, `db:psql` / `db:studio`, and `curl` — not clickable UI. Where a criterion genuinely can't be smoke-verified without #314, the step says so and points at what already covers it.

## Preflight

### Environment

- [ ] `git checkout feat/postgis-foundation && git pull --ff-only`
- [ ] `npm install`
- [ ] **Base-image swap (once).** This branch changes both compose databases to `imresamu/postgis:17-3.5-alpine`. Recreate the DB volumes so the new image is used, then re-migrate + re-seed:
  - [ ] `docker compose -p portalai pull postgres postgres-test`
  - [ ] `docker compose -p portalai up -d --force-recreate postgres postgres-test` (drops the old `postgres:17-alpine` containers; `pgdata` is recreated by the image init)
  - [ ] `cd apps/api && npm run db:migrate` — applies pending migrations, **including** `0076_enable-postgis`, `0077_add-geometry-column-type`, `0078_geometry-audit-helper`. Confirm it ends `migrations applied successfully!`
  - [ ] `npm run db:seed`
- [ ] `npm run dev` boots cleanly (API :3001, web :3000)
- [ ] Confirm PostGIS is live: `docker exec portalai-postgres-1 psql -U postgres -d portal_ai -tAc "SELECT postgis_version()"` → prints a `3.5 …` version string.

### Fixtures

- [ ] Log in to the web app as your local dev identity (`bbgrabbag@gmail.com`) and select/create an org.
- [ ] A **station** with an entity that carries geometry. There is **no ArcGIS connector type** — the vehicle is the ordinary **REST / JSON API connector**; an ArcGIS FeatureServer is just a JSON API whose geometry field is Esri-shaped (`{rings|paths, spatialReference:{wkid}}`), which the REST adapter normalizes to GeoJSON and infers as type `geometry`. Two ways to get one:
  - **Real (preferred for §4):** add a **REST API** connector whose endpoint is a public ArcGIS **FeatureServer/MapServer** query (records path `features`). Two response formats:
    - **`f=geojson`** — the RFC-7946 **standard** (always 4326). Cleanest; no SRID ambiguity. Prefer this.
    - **`f=json`** — Esri's proprietary format (`{ "attributes": {…}, "geometry": { "rings": […] } }`) with `spatialReference` at the **response root**, not per-feature. This is now threaded to each geometry on fetch (fix `338ce4aa`), so a non-4326 layer (e.g. web-mercator `102100`) reprojects correctly. Adding `&outSR=4326` also works. A verified public example: `https://sampleserver6.arcgisonline.com/arcgis/rest/services/USA/MapServer/2/query?where=1=1&outFields=STATE_NAME&f=json&returnGeometry=true` (records path `features`).
    - Probe → the `geometry` field should infer as type **geometry**; map it, then sync.
  - **Minimal (enough for §2/§3/§7/§9):** create a connector entity with one column mapped to the seeded **geometry** system column definition, then write a couple of rows (see §3).
- [ ] Note your station id and the entity's wide table name `er__<connectorEntityId>` (from `db:studio` → `connector_entities`, or ask the agent `station_context`).

### Reset between runs

- [ ] Most sections are read-only or idempotent. To start fully clean, re-run the Environment block's volume recreation (destroys local data — no production data exists). The `json ↔ geometry` transition (§5) is reversible in-place, so no reset is needed between its runs.

---

## §1 — Substrate: extension + base image (slice 1) · AC1

- [ ] `docker compose -p portalai ps` shows both `postgres` and `postgres-test` on `imresamu/postgis:17-3.5-alpine`.
- [ ] **Idempotent migrate:** run `cd apps/api && npm run db:migrate` a second time → it reports no pending migrations (no error), confirming `CREATE EXTENSION IF NOT EXISTS` and the geo migrations are no-ops on a migrated DB.
- [ ] **No regressions on the new image:** `cd apps/api && npm run test:integration` is green end-to-end (this is the whole existing suite running against PostGIS). Expected: `Test Suites: … passed`, 0 failed.
- [ ] `spatial_ref_sys` is populated: `docker exec portalai-postgres-1 psql -U postgres -d portal_ai -tAc "SELECT count(*) FROM spatial_ref_sys WHERE srid=4326"` → `1`.

## §2 — Contract + seed (slice 2) · AC6

- [ ] **Enum + role, via the seeded catalog.** In `db:studio` (`npm run db:studio`) open `column_definitions` and filter `system = true`. Confirm three geo rows exist with these exact `type` / `geo_role` values:
  - `geometry` → type `geometry`, `geo_role` **null**
  - `latitude` → type `number`, `geo_role` **lat**
  - `longitude` → type `number`, `geo_role` **lng**
- [ ] **Re-seed is clean:** `cd apps/api && npm run db:seed` again → completes without error and the three rows above are **not** duplicated (still one each; upsert-by-key).
- [ ] **`geoRole` is narrow.** Via the API (or the create-column dialog in §8), attempt to create a column definition with `geoRole: "geometry"` → rejected (400 invalid payload). `lat`/`lng`/`null` are accepted. (This is the "geometry is a type, not a role" contract.)

## §3 — Geometry is storable, typed, and indexed (slice 3) · AC2

Using the entity from Fixtures (with a geometry-typed column mapped + at least one row synced or agent-written):

- [ ] **Typed column.** `docker exec portalai-postgres-1 psql -U postgres -d portal_ai -c "SELECT type, srid FROM geometry_columns WHERE f_table_name = 'er__<connectorEntityId>'"` → one row, `type = GEOMETRY`, `srid = 4326`.
- [ ] **GiST index present.** `… psql -c "SELECT indexname, indexdef FROM pg_indexes WHERE tablename='er__<connectorEntityId>' AND indexname LIKE '%_gist'"` → one GiST index on the geometry column.
- [ ] **Reads back as GeoJSON.** Ask the agent (or `sql_query`): "show me one row's geometry" — the geometry value comes back as a **GeoJSON object** (`{"type":"Polygon",…}`), not WKB/hex.
- [ ] **Predicate uses the index.** In `psql`, `SET enable_seqscan = off;` then `EXPLAIN SELECT 1 FROM "er__<connectorEntityId>" WHERE "<c_geomcol>" && ST_MakeEnvelope(-180,-85,180,85,4326);` → the plan contains `Index Scan` or `Bitmap Index Scan` on the `_gist` index.

## §4 — Trustworthy import: audit, normalization, reprojection (slice 4) · AC2, AC4

Best exercised by a **real ArcGIS FeatureServer sync** (Fixtures → Real). If you can't reach one, the sub-steps note the DB-level equivalent.

- [ ] **ArcGIS → geometry.** After a sync of an ArcGIS polygon layer, the mapped geometry column is type `geometry` (re-check §3's `geometry_columns` query) and rows are populated.
- [ ] **Reprojection (non-4326 → 4326).** If the layer is web-mercator (`f=json` with root `spatialReference.wkid = 102100`), confirm the stored coordinates are **degrees**, not mercator meters: ask the agent "what's the centroid of the first feature?" (`ST_AsText(ST_Centroid(...))`) → longitude in [-180,180], latitude in [-90,90], landing where the feature actually is (not millions). The response-root SRID is threaded on fetch (fix `338ce4aa`); `f=geojson` sidesteps this entirely (already 4326). *(Slice-4 SRID reprojection; verified live against `sampleserver6` at `outSR=102100` during the smoke walk.)*
- [ ] **Repair is counted.** If the source has any self-intersecting/invalid polygons, the sync completes and its summary/logs report `geometry.repaired > 0`. (Inspect the connector_sync job result or the API logs for `rest-api.sync.geometry-audit`.) A repaired geometry is stored valid (`ST_IsValid` true).
- [ ] **Unparseable is rejected, named, and absent — never NULL.** Introduce one bad geometry value (e.g. a FeatureServer record whose geometry is malformed, or DB-level: attempt to sync a row whose geometry field is `{"nonsense":true}`). Confirm:
  - the sync summary / `X-`… log names the offending `sourceId` and a `rejected` count ≥ 1, and
  - that row is **absent** from `er__<id>` (not present with a NULL geometry): `psql -c "SELECT count(*) FROM \"er__<id>\" WHERE \"<c_geomcol>\" IS NULL"` → `0` for the rejected sourceId (the whole row was dropped, fail-closed).
- [ ] **Unknown SRID.** If you can source a layer with a SRID PostGIS doesn't know (or DB-inject one), the affected rows are rejected with reason `GIS_SRID_UNSUPPORTED` rather than written mislocated.

## §5 — Pre-flighted `json → geometry` transition (slice 5) · AC5

Set up a column definition of type **json** with a mapped wide column holding GeoJSON-shaped values (agent: "create a json column `boundary` and write two rows with GeoJSON polygons"). Then, in the web app, open the column definition's **Edit** dialog (§8 covers the dialog itself):

- [ ] **Clean convert.** With all `boundary` values valid GeoJSON, change type `json → geometry` and Save → **200**. Re-check §3: the wide column is now `geometry(Geometry,4326)` with a GiST index, and values still read back as GeoJSON.
- [ ] **Bad row blocks the convert.** Add one row whose `boundary` value is not parseable GeoJSON (e.g. `{"foo":"bar"}`), then attempt `json → geometry` again → **422** with an error naming a **count** and a **sample of `sourceId`s** (`GEOMETRY_CONVERSION_FAILED`). Confirm the column is **still `json`** (no ALTER ran) and **no** `_gist` index was created.
- [ ] **Reverse.** From a converted geometry column, change type `geometry → json` and Save → **200**; the `_gist` index is dropped and values remain readable as GeoJSON.

## §6 — Vector-tile endpoint (slice 6) · AC7

The **happy-path MVT render** needs a pinned/map block carrying a geometry pipeline, which #314's map tool creates — so the visual tile render is deferred to **#314's smoke** (and is covered here by `portal-map.router.integration.test.ts`, which renders a real MVT, a 204, and a cross-org 404). What you **can** verify now is the endpoint's contract via `curl`, using a bearer token copied from your logged-in browser (devtools → any `/api/*` request → `Authorization: Bearer …`):

- [ ] **Coordinate bounds → 400.** `curl -sw '%{http_code}' -H "Authorization: Bearer <token>" "http://localhost:3001/api/portal-map/tiles/pin/<any-id>/23/0/0.mvt"` → **400** (zoom > 22). Same for `.../2/4/0.mvt` (x ≥ 2^z).
- [ ] **Unknown / cross-org ref → 404 (no leak).** `curl … "http://localhost:3001/api/portal-map/tiles/pin/does-not-exist/0/0/0.mvt"` → **404** with code `MAP_TILE_NOT_FOUND` (the same 404 a cross-org pin returns — confirmed by the integration test's foreign-org case).
- [ ] **Contract confirmation.** Note in sign-off that the MVT/204/504/`X-Portal-Tile-Simplified`/`X-Portal-Tile-Truncated` happy paths are covered by the committed integration test and will be walked visually in #314's smoke.

## §7 — Agent geo surface (slice 7) · AC3

In the agent chat on the geometry-bearing station:

- [ ] **`station_context` exposes SRID.** Ask "what columns does `<entity>` have?" (or trigger `station_context`) → the geometry column reports `type: "geometry"` and `srid: 4326`; non-geometry columns carry no srid.
- [ ] **`ST_Intersects` / `ST_DWithin`.** Ask "how many `<entity>` rows fall inside this bounding box: lng 0–10, lat 0–10?" → the agent composes `ST_Intersects`/`&&` SQL and returns a count (no error).
- [ ] **`ST_Area(::geography)`.** Ask "what's the total area in acres of all `<entity>` polygons?" → the agent composes `ST_Area(<geom>::geography) / 4047` and returns a plausible number. (This is the `transform_entity_records` description's example executing through the read-only path.)
- [ ] The agent never claims it "can't do geospatial / needs a special tool" — the `## SQL Guidance` geo block is teaching it `ST_*` directly.

## §8 — Web column-definition surfaces (diff sweep)

- [ ] **Create dialog.** In the column-definitions view, open **Create**. The **type** dropdown now includes **geometry** (selectable). Creating a geometry column succeeds (it sends `geoRole: null` under the hood — no visible role field yet, which is correct; the role UI belongs to #314).
- [ ] **Edit dialog transitions.** Open **Edit** on a **json** column → the type dropdown offers **geometry** (enabled) while non-allowed targets (e.g. `string`) are disabled. On a **geometry** column, **json** is offered.
- [ ] **Data-table cell rendering.** View an entity's records table that includes the geometry column → each cell shows the GeoJSON **type** (e.g. `Polygon`, `Point`), **not** a dump of thousands of coordinates.
- [ ] **Filter behavior.** In the data-table filter builder, a geometry column offers only **is empty / is not empty** (no `equals`/`contains` — spatial predicates are agent-SQL, not the filter UI).

## §9 — Distance & area correctness (AC8)

- [ ] Ask the agent (or run via `sql_query`) for the area of a **known** geometry — e.g. a 1°×1° box near the equator, or a parcel whose acreage you can check against the source. Confirm `ST_Area(geom::geography)` (m²) and `ST_Distance(a::geography, b::geography)` (m) match PostGIS's geography result within rounding — i.e. they are geodesic meters, not planar degree units.

## §10 — Benchmark (AC9)

- [ ] `cd apps/api && npx dotenv -e .env -- tsx src/scripts/postgis-benchmark.ts 500000` runs to completion and prints: an indexed-PostGIS vs Node-over-JSONB comparison (PostGIS materially faster, and it never leaves the DB) and `ST_AsMVT` tile latencies at z8/z12/z16.
- [ ] The numbers are in the same ballpark as `docs/POSTGIS_FOUNDATION.benchmark.md` (machine-relative; the **ratio** is the signal). Re-run at `50000` to see the speedup widen on a more selective workload.

## §11 — Error, edge & rollback (spec Risks)

- [ ] **`CREATE EXTENSION` privilege (app-dev prerequisite).** Before the epic ever deploys to app-dev, confirm the app-dev DB role can `CREATE EXTENSION postgis`, **or** have an `rds_superuser` pre-create it so `0076`'s `IF NOT EXISTS` no-ops. (Verify against app-dev, not local — local runs as superuser.) Record the outcome here.
- [ ] **Image revert is one line.** Sanity-check that reverting `docker-compose.yml` to `postgres:17-alpine` is the only image change (no geometry columns exist in a fresh DB until synced), i.e. rollback is a one-line image swap while no geo data exists.
- [ ] **Fail-closed drops the whole row.** Re-confirm from §4 that a rejected geometry drops the record's **other columns too** (deliberate — a mislocated parcel must not masquerade as a located one). Note you saw the row absent, not partially written.

## Sign-off

- [ ] Every section above verified (or explicitly noted as deferred to #314 where called out)
- [ ] app-dev `CREATE EXTENSION` privilege confirmed (§11) before any epic→main deploy
- [ ] __________________  (date + name) — confirmed against my own running stack

## Bug-filing template

```
Section:            (e.g. §4 — import audit)
Expected:
Got:
Repro:              (exact prompt / curl / SQL, and fixture used)
Identifiers:        (org id / station id / connectorEntityId / sourceId / job id)
```

---

### Acceptance-criteria → section coverage

| Acceptance criterion | Section(s) |
|---|---|
| PostGIS present local/CI/app-dev; migrate idempotent; suite green on image | §1 (+ §11 for app-dev) |
| Synced ArcGIS entity → `geometry(Geometry,4326)` + GiST; predicate uses index | §3, §4 |
| Agent SQL `ST_Intersects`/`ST_DWithin`/`ST_Area(::geography)`; prompt example executes | §7 |
| Invalid repaired + counted; unparseable rejected, named, absent (not NULL) | §4 |
| `json → geometry` bad rows → 422 (count+sample), untouched; clean converts + indexes | §5 |
| `ColumnDataTypeEnum` has `geometry`; `geoRole` only `lat`/`lng`; seeds re-seed cleanly | §2, §8 |
| Tile: valid MVT / cross-org 404 / timeout 504 / simplify + cap headers | §6 (error paths live; happy path deferred to #314) |
| Distance & area match PostGIS `geography` | §9 |
| Benchmark committed | §10 |
