# GIS pack foundation — Smoke Suite

Manual smoke test for [#314](https://github.com/EnterpriseBT/portal-ai/issues/314) — the `gis` toolpack, `visualize_map`, the `geo` display block, and the MapLibre `MapWidget` (inline + vector tiles). **Branch under test:** `feat/gis-pack-foundation` (PR [#329](https://github.com/EnterpriseBT/portal-ai/pull/329), base `epic/gis-toolpack`). Builds on #316's substrate (already merged into the branch).

Walk this against your own running dev stack. Boxes are yours to check — the agent never checks one.

## Preflight

### Environment

- [ ] `git checkout feat/gis-pack-foundation && git pull --ff-only`
- [ ] `npm install` (adds `maplibre-gl` to `apps/web`)
- [ ] **PostGIS image + migrations (from #316, already on this branch).** Both compose DBs must be `imresamu/postgis:17-3.5-alpine`; if you haven't already run #316's smoke on a fresh volume, recreate the DB volumes and re-migrate + re-seed per `docs/POSTGIS_FOUNDATION.smoke.md` §Preflight. Confirm: `docker exec portalai-postgres-1 psql -U postgres -d portal_ai -tAc "SELECT postgis_version()"` prints a `3.5 …` string.
- [ ] `cd apps/api && npm run db:migrate` then `npm run db:seed` (seeds the geo column definitions — #316).
- [ ] `npm run dev` boots cleanly (API :3001, web :3000).

### Fixtures

- [ ] Log in to the web app as your local dev identity (`bbgrabbag@gmail.com`) and select/create an org.
- [ ] **A geometry-bearing entity.** Reuse the ArcGIS/REST entity from #316's smoke (a REST/JSON connector against an ArcGIS FeatureServer whose geometry field normalized to a `geometry` column) — or any entity with a `geometry` column and a categorical column (e.g. `prop_class`) + an address column. Note its wide table `er__<connectorEntityId>` and its `c_*` column names (from `db:studio` → `connector_entities`, or ask the agent `station_context`).
- [ ] **A Pro (or Enterprise) tier org**, so `gis` is entitled. If your org is Standard/Plus, either switch its tier (`portalops tier apply --env local …`, or set the org's tier in `db:studio`) or use a Pro org for the entitled path — and keep a Standard one for §1's not-on-tier check.
- [ ] **A station** with the entity attached; open its tool-pack picker.

### Reset between runs

- [ ] Read-only / idempotent throughout. Re-running a map prompt re-renders; no reset needed. Pinning (§5) creates a portal result you can delete afterward.

## §1 — Pack tiering & guards (AC1, AC12) · slice 3

- [ ] In a **Pro** station's tool-pack picker, the **GIS** pack appears with a **map icon** (not the puzzle-piece fallback) and is selectable. Attach it.
- [ ] In a **Standard/Plus** station, the GIS pack renders **dashed / dimmed** ("Inactive on your plan") and can't be attached; a portal there cannot call `visualize_map` (the tool isn't built for an unentitled pack).
- [ ] Guards (already green in CI, but confirmable): `cd packages/core && npm run test:unit -- builtin-toolpacks tool-capabilities` and `cd apps/api && npm run test:unit -- tools.service` pass with `gis` (pack count 8, costHint, coherence, cost-gate wrap).

## §2 — Inline map: the parcel walkthrough (AC2, AC6) · slices 2 + 4

- [ ] In a Pro portal on the station, ask: **"Show all the parcels on a map, colored by `<prop_class>`."** Expect an **interactive map** block (not a table/chart): pan, zoom, a **legend** with one swatch per class, and a basemap matching your theme (light/dark).
- [ ] **Click a parcel** → a popup shows its fields per the spec's popup template (e.g. address + class).
- [ ] **Highlight case (no codegen):** ask **"…and highlight the vacant ones."** The vacant parcels render in a distinct fill/outline from one polygons layer whose colour is a `case`/`colorBy` expression, with a legend generated from the spec. No `visualize_d3`-style codegen step occurs (the map appears without a "generating…" program phase).
- [ ] The result comes from **one SQL query + one MapSpec** — inspect the portal message's `geo` block (or the SSE trace): `type: "geo"`, a `spec` with the layer, and inline `rows` (small result).

## §3 — lat/lng points, no geometry column (AC5) · slice 4

- [ ] On an entity that has **numeric `latitude`/`longitude` columns but no geometry column**, ask **"Plot these on a map as points."** Expect a points layer rendered from the lat/lng pair (circles at the right locations), no geometry column required.

## §4 — Cardinality: small results inline, larger tile (AC3, AC9) · slice 5

The inline→tile boundary is the shared sink threshold (`INLINE_ROWS_THRESHOLD = 100`), and the LLM SQL layer caps results at `rowCap = 500` — so any map beyond ~100 features stages a handle and renders as **vector tiles**; only genuinely small results inline. Walk both sides:

- [ ] **Inline tier (≤ 100 features):** e.g. *"Map the synthetic points where c_pop2000 is at most 100, colored by c_state_name."* → the `geo` block carries inline **`rows`** (GeoJSON), **no** `…/tiles/…` request, instant pan/zoom.
- [ ] **Tile tier (> 100 features):** e.g. *"Map all the synthetic points, colored by c_state_name"* (or `≤ 2000`) → the block carries a **query-handle envelope** (no inline `rows`), and the network shows `/api/portal-map/tiles/{message|pin}/…/{z}/{x}/{y}.mvt` requests, each with an `Authorization: Bearer …` header; pan/zoom transfers only the viewport.
- [ ] **Boundary:** ≤ 100 inlines; > 100 tiles. The choice is the sink's — no open-coded cutoff in the widget.
- [ ] **Defensive clamp:** `MAP_LAYER_FEATURE_CAP = 10,000` is the renderer's inline backstop; it never binds in normal operation (inline ≤ 100). Test-covered; only a forced >10k inline payload would trip it.

## §5 — Pin & widget-refresh (AC4)

- [ ] **Pin** the map result (the pin affordance on the portal result). It persists and re-opens as a map (materialized snapshot).
- [ ] **Refresh:** use the map's refresh control (or reopen a stale session) → the map re-runs its pipeline SQL and redraws. A widget with no durable pipeline shows the "can't refresh" state rather than erroring.

## §6 — Agent spatial SQL + feed to `visualize_map` (AC7, AC10)

- [ ] Ask a **spatial question**: **"Which parcels are within 500m of `<some point/road>`?"** The agent answers by writing **`ST_DWithin`** SQL through `sql_query` (visible in the SSE trace) — **no wrapper tool** — and returns a count/list.
- [ ] Ask it to **"put those on a map."** The agent feeds that spatial query straight into `visualize_map`.
- [ ] **DB pushdown (AC7):** in `psql`, `SET enable_seqscan = off;` then `EXPLAIN SELECT 1 FROM "er__<id>" WHERE "<c_geom>" && ST_MakeEnvelope(-112,40,-111,41,4326);` → the plan uses the `_gist` index (Index/Bitmap Index Scan), i.e. the predicate runs in the database, not in Node. (Substrate is #316; confirm it still holds.)

## §7 — `station_context` SRID + seeded geo definitions (AC8)

- [ ] Ask **"What columns does `<entity>` have?"** (or trigger `station_context`) → the geometry column reports `type: "geometry"` and `srid: 4326`.
- [ ] In `db:studio` → `column_definitions` (filter `system = true`): the seeded `geometry` / `latitude` / `longitude` rows exist and are available to pick as field-mapping targets (#316 seed; confirm present).

## §8 — No quiet degradation notices (AC11) · slice 5

Each notice must be **visible** — a cap/simplification/failure is never silent.

- [ ] **Inline feature cap (row 1):** a map whose inline layer exceeds `MAP_LAYER_FEATURE_CAP` (10,000) shows **"Showing the first N of M features."** (Hard to hit with a small fixture — the unit test pins it; note here if not exercised live.)
- [ ] **Zoom-simplified (row 2):** on a tiled polygon layer, at a **low zoom** a persistent **"Simplified at this zoom — shapes are approximations"** indicator shows; it **clears** when you zoom in to full detail.
- [ ] **Density-partial (row 3):** where a tile hits the density cap, **"Partial at this zoom — zoom in for all features"** appears.
- [ ] **Tile timeout (row 4):** if a tile query times out (504), the widget shows a **timeout notice**, not blank ground. (Force by pointing at a very heavy layer, or note as test-covered.)
- [ ] **Unresolved popup (row 10):** a popup template referencing a field the row lacks renders **`⟨field⟩`**, not a blank.
- [ ] Each of the above also has a unit test (`MapWidget.test`, `tile-source.util.test`); the **malformed-expression → widget error state (row 9)** is exercised in Storybook with real MapLibre — verify a deliberately broken expression shows the widget's error alert there.

## §9 — Error & edge: `MAP_SPEC_INVALID` (spec Risks)

- [ ] Ask for a map in a way that yields an **invalid spec** (e.g. request **> 8 layers**, or a **polygons layer bound to a lat/lng pair**, or a layer keyed to a **column the query doesn't return**). The agent receives a typed **`MAP_SPEC_INVALID`** result (naming the problem / missing columns) and **relays it** — no partial or mis-styled map is rendered.

## Sign-off

- [ ] Every section above verified (or explicitly noted where a limit is test-covered rather than live-exercised)
- [ ] Both a **Pro** and a **Standard/Plus** org were used for §1's entitlement split
- [ ] __________________  (date + name) — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org / station / portal / entity ids):
