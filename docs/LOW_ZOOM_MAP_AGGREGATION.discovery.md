# Low-zoom map aggregation (grid bins + dominant category) — Discovery

**Issue:** [EnterpriseBT/portal-ai#330](https://github.com/EnterpriseBT/portal-ai/issues/330) · Feature · epic [#84](https://github.com/EnterpriseBT/portal-ai/issues/84)

**Why this exists.** #314 renders large layers as vector tiles and, to keep the browser responsive, caps each tile at `MAP_TILE_FEATURE_CAP = 10_000` features (`portal-map-tile.service.ts:42`). The cap is a blunt clip: it keeps an *arbitrary* subset, so on a dense layer (the 397k Salt Lake County parcels) whole regions vanish when zoomed out and reappear only on zoom-in. That is the worst outcome for exploration — a user scanning the county can't tell where the data is, so doesn't know where to zoom. The fix is to stop *dropping* features at low zoom and start *summarizing* them: below a zoom threshold, aggregate features into a per-tile spatial grid where each cell is a filled bin colored by the dominant `colorBy` category (count-density when there's no `colorBy`), switching back to raw features above the threshold. This is the low-zoom overview that makes the map useful at any zoom.

## The current shape

### Vector-tile query path (server)

| Piece | Location | Note |
|---|---|---|
| `defaultRunTileQuery` | `portal-map-tile.service.ts:210` | Builds the MVT SQL; the natural home for a `z < threshold` aggregation branch. |
| `tileSql` (`lim` CTE + `ST_AsMVT`) | `:245-254` | `LIMIT ${cap}` inside `lim`; `ST_AsMVTGeom(ST_Transform(geom,3857), ST_TileEnvelope(z,x,y), 4096, 64, true)`; `geom && ST_Transform(env,4326)`. The tail the aggregation query reuses. |
| `MAP_TILE_FEATURE_CAP` / `TILE_STATEMENT_TIMEOUT_MS` / `TILE_EXTENT` | `:42` / `:44` / `:46` | 10k / 10s / 4096. |
| `tileSimplifyTolerance(z)` | `:142` | `360/(2^z·4096)`, 0 at z≥15. Precedent for a zoom-derived server constant. |
| `truncated` (from `n_limited >= cap`) | `:291` | Truncation-notice detection (#314). The aggregate path replaces this signal with an "aggregated" one. |
| `renderTile` (headers, 204/304/504) | `:306` | Sets `simplifiedTolerance`/`truncatedCap`; where a new `aggregated` flag surfaces. |
| Response headers `X-Portal-Tile-Simplified/Truncated` | `routes/portal-map.router.ts:65-74` | `sendTile`; add `X-Portal-Tile-Aggregated` beside them. |

### MapSpec / tile contract (`packages/core`)

`map-spec.contract.ts`: `MapLayerSchema:96` (`kind` points/polygons/lines/heatmap/cluster `:98`, `source` `:99`, `style` `:101`); `MapLayerStyleSchema:70` holds `colorBy:74` (`column`/`palette`/`stops` `:76-82`); `MapSpecSchema:120` (`basemap`, `initialView` `:122`, `layers` min1/max8 `:128`, `popup` `:130`). Geo block content unions `GeoInlineContentSchema:151` / `GeoHandleContentSchema:162`; the tile path is the handle branch. Must stay compatible with `WidgetRefreshResponseSchema` (`portal-sql.contract.ts:76`) — a new *optional* field is additive and safe.

### colorBy stops + palette

`visualize-map.tool.ts:219-243` computes `colorBy.stops` at author time — a frequency `GROUP BY` (`:225-228`) mapped through `categoryColor` (`:79`, Tableau-10 then uncapped golden-angle HSL). Stops are **persisted into the spec**, so a stable value→color map already exists for the tile path. The web side duplicates the palette in `map-config.util.ts:102` (`DEFAULT_PALETTE`) — the two must stay in sync (a pinning concern, pre-existing).

### Web tile rendering (`apps/web/src/modules/MapWidget`)

Vector source added `MapWidget.component.tsx:176-181`; layers with `source-layer: TILE_SOURCE_LAYER` (`"default"`, `tile-source.util.ts:11`) at `:182-188`. Paint chosen in `map-config.util.ts` `layerToMapLibre:186` via `switch(layer.kind)` (`:203`): circle (points/cluster), fill+outline (polygons `:224-240`), line, heatmap. `resolveColorBy:128` compiles stops → a `["match", ["get", col], …]` expression + legend. Notices rendered in `MapWidget.component.tsx` (timeout `:347`, simplified `:356`, "Partial at this zoom" `:366`); status read by `readTileStatus` (`tile-source.util.ts:44`) into `TileStatus:13`.

### PostGIS substrate

Geometry stored `geometry(Geometry,4326)` + GiST (`wide-table-reconciler.service.ts:87,363,369`). `buildSessionViews` (`portal-sql.service.ts:138`) is computed **before** the tile txn (#314 pool-deadlock fix, `portal-map-tile.service.ts:256-263`). `ST_SquareGrid` / `ST_HexagonGrid` / `ST_SnapToGrid` / `mode()` are all present on the DB but unused in code today. `scripts/postgis-benchmark.ts:107-115` mirrors the canonical tile SQL and benchmarks z8/z12/z16 latency on synthetic parcels — a ready harness for validating grid-query cost.

## The design space

### Decision 1 — Grid model

| | A. Square (`ST_SquareGrid`/`ST_SnapToGrid`) | B. Hex (`ST_HexagonGrid`) |
|---|---|---|
| Geometry | Axis-aligned cells; trivial in 3857 | Prettier, uniform neighbor distance |
| Complexity | Low — snap centroid to grid, `GROUP BY` | Higher — hex indexing, edge tiling |
| Tile alignment | Aligns naturally to the pixel grid | Cells straddle tile edges more |

**Decision (confirmed): A (square).** The overview's job is "where is the data, roughly, colored by category" — square bins deliver that with the least SQL and clean tile-edge behavior. Hex is a cosmetic upgrade, deferrable. (Independent of the no-`colorBy` case — square bins + `count` density work identically.)

### Decision 2 — Where the zoom switch lives

| | A. Server-side, transparent | B. Client-side layer switch |
|---|---|---|
| Mechanism | `defaultRunTileQuery` emits bins below `z_threshold`, raw above | Client swaps paint by zoom |
| Client change | Minimal for polygon layers (same `fill`) | New zoom-gated layers |

**Lean: A for the tile *content* (server decides bins vs raw by `z`), plus a minimal client change for non-polygon layers** — see Decision 4. The server owning the switch keeps one source of truth and matches "all server-side."

### Decision 3 — Cell aggregate + color continuity

Per cell: `mode() WITHIN GROUP (ORDER BY <colorBy col>)` aliased back **as the colorBy column name**, plus `count(*)`. Because the widget's `["match", ["get", col], …stops]` is built from the **persisted** stops, bins and raw features get identical colors with no new palette. `count` drives optional opacity/size and the notice.

**When the layer has no `colorBy` there is no category to take the mode of**, so the cell carries `count(*)` only and the aggregate fill is painted as a **density map** — a single hue whose opacity/shade scales with `count` (an `interpolate` on the `count` property rather than a `match` on category). This is the general fallback and the most useful zoomed-out view for uncategorized data ("where is the data concentrated"). The count→opacity **scale domain** must be fixed or log-scaled (not per-tile normalized), or a cell would read differently in a dense vs a sparse tile.

**Decision (confirmed): `mode()`+`count` for category layers; `count`-only density fill for no-`colorBy` layers.** Reuses the existing stops/palette for the category case and adds one density paint mode for the no-category case.

### Decision 4 — Client rendering of bins

Bins are emitted as **polygons** on source-layer `default`. A polygon `fill` layer draws them. For polygon layers (the motivating parcels case) the *existing* fill layer already draws both bins and raw parcels — zero client change. For **point/line** layers, raw features use `circle`/`line` paint, which won't draw polygon bins, so the widget needs an **aggregate `fill` layer gated `maxzoom = z_threshold`** alongside the raw kind-layer gated `minzoom = z_threshold`, both colored by the same `colorBy` match.

**Decision (confirmed): dual zoom-gated layers per map layer (aggregate fill ≤ threshold, raw kind-layer ≥ threshold).** Uniform across kinds; for polygon layers the two are both fills and could collapse, but keeping one shape is simpler to reason about.

### Decision 5 — Contract: how aggregation is configured

| | A. Fully automatic | B. Automatic + per-layer override | C. Explicit only |
|---|---|---|---|
| Default UX | Always on below threshold | On by default, tunable/disable-able | Agent must opt in |
| Contract | No spec field | Optional `aggregation` block on the layer | Required field |

**Decision (confirmed): B.** Automatic below a default threshold (users/agent get it for free), with an optional per-layer `aggregation?: { enabled?, gridSizePx?, zoomThreshold? }` under `MapLayerSchema` (colorBy is per-layer, so aggregation is too). Additive + optional → safe against `WidgetRefreshResponse`.

### Decision 6 — Zoom threshold

**Decision (confirmed): a fixed default constant (≈ `z < 12`, beside `MAP_TILE_FEATURE_CAP`), overridable per-layer.** Predictable and uniform across tiles (a per-tile "aggregate only if it would clip" rule makes neighboring tiles look different, which reads as broken). Density-driven thresholds are a later refinement. The `12` value is tuned live against the parcels during smoke.

## Tradeoff comparison

| | Square grid (D1) | Server switch (D2) | mode()+count (D3) | Dual layers (D4) | Auto+override (D5) | Fixed threshold (D6) |
|---|---|---|---|---|---|---|
| Spread to spec | No | No | No | No | **Yes** (`aggregation` block) | **Yes** (default + override) |
| Client change | No | Minimal | No | **Yes** (point/line) | No | No |

## Recommendation

1. Add server-side grid aggregation to `defaultRunTileQuery`, gated on `z < AGG_ZOOM_THRESHOLD` (default ≈ 12): within the tile envelope, `ST_SnapToGrid`/`ST_SquareGrid` the geometry in 3857, `GROUP BY` cell, compute `mode() WITHIN GROUP (ORDER BY <colorBy col>)` aliased as the colorBy column + `count(*)`, then feed cell polygons through the same `ST_AsMVTGeom`/`ST_AsMVT` tail.
2. Cell size pinned to ~constant screen pixels (derive world-unit size from the tile envelope width and `TILE_EXTENT`), default ≈ 16–24 px.
3. No `colorBy` → aggregate `count(*)` per cell; paint the fill as a density map via an `interpolate` on `count` over a **fixed/log-scaled** domain (consistent across tiles), never per-tile normalized.
4. Extend `MapLayerSchema` with an optional `aggregation` block (`enabled?`, `gridSizePx?`, `zoomThreshold?`); default-on below the threshold.
5. Return an `aggregated` flag from `runTileQuery` → `TileRenderResult` → `X-Portal-Tile-Aggregated`; read it in `readTileStatus` and render an "Aggregated overview — zoom in for detail" notice (visibility of limits).
6. Web: for each layer add an aggregate `fill` layer (`maxzoom = threshold`) beside the raw kind-layer (`minzoom = threshold`), both colored by the same persisted `colorBy` stops.
7. Benchmark the grid query at z6/z9/z12 on the 397k parcels via `scripts/postgis-benchmark.ts` to confirm it stays well under `TILE_STATEMENT_TIMEOUT_MS`.

## Open questions

1. **Grid unit — square vs hex?** Lean: square (D1); revisit hex only if bins read poorly.
2. **Default threshold value — z<12?** Lean: z<12 as the shipped default, per-layer overridable; tune during smoke against the parcels.
3. **Non-polygon bins — dual layers vs bin-centroid points?** Lean: dual zoom-gated layers (D4); centroid-as-point is a fallback if the extra fill layer causes flor.
4. **No-colorBy density scale domain — fixed vs log-scaled?** Lean: log-scaled fixed domain (parcel counts per cell span orders of magnitude between downtown and rural); single-hue opacity. Tune the domain live during smoke.
5. **Aggregation-query timeout fallback?** Lean: reuse the existing 504 path; if low-zoom scans of very large layers time out, precompute (out of scope) rather than silently falling back to the arbitrary cap.

## Enterprise-scale considerations

- **Concurrency & correctness** — the aggregation query runs read-only per tile through the same session-view txn as raw tiles, after the #314 fix that computes `buildSessionViews` before the txn. No new shared state. `Lean: unchanged model.`
- **Accuracy & auditability** — the overview is *approximate by construction* (dominant category per cell). It is a render aid, never a record of truth; the mandatory "aggregated overview" notice keeps it honest. `Lean: notice-gated approximation.`
- **Failure modes** — a slow low-zoom scan surfaces as the existing typed 504 notice, not a blank tile. `Lean: reuse 504; no silent fallback to the arbitrary cap.`
- **Scale & unbounded growth** — cells per tile are bounded by the pixel-pinned grid (a few hundred); features scanned are bounded by the tile envelope + GiST. The lowest zooms scan the most — the benchmark gate (rec. 7) verifies the ceiling. `Lean: bounded per tile, benchmark-verified.`
- **Multi-tenancy** — per-org isolation is inherited from the session views; aggregation adds no cross-org surface. `N/A because it rides the existing scope.`
- **Contract stability** — the `aggregation` block is optional/additive and default-on, so existing specs and `WidgetRefreshResponse` consumers are untouched; future per-tier grid resolution slots into the same block. `Lean: additive-open.`
- **Data lifecycle** — render-time only, no stored aggregate. `N/A because there is no persisted state.`

## What this doesn't decide

- **Precomputed/materialized overview tiles** — a scale optimization only pursued if per-tile aggregation blows the timeout on the largest layers (rec. 7 gates this).
- **Hex grids** — deferred cosmetic upgrade (D1).
- **Client-side clustering / cross-tile bin stitching** — bins are per-tile; seams at tile edges are accepted for the overview. Out of scope.
- **Aggregating by a numeric measure (sum/avg per cell)** — this feature does dominant-category + count only; measure-based choropleths are a later capability.

## Next step

`/spec 330` pins the contract (the `aggregation` spec block, the tile-query SQL shape, the `X-Portal-Tile-Aggregated` header, the web layer/notice changes, and the acceptance criteria) on this branch (`feat/low-zoom-map-aggregation`, off `epic/gis-toolpack`); `/plan 330` then slices it — roughly: (1) contract + spec field, (2) server grid-aggregation query + threshold + header, (3) web dual-layer rendering + notice, (4) benchmark + smoke. Implementation follows once discovery/spec/plan are confirmed.
