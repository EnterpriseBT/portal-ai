# Smooth low-zoom dissolve band-boundary transitions — Condensed design (#478)

**Issue:** [EnterpriseBT/portal-ai#478](https://github.com/EnterpriseBT/portal-ai/issues/478) · Task · **small / condensed** (discovery + spec + plan + smoke in one doc). Follow-up to #472.

**Why.** A low-zoom polygon choropleth is precomputed in 3 zoom bands, each dissolved **independently** (`ST_SnapToGrid(bandTol) → ST_MakeValid → ST_Union → ST_Subdivide`). Because the snap tolerance differs per band, the *merge topology* differs per band (coarse snap merges parcels into big blobs; fine snap keeps them distinct — 444 vs 8,781 vs 13,336 pieces on the 397,960-parcel layer, same footprint). Crossing a band boundary (z8, z11) the tile geometry **re-tessellates** — a merged region visibly "pops" apart into finer shapes. Cosmetic, but below the polish bar. Touches `apps/api` (the processor) + `packages/core` (band constants); no contract change.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Per-band independent dissolve | `apps/api/src/queues/processors/dissolve-precompute.processor.ts` (the `for (… of DISSOLVE_ZOOM_BANDS)` loop) | 3 separate snap→makevalid→union→subdivide passes; each band snaps at its own tolerance ⇒ different merge topology |
| Band definitions | `packages/core/src/constants/large-data-ops.constants.ts` (`DISSOLVE_ZOOM_BANDS`, `bandForZoom`) | `[0–7], [8–10], [11–13]`, each a `representativeZoom` → `tileSimplifyTolerance` |
| Serve (unchanged) | `apps/api/src/services/portal-map-tile.service.ts` `runDissolveTile` | clips stored pieces per `(pin, column, band)` |

## Decision — nested simplify-once (+ coarse sliver-drop)

**Chosen:** dissolve **once** at the finest band's resolution into a master region per value, then derive each band by `ST_SimplifyPreserveTopology(master, bandTol)` → `ST_Subdivide`. All bands share **one merge topology**, so across a boundary a region stays the same region — only its outline detail changes. No re-tessellation pop. Union runs once (~30s, band-2's cost) instead of 3× (~53s), so it should also be **faster** (verify in the measurement step).

The one tradeoff: the fine-res master keeps ~every parcel outline, so a coarse band simplified from it would carry ~as many pieces as the fine band (heavier far-zoom render than today's 444 blobs). Mitigate with a **per-band area filter**: after simplify, drop pieces whose area < ~`(bandTol)²` (sub-pixel at that zoom, invisible). Big regions stay consistent across bands (the pop that mattered is gone); a tiny piece fading in as you zoom is a minor, acceptable transition.

**Rejected — "more bands" (e.g. 5–6):** trivial (`DISSOLVE_ZOOM_BANDS` only) but does **not** fix the root cause (still per-band snap ⇒ still re-tessellates, just in smaller jumps) and ~doubles storage/precompute. Keep 3 bands; fix the cause.

## Plan — 2 slices

**Slice 1 — nested-simplify processor + measurement.**
- Edit: `dissolve-precompute.processor.ts` — replace the per-band snap+union with: one snap(finestTol)+makevalid+union per value (the master), then per band `ST_SimplifyPreserveTopology(master, bandTol)` + area-drop + `ST_Subdivide`. Master computed once per value (reuse across bands within the txn structure; keep the per-band transactional replace).
- Tests: `apps/api/src/__tests__/__integration__/queues/dissolve-precompute.processor.integration.test.ts` — extend: coarser band is a **topological simplification of** the finer (piece bounding boxes/coverage nested, not independently re-merged); coarse band has **fewer or equal** pieces than fine; still valid MultiPolygons; recompute-replaces still holds.
- **Measurement (recorded, like #472's union gate):** run against the 397,960-parcel layer; record per-band time + piece counts; confirm total ≤ the current ~53s and coarse-band piece count stays render-friendly. Tune the finest snap tolerance + area-drop threshold here.

**Slice 2 — band-count tuning only if the measurement says so.** If nested-simplify makes more bands cheap enough to further smooth, adjust `DISSOLVE_ZOOM_BANDS` (core) + its constants test. Otherwise a no-op; keep 3.

Run: `cd apps/api && npm run test:integration -- --testPathPattern dissolve-precompute`; `cd packages/core && npm run test:unit -- --testPathPattern large-data-ops`.

## Smoke (manual, against your dev stack)

1. Rebuild core + restart the dev stack (band constants live in core dist). Re-pin (or refresh) the `owner_type` parcels choropleth so it recomputes with the new processor.
2. `psql "$DB" -c "SELECT zoom_band, count(*) FROM map_dissolve_geometries WHERE portal_result_id='<pin>' GROUP BY 1 ORDER BY 1;"` — coarse bands have **fewer/equal** pieces than fine (nested), all `ST_IsValid`.
3. Zoom the pinned map slowly through z7→z8 and z10→z11. **Expected:** big colored regions stay put and just gain/lose outline detail — **no** big blob breaking apart into many shapes. A small isolated parcel may fade in as you zoom; that's acceptable.
4. Far-zoom (whole layer) still renders quickly and legibly (the area-drop kept it light).
5. Confirm the dissolve job time is ≤ the pre-change ~53s (check the job `result`/logs).

## Out of scope

- The z14 handoff to raw parcels (inherent; different concern).
- Client-side cross-fade/animation of transitions (a UX approach, separate).
