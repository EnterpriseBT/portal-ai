# Low-zoom polygon choropleth treatment — Spec

Pins the contract for #472: a `"dissolve"` `AggTreatment` that renders a categorical polygon choropleth as one collected shape per colorBy value below the zoom threshold, instead of centroid-square bins. Builds on [`POLYGON_CHOROPLETH_LOWZOOM.discovery.md`](./POLYGON_CHOROPLETH_LOWZOOM.discovery.md). Child of epic [#470](https://github.com/EnterpriseBT/portal-ai/issues/470); branches off / PRs into `epic/map-tiles-at-scale`.

## Key decisions (flag for review)

1. **New `"dissolve"` treatment** (discovery D1) — bounds low-zoom output to #distinct colorBy values, unlike simplify-and-draw which still exceeds `MAP_TILE_FEATURE_CAP`.
2. **`ST_Collect` of simplified geometry, not `ST_Union`** (D2) — cheap, and visually identical under a solid single-color fill with no low-zoom outline. `ST_Union` is a documented fallback only if artifacts appear.
3. **Default polygons + categorical colorBy → `"dissolve"`, via the shared `resolveAggTreatment`** (D3) — one resolver keeps server tiles and client styles in agreement. "Categorical" = a colorBy present whose `scale` is not `"step"`/`"interpolate"`. Explicit `treatment` still overrides; no colorBy or continuous scale → `"bins"` (unchanged).
4. **Scope: categorical choropleths only** (Open Q1) — continuous/numeric colorBy polygons stay on the bins path; a value-aggregating low-zoom treatment is a separate follow-up.

## Scope

### In scope
- `"dissolve"` added to `AggTreatment`; `resolveAggTreatment` gains colorBy-aware routing.
- Server: `TileAggregation.treatment`; a `buildDissolveTileSql` branch; `X-Portal-Tile-Aggregated` emitted for dissolve.
- Client: `layerToMapLibre` renders dissolve below threshold (real geometry fill, colorBy).
- Cardinality cap + `X-Portal-Tile-Truncated` on overflow (Open Q2).

### Out of scope
- Continuous/numeric colorBy low-zoom treatment (Open Q1) — stays bins.
- `ST_Union` exact dissolve (D2 fallback), lowering `AGG_ZOOM_THRESHOLD`.
- Any change to `resolveColorBy` / legend (already property-agnostic).

## Surface

