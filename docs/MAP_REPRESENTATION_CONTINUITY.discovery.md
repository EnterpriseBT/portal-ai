# Continuous map representation — Discovery

**Issue:** [EnterpriseBT/portal-ai#532](https://github.com/EnterpriseBT/portal-ai/issues/532)

**Why this exists.** A map must never lie about what's on it, and today the tile pipeline breaks that in two ways. Small point layers (≈415 points, well under the ~10k raw cap) render as **grid squares** below z14 instead of dots, because `shouldAggregate` bins on a global zoom threshold regardless of feature count (the originally-filed bug). And where aggregation genuinely engages, the aggregate bins **wander and blink** as you zoom — a cluster shows in one place, dissolves a notch in, re-forms elsewhere — because the aggregate grid is a non-nested lattice; meanwhile the raw path silently **drops** over-cap features via a bare `LIMIT`. All three are the same defect: representation is neither complete nor continuous across zoom. This is the work that makes one invariant hold end-to-end — **every in-frame feature (point, line, polygon) is always represented, as itself or inside an aggregate that contains it, and transitions continuously as you zoom** (a mark stays, splits into its children, or merges into its parent — it never blinks out and reappears elsewhere).

## The current shape

### Raw-vs-aggregate decision (global zoom threshold)

| Piece | Location | Role |
|---|---|---|
| `shouldAggregate(z, agg)` | `apps/api/src/services/portal-map-tile.service.ts:243` | `agg.enabled && z < agg.zoomThreshold` — binary, count-blind |
| `aggregationFromSpec` | `portal-map-tile.service.ts:196-240` | Picks representative layer, resolves treatment, sets `enabled` (`:228`) |
| `resolveAggTreatment` | `packages/core/src/contracts/map-spec.contract.ts:162-175` | Shared server+web: explicit `treatment` wins, else `lines→none`, `polygon+colorBy→dissolve`, else `bins` |
| `AGG_ZOOM_THRESHOLD=14`, `AGG_GRID_PX=24` | `packages/core/src/constants/large-data-ops.constants.ts:118-119` | The single global cutoff + target cell px |

The `aggregation` block is **agent-authored and optional** (`MapLayerSchema.aggregation.optional()`, `map-spec.contract.ts:136`); nothing on the server injects it (`visualize-map.tool.ts` only mentions it in its description string, `:35`). So the current behavior already rides on defaults, not on agent intent.

### The aggregate grid (the wander)

`buildAggregateTileSql` (`portal-map-tile.service.ts:377-412`): `cellsPerAxis = round(512/24) = 21` (`:384-387`), `cellSize = WORLD_3857_WIDTH / 2^z / cellsPerAxis` (`:388`), `ST_SnapToGrid(ST_Centroid(...), cellSize)` at the PostGIS default origin (0,0) (`:397`), `GROUP BY 1`, `LIMIT 10_000` (`:402`). Because **21 is not a power of two**, the lattices at `z` and `z+1` share no boundaries — a cell at one zoom is not the union of cells at the next, so bins re-partition and their centers hop. The `LIMIT` is unreachable here (~23²≈529 cells/tile) and truncation is hard-coded `false` (`:410`, `:524`).

### The raw path (the silent drop)

`buildRawTileSql` (`:332-365`): `WHERE geom && envelope`, `LIMIT 10_000` (`:359`), and `ORDER BY ST_Length(...) DESC` **only for lines** (`rankByLength`, `:351-353`) — **points have no ordering**, so an over-cap tile keeps an arbitrary 10k and shows the rest as nothing. `truncated = n_limited >= cap` (`:524`) drives the `X-Portal-Tile-Truncated` signal.

### Frontend paint + notice

`layerToMapLibre` (`apps/web/src/modules/MapWidget/utils/map-config.util.ts:395-534`): when tiled + bins, raw layers get `minzoom = threshold` (`:503`) and a `${source}-agg` fill gets `maxzoom = threshold` (`:505-508`) — a clean min-inclusive/max-exclusive handoff at z14, mirroring the server gate via `agg?.enabled !== false && treatment === "bins"` (`:501`). Density opacity ramps on `log10(_count)` to `AGG_DENSITY_MAX=5000` (`:520-528`). The server sets `X-Portal-Tile-Aggregated` (`portal-map.router.ts:77`), read by `readTileStatus` (`tile-source.util.ts:60`) into the "Aggregated overview — zoom in for detail" notice (`MapWidget.component.tsx:373-380`).

### Polygon dissolve bands

`DISSOLVE_ZOOM_BANDS` (5 disjoint bands z0–13, `large-data-ops.constants.ts:139-145`); each band is dissolved **independently** — `ST_SnapToGrid(tol)` → `ST_Union GROUP BY value` → `ST_Subdivide` at its own `representativeZoom` tolerance (`dissolve-precompute.processor.ts:147-178`). Band N+1 is not derived from band N (stored rows carry no cross-band linkage, `map-dissolve-geometries.table.ts:29-56`), so crossing a boundary re-snaps and re-merges the whole region — the #478 "exploded" jump, softened from ~20× to ~2.7× by adding bands but not eliminated.

### Persisted feature count (already available)

The handle-backed geo block already carries the query envelope: `GeoHandleContentSchema` spreads `QueryHandleEnvelopeFieldsSchema` (`map-spec.contract.ts:231-233`), whose `matchedCount`/`matchedCountExact`/`rowCount` (`portal-sql.contract.ts:32-52`) are persisted by `visualize-map.tool.ts:343-349`. `resolvePipeline` (`portal-map-tile.service.ts:284-323`) loads that row today but reads only `pipeline`/`spec`/`snapshotUpdatedAt`. **So a count-aware decision needs no new query** — it's a field already on disk (a lower bound when `truncated`; `estimatePlan.estimatedRows` at `portal-sql.service.ts:485` is a fallback when absent).

### Tile ETag

`renderTile` ETag = `sha256(pipeline.sql | z | x | y | snapshotUpdatedAt)` (`portal-map-tile.service.ts:631-635`); the 304 path (`:639-650`) re-derives `aggregated` from config+zoom **without re-querying**. The hash covers **none** of the SQL-generation code, cap, grid formula, or thresholds — so any behavior change here serves stale cached tiles unless a version salt is folded into the hash.

## The design space

### Decision 1 — The raw-vs-aggregate decision model

The root cause of both the "squares on a small map" bug and the z14 discontinuity is that the choice is a **global, count-blind zoom threshold**. Replace it with a **count-driven** choice.

- **A — Whole-layer fast path + per-tile count.** If the persisted layer total ≤ cap, the layer is raw at every zoom (no aggregation ever — fixes #532 at zero per-tile cost). Otherwise decide *per tile*: a tile whose feature count ≤ cap serves raw dots; an over-cap tile serves the nested-grid aggregate. Dense tiles bin, sparse tiles show dots, at the same zoom — and a dense tile subdivides into four as you zoom until each drops under the cap and becomes dots.
- **B — Keep the global threshold, just lower/auto-tune it per layer.** Set `zoomThreshold` from the layer count so small layers never bin. Simpler, but still a single hard flip for large layers and still count-blind within a zoom (a sparse corner of a large layer stays binned).
- **C — Always raw, rely on client clustering (supercluster).** Moves the problem to the client; abandons server-MVT as the source of truth and re-introduces a memory ceiling on the browser.

| | A (count-driven, per-tile) | B (auto-tuned threshold) | C (client cluster) |
|---|---|---|---|
| Fixes small-map squares | Yes (fast path) | Yes | Yes |
| Never drops over-cap | Yes (over-cap tile bins) | No (still raw-clips a dense tile) | Shifts to client |
| Continuity | Per-tile, gradual | Hard flip at one zoom | N/A |
| Cost | +1 count probe per over-cap tile (or LIMIT cap+1 probe) | None | Client memory |

**Lean: A.** It is the only option that makes the invariant *hold* rather than *usually hold*; the whole-layer fast path keeps the common small case free, and the per-tile probe is cheap against the existing spatial index (or folded into a `LIMIT cap+1` raw probe that also returns the rows).

### Decision 2 — Aggregate grid geometry

- **A — Nested tile-pyramid grid.** `cellsPerAxis = 2^k` (e.g. 16 → 32 px, or 32 → 16 px), so `cellSize = WORLD_3857_WIDTH / 2^(z+k)` snapped to the tile origin. Every cell at `z` is exactly the union of its four children at `z+1`; a bin subdivides into four smaller squares, never re-partitions. The bin stays a **cell-bounds square** (no centroid marker) — nesting alone removes the wander, and a square that cleanly subdivides is the more legible continuity story than a drifting point.
- **B — Fixed global grid (geohash-like), display-size only.** One zoom-independent grid; only the rendered square size changes. Also nested, but decouples cell size from screen px (bins look tiny when zoomed / huge when out) — worse ergonomics for the same continuity.

| | A (nested pyramid) | B (fixed global) |
|---|---|---|
| Nested across zoom | Yes | Yes |
| Screen-px sized | Yes | No |
| SQL delta | `cellsPerAxis` → power of two; centroid mark | Larger rewrite of cell sizing |

**Lean: A** with the mark at the aggregated centroid. Smallest change to `buildAggregateTileSql`, screen-px sizing preserved, continuity by construction.

### Decision 3 — Advisory aggregation override

Per the ticket, the MapSpec `aggregation` field becomes a **preference**, not a switch that can strand features.

- **A — Advisory, invariant wins.** `enabled:false` / `treatment:"none"` means "prefer raw where the invariant allows" — a layer/tile under the cap renders raw; an over-cap tile still aggregates rather than clip. The choke points are `shouldAggregate` + the `enabled` computation (`:228`, `:243`) and the web mirror (`map-config.util.ts:501`), which stay in lockstep via `resolveAggTreatment`.

**Lean: A** (the chosen scope). No spec value can produce an unrepresented feature; the field only nudges toward dots when it's safe.

### Decision 4 — Polygon dissolve band continuity

Kept as a dissolve path (not folded into grid bins — that would regress real merged-boundary choropleths), but made continuous.

- **A — Derive coarse bands from the finest union.** Compute the finest band's `ST_Union` once, derive each coarser band by *simplifying that same geometry* (monotonic: a region's identity/outline only smooths across a boundary, never re-merges differently). Kills the "explode" at the cost of coupling the precompute stages.
- **B — Single dissolve, simplify per request.** One stored union per value; the tile query simplifies to the zoom's tolerance on read. Fewer stored rows, but pushes simplify cost onto every tile.
- **C — Accept the softened steps (#478) as-is.** No continuity guarantee; documents the residual.

| | A (derive from finest) | B (simplify on read) | C (accept) |
|---|---|---|---|
| Boundary continuity | Yes | Yes | No |
| Precompute cost | Highest (finest union always) | Lowest | Unchanged |
| Read cost | Low (pre-simplified) | Higher (per-tile simplify) | Low |

**Lean: A.** It is the only one that satisfies the invariant for polygons; the precompute already runs off-request on the `maintenance` queue, so the added cost is off the hot path. **The finest-union cost (the thing #478 tuned bands to avoid) is measured against a real 400k-parcel layer at smoke**; if prohibitive, fall back to B (simplify-on-read).

## Tradeoff comparison

|  | D1 per-tile count | D2 nested grid | D3 advisory | D4 band nesting |
|---|---|---|---|---|
| Spreads to spec | Yes | Yes | Yes | Yes |
| Touches `packages/core` | `bandForZoom`/consts | grid consts | shared gate | band consts |
| Touches `apps/web` | paint gate | mark styling | mirror gate | no |
| Needs ETag salt | Yes | Yes | Yes | (precompute rebuild) |

## Recommendation

1. Replace the global `z < zoomThreshold` choice with **per-tile, count-driven** selection: whole-layer-under-cap ⇒ raw everywhere (persisted `matchedCount`/`rowCount`, fallback `estimatedRows`); otherwise per-tile ⇒ raw when the tile is under cap, nested-grid aggregate when over.
2. Make the aggregate grid a **nested tile-pyramid** (`cellsPerAxis` a power of two, `cellSize = WORLD_3857_WIDTH / 2^(z+k)`); each bin stays a cell-bounds square that subdivides into four on zoom-in. Because bins are polygons and raw points are points, the raw and aggregate MapLibre layers coexist at all zooms (separated by geometry type + an `_agg` feature flag) — the fixed `AGG_ZOOM_THRESHOLD` min/max-zoom handoff is removed, letting dense and sparse tiles differ at the same zoom.
3. Over-cap **lines** aggregate too (no arbitrary length-clip); the never-drop guarantee covers points and lines, polygons via the dissolve path.
4. Make the MapSpec `aggregation` field **advisory** — a preference that never strands a feature — keeping the server gate and web mirror in lockstep through `resolveAggTreatment`.
5. Make dissolve bands **continuous** by deriving coarse bands from the finest union.
6. Fold a **grid/version salt** into the `renderTile` ETag input so existing cached tiles refresh when the SQL-generation behavior changes.

## Open questions

1. **`k` (cells per axis).** 16 (→32 px bins) or 32 (→16 px bins)? Larger `k` = finer bins, more MVT features per tile. **Lean: 16** (32 px bins ≈ today's 24 px target, comfortably under any per-tile feature budget).
2. **Over-cap probe mechanism.** A `SELECT count(*)` over the tile envelope, or a `LIMIT cap+1` raw probe that doubles as the raw result when under? **Lean: `LIMIT cap+1` probe** — one query decides *and* returns the rows in the common under-cap case; only over-cap tiles pay for a second (aggregate) query. **The probe's cost on a large layer is validated with production-scale performance tests at smoke** (recorded measurements, not a fixture assertion — plan choice is size-dependent per `CLAUDE.md`); if the per-tile probe plans poorly, fall back to `count(*)`.
3. **Line over-cap behavior. RESOLVED — hybrid.** An over-cap line tile keeps the **longest-N** lines as real (simplified) raw lines *and* covers the remaining lines with the nested-grid aggregate, where a line contributes to **every cell its geometry crosses** (so a line's full extent is covered, not just a representative point). Every in-frame location is covered by a real line or a bin; as tiles subdivide on zoom, more lines promote to raw and bins recede, until all are raw under the cap. This is the faithful reading of "regardless of quantity" for lines (a midpoint/centroid bin would leave a long line's body uncovered).
4. **Dissolve rebuild.** Band-nesting changes the precompute shape; existing `map_dissolve_geometries` rows must be recomputed. No prod data yet ⇒ a clean truncate + re-enqueue is acceptable rather than a dual-write migration. **Lean: truncate + re-enqueue on deploy.**
5. **Inline (non-tiled) maps.** Small maps delivered inline (GeoJSON + `fitBounds`) never aggregate. **Lean: unchanged** — they're already all-features-as-themselves and satisfy the invariant trivially.

## Enterprise-scale considerations

- **Concurrency & correctness.** Tile rendering is read-only inside the session-view transaction; no check-then-act race. The one correctness hazard is the ETag not covering behavior — the version salt (rec. 6) is the fix. **Lean: salt required.**
- **Accuracy & auditability.** The invariant *is* the accuracy guarantee: no feature silently absent. The persisted count is a lower bound when `truncated`, so the decision must treat "unknown/truncated" as "may be over cap" and fall to per-tile probing. **Lean: never trust a truncated count as under-cap.**
- **Failure modes.** Fail toward the safe side: when the count is unknown, when a probe errors, or when a tile is ambiguous, **aggregate** (never clip). A dropped feature is the failure this ticket exists to prevent. **Lean: fail-closed toward aggregation.**
- **Scale & unbounded growth.** A dense tile's aggregate is bounded by cell count (~`(2^k)²`), independent of feature count; the grouping scan is the same cost as today and guarded by `TILE_STATEMENT_TIMEOUT_MS`. Per-tile probing adds at most one bounded query per over-cap tile. **Lean: bounded by construction.**
- **Multi-tenancy.** Per-org isolation is unchanged (session-view transaction, org-scoped pipeline SQL). No new cross-tenant surface. **N/A beyond what exists.**
- **Contract stability.** Making `aggregation` advisory is **additive** — existing specs stay valid, the field just stops being able to strand features. The ETag salt is the forward versioning hook for future tile-behavior changes. **Lean: additive, no breaking spec change.**
- **Data lifecycle.** Only `map_dissolve_geometries` is derived/persisted; band-nesting invalidates it, and with no prod data a clean rebuild is fine (see open Q4). Tiles are cache-only (ETag), no lifecycle. **Lean: rebuild dissolve, no data migration.**

## What this doesn't decide

- Client-side clustering (supercluster) — rejected; server MVT stays the source of truth.
- Legend / control redesign — only the existing "aggregated overview" notice is made accurate (a truncation that can no longer happen stops being signaled).
- The `heatmap` and `cluster` layer kinds — out of scope; this covers `points`/`lines`/`polygons`.
- Retuning `AGG_DENSITY_MAX` / the opacity ramp — visual polish, not correctness; leave as-is unless the nested grid changes count distributions materially.

## Next step

Write `docs/MAP_REPRESENTATION_CONTINUITY.spec.md` (the contract — the invariant stated testably, the per-tile decision function, the nested-grid formula, the advisory-override semantics, the ETag salt, and the band-nesting shape) and `docs/MAP_REPRESENTATION_CONTINUITY.plan.md` (slices). Likely slicing: (1) count-driven decision + whole-layer fast path + ETag salt (fixes #532 outright, testable alone); (2) nested-grid geometry + centroid marks; (3) over-cap line aggregation; (4) advisory override; (5) dissolve band nesting. Each is a green-testable commit on this branch. The smoke doc carries **large-dataset performance validation** (the over-cap probe and the dissolve finest-union) as recorded measurements against a production-sized layer — the two cost leans above are confirmed there, not in unit fixtures.
