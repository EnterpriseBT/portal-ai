# Low-zoom map aggregation — Spec

Pins the contract for the grid-bins + dominant-category low-zoom overview. Discovery: `docs/LOW_ZOOM_MAP_AGGREGATION.discovery.md`. Issue: [#330](https://github.com/EnterpriseBT/portal-ai/issues/330) (epic #84). Builds on the #314 tile path.

## Key decisions (locked in discovery)

1. **Square grid**, server-side, in the tile query below a zoom threshold.
2. **`mode()`+`count` per cell** for category layers; **`count`-only density fill** when no `colorBy`.
3. **Dual zoom-gated client layers**: aggregate `fill` (`maxzoom = threshold`) + raw kind-layer(s) (`minzoom = threshold`), same `colorBy` match.
4. **Automatic below threshold** with an optional per-layer `aggregation` override; **default threshold `z < 14`**, tuned during smoke to clear the raw over-cap band.
5. **No silent degradation** — a new `X-Portal-Tile-Aggregated` header drives an "aggregated overview" notice; an aggregated tile is never also "truncated".
6. Density scale domain is **fixed + log-scaled** (not per-tile normalized).

## Scope

**In scope:** grid aggregation in the tile query; the `aggregation` spec field; the aggregated header + notice; web dual-layer rendering + density paint; a benchmark. **Out of scope:** hex grids; precomputed/materialized overview tiles; cross-tile bin stitching; measure-based (sum/avg) choropleths; changing raw-tile behavior above the threshold.

## Surface

### `packages/core/src/contracts/map-spec.contract.ts` — `aggregation` field

Add to the **inner object** of `MapLayerSchema` (before `.superRefine`):

```ts
aggregation: z
  .object({
    enabled: z.boolean().optional(),          // default true (server-applied)
    gridSizePx: z.number().int().positive().max(128).optional(),  // default AGG_GRID_PX
    zoomThreshold: z.number().int().min(0).max(22).optional(),     // default AGG_ZOOM_THRESHOLD
  })
  .optional();
```

All fields optional; **absence ⇒ aggregation on with the shared defaults**. Additive/optional ⇒ existing specs and `WidgetRefreshResponse` consumers unaffected. Export `MapLayerAggregation` type.

### `packages/core/src/constants/large-data-ops.constants.ts` — shared defaults

```ts
export const AGG_ZOOM_THRESHOLD = 12;   // aggregate at z < this; raw at z >= this
export const AGG_GRID_PX = 24;          // target cell size in screen px
export const AGG_DENSITY_MAX = 5000;    // upper bound of the log density domain
```

Shared so server (query) and web (layer minzoom/maxzoom + density paint) agree.

### `apps/api/src/services/portal-map-tile.service.ts` — aggregation branch

- `resolvePipeline` additionally returns an **`aggregation` descriptor** read from the spec (`inner.spec`/`content.spec`): `{ enabled: boolean; zoomThreshold: number; gridSizePx: number; colorByColumn: string | null }`. `colorByColumn` = the first layer's `style.colorBy.column` (null ⇒ density mode). Defaults filled from the constants.
- `TileQueryResult` gains `aggregated: boolean`. `TileRenderResult` gains `aggregated: boolean`.
- `defaultRunTileQuery(args)` gains `aggregation` in its args; when `aggregation.enabled && z < aggregation.zoomThreshold`, it builds the **grid query** instead of the `lim` CTE:
  - `cellSize = |envelope_width_3857| / (TILE_EXTENT / gridSizePx)` (world units per cell).
  - `binned`: `SELECT ST_SnapToGrid(ST_Centroid(ST_Transform(src.geom,3857)), cellSize) AS cell, <colorByColumn> FROM (pipeline.sql) src WHERE src.geom && ST_Transform(envelope,4326)`.
  - `cells`: `GROUP BY cell` → `mode() WITHIN GROUP (ORDER BY <colorByColumn>) AS <colorByColumn>` (omitted in density mode) + `count(*)::int AS _count`.
  - emit each cell as a square polygon via `ST_MakeEnvelope(x,y,x+cellSize,y+cellSize,3857)` → `ST_AsMVTGeom(…, envelope, TILE_EXTENT, 0, true)`, `ST_AsMVT(q,'default',TILE_EXTENT,'geom')`. Feature properties: `<colorByColumn>` (category mode) **and** `_count`.
  - returns `{ mvt, featureCount, truncated: false, aggregated: true }`.
- `renderTile`: when the result is `aggregated`, force `truncatedCap = null` (an aggregate is complete, not clipped) and pass `aggregated` through. Raw branch (`z >= threshold` or disabled) is unchanged, `aggregated: false`.
- `_count` is a reserved feature-property name (data columns are `c_*`, so no collision); `propertyColumnsFromSpec` is unchanged (it drives the raw path's property projection).

### `apps/api/src/routes/portal-map.router.ts` — `sendTile`

Add, after the truncated header:

```ts
if (result.aggregated) res.setHeader("X-Portal-Tile-Aggregated", "1");
```

`renderTile` already nulls `truncatedCap` when aggregated, so the two headers are mutually exclusive.

### `apps/web/src/modules/MapWidget/utils/tile-source.util.ts`

`TileStatus` gains `aggregated: boolean`; `EMPTY_TILE_STATUS.aggregated = false`; `readTileStatus` sets `aggregated: headers.get("X-Portal-Tile-Aggregated") != null`.

### `apps/web/src/modules/MapWidget/utils/map-config.util.ts`

- `MapLibreLayer` gains `minzoom?: number` and `maxzoom?: number`.
- `layerToMapLibre` (tile mode) emits, per layer:
  - the existing raw kind-layer(s) gated **`minzoom: zoomThreshold`**;
  - one **aggregate `fill`** layer gated **`maxzoom: zoomThreshold`**, id `${source}-agg`, `source-layer` `default`, painted by:
    - **category:** the same `colorBy` `match` expression (dominant category rides the same column) — reuse `resolveColorBy`;
    - **density (no `colorBy`):** `fill-opacity` = `["interpolate",["linear"],["log",["max",["get","_count"],1]], 0, 0.12, log(AGG_DENSITY_MAX), 0.85]`, `fill-color` = the layer color.
  - `zoomThreshold`/`gridSizePx` read from `layer.aggregation` with the shared-constant fallbacks. Aggregation is skipped only when `aggregation.enabled === false`.
- Inline (non-tiled) rendering path is untouched (aggregation is a tile concern).

### `apps/web/src/modules/MapWidget/MapWidget.component.tsx`

Add a notice block (mirroring the truncated one), shown when `tiles.aggregated` and suppressing the truncated notice:

```tsx
{tiles.aggregated ? (
  <Typography variant="caption" color="text.secondary" data-testid="map-widget-aggregated">
    Aggregated overview — zoom in for detail.
  </Typography>
) : tiles.truncated ? ( /* existing "Partial at this zoom" */ ) : null}
```

## Migration / Seed

**None** — no DB schema change. Aggregation is a read-time tile-query behavior over the existing `geometry(Geometry,4326)` + GiST columns.

## TDD test plan

Run per package via `npm run test:unit` / `npm run test:integration` (never raw jest).

### `packages/core` — `src/__tests__/contracts/map-spec.contract.test.ts`
- `aggregation` omitted → parses (optional); present with partial fields → parses; `zoomThreshold` out of 0–22 → rejects; `.superRefine` polygon/lat-lng rule still enforced with `aggregation` present. **≈4 cases.**

### `apps/api` — `src/__tests__/services/portal-map-tile.service.test.ts` (unit, mocked `runTileQuery`)
- `aggregated: true` from the query → `truncatedCap` forced null, result carries `aggregated`; `aggregated: false` → unchanged; a raw truncated tile still flags `truncatedCap`. **≈3 cases.**

### `apps/api` — `src/__tests__/__integration__/db/map-aggregation.integration.test.ts` (real SQL)
- Below threshold over seeded multi-category geometry: returns cell polygons; each cell's `<colorByColumn>` = the `mode()` of its members; `_count` = member count; at/above threshold → raw features, `aggregated:false`; no-`colorBy` spec → cells carry `_count`, no category property. **≈4 cases.**

### `apps/web` — `src/modules/MapWidget/__tests__/map-config.util.test.ts`
- tiled category layer → raw layer(s) `minzoom = threshold` + one `${source}-agg` fill `maxzoom = threshold` colored by the colorBy `match`; no-`colorBy` → agg fill uses the `_count` interpolate; `aggregation.enabled === false` → no agg layer. **≈4 cases.**

### `apps/web` — `tile-source.util` + `MapWidget` tests
- `readTileStatus` sets `aggregated` from the header; the aggregated notice renders and suppresses the truncated notice. **≈3 cases.**

**Totals ≈ 18 cases.** Plus a non-asserting benchmark addition to `scripts/postgis-benchmark.ts` for the grid query at z6/z9/z12.

## Acceptance criteria

- [ ] Viewing the 397k-parcel layer at county zoom shows filled square bins covering **all** regions (no empty areas), tinted by dominant city; the raw parcels return by `z ≥ threshold`.
- [ ] A no-`colorBy` layer shows a density fill at low zoom (denser cells more opaque), consistent cell-to-cell across the map.
- [ ] Aggregated tiles carry `X-Portal-Tile-Aggregated`; the widget shows "Aggregated overview — zoom in for detail" and **not** "Partial at this zoom".
- [ ] Aggregated and raw views use identical category colors (shared persisted stops).
- [ ] The grid query stays within `TILE_STATEMENT_TIMEOUT_MS` at z6/z9/z12 on the 397k parcels (benchmark).
- [ ] Point and line layers also aggregate below the threshold.

## Risks & rollback

- **Low-zoom scan cost.** The lowest zooms scan the most features per tile; if the grid query exceeds the timeout it surfaces as the existing typed **504** (fail-safe, not a blank tile) — no silent fallback to the arbitrary cap. Rollback: set `aggregation.enabled=false` (per-layer) or bump the threshold; the raw+cap path is untouched.
- **Color drift** between aggregate and raw if stops aren't reused — mitigated by aliasing `mode()` as the colorBy column so the same persisted `match` applies.
- **Property-name collision** on `_count` — avoided (data columns are `c_*`).

## Files touched

- Edit: `packages/core/src/contracts/map-spec.contract.ts`, `packages/core/src/constants/large-data-ops.constants.ts`
- Edit: `apps/api/src/services/portal-map-tile.service.ts`, `apps/api/src/routes/portal-map.router.ts`
- Edit: `apps/web/src/modules/MapWidget/utils/tile-source.util.ts`, `.../utils/map-config.util.ts`, `.../MapWidget.component.tsx`
- Edit: `scripts/postgis-benchmark.ts`
- New tests: `map-aggregation.integration.test.ts`; extend the contract / tile-service / map-config / tile-source / MapWidget test files above.

## Next step

`/plan 330` slices this on `feat/low-zoom-map-aggregation` — roughly: (1) contract field + shared constants + tests; (2) server grid query + `resolvePipeline` descriptor + `aggregated` flag + header; (3) web dual-layer rendering + density paint + notice + status; (4) integration/benchmark + smoke-doc refresh. Each a testable commit on this branch.
