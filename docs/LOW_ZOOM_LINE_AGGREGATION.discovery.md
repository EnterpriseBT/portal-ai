# Low-zoom aggregation treatment for line (and point) layers — Discovery

**Issue:** [EnterpriseBT/portal-ai#337](https://github.com/EnterpriseBT/portal-ai/issues/337) · Task · epic [#84](https://github.com/EnterpriseBT/portal-ai/issues/84)

**Why this exists.** Low-zoom aggregation (#330) summarizes a dense layer below `AGG_ZOOM_THRESHOLD` (z14) by binning every feature into **square grid cells** — a choropleth. That reads well for **polygon** layers (areas → colored cells) and is defensible for **point** layers (a dot cloud → count-density cells). It reads *badly* for **line** layers: `buildAggregateTileSql` takes `ST_Centroid` of each geometry and snaps it to the grid (`portal-map-tile.service.ts:336`), so a connected road network collapses into a scatter of disconnected colored squares. Observed live smoking the Utah Roads layer — the network becomes a grid, not a map of roads. This is the per-`kind` treatment #330 didn't split: it aggregates uniformly, and one shape doesn't fit all geometries. This is the fix that makes a line layer legible at low zoom **at any dataset size** — from a county's streets to a whole state's road network.

## The current shape

### The aggregate tile query is kind-blind (server)

| Piece | Location | Note |
|---|---|---|
| `buildAggregateTileSql(pipelineSql, z, envelope, aggregation, cap)` | `portal-map-tile.service.ts:316-351` | Uniform for all kinds. `ST_SnapToGrid(ST_Centroid(ST_Transform(geom,3857)), cellSize)` (`:336`); per cell `mode()…AS cat` + `count(*) AS _count`; square cell polygon via `ST_MakeEnvelope` (`:343-349`). **No `kind` branch.** |
| `aggregationFromSpec(spec)` | `:157-185` | Iterates `spec.layers`, reads only `l.aggregation` (`:161`) + `l.style.colorBy.column` (`:167-173`). **Never reads `l.kind`.** Returns `TileAggregation {enabled, zoomThreshold, gridSizePx, colorByColumn}` (`:142-149`). |
| `shouldAggregate(z, agg)` | `:188-190` | `agg.enabled && z < agg.zoomThreshold`. Zoom + enabled only. |
| aggregate branch | `defaultRunTileQuery:382-391` | `shouldAggregate(...) ? buildAggregateTileSql(...) : buildRawTileSql(...)`. The single switch to reuse. |
| raw path + simplification | `buildRawTileSql:277-304`; `tileSimplifyTolerance(z):205-209` | `ST_SimplifyPreserveTopology(geom, 360/(2^z·4096))` for z<15 (`:284-286`); **bare `LIMIT cap` with no `ORDER BY`** (`:299`) — so when the cap bites, the kept subset is *arbitrary*. `n_limited` drives the truncation notice. Runs only when `!shouldAggregate` today (z ≥ threshold). |

The tile service **never validates against `MapSpecSchema` and never materializes `MapLayer`** (`resolvePipeline:213-268` operates on `pipeline.sql` + colorBy/agg only). So the server *cannot* branch on kind without `aggregationFromSpec` reading `l.kind` — a field it already iterates.

### The scale problem this must solve

`MAP_TILE_FEATURE_CAP = 10_000` is **per tile**. A statewide road network is 10⁵–10⁶ segments. At low zoom (z≲8) the whole state falls into a handful of tiles — often one — so each tile holds far more than 10k lines. With the **bare unordered `LIMIT`**, the tile clips to an *arbitrary, spatially-patchy* 10k: a random scatter of fragments that looks like "the roads" but isn't — recreating the exact defect #330 killed for polygons. Simplification does **not** help: `ST_SimplifyPreserveTopology` thins *vertices per feature*, not the *feature count* the cap limits. Any line treatment must be correct at this scale, not just for a sparse county layer.

### Contract + constants (`packages/core`)

`MapLayerAggregationSchema:105-109` — `{ enabled?, gridSizePx? (1..128), zoomThreshold? (0..22) }`; **no treatment/kind field.** `MapLayerSchema.kind:114` — `enum(["points","polygons","lines","heatmap","cluster"])`; the only kind-aware contract logic is the `superRefine:120-132` requiring `geometryColumn` for polygons/lines. `AGG_ZOOM_THRESHOLD=14` / `AGG_GRID_PX=24` / `AGG_DENSITY_MAX=5000` (`large-data-ops.constants.ts:118-120`).

### Web aggregate rendering adds a square fill for any kind (`apps/web`)

`layerToMapLibre` (`map-config.util.ts:256-386`). The aggregate block (`:352-382`) is **kind-blind**: `if (opts.tiled && agg?.enabled !== false)` it sets `minzoom = threshold` on **every** raw layer (`:354-355`) and pushes a `type: "fill"` aggregate layer `maxzoom = threshold` (`:356-382`). For a **line** layer that means: below z14 only the square `fill` bins paint; the real `type: "line"` layer (`:319-331`) is gated off until z14. Raw line paint is `line-color`/`line-width ?? 2`/`line-opacity`.

### Heatmap today is a stub

The `kind: "heatmap"` case (`map-config.util.ts:332-344`) emits `type: "heatmap"` but sets **no** `heatmap-weight`/`-color`/`-radius`/`-intensity` — MapLibre defaults only. The server emits **no** length/weight column (`ST_Length` absent from both queries). So a *length-weighted* line-density surface is a materially larger change — it needs a new server weight + real paint.

## The design space

### Decision 1 — Per-kind default treatment

| kind | today | proposed default |
|---|---|---|
| polygons | square bins | **square bins (unchanged)** |
| points | square bins | **square bins (unchanged)** — a dot cloud → count-density cell is legible |
| lines | square bins | **raw, importance-ranked, simplified, capped — at all zooms** |

**Decision: lines opt out of square bins and render as importance-ranked raw lines; polygons + points keep bins.** Bins collapse a network's topology; raw lines preserve it. To make the per-tile cap *meaningful at scale*, the line raw query selects by importance (longest first) so a clipped low-zoom tile shows the **major-road skeleton**, not an arbitrary scatter — exactly how real maps degrade (highways when zoomed out, all streets when zoomed in). "Reconsider points" resolves to *keep* bins — points are point-like, binning them is the canonical density choropleth and reads fine. The split is strictly per-`kind`, never per-dataset (AC).

### Decision 2 — Mechanism: routing + importance ranking

Two touches, both flowing from the tile service learning the representative layer's `kind`:

1. **Routing (no new SQL).** `aggregationFromSpec` reads the representative layer's `kind` (the same "one representative layer over one pipeline" collapse it already uses to pick `colorByColumn`) and, when the resolved treatment is raw, returns `enabled: false`. Then `shouldAggregate` is already false and `buildRawTileSql` already runs at all zoom — reusing the existing switch, the existing simplification, and the existing truncation signal.
2. **Ranking (one `ORDER BY`).** `buildRawTileSql`, for line layers, orders `ST_Length(ST_Transform(src.geom, 3857)) DESC` before the `LIMIT` so the clip is longest-first rather than arbitrary. `ST_Length` on a geometry column is a **dataset-agnostic** importance proxy (no schema-specific "road class" needed); projected-metre length is monotonic enough for ranking and consistent with the query's existing 3857 transform.

So `kind` threads into `aggregationFromSpec` (routing) **and** `buildRawTileSql` (ranking). No new grid SQL, no new aggregate CTE — one `ORDER BY` clause plus a field read that flips an existing switch. The web mirror (`layerToMapLibre`) gates its aggregate-fill/`minzoom` block on the same resolved treatment, so real lines paint at every zoom.

**Decision: routing via `enabled:false` + a length-ranked `ORDER BY` in the raw line query.**

### Decision 3 — Contract: per-kind default + per-layer override

| | A. Hardcoded per-kind, no field | B. `aggregation.treatment?` enum, default-by-kind |
|---|---|---|
| Override | Only `enabled:false` (can't force bins on a line) | Any layer can pin its treatment |
| Contract | No change | One optional additive field |

**Decision: B — add `treatment?: "bins" \| "none"` to `MapLayerAggregationSchema`.** Absent ⇒ per-kind auto (Decision 1: lines→`none`, points/polygons→`bins`). Explicit `"bins"` forces square bins on a line; `"none"` forces ranked-raw on anything. Additive + optional ⇒ every existing spec is unchanged and `WidgetRefreshResponse` consumers are untouched. Leaves room for a future `"density"` value (Decision 4) with no re-plumbing.

### Decision 4 — Line *density* surface (length-weighted) — deferred alternative

The weighed alternative (option 2 in review) is to aggregate lines below the threshold into cells shaded by **total road length** (`sum(ST_Length(ST_Intersection(line, cell)))`) — a smooth "where roads concentrate" surface. It is also scale-proof and bounded, but it answers a *different question* (concentration, not network shape — blobs, not lines) and is materially heavier: a new per-cell intersection aggregate **and** a real density/heatmap paint (today's heatmap case is a stub).

**Decision: defer density; ship importance-ranked raw lines as the line default.** Ranked-raw preserves the network (the ticket's "legible summary … not a square grid"), scales, and is light. Density is reachable later via a `treatment: "density"` value + the intersection aggregate + heatmap paint, with no re-plumbing of the contract. Recorded in "What this doesn't decide."

### Decision 5 — Scale behavior for "all roads in a state"

With ranked-raw, the per-tile cap still bites at the lowest zooms (one tile cannot hold 10⁶ lines) — but the visible 10k are now the **longest/major** segments, a legible highway skeleton, not an arbitrary scatter. The existing `X-Portal-Tile-Truncated` notice still fires when clipped; its copy is reframed from "partial/arbitrary" to **"showing major features — zoom in for the rest"** (honest about *what* was kept). No #330 regression: whole regions no longer vanish, because the ranking is spatially even (major roads span the state).

**Decision: ranked clip + reframed truncation notice.** Bounded and meaningful at any size; density (D4) is the future escape hatch only if "concentration" is the actual question.

### Decision 6 — How the treatment is chosen: agent intent + heuristic defaults

The `aggregation` block (and its new `treatment`) is already an **agent-authorable** per-layer field — the agent authors the whole MapSpec, so it can set aggregation from the user's prompt ("map the road *network*" → `treatment:"none"`; "where parcels are *dense*" → coarser bins; "*overview*" → higher threshold). The per-kind defaults are the **fail-safe** when the prompt carries no such intent. This yields a three-layer resolution, most-specific wins:

1. **Agent-authored spec fields** — from prompt intent.
2. **Per-kind heuristic default** (this ticket) — chosen by a deterministic heuristic on `kind` (+ cheap cardinality; `visualize_map` already queries at author time, `visualize-map.tool.ts:215-243`), not an LLM guess.
3. **Hard constants** — `AGG_ZOOM_THRESHOLD`, `AGG_GRID_PX`.

Matches `heuristic-vs-AI`: the *default* is a deterministic heuristic (reliable, dataset-agnostic); the LLM only **overrides** on explicit semantic intent. This needs guidance in `system.prompt` + the `visualize_map` description so the agent knows the fields exist and when to set them — the doc-sync surface #337 owns.

**Decision: three-layer resolution — agent-authored > per-kind heuristic default > constant; add agent guidance to `system.prompt`/`visualize_map`. In-widget user controls are deferred to [#338](https://github.com/EnterpriseBT/portal-ai/issues/338).**

## Tradeoff comparison

| | Per-kind default (D1) | Route+rank (D2) | `treatment` field (D3) | Defer density (D4) | Ranked clip (D5) |
|---|---|---|---|---|---|
| Spread to spec | No | No | **Yes** (`treatment`) | No | No |
| Server SQL change | — | **Yes** (one `ORDER BY`) | No | No | — |
| Web change | **Yes** (kind gate) | — | No | No | No |
| Scales to a state | **Yes** | Yes | — | — | **Yes** |

## Recommendation

1. Add `treatment?: "bins" \| "none"` to `MapLayerAggregationSchema` (`packages/core`); absent ⇒ per-kind auto — `lines` → `none`, `points`/`polygons` → `bins`.
2. A shared resolver `resolveAggTreatment(kind, aggregation?.treatment)` → `"bins" | "none"`, used by both server (`aggregationFromSpec`) and web (`layerToMapLibre`) so the two agree without a round-trip (the #330 shared-constant pattern).
3. Server routing: `aggregationFromSpec` reads the representative layer's `kind`; when `resolveAggTreatment` is `"none"` it returns `enabled: false`, reusing `shouldAggregate`/`buildRawTileSql` at all zoom (raw, simplified, capped). No new routing SQL.
4. Server ranking: `buildRawTileSql` gains an optional importance order — for line layers, `ORDER BY ST_Length(ST_Transform(geom,3857)) DESC` before `LIMIT` — so the low-zoom clip is major-roads-first, not arbitrary. Thread `kind` into the raw builder.
5. Web: `layerToMapLibre` gates its aggregate-fill + `minzoom` block (`:352-382`) on `resolveAggTreatment` — for `"none"` layers, skip the aggregate fill and don't `minzoom`-gate the raw layer, so real lines render at every zoom.
6. Reframe the truncation notice copy for the ranked case ("showing major features — zoom in for the rest") and confirm it fires on the raw line path at low zoom.
7. Compute the per-kind default via a **deterministic heuristic** (kind, + feature count where cheap) so the fail-safe never depends on an LLM guess; the agent overrides only on explicit intent.
8. **Agent guidance (doc-sync):** add to `system.prompt` (Mapping block) + the `visualize_map` tool description — the `aggregation`/`treatment` fields, when to pick ranked-raw vs bins vs a higher threshold from the prompt, and that omission falls back to per-kind defaults (per CLAUDE.md doc-sync).
9. Smoke against a **statewide** roads layer (recreated): below z14 shows a legible major-road network (not squares, not an arbitrary scatter); zoom fills in; polygons/points unchanged; `treatment:"bins"` forces bins on a line; `treatment:"none"` forces ranked-raw on a polygon; a prompt like "map the road network" vs "where are roads dense" steers the treatment.

## Open questions

1. **Points — bins or raw?** Lean: keep bins (D1); revisit only if a point layer reads poorly.
2. **`treatment` value names — `"bins" \| "none"` vs adding explicit `"auto"`.** Lean: `"bins" \| "none"`, absence *is* auto; keeps the enum minimal and future-`"density"`-open.
3. **Rank column — always `ST_Length` vs an optional `aggregation.rankBy` override?** Lean: `ST_Length` as the dataset-agnostic default now; an optional `rankBy` column (e.g. a road-class or population field) is a clean later addition, out of scope here.
4. **Apply the ranked `ORDER BY` at all zooms or only `z < threshold`?** Lean: apply for line layers at all zooms (harmless above threshold where the cap rarely bites; simplest contract) — verify the sort cost on the largest tiles stays under `TILE_STATEMENT_TIMEOUT_MS` in the benchmark.
5. **Does the truncation notice fire on the raw line path at low zoom?** Lean: it should (`n_limited` from `LIMIT`) — assert in the spec's test plan; if not, small fix same PR.

## Enterprise-scale considerations

- **Concurrency & correctness** — read-only per tile through the existing session-view path; the change is which existing query runs + one `ORDER BY`. `N/A because no new shared state.`
- **Accuracy & auditability** — ranked-raw lines are *exact* geometries (more faithful than bins); the low-zoom clip is a render aid made honest by the reframed truncation notice ("major features shown"). `Lean: exact raw, notice-gated ranked clip.`
- **Failure modes** — a statewide line layer at the lowest zoom degrades to *major-roads-first* + truncation notice, never a blank tile and never an arbitrary scatter. `Lean: meaningful ranked clip, no silent/arbitrary drop.`
- **Scale & unbounded growth** — features/tile bounded by the cap; the ranked `ORDER BY` is a top-N sort over the GiST-bounded envelope; the lowest zoom is the ceiling and gets benchmarked (OQ4). Vertices bounded by `ST_SimplifyPreserveTopology`. `Lean: bounded + benchmark-verified; density deferred as the concentration-view escape hatch.`
- **Multi-tenancy** — inherited from session views; no new cross-org surface. `N/A because it rides existing scope.`
- **Contract stability** — `treatment` is optional/additive with a per-kind default; existing specs + `WidgetRefreshResponse` untouched; `"density"` and a future `rankBy` slot into the same block. `Lean: additive-open.`
- **Data lifecycle** — render-time only, no stored aggregate. `N/A because there is no persisted state.`

## What this doesn't decide

- **Line/point *density* surfaces (length-weighted).** Deferred (D4) — needs a per-cell `ST_Length(ST_Intersection(...))` aggregate + real heatmap paint (today's heatmap case is a stub). Reachable via a `treatment: "density"` value with no re-plumbing.
- **An explicit `rankBy` importance column.** `ST_Length` is the agnostic default (OQ3); a per-layer rank column is a later addition.
- **In-widget user settings** for aggregation/treatment/threshold — deferred to [#338](https://github.com/EnterpriseBT/portal-ai/issues/338). Aggregation is server-tiled, so UI controls need tile-request overrides or a spec write-back (a separate, heavier surface); #337 makes the choice agent-driven with defaults instead.
- **Changing polygon or point aggregation.** Explicitly unchanged (AC).
- **Precomputed/materialized line overviews.** Only if the ranked top-N sort blows the timeout on the largest layers (OQ4) — same deferral posture as #330.
- **Cross-tile network stitching / topology-aware simplification.** Per-tile `ST_SimplifyPreserveTopology` is accepted; tile-edge seams are tolerated for the overview.

## Next step

`/spec 337` pins the contract on this branch (`chore/low-zoom-line-aggregation`, off `epic/gis-toolpack`): the `treatment` field + refinement, the `resolveAggTreatment` signature, the `aggregationFromSpec` kind-read returning `enabled:false` for `none`, the `buildRawTileSql` importance `ORDER BY` for lines, the `layerToMapLibre` kind-gate, the reframed truncation copy, and the acceptance criteria (including the statewide-scale check). `/plan 337` then slices it — roughly: (1) contract field + shared resolver + core tests; (2) server `aggregationFromSpec` kind-read (+ heuristic default) + `buildRawTileSql` ranking + tests + benchmark; (3) web `layerToMapLibre` kind-gate + notice copy + tests; (4) agent guidance (`system.prompt` + `visualize_map`) + doc-sync + smoke. Modest on the render side — one `ORDER BY` and a field-read that flips an existing switch, no new grid SQL — plus the agent-guidance doc-sync that makes the choice prompt-driven.
