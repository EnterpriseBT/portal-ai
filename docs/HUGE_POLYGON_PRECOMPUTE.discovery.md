# Bound the huge-polygon dissolve precompute — Discovery

**Issue:** [EnterpriseBT/portal-ai#541](https://github.com/EnterpriseBT/portal-ai/issues/541)

**Why this exists.** #532 gave polygon map tiles a never-drop invariant: an over-cap tile serves a precomputed **merged coverage** (a dissolved `ST_Union` per colorBy value per band) so every polygon is represented, not clipped. That union is the one expensive step — measured **130–153 s/band** on a 211,136-polygon layer, over the **180 s** per-band dissolve budget (`DISSOLVE_STATEMENT_TIMEOUT_MS`). When it exceeds budget the merged pass throws, the pin is left `degraded`, and — the sharp edge this ticket exists for — an over-cap tile then serves **an empty tile**, not even the pre-#532 drop (see Decision 2). So never-drop holds for layers up to ~tens of thousands of polygons but *fails blank* at 200k+.

This is the work that makes the merged coverage **always producible within budget** (or a never-drop equivalent), and makes the degraded state **graceful** rather than blank.

## The current shape

### Precompute processor
`apps/api/src/queues/processors/dissolve-precompute.processor.ts`

| Piece | Location | Note |
|---|---|---|
| Per-band statement budget | `:30` (`DISSOLVE_STATEMENT_TIMEOUT_MS = 180_000`), set via `SET LOCAL` in `applyViews` `:122-129` | The ceiling the union must clear |
| Individuals loop (`merged=false`) | `:178-217` | One txn **per band**, one row per polygon, `ST_SimplifyPreserveTopology`, no union. A band failure → `degraded`, keeps prior rows |
| Merged derive-from-finest (`merged=true`) | `:228-285` | **One** txn: a `_dissolve_finest` TEMP TABLE = `ST_Union(ST_CollectionExtract(ST_MakeValid(ST_SnapToGrid(geom, finestTol)),3))` GROUP BY value (`:236-247`) — the expensive step — then per band `ST_Subdivide(ST_SimplifyPreserveTopology(geom, tol), 512)` `:252-271` |
| Degradation | `:279-285`, result `:287-292` | Any merged-pass failure → `degraded: true`, individuals intact |
| `SUBDIVIDE_MAX_VERTICES` | `:36` (512) | Bounds each stored coverage piece |
| Advisory lock | `SyncLockService.withAdvisoryLock`, `:301-316` | Two refreshes can't race; a lost lock → `skipped:"superseded"` |

### Serve path
`apps/api/src/services/portal-map-tile.service.ts`

- `dissolveReady` (`:641-663`) requires `treatment==="dissolve"` + a band + `hasDissolvePrecompute`. **`hasDissolvePrecompute` (`:821-836`) is an EXISTS on `(portal_result_id, column_name, zoom_band)` — it does NOT check `merged`.** So it returns true whenever *individuals* exist, even if the merged pass degraded.
- `runDissolveTile` (`:851-949`): counts `merged=false` rows in the envelope (`cnt`, `:872-881`); `individuals` fires only `cnt.n <= cap` (`:882-895`); `coverage` fires only `cnt.n > cap` selecting `merged=true` (`:896-907`). **When merged degraded: an over-cap tile has `cnt.n > cap` → individuals gated out AND coverage empty → the tile serves empty** (verified). The area-ranked `ORDER BY ST_Area DESC LIMIT cap` only runs under-cap.

### Bands, tolerances, caps
`packages/core/src/constants/large-data-ops.constants.ts` — `DISSOLVE_ZOOM_BANDS` (`:162-168`, five bands rep 6/7/8/9/12), `bandForZoom` (`:171-176`), `AGG_ZOOM_THRESHOLD=14` (dissolve ceiling only). `MAP_LAYER_FEATURE_CAP=10_000` (`:42`); `MAP_TILE_FEATURE_CAP=10_000` in the service (`:56`). `tileSimplifyTolerance(z)=360/(2^z*4096)` (`portal-map-tile.service.ts:384-388`).

### Storage
`apps/api/src/db/schema/map-dissolve-geometries.table.ts` — `merged boolean` (`:58`), `featureCount` (1 for individuals, source count for coverage), lookup index `(portalResultId, columnName, zoomBand, merged)` (`:60-70`), `geom` GiST added by migration DDL. No unique key; idempotent via per-pin delete-then-insert.

### Job infra + degradation surfacing
- Dissolve runs on the **jobs** queue (`queues/processors/index.ts:11,31`; worker `jobs.worker.ts:303`, `concurrency: 2`), enqueued best-effort by `DissolvePrecomputeService.enqueueForPin` (`dissolve-precompute.service.ts:41-71`).
- `degraded` lives on the job result schema (`packages/core/src/models/job.model.ts:550-566`) → surfaced through the jobs routes, **not** `GET /api/admin/maintenance` (that endpoint reads only the maintenance queue — `admin.router.ts:137-166`). So today a degraded dissolve is invisible unless you inspect the specific job.

### Bounding-pattern precedents
- Batch-bounded drain loops with a typed run summary: `entity-record-retention-purge.processor.ts`, `ledger-retention-purge.processor.ts`.
- PostGIS scale usage: `scripts/postgis-benchmark.ts` (snap/makevalid/grid), `geometry-audit.service.ts` (makevalid-on-write). The only "scalable dissolve" precedent is the merged pass itself; #532's smoke already measured and **rejected** per-grid-cell union (132 s + 124k rows) and full dissolve-all union (153 s).

## The design space

### Decision 1 — How to bound the merged-coverage union

The coverage is only ever shown for **over-cap tiles**, which occur at **low/coarse zoom** — where fine detail is invisible anyway. That is the lever: a coarse coverage is not a quality loss at the zoom it's used.

- **A. Coarser per-band snap before union.** Snap each polygon to the band's grid (`ST_SnapToGrid` at a per-band tolerance, coarser than the current single `finestTol`) *before* union. The union then operates on far fewer distinct vertices/shapes — union cost scales with post-snap complexity, not raw vertices. Coarse bands snap hard (near a coverage mask), fine bands barely.
- **B. Subdivide-before-union.** `ST_Subdivide` the (snapped) input into bounded pieces, union piece-groups, then re-subdivide. Bounds peak per-union vertex count; robustness for pathological geometries.
- **C. Grid-cell coverage mask.** At coarse bands, don't union polygons at all — union the **grid cells any polygon occupies** (`ST_SnapToGrid` centroid/extent → distinct cells → `ST_Union` of cell squares). O(cells), never O(vertices). Coarsest, cheapest, always represents every polygon (its cell is filled).
- **D. Area/row cap on the coverage.** Only union the largest-N by area, drop the rest. **Rejected — reintroduces the never-drop violation** this whole line of work fixed.

| | A snap-before-union | B subdivide-before-union | C cell coverage mask | D area cap |
|---|---|---|---|---|
| Union cost bound | Post-snap complexity | Per-piece vertex cap | O(occupied cells) | Low but wrong |
| Never-drop | ✅ | ✅ | ✅ | ❌ |
| Detail at coarse zoom | Good | Good | Blocky (fine at that zoom) | n/a |
| Fits existing pattern | Extends finest-union | Extends subdivide | New (but simplest SQL) | — |

**Lean: A as the primary, C as the coarse-band floor, B for robustness — a per-band budget-aware pipeline.** Coarse bands (0–1) use C or a hard snap (cheap coverage mask); mid/fine bands use A (snap-before-union) + B (subdivide). Each band measured against the 180 s budget; the target is that the whole merged pass clears budget on a production-sized layer.

### Decision 2 — The degraded fallback (the empty-tile gap)

Independent of Decision 1: even a bounded union can fail (a truly pathological or oversized layer), and there's a window between "pin created" and "precompute done." Today that window / failure serves **empty** over-cap tiles.

- **A. Fall back to area-ranked individuals when merged is absent.** `runDissolveTile` detects no `merged` rows for the band and serves `merged=false` area-ranked `LIMIT cap` (the pre-#532 drop). Not never-drop, but **shows the layer** instead of a blank — a strictly better degraded state, and honest (pair with the degraded notice).
- **B. Leave empty.** Current. A blank map reads as "no data," which is wrong and alarming.

**Lean: A.** Graceful degradation is the enterprise-failure-mode rule: a bounded union is the goal, but the fallback must never be blank. `hasDissolvePrecompute` / the `coverage` CTE gains a merged-existence check so an over-cap tile with no coverage serves area-ranked individuals.

### Decision 3 — Where "degraded / approximate coverage" is visible

- **A. On the map** — the `aggregated` notice already exists (#532); extend it so a degraded/approximate coverage tile says so ("coverage is approximate at this zoom"), plus keep `degraded` on the job result.
- **B. Job result only** (current) — invisible to the viewer.

**Lean: A** — the viewer of a large map should know the low-zoom coverage is approximate/bounded, consistent with the existing "simplified / aggregated overview" notices.

## Tradeoff comparison

| | D1: per-band bounded union (A+C+B) | D2: fallback to individuals | D3: on-map degraded notice |
|---|---|---|---|
| Spreads to spec | Yes — the precompute SQL per band + a budget check | Yes — `runDissolveTile` merged-existence branch + `hasDissolvePrecompute` | Yes — render notice + tile metadata |
| Independently shippable | Yes (slice 1) | Yes (slice 2 — the safety net; ship first?) | Yes (slice 3) |

## Recommendation

1. **Fix the degraded fallback first (Decision 2A):** an over-cap tile with no `merged` coverage serves area-ranked individuals, never empty. This is the safety net and closes the current blank-tile bug regardless of the union work.
2. **Bound the merged union per band (Decision 1):** coarse bands use a cheap coverage (snap-hard / cell mask), mid/fine bands snap-before-union + subdivide, every band measured against the 180 s budget so the full merged pass clears it on a production-sized layer.
3. **Surface the degraded/approximate state on the map (Decision 3A).**
4. **State + enforce a target ceiling** (Open question 1) — the largest layer never-drop must hold for; above it, a documented, surfaced "too large — approximate coverage" state (which 2A already provides).

## Open questions

1. **Target ceiling.** What layer size must never-drop hold for — 200k (the census layer), ~500k–1M (county parcels, the largest realistic host), or unbounded? **Lean: ~500k–1M** (the parcel scale #472's comments already cite), with 2A's graceful fallback as the honest behavior above it. The bounding pipeline is tuned to clear budget at that ceiling.
2. **Noisy-neighbor: a huge precompute holds a jobs-queue slot for minutes.** The jobs worker is `concurrency: 2`; a 200k+ dissolve occupies one slot for the whole run. **Lean: acceptable for now** (dissolve is already off-request + advisory-locked; a dedicated queue/priority is a separate scaling ticket), but note it — a burst of large pins could starve other jobs.
3. **Re-precompute on deploy.** Existing pins precomputed before this ticket have coverage built the old (unbounded / possibly-degraded) way. **Lean: a one-shot re-enqueue of dissolvable pins on deploy** (the #532 branch already contemplated a "dissolve re-enqueue on deploy" step) so the bounded coverage replaces stale/degraded rows.
4. **Does the coarse coverage mask (C) need the colorBy value?** A per-value cell mask multiplies cells by cardinality. **Lean: yes, keep per-value** (the serve emits the value for the choropleth paint), but the cell-grid keeps it bounded regardless of cardinality — validate cost at smoke.

## Enterprise-scale considerations

- **Concurrency & correctness.** Precompute is advisory-locked per pin (`SyncLockService`); the bounding work doesn't change that. `N/A — covered`.
- **Failure modes.** The crux: today's failure is **fail-blank** (empty over-cap tiles). Decision 2A makes it **fail-to-individuals** (graceful, honest). The bounded union reduces how often the fallback is needed. This is the primary enterprise concern.
- **Scale & unbounded growth.** The whole ticket. The union input is bounded per band (snap/subdivide/cell), and the target ceiling is stated with a graceful state above it.
- **Multi-tenancy.** Per-org, per-pin precompute; noisy-neighbor on the shared jobs queue is Open question 2 (`Lean: note, don't solve here`).
- **Data lifecycle.** Coverage rows are rebuilt on re-pin, cascade-deleted with the pin; no retention concern. Re-enqueue on deploy (Open question 3) handles stale rows.
- **Accuracy & auditability.** `N/A — coverage is a derived render artifact, not a record of truth`; the individuals rows remain the faithful geometry.
- **Contract stability.** No schema change needed (the `merged` column + index from #532 already carry both representations); bounding is internal to the precompute SQL + serve fallback. `Lean: additive, no contract change`.

## What this doesn't decide

- **Message-block (un-pinned) polygon maps** — served raw, no precompute. That's the sibling ticket #542; this one is pin-only.
- **A dedicated/prioritized dissolve queue** for noisy-neighbor isolation — noted (Open question 2), deferred as a separate scaling ticket.
- **Points/lines** — already count-driven + bounded by #532 slices 3–4; untouched here.

## Next step

Write `docs/HUGE_POLYGON_PRECOMPUTE.spec.md` (the per-band bounded-union contract + the `runDissolveTile` merged-existence fallback + the degraded notice) and `.plan.md`. The plan slices: (1) degraded fallback to area-ranked individuals (the blank-tile safety net, shippable alone, TDD against `runDissolveTile`); (2) the per-band bounded merged union with measured budgets; (3) the on-map degraded/approximate notice; (4) re-enqueue-on-deploy of dissolvable pins.
