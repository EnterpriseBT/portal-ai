# Continuous map representation — Spec

**Issue:** [EnterpriseBT/portal-ai#532](https://github.com/EnterpriseBT/portal-ai/issues/532) · **Discovery:** `docs/MAP_REPRESENTATION_CONTINUITY.discovery.md`

Pins the contract for the map-representation invariant: the raw-vs-aggregate choice moves from a global zoom threshold to a **per-tile feature count**, the aggregate grid becomes a **nested tile-pyramid**, over-cap points/lines **aggregate instead of clipping**, the MapSpec `aggregation` block becomes **advisory**, polygon **dissolve bands become continuous**, and the tile **ETag gains a version salt**. This is what the tests assert against.

## Key decisions (confirm before implementation)

1. **Count-driven, per-tile.** A tile renders raw iff it holds ≤ `MAP_TILE_FEATURE_CAP` features; over-cap tiles aggregate. A **whole-layer fast path** (persisted exact count ≤ cap) short-circuits to raw at all zooms with no query — this is the direct #532 fix.
2. **Nested grid.** `cellsPerAxis = 16` (2⁴), `cellSize = WORLD_3857_WIDTH / 2^(z+4)`, snapped to origin (0,0). Cells nest across zoom (each splits into 4); bins are cell-bounds squares. No centroid marker.
3. **Advisory aggregation.** The invariant always wins: no spec value can strand a feature. `zoomThreshold` is retained-but-ignored; `enabled:false`/`treatment:"none"` mean "prefer raw" (= the new default); `treatment:"dissolve"` and `gridSizePx` stay active.
4. **Lines over cap = hybrid.** Longest-N raw lines + a nested-grid density aggregate where each line contributes to **every cell its geometry crosses**. Both ride one MVT, separated by an `_agg` feature flag.
5. **`truncated` retired.** Over-cap → aggregate, never clip, so truncation is unreachable. The `TileQueryResult.truncated` field, `TileRenderResult.truncatedCap`, the `X-Portal-Tile-Truncated` header, and its web notice are removed (clean cut — no prod data, no compat alias).
6. **ETag salt.** `AGG_TILE_VERSION` folds into the ETag hash; the resolved tile mode rides the ETag as a prefix so a 304 reports the right notice without re-querying.
7. **Dissolve continuity.** Coarse bands are derived by simplifying the **finest** band's union, not re-unioned independently — a region's outline only smooths across a boundary, never re-merges.

## Scope

### In scope

- `packages/core` — count-driven decision helpers + grid constants + advisory-field docs in `large-data-ops.constants.ts` and `map-spec.contract.ts`.
- `apps/api` — `portal-map-tile.service.ts` (decision, nested grid, line hybrid, ETag salt, `truncated` removal), `portal-map.router.ts` (header removal), `dissolve-precompute.processor.ts` (band nesting), dissolve re-enqueue on deploy.
- `apps/web` — `map-config.util.ts` (remove zoom-gate, `_agg` filters), `MapWidget.component.tsx` (notice copy, remove truncated notice), `tile-source.util.ts` (drop truncated status).

### Out of scope

- Replacing the dissolve path with grid bins; `heatmap`/`cluster` layer kinds; client-side clustering; legend/opacity-ramp retuning (unless nesting materially shifts count distributions — a smoke observation, not a change here).

## Surface

### `packages/core/src/constants/large-data-ops.constants.ts`

```ts
/** Aggregate grid cells per tile axis — a power of two so the grid nests across
 *  zoom (a cell at z is exactly the union of its 4 children at z+1). 16 ⇒ ~32px
 *  bins at the 512px tile size. Replaces the old non-nested round(512/24)=21. */
export const AGG_CELLS_PER_AXIS = 16;               // 2^AGG_GRID_LEVELS
export const AGG_GRID_LEVELS = 4;                   // log2(AGG_CELLS_PER_AXIS)

/** Bumped whenever tile-generation behavior changes (grid, decision, line
 *  hybrid). Folded into the tile ETag so cached tiles refresh on deploy. */
export const AGG_TILE_VERSION = 2;
```

- `AGG_ZOOM_THRESHOLD` is **retained** (specs still reference it; `bandForZoom` still uses it as the dissolve ceiling) but no longer gates the raw-vs-aggregate flip. `AGG_GRID_PX` is retained for `gridSizePx` back-compat but the nested grid derives `cellsPerAxis` from `AGG_CELLS_PER_AXIS`, not from px (px can't yield a power of two). Update both JSDoc blocks to say so.

### `packages/core/src/contracts/map-spec.contract.ts`

- `MapLayerAggregationSchema` (`:109-126`) — **unchanged shape** (contract-stable). JSDoc updated: `zoomThreshold` marked advisory/ignored; `enabled:false` + `treatment:"none"` documented as "prefer raw" (equal to the new default for points/lines); the invariant note added ("no value suppresses aggregation of an over-cap tile").
- `resolveAggTreatment` (`:162-175`) — **unchanged**. Still the single source of truth; `"none"`/`"bins"` now both feed the count-driven path (they no longer decide raw-vs-aggregate, only whether a `"dissolve"` polygon path is selected).

### `apps/api/src/services/portal-map-tile.service.ts`

**Decision function (new, exported, pure):**

```ts
export type TileMode = "raw" | "aggregate" | "hybrid-lines" | "dissolve";

/** The per-tile render mode. `layerTotal`/`layerTotalExact` come from the
 *  persisted query envelope; `tileCount` is the per-tile probe (null when the
 *  fast path settled it without a probe). `dissolveReady` = precompute exists. */
export function resolveTileMode(args: {
  z: number;
  aggregation: TileAggregation;
  layerTotal: number | null;
  layerTotalExact: boolean;
  tileCount: number | null;
  cap: number;
  dissolveReady: boolean;
}): TileMode;
```

Resolution order:
1. `treatment === "dissolve" && bandForZoom(z) !== null && dissolveReady` → `"dissolve"`. (A miss falls through to the count path — real polygons, never bins.)
2. Whole-layer fast path: `layerTotalExact && layerTotal !== null && layerTotal <= cap` → `"raw"` (no probe).
3. Per-tile: `tileCount !== null && tileCount <= cap` → `"raw"`; else `kind === "lines"` → `"hybrid-lines"`, else → `"aggregate"`.

**`shouldAggregate` (`:243`) — removed.** All call sites move to `resolveTileMode`.

**`resolvePipeline` (`:268-323`) — return shape gains the persisted count:**

```ts
Promise<{ pipeline; snapshotUpdatedAt; propertyColumns; aggregation;
          layerTotal: number | null; layerTotalExact: boolean }>
```

`layerTotal = content.matchedCount ?? content.rowCount ?? null`; `layerTotalExact = content.matchedCountExact === true` (from `QueryHandleEnvelopeFieldsSchema`, `portal-sql.contract.ts:32-52`). Read from the same `content`/`inner` object already loaded for both the message and pin refs.

**`buildAggregateTileSql` (`:377-412`) — nested grid.** `cellSize = WORLD_3857_WIDTH / 2 ** (z + AGG_GRID_LEVELS)` (no `round(512/gridSizePx)`); everything else (centroid snap, `ST_MakeEnvelope` cell square, `mode()`/`_count`, envelope expand by one cell) unchanged **plus** emit `1 AS _agg` as a feature property so the client filters bins from raw. `n_limited` stays `0`.

**`buildRawTileSql` (`:332-365`) — probe + no `_agg`.** Add a `probe` mode: when the mode is unknown (large layer, no fast path), build with `LIMIT ${cap + 1}`; the caller reads `n_limited`: `<= cap` ⇒ serve as raw (done), `> cap` ⇒ discard and aggregate. Raw features carry no `_agg`. `rankByLength` (lines) unchanged.

**`buildLineHybridTileSql` (new).** For `"hybrid-lines"`: one MVT `'default'` layer = `UNION ALL` of (a) longest-N raw lines (`ORDER BY ST_Length DESC LIMIT ${cap}`, no `_agg`) and (b) nested-grid bins where **each line contributes to every cell it intersects** — a bin per `(cell)` with `count(*) AS _count, 1 AS _agg`. Crossed-cell coverage via `ST_SquareGrid(cellSize, line)` ∩ line (contract: a cell any source line crosses has a bin); the exact PostGIS primitive (`ST_SquareGrid` vs segmentize-and-snap) is a plan choice validated for cost at smoke.

**`defaultRunTileQuery` (`:420-536`) — driven by `resolveTileMode`:**
- `"dissolve"` → `runDissolveTile` (unchanged).
- `"raw"` (fast path) → `buildRawTileSql` with `LIMIT cap` (no probe needed).
- unknown large-layer → `buildRawTileSql` probe (`LIMIT cap+1`); if `n_limited <= cap` return raw; else run `buildAggregateTileSql` (points) or `buildLineHybridTileSql` (lines).
- Return `{ mvt, featureCount, mode }` — `TileQueryResult.truncated`/`aggregated` **replaced** by `mode: TileMode` (`aggregated = mode !== "raw" && mode !== "dissolve"` derivable where needed).

**`renderTile` (`:620-702`) — ETag salt + mode prefix, `truncated` removed:**

```ts
const hash = sha256(`${pipeline.sql}|${z}|${x}|${y}|${snapshotUpdatedAt ?? ""}|${AGG_TILE_VERSION}`).slice(0,32);
// mode rides the ETag so a 304 reports the right notice without re-querying:
const etag = `"${mode}~${hash}"`;               // mode filled after the query on a 200
```

304 branch: parse the incoming `If-None-Match` into `(mode, hash)`; compare **hash parts**; on match return 304 with `aggregated` derived from the echoed `mode` (no query). `TileRenderResult` drops `truncatedCap`; `aggregated` is set from `mode`. `simplifiedTolerance` stays (raw/dissolve paths still simplify).

### `apps/api/src/routes/portal-map.router.ts`

`sendTile` (`:63-89`) — remove the `X-Portal-Tile-Truncated` header block (`:74-76`). `X-Portal-Tile-Aggregated` + `X-Portal-Tile-Simplified` unchanged. Update the two route `@openapi` blocks to drop the truncated response header.

### `apps/api/src/queues/processors/dissolve-precompute.processor.ts`

`runDissolve` (`:73-215`) — replace the per-band independent `ST_Union` (`:147-198`) with **derive-from-finest**: compute the finest band's `ST_Union` per value once (a CTE / a temp materialization), then each band's rows = `ST_Subdivide(ST_SimplifyPreserveTopology(<finest union>, tol(band)), SUBDIVIDE_MAX_VERTICES)`. Per-band atomic replace transaction and the fallback-on-band-failure behavior are preserved. `map_dissolve_geometries` columns unchanged.

### `apps/web/src/modules/MapWidget/utils/map-config.util.ts`

`layerToMapLibre` (`:490-531`) — for a tiled `bins` layer:
- **Remove** `for (const l of layers) l.minzoom = threshold` (`:503`) and the `-agg` fill's `maxzoom` (`:508`).
- The `-agg` fill and the raw layer(s) both render at all zooms, separated by filter: `-agg` fill gains `filter: ["==", ["get", "_agg"], 1]`; every raw layer gains `filter: ["!", ["has", "_agg"]]`.
- Density opacity ramp (`:520-528`) unchanged. `gridSizePx`/`zoomThreshold` reads become vestigial (kept for schema compat; not used for gating).

### `apps/web/src/modules/MapWidget/utils/tile-source.util.ts` + `MapWidget.component.tsx`

- `readTileStatus` (`:52-65`) — drop the `truncated` field (the `X-Portal-Tile-Truncated` read). `TileStatus` loses `truncated`.
- `MapWidget.component.tsx` — remove the truncated-notice branch (`:381`); the aggregated notice copy updates to name per-area summarization, e.g. **"Dense areas are summarized — zoom in for detail."** (some tiles at a zoom may be raw while others aggregate).

## Migration / Seed

**No schema change** — no migration, no seed. `map_dissolve_geometries` keeps its columns; only its contents change (band-nesting), so existing rows are **cleared and re-enqueued** on deploy (a one-off `DELETE FROM map_dissolve_geometries` + re-enqueue via `DissolvePrecomputeService.enqueueForPin` for existing dissolvable pins — a boot-time or ops step, safe with no prod data). Document the step; no data migration test needed.

## TDD test plan

Run via npm scripts (`feedback_use_npm_test_scripts`): `cd packages/core && npm run test:unit`; `cd apps/api && npm run test:unit && npm run test:integration`; `cd apps/web && npm run test:unit`.

### Layer 1 — `@portalai/core` (`__tests__/constants/large-data-ops.util.test.ts`)

1. `AGG_CELLS_PER_AXIS` is a power of two; `2 ** AGG_GRID_LEVELS === AGG_CELLS_PER_AXIS`.
2. Nesting property: `cellSize(z) === 2 * cellSize(z+1)` for the derived formula across a zoom range.
3. `resolveAggTreatment` unchanged (regression): lines→none, polygon+colorBy→dissolve, else bins.

### Layer 2 — decision + SQL builders (`apps/api/src/__tests__/services/portal-map-tile.service.test.ts`)

4. `resolveTileMode` fast path: exact `layerTotal ≤ cap` → `"raw"` regardless of `z` (no `tileCount`).
5. `resolveTileMode` per-tile: `tileCount ≤ cap` → `"raw"`; `> cap` + points → `"aggregate"`; `> cap` + lines → `"hybrid-lines"`.
6. `resolveTileMode` dissolve: polygon+colorBy+band+`dissolveReady` → `"dissolve"`; miss → falls to count path.
7. `resolveTileMode` inexact count > cap forces the per-tile probe (never fast-path-raw on an inexact/truncated total).
8. `buildAggregateTileSql` emits `cellSize = WORLD_3857_WIDTH / 2^(z+4)` and `1 AS _agg` (assert on generated SQL string).
9. `buildRawTileSql` probe uses `LIMIT cap+1` and no `_agg`; raw non-probe uses `LIMIT cap`.
10. `buildLineHybridTileSql` UNIONs longest-N raw lines (no `_agg`) with per-crossed-cell bins (`_agg`, `_count`).
11. ETag: same inputs → same etag; bumping `AGG_TILE_VERSION` changes it; mode prefix present.

### Layer 3 — tile render integration (`apps/api/src/__tests__/__integration__/routes/portal-map.router.integration.test.ts`)

12. **Small point layer (< cap) renders raw dots at z3** (the #532 fix) — MVT features are points, not bin polygons; `X-Portal-Tile-Aggregated` absent.
13. **Over-cap point tile aggregates**, not clips — bins present; feature (bin) count ≪ source count; no features dropped (every source point falls in some bin's cell).
14. **Nesting/continuity**: a bin cell at z is exactly covered by ≤4 bin cells at z+1 (assert cell bounds subdivide; no cell appears that isn't a child of a z cell).
15. **Over-cap line tile is hybrid** — longest lines present as line geometries AND bins covering the crossed cells of a known short line that is *not* in the longest-N set (proves the short line is represented, not dropped).
16. `304` on `If-None-Match` echo returns the right `aggregated` flag from the ETag mode prefix without running a query (spy asserts no tile query).
17. `304` still 304s after `AGG_TILE_VERSION` unchanged; a bumped version yields a fresh `200` (cache-bust).
18. **Advisory override**: a spec with `aggregation.enabled:false` on an over-cap layer still aggregates (invariant wins) — bins present.
19. No response carries `X-Portal-Tile-Truncated` (header retired) on any path.

### Layer 4 — dissolve continuity (`apps/api/src/__tests__/__integration__/queues/dissolve-precompute.processor.integration.test.ts`)

20. Coarser band geometry is a topological simplification of the finest band's union for the same value (area within tolerance; same value set) — not an independent re-merge.
21. Every value present in the finest band is present in every coarser band (no region drops across a boundary).
22. Per-band atomic-replace + band-failure fallback behavior preserved (regression).

### Layer 5 — web (`apps/web/src/modules/MapWidget/__tests__/map-config.util.test.ts`, `.../MapWidget.test.tsx`, `.../tile-source.util.test.ts`)

23. `layerToMapLibre` bins layer: no `minzoom`/`maxzoom` on the raw or `-agg` layers; `-agg` fill has `filter ["==",["get","_agg"],1]`; raw layer has `filter ["!",["has","_agg"]]`.
24. Density opacity ramp unchanged on the `-agg` fill (regression).
25. `readTileStatus` no longer surfaces `truncated`; `TileStatus` has no `truncated`.
26. `MapWidget` shows the aggregated notice (new copy) when a tile is aggregated; renders no truncated notice ever.

**Totals:** ~3 core, ~8 api service, ~8 api integration, ~3 dissolve, ~4 web ≈ **26 cases**.

## Acceptance criteria

- [ ] A point layer under the cap renders as individual dots at every zoom (no squares) — #532.
- [ ] Every in-frame feature (point/line/polygon) is represented as itself or an aggregate at every zoom; no arbitrary `LIMIT` drop remains.
- [ ] Aggregate bins nest: zooming ±1 splits a bin into its children / merges children into it — no bin appears where no parent was.
- [ ] Over-cap line tiles show the major skeleton as real lines and cover the rest with bins over their crossed cells.
- [ ] No `aggregation` spec value can leave an in-frame feature unrepresented.
- [ ] Polygon choropleths transition across dissolve bands with a region only smoothing, never dropping or re-merging.
- [ ] Deploying refreshes cached tiles (ETag salt); a 304 reports the correct notice without a query.
- [ ] `X-Portal-Tile-Truncated` and its notice are gone; no truncation occurs.
- [ ] `npm run lint && npm run type-check` clean; all suites green.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| Per-tile probe cost on a huge layer. | Whole-layer fast path avoids it for small layers; `LIMIT cap+1` bounds it; **measured at smoke on a production-sized layer** (discovery Q2). Fall back to `count(*)` if it plans poorly. |
| Line crossed-cell coverage (`ST_SquareGrid` ∩ line) blows up on long lines. | Bounded per tile by `(2^k)²` cells; primitive choice (grid vs segmentize) confirmed at smoke. Fail-closed: on probe/aggregate error the tile still errors visibly (504), never silently drops. |
| Dissolve finest-union cost (the thing #478 tuned to avoid). | Off the hot path (maintenance queue); **measured at smoke**; fall back to simplify-on-read if prohibitive. |
| Stale cached tiles after behavior change. | `AGG_TILE_VERSION` salt in the ETag; test 17 asserts the bust. |
| 304 reports the wrong notice. | Mode rides the ETag prefix; test 16 asserts a query-free, correct 304. |
| Fail policy. | **Fail-closed toward aggregation / visible error** — an unknown/inexact count or a probe error never yields a silent clip. |

**Rollback:** `git revert` the code; re-run dissolve precompute (or restore prior rows). No schema, no data migration — reversible.

## Files touched

- **core** — edit `constants/large-data-ops.constants.ts` (new consts + JSDoc), `contracts/map-spec.contract.ts` (JSDoc only); new/edit tests.
- **api** — edit `services/portal-map-tile.service.ts` (decision, grid, hybrid, ETag, `truncated` removal, count read), `routes/portal-map.router.ts` (header + `@openapi`), `queues/processors/dissolve-precompute.processor.ts` (band nesting); dissolve re-enqueue ops step; edit service + integration tests.
- **web** — edit `modules/MapWidget/utils/map-config.util.ts` (gating→filters), `modules/MapWidget/utils/tile-source.util.ts` (drop truncated), `modules/MapWidget/MapWidget.component.tsx` (notice copy); edit tests.

No new dependency, env var, or infra change.

## Next step

`docs/MAP_REPRESENTATION_CONTINUITY.plan.md` — TDD slices, each a green commit on this branch: (1) grid constants + `resolveTileMode` + fast path + ETag salt + `truncated` removal (fixes #532, unit + integration); (2) nested `buildAggregateTileSql` + `_agg` + web filter (remove zoom-gate); (3) over-cap probe + `buildLineHybridTileSql`; (4) advisory-override docs + regression; (5) dissolve band-nesting + re-enqueue. Slice 1 is independently mergeable and closes the originally-filed bug; the perf-sensitive slices (3, 5) carry their smoke measurements.
