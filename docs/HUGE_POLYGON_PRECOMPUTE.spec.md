# Bound the huge-polygon dissolve precompute — Spec

Pins the contract for making the polygon merged-coverage precompute clear the 180 s per-band budget at 200k+ scale, and for making the degraded state **graceful (area-ranked individuals) instead of blank**. Builds on `docs/HUGE_POLYGON_PRECOMPUTE.discovery.md`. Issue: [#541](https://github.com/EnterpriseBT/portal-ai/issues/541).

## Key decisions (from discovery, confirmed)

1. **Degraded fallback, never blank.** When an over-cap tile has no `merged` coverage (the merged pass degraded, or is mid-build), `runDissolveTile` serves **area-ranked individuals** (`ORDER BY ST_Area DESC LIMIT cap`), flagged `truncated` — not the empty tile it serves today. Shippable alone (slice 1) — it closes the current blank-tile bug regardless of the union work.
2. **Bounded merged union, per band.** The merged coverage is only ever shown for over-cap tiles (dense, low/coarse zoom) where fine detail is invisible — so the union input is **snapped to a coarse per-band grid before union**, bounding cost to O(distinct snapped cells) not O(vertices). Derive-from-finest is dropped; each band snaps+unions independently (a coarse→finer mask across bands is a smooth refinement, not the #478 explode).
3. **Target ceiling ~500k–1M** (parcel scale); above it the bounded union may still degrade, and slice 1's fallback is the honest behavior. Enforced by measurement, not a hard reject.
4. **Fail-mode is graceful degradation** (fail-to-individuals), the enterprise failure-mode rule — never fail-blank.
5. **Re-enqueue existing pins** so stale/degraded coverage is replaced by the bounded version (slice 3, operator-triggered).

## Scope

### In scope
- `runDissolveTile` merged-existence fallback (over-cap + no coverage → area-ranked individuals, `truncated`).
- Per-band bounded merged-union precompute (coarse snap-before-union, per-band transaction, subdivide).
- An operator-triggered re-enqueue of dissolvable pins.

### Out of scope
- Message-block (un-pinned) polygon maps → #542 (pin-only here).
- A dedicated/prioritized dissolve queue (noisy-neighbor) → separate scaling ticket (discovery Open Q2).
- Points/lines (already bounded by #532 slices 3–4).

## Surface

### `apps/api/src/services/portal-map-tile.service.ts` — `runDissolveTile` (`:851-949`)

Add a band-level `merged`-existence signal and fall back to area-ranked individuals when it's absent. The single query gains a `has_merged` CTE and re-gates `individuals` / `coverage`:

- `has_merged AS (SELECT EXISTS(SELECT 1 FROM map_dissolve_geometries WHERE portal_result_id = $pin AND column_name = $col AND zoom_band = $band AND merged = true AND deleted IS NULL) AS h)` — band-level, envelope-independent (a populated band whose coverage lies outside this envelope must still count as "has coverage", so an empty-but-covered tile serves empty coverage, not the fallback).
- `individuals` fires when `cnt.n <= $cap OR NOT (SELECT h FROM has_merged)` — i.e. under cap **or** no coverage exists; keeps `ORDER BY ST_Area DESC LIMIT $cap`.
- `coverage` fires when `cnt.n > $cap AND (SELECT h FROM has_merged)`.
- Result flags: `aggregated = (cnt.n > cap AND has_merged)` (served coverage); **`truncated = (cnt.n > cap AND NOT has_merged)`** (the degraded area-ranked clip → the existing "Partial at this zoom" notice). `TileQueryResult` already carries both fields — no shape change.

`hasDissolvePrecompute` (`:821-836`) is unchanged (still `(pin, col, band)` existence — an individuals-only pin is still "dissolve-ready"; the fallback lives inside `runDissolveTile`).

### `apps/api/src/queues/processors/dissolve-precompute.processor.ts` — merged pass (`:228-285`)

Replace the single derive-from-finest transaction with a **per-band bounded snap-before-union**, mirroring the individuals loop's per-band-transaction + degrade-isolation shape:

```
for (const { band, representativeZoom } of DISSOLVE_ZOOM_BANDS) {
  const snap = coverageSnapTolerance(representativeZoom);   // coarse (see constants)
  try {
    await db.transaction:
      applyViews(tx)
      DELETE ... WHERE portal_result_id = $pin AND zoom_band = $band AND merged = true
      INSERT ... merged=true, feature_count = <source count per value>, geom =
        ST_Subdivide(
          ST_Union(ST_CollectionExtract(ST_MakeValid(ST_SnapToGrid(src.geom, ${snap})), 3)),
          ${SUBDIVIDE_MAX_VERTICES})     -- grouped by ${valueExpr}
  } catch { degraded = true; log "dissolve.merged-band-failed" }  // isolate per band
}
```

- Drop the `_dissolve_finest` TEMP TABLE + `finestTol`. Each band's union input is snapped to `coverageSnapTolerance(band)` (coarse), so the union operates on few distinct vertices → bounded cost. `feature_count` per (value, band) = the source polygon count that fed it.
- A band that still exceeds budget throws → `degraded = true`, that band's prior merged rows stay, other bands unaffected (matching the individuals loop `:210-216`), and slice 1's fallback covers any band left without coverage.

### `packages/core/src/constants/large-data-ops.constants.ts`

- New `COVERAGE_SNAP_FACTOR` (integer, initial value tuned at smoke ~8) — the coarse-snap multiple.
- New `coverageSnapTolerance(representativeZoom: number): number = tileSimplifyTolerance-equivalent(representativeZoom) * COVERAGE_SNAP_FACTOR`. Because `tileSimplifyTolerance` lives in the service, either (a) move the `360/(2^z*TILE_EXTENT)` formula into a shared constant helper, or (b) define `coverageSnapTolerance` in the service beside `tileSimplifyTolerance`. **Contract: `coverageSnapTolerance(repZoom)` returns a degrees tolerance `≥ tileSimplifyTolerance(repZoom)`, coarser at coarse bands.** (Placement is an implementation choice; the value is what's pinned.)

### `apps/api/src/services/dissolve-precompute.service.ts` + an admin route

- `DissolvePrecomputeService.reenqueueAllDissolvable(): Promise<{ enqueued: number }>` — scan `portal_results` (type `geo`, not deleted) whose content `isDissolvable`, call `enqueueForPin` for each (idempotent; an in-flight pin's job is advisory-locked and returns `superseded`). Returns the count enqueued.
- `POST /api/admin/dissolve/reenqueue` (admin router, admin-guarded) → `{ enqueued }`. `@openapi` block; response schema registered. Operator-triggered — no auto-run-on-boot (avoids a re-precompute storm on every restart).

## Migration / Seed

**None.** The `merged` column + `(portal_result_id, column_name, zoom_band, merged)` index from #532 already carry both representations; this ticket changes only the SQL that fills the merged rows and the SQL that serves them. No schema change, no seed.

## TDD test plan

### `apps/api` unit — `src/__tests__/services/portal-map-tile.service.test.ts`
- `coverageSnapTolerance(repZoom)` ≥ `tileSimplifyTolerance(repZoom)` and is coarser at a coarser band. (2)

### `apps/api` unit — `src/__tests__/services/dissolve-precompute.service.test.ts`
- `reenqueueAllDissolvable` enqueues once per dissolvable pin, skips non-polygon / non-geo. (2)

### `apps/api` integration — `src/__tests__/__integration__/routes/portal-map.router.integration.test.ts`
- **Slice 1:** an over-cap tile with **individuals but no merged rows** serves area-ranked individuals (non-empty MVT, `truncated=true`, `aggregated=false`) — the never-blank fallback. (1)
- An over-cap tile **with** merged rows still serves coverage (`aggregated=true`) — unchanged. (1, guards no regression)
- An **empty-but-covered** envelope (band has merged rows elsewhere) serves empty coverage, not the fallback. (1)

### `apps/api` integration — `src/__tests__/__integration__/queues/dissolve-precompute.processor.integration.test.ts`
- **Slice 2:** merged rows are produced **per band** via snap-before-union (present for every band; `feature_count` = source count; valid MultiPolygon); a band's failure isolates (others still written, `degraded`). (2)
- The coarse snap collapses adjacent polygons into a bounded coverage (row/piece count per band is bounded, not O(source polygons)). (1)

### `apps/api` integration — admin route
- `POST /api/admin/dissolve/reenqueue` returns `{ enqueued: N }` and creates N dissolve jobs. (1)

Run via `npm run test:unit` / `npm run test:integration` from `apps/api` (never raw jest). **Totals ≈ 11 cases.** No migration test (no schema change). Union *budget* is a recorded smoke measurement against a production-sized layer, not an asserted test (per `CLAUDE.md` — don't assert query plans/timings in the suite).

## Acceptance criteria

- [ ] A pinned no-colorBy polygon layer of ~200k+ features renders a filled coverage at low zoom (no empty swathes, no `504`) and resolves to individuals on zoom-in — the merged pass completes without degrading, measured against the 180 s/band budget.
- [ ] With merged coverage **absent** (forced degrade / mid-build), an over-cap tile serves area-ranked individuals — **never an empty tile** — with the "Partial at this zoom" notice.
- [ ] `POST /api/admin/dissolve/reenqueue` rebuilds coverage for existing dissolvable pins.
- [ ] Recorded smoke measurements: per-band merged build time + piece counts on a production-sized layer.

## Risks & rollback

- **Fail mode: graceful degradation (fail-to-individuals), never fail-blank.** If the bounded union still can't clear budget on a pathological layer, slice 1 guarantees the tile shows the layer (area-ranked) rather than blanking. Rollback: the merged-pass change is self-contained in the processor; reverting it restores derive-from-finest (and the old blank-on-degrade, so slice 1 should not be reverted independently).
- **Coarse coverage looks blocky at the low zoom it's shown.** Accepted — an over-cap tile is a dense area where per-polygon detail is sub-pixel; the coverage refines on zoom-in as tiles fall under cap and individuals take over. `COVERAGE_SNAP_FACTOR` is the tuning knob.
- **Re-enqueue storm.** `reenqueueAllDissolvable` is operator-triggered (not on boot) and advisory-locked per pin, so it can't double-run a pin; a large fleet still floods the 2-slot jobs queue — run it off-peak (noisy-neighbor is the deferred scaling ticket).

## Files touched

- Edit: `apps/api/src/services/portal-map-tile.service.ts` (`runDissolveTile` fallback; possibly `coverageSnapTolerance`).
- Edit: `apps/api/src/queues/processors/dissolve-precompute.processor.ts` (per-band bounded snap+union).
- Edit: `packages/core/src/constants/large-data-ops.constants.ts` (`COVERAGE_SNAP_FACTOR` / `coverageSnapTolerance`).
- Edit: `apps/api/src/services/dissolve-precompute.service.ts` (`reenqueueAllDissolvable`).
- Edit: `apps/api/src/routes/admin.router.ts` (+ swagger component) — `POST /api/admin/dissolve/reenqueue`.
- Edit tests: the four suites above.

## Next step

`docs/HUGE_POLYGON_PRECOMPUTE.plan.md` — three TDD slices on this branch: (1) the degraded fallback in `runDissolveTile` (the blank-tile safety net, shippable alone); (2) the per-band bounded snap+union precompute + `coverageSnapTolerance`; (3) `reenqueueAllDissolvable` + the admin route. Each a green-testable commit.
