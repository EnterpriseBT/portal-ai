# Low-zoom polygon choropleth treatment — Discovery

**Issue:** [EnterpriseBT/portal-ai#472](https://github.com/EnterpriseBT/portal-ai/issues/472) · child of epic [#470](https://github.com/EnterpriseBT/portal-ai/issues/470) (`epic/map-tiles-at-scale`). Split from #450 cause 3.

**Why this exists.** A polygons map with a `colorBy` (a choropleth — e.g. parcels coloured by zip) renders below zoom 14 as 24px **centroid-snapped squares**, not polygons, because `resolveAggTreatment` routes everything except `lines` to `"bins"` (a centroid grid) and the client hard-gates raw polygon fills to `minzoom = 14`. So at every overview zoom the choropleth is *wrong*, not just slow — #450 made those tiles fast, but they're still squares. This is the fix that renders a correct choropleth at low zoom. It's a **map-spec `AggTreatment` contract change** spanning `packages/core` + `apps/api` tile SQL + `apps/web` map config.

## The current shape

### The contract (shared, server + client)

`packages/core/src/contracts/map-spec.contract.ts`:
- `MapLayerAggregationSchema` (`:109-121`): `enabled`, `gridSizePx`, `zoomThreshold`, `treatment` = `z.enum(["bins","none"])` (`:120`); `AggTreatment` type (`:123`) derives from it.
- `resolveAggTreatment(kind, treatment?)` (`:157-163`): explicit wins, else `lines → "none"`, everything else `→ "bins"`. **Line `:162` is the bug's center** — polygons default to centroid bins.
- `style.colorBy` (`:74-87`): `column` (required), `palette?`, `stops?`, `scale?` = `"categorical" | "step" | "interpolate"`.

### Server tile SQL — `apps/api/src/services/portal-map-tile.service.ts`

- `aggregationFromSpec` (`:187-225`) resolves treatment (`:203`) + the `colorByColumn` (`:204-212`), then collapses to a boolean `enabled` (`:214`). `TileAggregation` (`:167-179`) has no treatment field — the builder branch (`:428`) only reads `shouldAggregate` (`:228`).
- `buildAggregateTileSql` (`:362-397`) — the centroid-bin path: `ST_SnapToGrid(ST_Centroid(...))`, `mode()` colorBy (`:377`), emits `ST_MakeEnvelope` squares (`:391`). **This is what draws the squares.**
- `buildRawTileSql` (`:317-350`) — real geometry via `ST_AsMVTGeom` + `ST_SimplifyPreserveTopology` (`:326`), colorBy columns on each feature (`:331-333`).

### Client — `apps/web/src/modules/MapWidget/utils/map-config.util.ts`

- `layerToMapLibre` (`:372-506`), handoff (`:463-503`): gated on `treatment === "bins"` (`:473`) — sets raw layers `minzoom = threshold` (`:475`) and pushes an aggregate centroid-square `-agg` fill at `maxzoom = threshold` (`:476-502`).
- **Key enabler:** `resolveColorBy` (`:211-350`) compiles colorBy to a MapLibre expression reading `["get", colorBy.column]` — it works on **any** feature property (bin square, raw polygon, or dissolved multipolygon) as long as the tile emits the colorBy column. So a dissolve tile that carries the colorBy value needs **no new client colour code**.

## The design space

### Decision 1 — the low-zoom treatment: dissolve-by-colorBy vs simplify-and-draw

**A. Dissolve-by-`colorBy`** — `GROUP BY <colorBy column>`, aggregate the geometry into one shape per value; the tile carries #distinct-colorBy features, each coloured by its value. **B. Simplify-and-draw** — draw the real polygons with `ST_SimplifyVW` below z14.

| | A (dissolve) | B (simplify-and-draw) |
|---|---|---|
| Correct choropleth | Yes — one coloured region per value | Yes, but… |
| Feature count at low zoom | Bounded by #distinct colorBy values (41 zips) | Still ~283K polygons → exceeds `MAP_TILE_FEATURE_CAP` (10K), truncates |
| Matches the "can't just lower the threshold" note | Yes (constants doc `:102-117` — dense parcels blow the cap) | No — same cap problem raw has |

**Lean: A (dissolve-by-colorBy).** It's the only one that bounds the work *and* is the visually-correct low-zoom choropleth. Simplify-and-draw doesn't solve the feature-count ceiling that motivated aggregation in the first place.

### Decision 2 — dissolve geometry: `ST_Union` vs `ST_Collect`

**A. `ST_Union`** — true topological dissolve (shared boundaries removed), one clean multipolygon per value; expensive (topology over thousands of polygons per tile). **B. `ST_Collect`** — cheap aggregation into a multipolygon without merging; rendered as a single-colour fill with no per-parcel outline, adjacent parcels read as one region (internal edges invisible under a solid fill).

**Lean: B (`ST_Collect`) of `ST_SimplifyVW`-simplified geometry.** For a choropleth (solid fill per value, no low-zoom per-parcel outline) `ST_Collect` is visually indistinguishable from `ST_Union` and far cheaper; simplify first to bound vertex count at overview zooms where parcel detail is invisible. Keep `ST_Union` as the fallback only if collect shows artifacts (e.g. semi-transparent fills double-stacking) — noted in the spec.

### Decision 3 — routing: how polygons pick dissolve vs bins

Dissolve only makes sense for a **categorical** colorBy (zips, classes) — a continuous/`interpolate` colorBy has ~one distinct value per row, so grouping bounds nothing. And a polygons layer with **no** colorBy has nothing to dissolve by.

**A. Extend `resolveAggTreatment(kind, treatment?, opts?)`** with `opts.hasCategoricalColorBy` — returns `"dissolve"` for polygons with a categorical colorBy, `"bins"` for polygons otherwise, `"none"` for lines. Both server (`aggregationFromSpec`) and client (`layerToMapLibre`) call it the same way, so the routing decision stays in one shared function.
**B. Keep the default `"bins"`; require explicit `treatment: "dissolve"`.**

**Lean: A.** The bug is the *default* choropleth being wrong; the default must fix itself. One shared resolver keeps server and client tiles/styles in agreement (a drift here = squares on one side, polygons on the other). Explicit `treatment` still overrides.

## Tradeoff comparison

| | D1 dissolve | D2 ST_Collect+simplify | D3 shared resolver w/ colorBy |
|---|---|---|---|
| Spread to spec | Yes | Yes | Yes |
| Contract change | `AggTreatment` enum += `"dissolve"` | none | `resolveAggTreatment` signature |
| Blast radius | new tile builder + client branch | tile builder only | contract + both consumers |

## Recommendation

1. Add `"dissolve"` to the `AggTreatment` enum; extend `resolveAggTreatment` to take colorBy info and default **polygons + categorical colorBy → `"dissolve"`** (bins otherwise, none for lines).
2. Add a `treatment` field to `TileAggregation`; branch `defaultRunTileQuery` to a new `buildDissolveTileSql` — `GROUP BY <colorByColumn>`, `ST_Collect(ST_SimplifyVW(geom, tol))`, `ST_AsMVTGeom(...)`, emitting the colorBy value as a feature property, capped at `MAP_TILE_FEATURE_CAP`.
3. Client: in `layerToMapLibre`, for `treatment === "dissolve"` draw a low-zoom fill layer (`maxzoom = threshold`) painting the dissolved geometry with the **existing** `resolveColorBy` expression (no centroid-square `-agg` layer), and keep the raw fill/outline at `minzoom = threshold` for z ≥ 14.
4. Emit `X-Portal-Tile-Aggregated` for dissolve too, so the "aggregated overview" notice still fires.

## Open questions

1. **Continuous (`interpolate`/numeric) colorBy on polygons at low zoom.** Dissolve doesn't fit (no grouping). **Lean: out of scope for #472** — keep the current bins path for continuous colorBy; a value-aggregating low-zoom treatment (e.g. bins coloured by `avg(value)`) is a separate follow-up. #472 fixes the categorical choropleth the ticket documents.
2. **colorBy cardinality ceiling.** A categorical colorBy with thousands of distinct values would emit thousands of dissolved features. **Lean: cap dissolved groups at `MAP_TILE_FEATURE_CAP` and set `X-Portal-Tile-Truncated`** (reusing #316's notice), same as the raw path — choropleth colorBy is low-cardinality by nature, so this is a guard, not the common path.
3. **Simplify tolerance for dissolve.** Reuse `tileSimplifyTolerance(z)` (already ≈ one tile pixel, 0 at z ≥ 15)? **Lean: yes** — it's the same "detail invisible at this zoom" scale the raw path uses; no new constant.

## Enterprise-scale considerations

- **Scale & unbounded growth.** Dissolve bounds output to #distinct colorBy values (cap-guarded, Open Q2); `ST_Collect` + simplify bounds vertex work. This is *why* dissolve over simplify-and-draw. `Lean: bounded`.
- **Concurrency & correctness.** Read-only tile query, no new write path; `N/A` for races.
- **Contract stability.** Additive enum member + an optional resolver arg — existing `treatment: "bins"|"none"` callers and specs are unaffected; a spec can pin `"bins"` to opt out. `Lean: additive`.
- **Multi-tenancy / data lifecycle / accuracy-auditability.** `N/A` — a render transform over already-scoped tile data, no durable state.
- **Failure modes.** If a layer's colorBy is absent or continuous, routing falls back to the existing bins path (no worse than today). Fail-safe. `Lean: degrade to bins`.

## What this doesn't decide

- **Continuous-colorBy low-zoom treatment** (Open Q1) — separate follow-up.
- **`ST_Union` exact dissolve** — only if `ST_Collect` shows artifacts (Decision 2 fallback).
- **Lowering `AGG_ZOOM_THRESHOLD`** — rejected by the constants doc's own reasoning (dense parcels exceed the cap below z14); dissolve is the answer, not a lower threshold.

## Next step

`docs/POLYGON_CHOROPLETH_LOWZOOM.spec.md` then `.plan.md`. The plan slices roughly: (1) contract — `"dissolve"` enum + `resolveAggTreatment(hasCategoricalColorBy)` + tests; (2) server — `TileAggregation.treatment` + `buildDissolveTileSql` + branch + tests; (3) client — `layerToMapLibre` dissolve branch + tests; (4) doc-sync (glossary/help if map treatments are user-documented). Child PR targets `epic/map-tiles-at-scale`.
