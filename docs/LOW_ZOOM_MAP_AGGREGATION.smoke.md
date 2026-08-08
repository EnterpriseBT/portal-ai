# low-zoom-map-aggregation — Smoke Suite

Manual smoke test for [#330](https://github.com/EnterpriseBT/portal-ai/issues/330) — low-zoom map aggregation (grid bins + dominant-category overview): dense tiled layers summarize into a per-tile grid below a zoom threshold instead of clipping to an arbitrary subset. **Branch under test:** `feat/low-zoom-map-aggregation` (PR [#331](https://github.com/EnterpriseBT/portal-ai/pull/331), into `epic/gis-toolpack`).

## Preflight

### Environment

- [ ] `git checkout feat/low-zoom-map-aggregation && git pull --ff-only`
- [ ] `npm install`
- [ ] **No migration** — aggregation is a read-time tile-query behavior; no schema change.
- [ ] `npm run dev` boots cleanly (API :3001, web :3000). The dev stack must run **this** branch so the tile service + web widget carry the aggregation code.

### Fixtures

Already seeded on the dev DB (org `38e71bc6…`, station `9916fb74…`) from the #314 walk — reuse them:

- [ ] `parcels` — ~397k Salt Lake County polygons (has `c_city`, `c_own_type`, `c_area`). The headline dataset.
- [ ] `roads` — 2k Utah Roads lines (`c_cartocode`).
- [ ] `smoke` — 60k synthetic points (`c_state_name`) — a **tiled** point layer.
- [ ] `cities` — 60 US cities via lat/lng columns — a **small/inline** layer (used to confirm inline does *not* aggregate).

If the parcels are gone, re-seed per the #314 cleanup manifest before starting.

### Reset between runs

- [ ] None needed — every step is read-only (viewing maps). Re-run by re-prompting or reloading; hard-refresh after a code change so the widget re-reads tiles.

## §1 — Polygon aggregate overview + colour continuity (AC1, AC3, AC4) · slice 2+3

- [ ] Prompt **"Map the parcels colored by city."** Let it render, then zoom out to the whole county (≈ z9–z11).
- [ ] **Every region is filled** with square bins — no empty/blank areas anywhere in the county (contrast the old behavior where whole areas vanished).
- [ ] Each bin is coloured by its **dominant city** (e.g. the Salt Lake City area reads as SLC's colour, Sandy's as Sandy's) — the 25-city legend still shows.
- [ ] The notice under the map reads **"Aggregated overview — zoom in for detail."** and **not** "Partial at this zoom — zoom in for all features."
- [ ] **Zoom into a city/neighborhood (z14+):** the bins give way to individual parcel polygons, coloured by the **same** per-city colours (a city's bins and its parcels are the same hue — shared persisted stops).
- [ ] **DevTools → Network:** a low-zoom `…/{z}/{x}/{y}.mvt` response (z < 14) carries header **`X-Portal-Tile-Aggregated: 1`** and **no** `X-Portal-Tile-Truncated`; a z ≥ 14 `.mvt` carries **neither** aggregated nor (for this layer) truncated.

## §2 — Density fallback with no colorBy (AC2) · slice 2+3

- [ ] Prompt **"Map the parcels."** (no colour). Zoom out to the county.
- [ ] Low zoom shows a **density fill** — a single hue whose opacity scales with how many parcels fall in each cell (dense downtown cells solid, rural-edge cells faint), **not** a flat single colour.
- [ ] The shading is **consistent cell-to-cell across the map** — a cell with ~the same count looks the same in a dense tile and a sparse tile (fixed/log domain, not per-tile normalized).
- [ ] Zoom in past z14 → individual parcels in the layer's default colour.

## §3 — Points and lines also aggregate (AC6) · slice 2+3

- [ ] Prompt **"Map the synthetic points colored by state."** (the 60k `smoke` points — a tiled point layer). At low zoom → grid bins coloured by dominant state; zoom in → individual points. (`smoke`, not `cities` — see §6.)
- [ ] Prompt **"Map the roads."** (2k lines). At low zoom → grid bins over the road network; zoom in → individual line features.

## §4 — Threshold handoff (AC1) · slice 3

- [ ] Slowly zoom across **z14** on the parcels map. The switch from bins → raw parcels is **clean at the boundary** — no gap (a blank zoom level), no double-draw (bins overlaid on parcels). MapLibre `minzoom`/`maxzoom` are min-inclusive / max-exclusive, so exactly one representation shows at any zoom.

## §5 — Performance / responsiveness (AC5) · slice 2

- [ ] The **county-wide parcels view is responsive** — panning/zooming at low zoom does not stall the browser (the pre-aggregation 3.5 MB low-zoom tiles that froze the tab are gone; aggregate tiles are light).
- [ ] *(Optional, script-verified)* Run the benchmark and confirm the aggregate grid query is well under the 10 s tile timeout at low zoom:
  ```
  DATABASE_URL=<your dev db> npx tsx apps/api/src/scripts/postgis-benchmark.ts 200000
  ```
  → the **"aggregate tile render (grid bins, #330)"** block reports z6/z9/z12 each in the low-milliseconds, far under 10 s.

## §6 — Error & edge cases (spec Risks)

- [ ] **Inline layers don't aggregate:** prompt **"Map the US cities colored by state."** (the 60-row `cities` layer renders inline, not tiled). It shows individual markers at **every** zoom — **no** bins and **no** "Aggregated overview" notice (aggregation is a tile-only path).
- [ ] **Notice clears on zoom-in:** on the parcels map, the "Aggregated overview" notice is **present** at low zoom and **gone** once you pass z14 (not sticky).
- [ ] *(If you exercise it)* A tiled map that hits the raw per-tile cap at z ≥ 14 still shows "Partial at this zoom" — the truncated notice is only *suppressed while aggregated*, not removed.

## Sign-off

- [ ] Every section above verified (or explicitly noted where a check was skipped / script-verified rather than live)
- [ ] __________________  (date + name) — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro (prompt + zoom level): · Identifiers (org / station / message / entity ids, tile z/x/y):
