# huge-polygon-precompute — Smoke Suite

Manual smoke test for [#541](https://github.com/EnterpriseBT/portal-ai/issues/541) — the polygon merged-coverage precompute is bounded (per-band snap-before-union) so it clears the per-band budget at 200k+ scale, and a degraded/mid-build pin serves area-ranked individuals instead of a blank tile. **Branch under test:** `feat/huge-polygon-precompute` (PR [#543](https://github.com/EnterpriseBT/portal-ai/pull/543)).

## Preflight

### Environment

- [ ] `git checkout feat/huge-polygon-precompute && git pull --ff-only`
- [ ] `npm install`
- [ ] `npm run db:migrate` from `apps/api` — applies `0092_dissolve_merged_representation`… wait, **no new migration** on this branch: #541 is code-only (the `merged` column + index landed with #532's `0091`). Confirm `db:migrate` reports nothing pending.
- [ ] Rebuild `@portalai/core` (the `AGG_TILE_VERSION` bump to 8 + `COVERAGE_SNAP_FACTOR` live there): `npm run build --workspace @portalai/core`, then restart `npm run dev` so the API loads it.
- [ ] `npm run dev` boots cleanly (API :3001, web :3000).

### Fixtures

- [ ] Your local admin org (`admin@portalsai.io`, on an unlimited tier) — the same org used for the #532 smoke.
- [ ] **A mid-size polygon layer (CA census block groups, ~22k)** pinned as a no-colorBy map — reliable, precomputes all bands in seconds. (ArcGIS: `.../Census/MapServer/1/query?where=STATE_FIPS='06'&outFields=*&f=geojson`.)
- [ ] **A production-sized polygon layer (~200k+, the US census block groups)** for the budget measurement — this is the stress case (#532 established the local container struggles with it; the measurement is what proves the bound).

### Reset between runs

- [ ] Re-pinning a layer re-runs the precompute (delete-then-insert per pin), so re-pin to reset. To force the degraded state for §1, clear a pin's merged rows: `DELETE FROM map_dissolve_geometries WHERE portal_result_id = '<pin>' AND merged = true;` (via `db:studio` or psql).

## §1 — Degraded fallback: never blank (slice 1)

- [ ] Pin the **22k CA** no-colorBy layer; wait for its dissolve job to complete (all 5 bands, both `merged=false` and `merged=true` rows present — check `map_dissolve_geometries` in `db:studio`). *(agent-walkable: pin via the map UI; DB check manual)*
- [ ] Force the degraded state: `DELETE … WHERE portal_result_id = '<pin>' AND merged = true;` (remove only the coverage rows). *(manual — DB)*
- [ ] View the pinned map zoomed out to where a tile holds > 10k block groups (state level). **Expected:** the dense areas render as **area-ranked individual polygons (a filled clip), NOT a blank/empty map**, and the "Partial at this zoom" notice shows. *(agent-walkable: screenshot; `— manual` visual confirm that it's not blank)*
- [ ] Zoom in until tiles fall under the cap. **Expected:** individual polygons throughout, no notice. *(agent-walkable)*

## §2 — Bounded merged coverage at scale (slice 2) — **recorded measurement**

- [ ] Pin the **~200k+ US** no-colorBy layer; let the `dissolve_precompute` job run. **Expected:** the job reaches `completed` **without `degraded: true`** (inspect the job in the jobs dashboard / `jobs` table `result`). *(manual — the job may be slow; this is the budget proof)*
- [ ] **Record**, per band, the merged build time and the `merged=true` row (piece) count: `SELECT zoom_band, count(*) FROM map_dissolve_geometries WHERE portal_result_id='<pin>' AND merged=true GROUP BY 1;`. **Expected:** each band clears the 180 s budget; piece counts are **bounded** (far below the ~200k source count — the coarse snap collapsed them). Paste the numbers into the "Recorded measurements" block below. *(manual — psql)*
- [ ] View the 200k pin zoomed out. **Expected:** a filled merged coverage over the dense areas (no empty swathes, no `504`), resolving to individuals on zoom-in — the #532 "swathes" behavior stays fixed at this scale. *(agent-walkable: screenshot; `— manual` visual)*
- [ ] Adjust `COVERAGE_SNAP_FACTOR` only if a band misses budget — coarser snap = cheaper + blockier. Re-pin and re-measure. *(manual)*

## §3 — Operator re-enqueue (slice 3)

- [ ] With ≥1 dissolvable pin present, call the endpoint (authenticated as the admin):
      `POST http://localhost:3001/api/admin/dissolve/reenqueue` with a Bearer token. **Expected:** `200` with `{ "success": true, "payload": { "enqueued": <N> } }` where N = number of geo polygon pins. *(agent-walkable via an authenticated fetch, or `— manual` curl)*
- [ ] **Expected:** N `dissolve_precompute` jobs appear in the jobs dashboard / `jobs` table, and each pin's coverage is rebuilt (merged rows re-created). A pin with an in-flight dissolve reports `superseded` in its job result. *(manual — DB/dashboard)*

## §4 — Error & edge cases

- [ ] **Empty-but-covered envelope:** pan the 22k pin (coverage intact) to an over-cap band but an area with no features in the envelope. **Expected:** empty tile (204/empty MVT), **not** the area-ranked fallback (has_merged is band-level, so a covered band never falls back). *(manual — visual + network)*
- [ ] **Message-block polygon map** (un-pinned, large): still shows the raw-path partial/`504` behavior — **unchanged**, out of scope here (#542). *(manual — confirms scope boundary)*
- [ ] **A band that fails mid-build** (hard to force locally) degrades that band only: other bands' coverage stays, and §1's fallback covers the failed band. *(manual — recorded reasoning, not forced)*

### Recorded measurements (production-sized layer)

| Band (rep zoom) | merged build time | merged piece count | source polygons |
|---|---|---|---|
| 0 (z6) | _tbd_ | _tbd_ | ~200k |
| 1 (z7) | _tbd_ | _tbd_ | |
| 2 (z8) | _tbd_ | _tbd_ | |
| 3 (z9) | _tbd_ | _tbd_ | |
| 4 (z12) | _tbd_ | _tbd_ | |

## Sign-off

- [ ] Every section above verified
- [ ] Recorded measurements filled in (the budget is measured, not asserted in CI)
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/job/pin ids):

---

### Acceptance-criteria → section map

| Spec acceptance criterion | Section |
|---|---|
| 200k+ pin renders filled coverage, no swathes/504, resolves to individuals; merged completes without degrading | §2 |
| Merged absent → over-cap tile serves area-ranked individuals, never empty, "Partial" notice | §1 |
| `POST /api/admin/dissolve/reenqueue` rebuilds coverage for existing pins | §3 |
| Recorded per-band build time + piece counts on a production-sized layer | §2 + Recorded measurements |
