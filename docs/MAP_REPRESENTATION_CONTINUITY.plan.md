# Continuous map representation — Plan

**TDD-sequenced implementation of the invariant: the count-driven per-tile decision + whole-layer fast path + layer-coexistence + ETag salt (slice 1), the nested grid (2), the over-cap point probe/aggregate (3), the line hybrid + `truncated` retirement (4), polygons-dissolve-never-bin (5, smoke amendment), and dissolve band continuity (6).**

Spec: `docs/MAP_REPRESENTATION_CONTINUITY.spec.md`. Discovery: `docs/MAP_REPRESENTATION_CONTINUITY.discovery.md`. Issue: #532.

6 slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/map-representation-continuity` / PR #535** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR"). Slices 1–2 are implemented + smoked (points pass); slices 3–6 remain, with **slice 5 added from the slices-1–2 smoke** (large no-colorBy polygons 504'd on the live centroid path and centroid squares lost polygon extent — see the discovery "Smoke findings" amendment).

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
cd apps/web && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — the decision + rendering mechanism first (this alone fixes #532 end-to-end), then geometry, then the large-layer guarantees, then the separate dissolve subsystem:

- **Slice 1** — `resolveTileMode` (pure, fully implemented) + the whole-layer fast path wired + the layer-coexistence mechanism (remove zoom-gate, `_agg` on bins, `_agg` filters) + ETag salt. **Closes the originally-filed #532** (small layers render as dots at all zooms). Large layers keep interim zoom-threshold behavior via the `tileCount === null` fallback — no probe yet, no clipping change.
- **Slice 2** — swap the aggregate grid to the nested tile-pyramid formula. Pure geometry; the web already renders `_agg` bins ungated.
- **Slice 3** — wire the per-tile `LIMIT cap+1` probe so large-layer tiles decide by count; over-cap **points** aggregate instead of clipping. Advisory-override behavior + JSDoc.
- **Slice 4** — over-cap **lines** go hybrid (longest-N raw + crossed-cell bins). With points (3) + lines (4) never clipping, **retire `truncated`** (fields, header, web notice).
- **Slice 5** — **polygons dissolve, never centroid-bin** (smoke amendment): `resolveAggTreatment` routes every polygon to `"dissolve"`; a new no-colorBy area-ranked simplified-geometry flavor (no union) is precomputed + served; the enqueue extends to all polygons. Fixes the smoke's low-zoom polygon 504 + centroid-square extent loss.
- **Slice 6** — dissolve band continuity (derive coarse from finest) + re-enqueue. Last because it's the most perf-sensitive (measured at smoke).

No migration (no schema change; `map_dissolve_geometries` contents are re-enqueued in slice 6, reusing a sentinel `column_name="__all__"` for the no-colorBy area-ranked flavor).

---

## Slice 1 — Count-driven decision + fast path + layer coexistence + ETag salt

The decision core and the rendering mechanism that lets raw and aggregate tiles coexist at one zoom. This slice alone makes a small point layer render as dots at every zoom (#532).

**Files**

- Edit: `packages/core/src/constants/large-data-ops.constants.ts` — add `AGG_CELLS_PER_AXIS = 16`, `AGG_GRID_LEVELS = 4`, `AGG_TILE_VERSION`; JSDoc `AGG_ZOOM_THRESHOLD`/`AGG_GRID_PX` as no-longer-gating.
- Edit: `apps/api/src/services/portal-map-tile.service.ts` — add exported `resolveTileMode` + `TileMode`; remove `shouldAggregate`; `resolvePipeline` returns `layerTotal`/`layerTotalExact`; `defaultRunTileQuery` drives off `resolveTileMode` (fast-path raw; `tileCount` passed `null` ⇒ interim zoom-threshold fallback inside `resolveTileMode`); `buildAggregateTileSql` emits `1 AS _agg` (grid formula unchanged this slice); `renderTile` ETag = `"<mode>~<hash>"` with `AGG_TILE_VERSION` in the hash + query-free 304 from the mode prefix; `TileQueryResult` carries `mode`.
- Edit: `apps/web/src/modules/MapWidget/utils/map-config.util.ts` — remove `minzoom`/`maxzoom` gate; `-agg` fill `filter ["==",["get","_agg"],1]`; raw layers `filter ["!",["has","_agg"]]`.
- Edit: `apps/web/src/modules/MapWidget/MapWidget.component.tsx` — aggregated-notice copy → "Dense areas are summarized — zoom in for detail."
- Tests: `packages/core/src/__tests__/constants/large-data-ops.util.test.ts`; `apps/api/src/__tests__/services/portal-map-tile.service.test.ts`; `apps/api/src/__tests__/__integration__/routes/portal-map.router.integration.test.ts`; `apps/web/src/modules/MapWidget/__tests__/map-config.util.test.ts`.

**Steps**

1. **Tests.** Core cases 1, 2 (power-of-two; `cellSize(z)=2·cellSize(z+1)` via the const relationship), 3 (`resolveAggTreatment` regression). Service cases 4, 5, 6, 7 (`resolveTileMode` pure: fast-path raw; per-tile count → raw/aggregate/hybrid-lines; dissolve; inexact-count forces probe), 11 (ETag: stable, version-bumped changes it, mode prefix present), 8-partial (`buildAggregateTileSql` emits `_agg`). Integration 12 (small point layer < cap → point MVT features, no `X-Portal-Tile-Aggregated`), 16 (304 echo returns correct `aggregated` from the mode prefix, no tile query run — spy), 17 (bumped `AGG_TILE_VERSION` ⇒ fresh 200). Web 23 (no min/maxzoom; `_agg` filters), 24 (opacity ramp unchanged). Run; fail.
2. **Implement** per spec Surface. `resolveTileMode`'s fallback (when `tileCount === null` and no fast path) reproduces today's `z < zoomThreshold` so large layers are unchanged this slice. Green.
3. Lint + type-check.

**Done when:** cases 1–7, 8(_agg), 11, 12, 16, 17, 23, 24 pass; a small point layer renders dots at all zooms in the dev app; large layers behave exactly as before. #532's filed repro is fixed.

**Risk:** the web/server coupling — dots stay hidden unless the zoom-gate removal ships in this same slice (the reason it's here, not in slice 2). Case 12 asserts it end-to-end.

---

## Slice 2 — Nested tile-pyramid grid

Make aggregate cells nest across zoom so bins subdivide instead of wandering.

**Files**

- Edit: `apps/api/src/services/portal-map-tile.service.ts` — `buildAggregateTileSql`: `cellSize = WORLD_3857_WIDTH / 2 ** (z + AGG_GRID_LEVELS)` (drop `round(TILE_SCREEN_PX/gridSizePx)`).
- Tests: `apps/api/src/__tests__/services/portal-map-tile.service.test.ts`; `.../__integration__/routes/portal-map.router.integration.test.ts`.

**Steps**

1. **Tests.** Case 8-formula (generated SQL uses `2^(z+4)` cell size). Integration case 14 (nesting/continuity: a bin cell at `z` is exactly covered by ≤4 bin cells at `z+1`; no bin appears without a `z` parent). Run; fail.
2. **Implement** the formula change. Green.
3. Lint + type-check.

**Done when:** cases 8, 14 pass; aggregate bins subdivide cleanly across zoom on a large layer in the dev app (no wander/blink).

**Risk:** none structural — bins are already `_agg`-flagged and rendered ungated (slice 1).

---

## Slice 3 — Per-tile probe + over-cap point aggregate + advisory override

Large-layer tiles now decide by real count; an over-cap point tile aggregates rather than clips.

**Files**

- Edit: `apps/api/src/services/portal-map-tile.service.ts` — `buildRawTileSql` probe mode (`LIMIT cap+1`); `defaultRunTileQuery`: for non-fast-path layers run the probe, `n_limited <= cap` ⇒ serve raw, else ⇒ `buildAggregateTileSql`; pass the resulting `tileCount` into `resolveTileMode`.
- Edit: `packages/core/src/contracts/map-spec.contract.ts` — JSDoc: `zoomThreshold` advisory/ignored; `enabled:false`/`treatment:"none"` = "prefer raw"; invariant note.
- Tests: `.../__integration__/routes/portal-map.router.integration.test.ts`.

**Steps**

1. **Tests.** Case 13 (over-cap point tile → bin polygons, bin count ≪ source count, every source point falls in some bin cell — nothing dropped). Case 18 (spec `aggregation.enabled:false` on an over-cap layer still aggregates — invariant wins). Run; fail.
2. **Implement** the probe + branch; update the `MapLayerAggregationSchema` JSDoc (doc-sync). Green.
3. Lint + type-check.

**Done when:** cases 13, 18 pass; an over-cap point layer never drops a point (aggregate covers all); the advisory field cannot suppress it.

**Risk:** probe cost on a huge layer — **measured at smoke** (spec Risks; discovery Q2); `LIMIT cap+1` bounds it; `count(*)` fallback if it plans poorly. Fail-closed: a probe error surfaces as 504, never a silent clip.

---

## Slice 4 — Line hybrid + retire `truncated`

Over-cap lines keep the major skeleton and cover the rest with bins; with points (3) and lines (4) never clipping, truncation is unreachable and its signal is removed.

**Files**

- Edit: `apps/api/src/services/portal-map-tile.service.ts` — new `buildLineHybridTileSql` (UNION ALL: longest-N raw lines, no `_agg`, + per-crossed-cell bins with `_agg`/`_count`); `defaultRunTileQuery` routes `"hybrid-lines"` to it; remove `TileQueryResult.truncated` / `TileRenderResult.truncatedCap` (and the `renderTile` truncated logic + warn).
- Edit: `apps/api/src/routes/portal-map.router.ts` — remove the `X-Portal-Tile-Truncated` header block + its `@openapi` mention.
- Edit: `apps/web/src/modules/MapWidget/utils/tile-source.util.ts` — drop `truncated` from `readTileStatus`/`TileStatus`.
- Edit: `apps/web/src/modules/MapWidget/MapWidget.component.tsx` — remove the truncated-notice branch.
- Tests: `.../services/portal-map-tile.service.test.ts`, `.../__integration__/routes/portal-map.router.integration.test.ts`, `.../MapWidget/__tests__/tile-source.util.test.ts`, `.../MapWidget.test.tsx`.

**Steps**

1. **Tests.** Case 10 (hybrid SQL: longest-N raw lines + crossed-cell bins). Case 15 (over-cap line tile: longest lines present as lines AND a bin covering the crossed cells of a short line *not* in the longest-N set — proves it's represented, not dropped). Case 19 (no `X-Portal-Tile-Truncated` on any path). Cases 25 (`TileStatus` has no `truncated`), 26 (no truncated notice ever; aggregated notice renders). Run; fail.
2. **Implement** `buildLineHybridTileSql` + the `truncated` removal across api + web. Green.
3. Lint + type-check.

**Done when:** cases 10, 15, 19, 25, 26 pass; an over-cap line layer represents every line (raw or bin); nothing references truncation.

**Risk:** crossed-cell line coverage cost (`ST_SquareGrid ∩ line` vs segmentize-and-snap) — the primitive is a plan/smoke call (spec Key decision 4); **measured at smoke**. Bounded per tile by `(2^k)²` cells.

---

## Slice 5 — Polygons dissolve, never centroid-bin (smoke amendment)

Fixes the two smoke bugs on large no-colorBy polygons — the low-zoom `504 MAP_TILE_TIMEOUT` and centroid squares that don't show polygon extent. Polygons route to `"dissolve"` for **all** polygon layers, served from the GiST-indexed precompute. **Measurement drove the mechanism:** union-based dissolve (dissolve-all or per-cell) is 130–153s/band on the 211k @ ~226-vertex layer (prohibitive); a no-colorBy layer is instead precomputed as **area-ranked simplified geometry, no union** (~10s/band), served `ORDER BY ST_Area DESC LIMIT cap`.

**Files**

- Edit: `packages/core/src/contracts/map-spec.contract.ts` — `resolveAggTreatment`: `kind === "polygons"` → `"dissolve"` regardless of colorBy (drop the `hasColorBy` gate). Single source of truth → the web mirror follows.
- Edit: `apps/api/src/services/dissolve-precompute.service.ts` — `isDissolvable`/`enqueueForPin` enqueue **every** polygon layer (colorBy or not).
- Edit: `apps/api/src/queues/processors/dissolve-precompute.processor.ts` — a no-colorBy polygon precomputes **area-ranked simplified geometry (no union)**: per band, `ST_SimplifyPreserveTopology(geom, tol(band))` each polygon and store **one row per polygon** under sentinel `column_name = value = "__all__"`, `feature_count = 1` (no subdivide, so `ST_Area` ranks the whole polygon). colorBy per-value union path unchanged.
- Edit: `apps/api/src/services/portal-map-tile.service.ts` — `runDissolveTile` branches on the `"__all__"` sentinel: envelope-clip + `ORDER BY ST_Area(mdg.geom) DESC LIMIT cap`, no colorBy property. colorBy path unchanged; pass the cap through.
- Tests: `.../services/portal-map-tile.service.test.ts` (case 6, 29), `.../__integration__/queues/dissolve-precompute.processor.integration.test.ts` (27), `.../__integration__/routes/portal-map.router.integration.test.ts` (28).

**Steps**

1. **Tests.** Case 29 (`resolveAggTreatment("polygons")` no colorBy → `"dissolve"`, not `"bins"`). Case 6 (`resolveTileMode`: a no-colorBy polygon over cap never returns `"aggregate"` — `"dissolve"` when ready, else `"raw"`). Case 27 (area-ranked precompute: **one row per polygon** under `"__all__"`, not unioned — row count ≈ polygon count). Case 28 (**a large no-colorBy polygon renders a non-empty fill MVT at z2/z3 — the tile that 504'd — real geometry, feature count ≤ cap, largest-by-area**). Run; fail.
2. **Implement** the `resolveAggTreatment` change + area-ranked precompute + area-capped serve path. Green.
3. Lint + type-check.

**Done when:** cases 6, 27, 28, 29 pass; the 211k census-block-groups layer renders real polygons at low zoom with **no timeout** (recorded measurement: ~10s/band build, index-served tiles); no polygon layer ever reaches `buildAggregateTileSql`.

**Risk:** storage ~213k rows/band (accepted, GiST-indexed; fewer bands would still serve since the per-tile area-cap bounds features). Sub-pixel polygons unrendered at extreme low zoom — the documented no-union tradeoff (analogous to lines' longest-N). Transient: precompute-pending falls to raw-simplify until the enqueued job lands — self-healing.

---

## Slice 6 — Dissolve band continuity + re-enqueue

Coarse dissolve bands derive from the finest union so a region only smooths across a boundary (the colorBy union flavor; the no-colorBy area-ranked flavor has no union to re-merge, so its per-band simplification is already continuous).

**Files**

- Edit: `apps/api/src/queues/processors/dissolve-precompute.processor.ts` — `runDissolve`: compute the finest band's `ST_Union` once, derive each band by `ST_Subdivide(ST_SimplifyPreserveTopology(<finest union>, tol(band)), …)`; keep per-band atomic replace + band-failure fallback.
- Ops (documented, not a migration): clear + re-enqueue existing dissolvable pins on deploy (`DELETE FROM map_dissolve_geometries` + `DissolvePrecomputeService.enqueueForPin`).
- Tests: `apps/api/src/__tests__/__integration__/queues/dissolve-precompute.processor.integration.test.ts`.

**Steps**

1. **Tests.** Case 20 (coarser band is a topological simplification of the finest union — area within tolerance, same value set — not an independent re-merge). Case 21 (every value in the finest band present in every coarser band; no region drops across a boundary). Case 22 (per-band atomic-replace + band-failure fallback preserved — regression). Run; fail.
2. **Implement** the derive-from-finest rewrite. Green.
3. Lint + type-check.

**Done when:** cases 20–22 pass; a polygon choropleth transitions across bands with only outline smoothing.

**Risk:** finest-union cost (the thing #478 tuned bands to avoid) — off the hot path (maintenance queue); **measured at smoke** against a ~400k-parcel layer; fall back to simplify-on-read if prohibitive (spec Risks).

---

## Sequence summary

| Slice | Lands | Spec cases | Tests |
|---|---|---|---|
| 1 | decision + fast path + coexistence + ETag salt (**#532 fix**) | 1–7, 8(_agg), 11, 12, 16, 17, 23, 24 | core + api unit/int + web |
| 2 | nested tile-pyramid grid | 8(formula), 14 | api unit + int |
| 3 | per-tile probe + over-cap point aggregate + advisory | 13, 18 | api int |
| 4 | line hybrid + retire `truncated` | 10, 15, 19, 25, 26 | api unit/int + web |
| 5 | **polygons dissolve, never bin (smoke fix)** | 6, 27, 28, 29 | core + api unit/int |
| 6 | dissolve band continuity + re-enqueue | 20, 21, 22 | api int |

Total ≈ **29 cases**, no migration. Commits on `feat/map-representation-continuity`; PR #535 grows commit-by-commit.

## Cross-slice notes

- **Slice 1 is the mergeable #532 fix.** If context or review pressure forces a split, slice 1 ships alone as the filed bug's fix; slices 2–5 complete the invariant for large/line/polygon layers.
- **Layer coexistence is the load-bearing mechanism.** Bins are polygons + `_agg:1`; raw points are points with no `_agg`. MapLibre geometry-type + the `_agg` filter separate them, so no zoom-gate is needed and dense/sparse tiles differ at one zoom. Every slice preserves this.
- **`resolveTileMode` is fully implemented in slice 1; only the *caller's* `tileCount` source changes.** Slice 1 passes `null` (interim zoom-threshold fallback); slice 3 passes the probe result. No forward dep — the pure function's cases (4–7) all pass in slice 1.
- **`truncated` retirement waits for slices 3+4.** It stays meaningful (lines still clip) until slice 4; removing it earlier would drop a live signal.
- **Polygons never touch `buildAggregateTileSql` (slice 5).** The nested centroid-bin grid (slices 1–2) is a **points-only** path; `resolveAggTreatment` sends every polygon to `"dissolve"`, and `resolveTileMode`'s dissolve branch returns `"dissolve"`/`"raw"` (never `"aggregate"`). Until slice 5 lands, a large no-colorBy polygon layer stays on the broken centroid path (low-zoom 504) — a documented interim gap, new-branch-only, worked around today by a colorBy re-map. Bump `AGG_TILE_VERSION` in slice 5 so cached bin-tiles for polygons refresh to dissolve.
- **ETag mode prefix + `AGG_TILE_VERSION`** ship in slice 1 so cache-busting is in place before any grid/decision change; later slices that change behavior bump `AGG_TILE_VERSION`.
- **Doc-sync (per `CLAUDE.md` → "Keeping Documentation in Sync"):** slice 1 updates the constants JSDoc; slice 3 updates `map-spec.contract.ts` JSDoc; slice 4 updates the route `@openapi`. No user-facing Help/glossary/tool surfaces change (map rendering is not a tool or a documented user step). The two runbook/README map mentions carry no aggregation-behavior detail — confirm at slice 4.
- **CLAUDE.md compliance:** file suffixes hold; server-computed SQL interpolants only (no user strings); no SDK/env/infra change; tests via npm scripts.

## Next step

Implement slice 1 (tests-first) once discovery + spec + plan are confirmed. Before coding, re-read the spec's Surface against the real `portal-map-tile.service.ts` signatures — the skeletons are faithful to the shipped shapes; lift, don't reinvent.