### `packages/core/src/contracts/map-spec.contract.ts`
- `MapLayerAggregationSchema.treatment` (`:120`): `z.enum(["bins","none","dissolve"])`. `AggTreatment` (`:123`) widens automatically. Update the doc comment (`:113-119`).
- `resolveAggTreatment` (`:157-163`) — new signature:
  ```ts
  export function resolveAggTreatment(
    kind: MapLayerKind,
    treatment?: AggTreatment,
    opts?: { hasColorBy?: boolean; colorByScale?: MapColorScale }
  ): AggTreatment
  ```
  where `MapColorScale = "categorical" | "step" | "interpolate"` (export the `scale` enum's type). Logic: explicit `treatment` wins; `lines → "none"`; **`polygons` with a categorical colorBy → `"dissolve"`** (categorical = `opts.hasColorBy === true && opts.colorByScale !== "step" && opts.colorByScale !== "interpolate"`); everything else (`polygons` without a categorical colorBy, `points`/`heatmap`/`cluster`) → `"bins"`. Back-compatible: called without `opts`, polygons still resolve `"bins"`.

### `apps/api/src/services/portal-map-tile.service.ts`
- `TileAggregation` (`:167-179`): add `treatment: AggTreatment`.
- `aggregationFromSpec` (`:187-225`): resolve treatment from the **representative layer's** colorBy — `resolveAggTreatment(kind, agg.treatment, { hasColorBy: !!repColorBy?.column, colorByScale: repColorBy?.scale })`; set `treatment` on the result; keep `enabled = treatment === "none" ? false : (agg.enabled ?? true)` (dissolve is enabled). `colorByColumn` scan unchanged.
- New `buildDissolveTileSql(pipelineSql, z, envelope, aggregation, cap)`: a `cells` CTE `SELECT src.<colorByColumn> AS cat, ST_Collect(ST_SimplifyPreserveTopology(src.geom, <tol>)) AS geom FROM (<pipelineSql>) src WHERE src.geom && ST_Transform(ST_Expand(<envelope>, <buffer>), 4326) GROUP BY 1 LIMIT ${cap}`, then `ST_AsMVT(q,'default',TILE_EXTENT,'geom')` over `SELECT cat AS "<colorByColumn>", ST_AsMVTGeom(ST_Transform(geom,3857), <envelope>, TILE_EXTENT, 64, true) AS geom FROM cells`, plus `n` = distinct-group count and `n_limited` = `1` when the group count hit `cap` (drives truncation). `<tol>` = `tileSimplifyTolerance(z)` (degrees, `:245`). Emits the colorBy value under its own column name so the client's `["get", col]` expression colours it — no client colour change.
- `defaultRunTileQuery` (`:428-438`): when `shouldAggregate(z, agg)`, branch on `agg.treatment` — `"dissolve"` → `buildDissolveTileSql`, else `buildAggregateTileSql`. The `X-Portal-Tile-Aggregated` header fires for both (dissolve is still an aggregated overview); `truncated` (→ `X-Portal-Tile-Truncated`) set when `n_limited`.

### `apps/web/src/modules/MapWidget/utils/map-config.util.ts`
- `layerToMapLibre` handoff (`:471-503`): `const treatment = resolveAggTreatment(layer.kind, agg?.treatment, { hasColorBy: !!style.colorBy?.column, colorByScale: style.colorBy?.scale })`. Extend the gate to `treatment === "bins" || treatment === "dissolve"`. For dissolve the existing **colorBy** branch (`:481-485`) applies unchanged (dissolve always has a colorBy) — a `-agg` fill at `maxzoom = threshold` painting the tile's real dissolved geometry with `resolveColorBy`; no centroid-square/density branch, no low-zoom outline. Raw fill/outline keep `minzoom = threshold`.

### Constants
None new — reuse `AGG_ZOOM_THRESHOLD`, `TILE_EXTENT`, `MAP_TILE_FEATURE_CAP`, `tileSimplifyTolerance`, `AGG_FILL_OPACITY`.

## Migration / Seed
None — a render-path + contract change, no DB schema. (Map specs are per-block content, re-rendered on read; no stored-data migration.)

## TDD test plan

### `packages/core` unit — `map-spec.contract.test.ts`
- `treatment` enum accepts `"dissolve"` (update the `rejects an unknown treatment` case, `:245`).
- `resolveAggTreatment`: polygons + categorical colorBy (`hasColorBy`, no/`categorical` scale) → `"dissolve"`; polygons + `step`/`interpolate` colorBy → `"bins"`; polygons + no colorBy → `"bins"`; explicit `treatment` overrides; `lines` → `"none"`; called without `opts` → `"bins"` (back-compat); points/heatmap/cluster → `"bins"`.

### `apps/api` unit — `portal-map-tile.service.test.ts`
- `aggregationFromSpec`: a polygon layer with a categorical colorBy yields `treatment: "dissolve"`, `enabled: true`, the `colorByColumn`; a `step` colorBy yields `"bins"`; no colorBy yields `"bins"`.
- `buildDissolveTileSql` (string SQL assertions, the pattern `buildRawTileSql` tests use): contains `GROUP BY`, `ST_Collect`, `ST_SimplifyPreserveTopology`, `ST_AsMVTGeom`, the quoted `colorByColumn` as both group key and emitted property, and `LIMIT <cap>`.
- `defaultRunTileQuery` routes a dissolve aggregation to the dissolve SQL (spy/stub `runTileQuery` or assert the built SQL shape).

### `apps/web` unit — `map-config.util.test.ts`
- A tiled polygons layer with a categorical colorBy: raw fill/outline get `minzoom = threshold`; a `-agg` **fill** (not centroid-square) at `maxzoom = threshold` painted by the colorBy expression; **no** `_count` density layer.
- A `step`/`interpolate` colorBy polygons layer still gets the bins handoff (regression).
- `treatment: "none"` / lines unchanged (regression).

**Totals ≈ 18 cases** (8 core + 5 api + 5 web). No migration test (no schema change). Integration/render is the epic's app-dev smoke.

## Acceptance criteria
- [ ] A polygons map with a categorical colorBy renders **filled dissolved regions** (one per value, colored by value) below z14 — not centroid squares.
- [ ] Above z14 the raw parcels render, colored by the same colorBy.
- [ ] A `step`/`interpolate` colorBy, or a no-colorBy polygons layer, is unchanged (bins).
- [ ] `resolveAggTreatment` is the single decision; server tile and client style never disagree (both call it with the same colorBy inputs).
- [ ] A dissolve tile carries the colorBy value as a feature property; the client colours it with the existing `resolveColorBy` (no new color code).
- [ ] Group overflow past `MAP_TILE_FEATURE_CAP` sets `X-Portal-Tile-Truncated`; `X-Portal-Tile-Aggregated` fires for dissolve.
- [ ] `build`, `type-check`, `lint` green.

## Risks & rollback
- **Mis-routed continuous colorBy** (numeric, no explicit scale) → dissolve with ~one group per row. Guarded by the cap (degrades to a truncated tile, not an explosion) + the `step`/`interpolate` exclusion. Fail-safe. Authors can set `scale`/`treatment: "bins"` to force the bins path.
- **`ST_Collect` artifacts** (semi-transparent overlap) — fallback to `ST_Union` (D2); detected in the app-dev render smoke.
- **Rollback**: revert the branch; the additive enum member and optional `resolveAggTreatment` arg leave existing specs (`"bins"`/`"none"`) untouched.

## Files touched
- `packages/core/src/contracts/map-spec.contract.ts` — enum + resolver
- `apps/api/src/services/portal-map-tile.service.ts` — `TileAggregation`, `aggregationFromSpec`, `buildDissolveTileSql`, branch, header
- `apps/web/src/modules/MapWidget/utils/map-config.util.ts` — dissolve handoff
- Tests: `map-spec.contract.test.ts`, `portal-map-tile.service.test.ts`, `map-config.util.test.ts`
- Doc-sync: check glossary/help if map "aggregation/overview" is user-documented

## Next step
`docs/POLYGON_CHOROPLETH_LOWZOOM.plan.md` (`/plan 472`). ~4 slices: (1) contract enum + resolver (+ core tests); (2) server `TileAggregation`/`aggregationFromSpec`/`buildDissolveTileSql`/branch (+ api tests); (3) client handoff (+ web tests); (4) doc-sync. Each a testable commit; child PR targets `epic/map-tiles-at-scale`.
