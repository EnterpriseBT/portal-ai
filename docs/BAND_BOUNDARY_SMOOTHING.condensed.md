# Smooth low-zoom dissolve band-boundary transitions — Condensed design (#478)

**Issue:** [EnterpriseBT/portal-ai#478](https://github.com/EnterpriseBT/portal-ai/issues/478) · Task · **small / condensed** (discovery + spec + plan + smoke in one doc). Follow-up to #472.

**Why.** A low-zoom polygon choropleth is precomputed in 3 zoom bands, each dissolved **independently** (`ST_SnapToGrid(bandTol) → ST_MakeValid → ST_Union → ST_Subdivide`). Because the snap tolerance differs per band, the *merge topology* differs per band (coarse snap merges parcels into big blobs; fine snap keeps them distinct — 444 vs 8,781 vs 13,336 pieces on the 397,960-parcel layer, same footprint). Crossing a band boundary (z8, z11) the tile geometry **re-tessellates** — a merged region visibly "pops" apart into finer shapes. Cosmetic, but below the polish bar. Touches `apps/api` (the processor) + `packages/core` (band constants); no contract change.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Per-band independent dissolve | `apps/api/src/queues/processors/dissolve-precompute.processor.ts` (the `for (… of DISSOLVE_ZOOM_BANDS)` loop) | 3 separate snap→makevalid→union→subdivide passes; each band snaps at its own tolerance ⇒ different merge topology |
| Band definitions | `packages/core/src/constants/large-data-ops.constants.ts` (`DISSOLVE_ZOOM_BANDS`, `bandForZoom`) | `[0–7], [8–10], [11–13]`, each a `representativeZoom` → `tileSimplifyTolerance` |
| Serve (unchanged) | `apps/api/src/services/portal-map-tile.service.ts` `runDissolveTile` | clips stored pieces per `(pin, column, band)` |

## Decision — more bands (keep per-band merging)

**Chosen:** keep the per-band independent snap+union (it gives the nice merged-blob far-zoom look) and **add intermediate bands** so each boundary crossing is a small granularity step, not one 20× jump. The pop is *reduced* (many small, barely-perceptible steps) rather than eliminated — the honest tradeoff for keeping the merged-region aesthetic.

**Rejected — nested simplify-once** (dissolve once at finest res, derive bands by `ST_SimplifyPreserveTopology`): measured against the 397,960-parcel layer it was **slower** (~92s vs ~53s — simplifying the 1.29M-pt master ×3 costs more than 3 coarse unions) **and** changed the far-zoom look from 444 merged blobs to ~3K scattered simplified parcels (a readability downgrade). It eliminates the pop but the cost/aesthetic tradeoff isn't worth it. (Measurement recorded on #478.)

**The band set** (measured piece counts, per value across the 3 owner-types → total): the current 3 bands step 444 → 8,781 → 13,336 (the 444→8,781 jump at z8 is the jarring one). Five bands at rep zooms **6 / 7 / 8 / 9 / 12** step 444 → 1,227 → 3,272 → 8,781 → 13,336 — every jump ~2.7×:

| band | zoom range | rep zoom | ~pieces | union time |
|---|---|---|---|---|
| 0 | z0–6 | 6 | 444 | 2.2s |
| 1 | z7 | 7 | 1,227 | 5.8s |
| 2 | z8 | 8 | 3,272 | 13.2s |
| 3 | z9–10 | 9 | 8,781 | 20.7s |
| 4 | z11–13 | 12 | 13,336 | 30s |

Total precompute ~72s (vs ~53s), all off-request. The added bands are the *cheap* coarse ones (z7/z8); the expensive fine unions (z9/z12) are unchanged in count.

## Plan — 1 slice

- Edit: `packages/core/src/constants/large-data-ops.constants.ts` — replace `DISSOLVE_ZOOM_BANDS` with the 5-band set above (`maxZoomExclusive` 7/8/9/11/14, `representativeZoom` 6/7/8/9/12). `bandForZoom` and the last band's `AGG_ZOOM_THRESHOLD` boundary are unchanged in shape.
- **No processor or serve change** — `dissolve-precompute.processor.ts` loops `DISSOLVE_ZOOM_BANDS` and `runDissolveTile`/`bandForZoom` are all data-driven off the constant.
- Tests: `packages/core/src/__tests__/constants/large-data-ops.constants.test.ts` — update to 5 bands + the new `bandForZoom` mappings (z6→0, z7→1, z8→2, z10→3, z13→4, z14→null). The processor integration test asserts bands via `DISSOLVE_ZOOM_BANDS.map(b=>b.band)`, so it adapts automatically.

Run: `cd packages/core && npm run test:unit -- --testPathPattern large-data-ops`; `cd apps/api && npm run test:integration -- --testPathPattern dissolve-precompute`.

## Smoke (manual, against your dev stack)

1. Rebuild core + restart the dev stack (band constants live in core dist). Re-pin (or refresh) the `owner_type` parcels choropleth so it recomputes with the new bands.
2. `psql "$DB" -c "SELECT zoom_band, count(*) FROM map_dissolve_geometries WHERE portal_result_id='<pin>' GROUP BY 1 ORDER BY 1;"` — **5 bands** (0–4), piece counts stepping ~444 → ~1,227 → ~3,272 → ~8,781 → ~13,336, all `ST_IsValid`.
3. Zoom the pinned map slowly out from z13 to z0. **Expected:** the merged-region granularity changes in **smaller steps** at more boundaries (z7, z8, z9, z11) — no single jarring 20× "explode" the way the old z8 boundary did. The merged-blob far-zoom look is preserved.
4. Far-zoom still renders quickly and legibly (coarsest band ~444 pieces, unchanged).
5. Precompute time is longer (~72s vs ~53s) but off-request — the pin/refresh HTTP returns immediately and the map stays usable (fallback) while it runs.

## Out of scope

- The z14 handoff to raw parcels (inherent; different concern).
- Client-side cross-fade/animation of transitions (a UX approach, separate).
