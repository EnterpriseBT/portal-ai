# precomputed-polygon-dissolve — Smoke Suite

Manual smoke test for [#472](https://github.com/EnterpriseBT/portal-ai/issues/472) — low-zoom polygon **choropleths** render as real dissolved polygons (not centroid bins), served from a per-pin precomputed geometry with a raw-simplify fallback. **Branch under test:** `fix/precomputed-polygon-dissolve` (PR [#477](https://github.com/EnterpriseBT/portal-ai/pull/477)).

Run **§Preflight** once. The rest can be walked top-to-bottom; each section is independent after preflight. Every box starts unchecked — checking them is your confirmation against your own running stack.

Filing bugs: open an issue against `EnterpriseBT/portal-ai`, set type `Bug`, link this file's section (template at the bottom).

`DB=` your local connection, e.g. `export DB="postgresql://postgres:postgres@postgres:5432/portal_ai"` (add `LC_ALL=C LANG=C` to silence locale warnings).

---

## Preflight

### Environment

- [ ] `git checkout fix/precomputed-polygon-dissolve && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/core` — `map-spec.contract.ts`, `job.model.ts`, and the dissolve constants changed; the API **and** web consume core from `dist`, so rebuild it.
- [ ] `cd apps/api && npm run db:migrate && cd ../..` — applies **0085** (`map_dissolve_geometries` table + the hand-added `geometry(MultiPolygon,4326)` `geom` column + GiST), **0086** (`ALTER TYPE job_type ADD VALUE 'dissolve_precompute'`), **0087** (drop the unique key → pieces lookup index). Confirm all three apply cleanly.
- [ ] **Restart the dev stack** (`npm run dev`) so both API and web pick up the rebuilt core dist. API `:3001`, web `:3000` boot cleanly.
- [ ] Redis is reachable; the API log shows the BullMQ worker attach without retry errors (the `dissolve_precompute` processor is registered in `queues/processors/index.ts`).

### Fixtures

| Alias | Shape | Used by |
|---|---|---|
| **parcels** | A **polygons** connector entity with a **low-cardinality categorical** column (e.g. the local "Demo" station's parcel entity `8bd191fc…` with `c_own_type` — Private/Federal/State). Big enough that the low-zoom overview matters (the ~398K local parcel layer is ideal). | §2–§7 |

A choropleth here = a `visualize_map` polygons layer with a `colorBy` on the categorical column (e.g. "map parcels colored by owner type").

### Reset between runs

- [ ] **Unpin** to clear a pin's precompute: deleting the `portal_results` row cascades to `map_dissolve_geometries` (FK `ON DELETE CASCADE`). Re-pin to recompute from scratch.
- [ ] `psql "$DB" -c "DELETE FROM map_dissolve_geometries WHERE portal_result_id='<pin>';"` forces a specific pin back to the fallback for a fresh §5 run.

---

## §1 — Contract & build sanity

- [ ] `npm run lint && npm run type-check` clean at repo root.
- [ ] `npm run test --workspace=packages/core -- --testPathPattern "map-spec|large-data-ops|job.model"` green (treatment enum, `resolveAggTreatment` routing, bands, job schema).

## §2 — The core fix: dissolved polygons at low zoom (criteria 1)

- [ ] In the app, author a parcels **choropleth** colored by the categorical column (`visualize_map`, polygons + `colorBy`), then **pin** it.
- [ ] Open the pinned map and **zoom out below z14** (an overview of the whole layer).
- [ ] **Expected:** the polygons render as **real shapes colored by category** — a dissolved choropleth. **NOT** the old 24px centroid squares (bins), and **not** blank.
- [ ] Zoom in past z14: the raw per-parcel polygons render (unchanged high-zoom path).
- [ ] The legend shows the categorical values (Private/Federal/State), matching the fill colors.

## §3 — Precompute lands in storage (criterion 4)

Give the `dissolve_precompute` job a moment after pinning (~tens of seconds on a 400K layer — see §8).

- [ ] `psql "$DB" -c "SELECT column_name, zoom_band, value, count(*) AS pieces FROM map_dissolve_geometries WHERE portal_result_id='<pin>' GROUP BY 1,2,3 ORDER BY 2,3;"` — rows exist for **each band (0,1,2)** × each category value, many **pieces** per group.
- [ ] Every stored geom is valid + MultiPolygon: `psql "$DB" -c "SELECT bool_and(ST_IsValid(geom)) AS all_valid, bool_and(ST_GeometryType(geom)='ST_MultiPolygon') AS all_multi FROM map_dissolve_geometries WHERE portal_result_id='<pin>';"` → `t | t`.
- [ ] In `apps/api` the job row is `completed`: `psql "$DB" -c "SELECT status, result FROM jobs WHERE type='dissolve_precompute' ORDER BY created DESC LIMIT 1;"` — `result` shows `columnName`, `valuesDissolved`, `rowsWritten`, no `skipped`.

## §4 — Served from precompute, not the pipeline (criterion 5)

- [ ] With the map open at low zoom, watch the browser Network tab: `/api/portal-map/tiles/pin/<pin>/{z}/{x}/{y}.mvt` requests at z < 14 return `200` **quickly** (well under the 10s tile budget) even on the 400K layer.
- [ ] (Optional, strong proof) Temporarily break the pin's pipeline source — e.g. rename the entity's session view target — and reload a **low-zoom** tile: it still renders (the dissolve-hit path reads `map_dissolve_geometries` directly, never the pipeline). Undo the rename after.

## §5 — Fallback before precompute / unpinned (criterion 3)

- [ ] Delete the pin's dissolve rows (reset command above) **without** re-pinning, then reload the map at low zoom.
- [ ] **Expected:** the choropleth still renders as **real simplified polygons** (raw-simplify fallback) — never centroid bins, never blank. The tile response carries the `X-Portal-Tile-Simplified` header (Network tab).
- [ ] A **freshly pinned** large layer: immediately after pinning (before the job finishes) the low-zoom view shows the raw-simplify fallback, then **upgrades to dissolved geometry** on a later tile fetch / map refresh once the job lands.
- [ ] The same map viewed **in chat (unpinned message block)** at low zoom renders real simplified polygons (no precompute for message refs), not bins.

## §6 — Joined / aggregated choropleth (criterion 2)

- [ ] Author a choropleth whose pipeline **joins or aggregates** (e.g. boundary polygons colored by a categorical metric joined from another entity, or a `GROUP BY`-derived category), and **pin** it.
- [ ] **Expected:** it renders dissolved at low zoom exactly like §2 — the precompute is keyed by the pin's pipeline, so an arbitrary multi-source `SELECT` is served, not just a single-entity column.
- [ ] `map_dissolve_geometries` rows exist for this pin (same §3 query) — proving the dissolve ran over the joined/aggregated result.

## §7 — Refresh recompute, lock, non-fatal (criteria 6, 7)

- [ ] Refresh the pinned map (the widget's refresh control). A **new** `dissolve_precompute` job runs; `map_dissolve_geometries` for the pin is replaced (row counts consistent, never doubled).
- [ ] During/after a refresh the map never shows a half-built dimension (no flicker to a partial region) — the per-band replace is transactional.
- [ ] (Optional) Trigger two refreshes back-to-back: only one dissolves at a time; the other's job returns `skipped: "superseded"` (`SELECT result FROM jobs WHERE type='dissolve_precompute' ORDER BY created DESC LIMIT 2;`) — the advisory lock held.

## §8 — Cost & edge behavior

- [ ] **Off-request cost is bounded, not on the request path.** The `dissolve_precompute` job takes tens of seconds on the 400K layer (measured ~2s/21s/30s per band); confirm the pin/refresh **HTTP response returns immediately** and the map is usable (fallback) while the job runs.
- [ ] **Over-cardinality skip:** a choropleth on a high-cardinality column (> 64 distinct values) does **not** dissolve — the job `result.skipped = "over-cardinality"` and the map serves the raw-simplify fallback (real polygons, not bins).
- [ ] A polygon layer **without** a colorBy still shows the low-zoom **density bins** (unchanged) — dissolve is choropleth-only.

## Sign-off

- [x] Every section above verified against my own running stack. (§6 joined/aggregated and the §7 two-refresh lock race are covered-by-integration-test; the lock was *also* observed firing live — a concurrent refresh returned `skipped: "superseded"`.)
- [x] 2026-08-30 — Ben Turner — confirmed.

## Bug-filing template

```
Section: §<n> — <title>
Expected: <from the step>
Got: <what happened>
Repro: <exact prompt / click / tile URL / SQL>
Identifiers: org=<id> pin=<portalResultId> job=<jobId> entity=<connectorEntityId>
```
