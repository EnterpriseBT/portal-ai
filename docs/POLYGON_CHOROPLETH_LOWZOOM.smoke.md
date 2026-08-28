# polygon-choropleth-lowzoom — Smoke Suite

Manual smoke test for [#472](https://github.com/EnterpriseBT/portal-ai/issues/472) — a polygon choropleth renders as **dissolved filled regions** below zoom 14 instead of centroid squares (the `"dissolve"` `AggTreatment`). **Branch under test:** `fix/polygon-choropleth-lowzoom` (PR [#475](https://github.com/EnterpriseBT/portal-ai/pull/475) → `epic/map-tiles-at-scale`).

The headline (§1) is a **visual render check** — best run on the assembled epic deployed to app-dev (`gh workflow run deploy-dev.yml --ref epic/map-tiles-at-scale`), against the real categorical (zip) choropleth layer. §3/§4 are DB/header-level and can be checked locally too.

## Preflight

### Environment

- [ ] `git checkout fix/polygon-choropleth-lowzoom && git pull --ff-only` (or smoke the assembled epic on app-dev)
- [ ] `npm install`
- [ ] **No migration** — #472 is a render/contract change, no DB schema.
- [ ] `npm run dev` boots cleanly (API :3001, web :3000), signed in.

### Fixtures

- [ ] A **polygons** layer with a **categorical** colorBy (e.g. parcels colored by zip/class) — the app-dev `Smoke 3`-style 283K parcel layer with a `colorBy` on a discrete column. Ask the assistant: *"show all parcels on a map, colored by zip"* to mint the map, then view it.
- [ ] For §4, a **continuous** colorBy map (e.g. *"parcels colored by market value"* with a numeric/interpolate scale).

### Reset between runs

- [ ] Read-only — panning/zooming a map. No reset needed.

## §1 — Dissolved choropleth below z14 (AC 1, 2 — the headline)

- [ ] Open the categorical-colorBy polygons map at its authored **low zoom (~z8)**. **Before #472:** the map showed 24px squares snapped to parcel centroids. **After:** it shows **filled regions** — one solid colored area per colorBy value (e.g. each zip is one colored region), i.e. a real choropleth.
- [ ] Zoom **in past z14**: the map switches to **individual parcels**, colored by the same colorBy. The z14 handoff is seamless (no blank band).
- [ ] Zoom back out below z14: it returns to the dissolved regions.

## §2 — Server emits dissolve tiles (AC 4, 5, 6)

- [ ] In devtools/network, a low-zoom tile request (`…/{z}/{x}/{y}.mvt` at z < 14) carries the **`X-Portal-Tile-Aggregated`** response header (the "Aggregated overview" notice still fires).
- [ ] The rendered low-zoom features are **polygons** (inspect one via click/popup — it covers a whole colorBy region), colored by the colorBy value — confirming the tile carries the colorBy property and the client's existing color expression paints it (no separate color path).
- [ ] (Optional, DB) Against the layer, the dissolve query groups by the colorBy column: `SELECT <colorBy>, ST_NumGeometries(ST_Collect(c_geometry)) FROM "er__<id>" GROUP BY <colorBy>` returns one row per distinct value — the bound the treatment relies on.

## §3 — Continuous colorBy is unchanged (AC 3)

- [ ] Open the **continuous** (market-value / interpolate) colorBy polygons map at low zoom. It still renders the **bins** path (squares / density) — #472 does not change the continuous case. (No regression, and no dissolve for a gradient.)
- [ ] A polygons layer with **no** colorBy still renders density bins at low zoom.

## §4 — Recorded (not manually smoke-tested)

- [ ] **Truncation on colorBy overflow (AC 6, second half)** — a categorical colorBy with > `MAP_TILE_FEATURE_CAP` (10,000) distinct values sets `X-Portal-Tile-Truncated`. Not reproduced by hand (no such high-cardinality categorical layer); covered by the unit assertion that the dissolve builder caps + reports `n_limited`.
- [ ] **build / type-check / lint (AC 7)** — verified by CI on the PR; no local step.

## Sign-off

- [ ] Every section above verified
- [ ] ______ (date + name) — confirmed against my own running stack / app-dev

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/entity/block ids):
