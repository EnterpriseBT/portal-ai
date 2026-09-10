# Bound the huge-polygon dissolve precompute — Plan

**Three TDD slices that make the polygon merged-coverage precompute clear the per-band budget at scale and the degraded state never-blank: the safety-net fallback first, then the bounded union, then the operator re-enqueue.**

Spec: `docs/HUGE_POLYGON_PRECOMPUTE.spec.md`. Discovery: `docs/HUGE_POLYGON_PRECOMPUTE.discovery.md`. Issue: #541. Builds on #532 (the `merged` column + count-driven `runDissolveTile` + the merged-coverage precompute).

3 slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/huge-polygon-precompute`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from `apps/api` (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — **Slice 1** (degraded fallback) ships first because it's the never-blank safety net: it closes the current empty-tile bug independently AND makes Slice 2's per-band degrade-isolation graceful (a band that fails the union already renders area-ranked, not blank). **Slice 2** (bounded union) is the perf fix and depends only on the existing schema. **Slice 3** (re-enqueue) is last because it only makes sense once the bounded coverage exists to rebuild toward.

---

## Slice 1 — Degraded fallback: over-cap + no coverage → area-ranked individuals, never blank

`runDissolveTile` serves area-ranked individuals (not an empty tile) when a band has no `merged` coverage. Closes the verified blank-tile bug (`hasDissolvePrecompute` ignores `merged`, so a degraded pin's over-cap tiles serve empty).

**Files**

- Edit: `apps/api/src/services/portal-map-tile.service.ts` — `runDissolveTile` (`:851-949`): add a band-level `has_merged` CTE; re-gate `individuals` (`cnt.n <= cap OR NOT has_merged`) and `coverage` (`cnt.n > cap AND has_merged`); set `truncated = (cnt.n > cap AND NOT has_merged)`, `aggregated = (cnt.n > cap AND has_merged)`.

**Steps**

1. **Tests (spec: Slice-1 integration cases).** In `src/__tests__/__integration__/routes/portal-map.router.integration.test.ts`: (a) an over-cap tile with individuals but **no** merged rows → non-empty MVT, `truncated=true`, `aggregated=false`; (b) an over-cap tile **with** merged rows → `aggregated=true` (no regression); (c) an empty-but-covered envelope (band has merged rows outside the envelope) → empty coverage, not the fallback. Run; (a)/(c) fail (today (a) is empty).
2. **Implement** the `has_merged` CTE + re-gating in `runDissolveTile`. Green.
3. Lint + type-check.

**Done when:** an over-cap tile of a merged-less (degraded/mid-build) pin renders the layer area-ranked with the "Partial at this zoom" notice; the with-coverage and empty-but-covered paths are unchanged.

**Risk:** the `has_merged` existence must be band-level (envelope-independent) or an empty-but-covered tile wrongly triggers the fallback — case (c) guards exactly this.

---

## Slice 2 — Bounded per-band merged union (snap-before-union), replacing derive-from-finest

The merged coverage is built per band by snapping the union input to a coarse per-band grid, bounding cost to O(distinct cells). Each band its own transaction, degrade-isolated.

**Files**

- New: `packages/core/src/constants/large-data-ops.constants.ts` — `COVERAGE_SNAP_FACTOR` (int, ~8) + `coverageSnapTolerance(representativeZoom)` (or beside `tileSimplifyTolerance` in the service — returns a degrees tolerance `≥ tileSimplifyTolerance(repZoom)`, coarser at coarse bands).
- Edit: `apps/api/src/queues/processors/dissolve-precompute.processor.ts` — merged pass (`:228-285`): drop `_dissolve_finest`/`finestTol`; per-band transaction doing `ST_Subdivide(ST_Union(ST_CollectionExtract(ST_MakeValid(ST_SnapToGrid(geom, coverageSnap(band))),3)), SUBDIVIDE_MAX_VERTICES)` grouped by value, `merged=true`, `feature_count` = per-(value,band) source count; a band failure sets `degraded` and isolates.

**Steps**

1. **Tests (spec: unit + Slice-2 integration).** Unit `portal-map-tile.service.test.ts`: `coverageSnapTolerance(repZoom) ≥ tileSimplifyTolerance(repZoom)` and coarser at a coarser band (2). Integration `dissolve-precompute.processor.integration.test.ts`: merged rows present for **every** band via snap-before-union (valid MultiPolygon, `feature_count` = source count) (2); adjacent polygons collapse so per-band merged piece count is **bounded**, not O(source polygons) (1). Run; fail.
2. **Implement** `coverageSnapTolerance` + the per-band snap+union merged pass. Green.
3. Lint + type-check.

**Done when:** the merged coverage is produced per band by a bounded snap+union (piece count bounded by the snap grid, not source count); a single band's failure leaves the others written + `degraded`. Slice 1 already covers any band left without coverage.

**Risk:** too-coarse a snap loses the coverage's shape at the zoom it's shown → `COVERAGE_SNAP_FACTOR` is the knob, tuned by the recorded smoke measurement (not an asserted timing test).

---

## Slice 3 — Operator re-enqueue of dissolvable pins

An admin action rebuilds coverage for existing pins so stale/degraded rows are replaced by the bounded version.

**Files**

- Edit: `apps/api/src/services/dissolve-precompute.service.ts` — `reenqueueAllDissolvable(): Promise<{ enqueued: number }>` (scan geo pins, `isDissolvable` filter, `enqueueForPin` each; advisory lock skips in-flight).
- Edit: `apps/api/src/routes/admin.router.ts` (+ swagger component) — `POST /api/admin/dissolve/reenqueue` (admin-guarded) → `{ enqueued }`, with `@openapi`.

**Steps**

1. **Tests (spec: unit + admin-route integration).** Unit `dissolve-precompute.service.test.ts`: `reenqueueAllDissolvable` enqueues once per dissolvable pin, skips non-polygon/non-geo (2). Integration: `POST /api/admin/dissolve/reenqueue` → `{ enqueued: N }`, N dissolve jobs created (1). Run; fail.
2. **Implement** the service method + route + swagger component. Green.
3. Lint + type-check.

**Done when:** an operator can trigger a fleet-wide coverage rebuild; the endpoint reports the count enqueued and is `@openapi`-documented.

**Risk:** re-enqueue floods the 2-slot jobs queue — operator-triggered + advisory-locked mitigates; noisy-neighbor isolation is the deferred scaling ticket.

---

## Sequence summary

| Slice | Lands | Gating check |
|---|---|---|
| 1 | `runDissolveTile` never-blank fallback | integration: over-cap no-coverage → area-ranked individuals (`truncated`), not empty |
| 2 | per-band bounded snap+union + `coverageSnapTolerance` | unit (snap monotonic) + integration (per-band coverage, bounded piece count, degrade isolation) |
| 3 | `reenqueueAllDissolvable` + admin route | unit + integration (enqueues per dissolvable pin) |

## Cross-slice notes

- **No migration** — the `merged` column + `(portal_result_id, column_name, zoom_band, merged)` index from #532 already carry both representations; every slice is code-only.
- **`AGG_TILE_VERSION` bump:** Slice 1 changes the bytes a degraded over-cap tile emits (empty → area-ranked), and Slice 2 changes the merged coverage geometry — bump `AGG_TILE_VERSION` once (in Slice 2, or whichever lands last) so cached tiles refresh on deploy.
- **Doc sync (`CLAUDE.md` → "Keeping Documentation in Sync"):** the merged-pass comment at `dissolve-precompute.processor.ts:219-227` (and the `runDissolveTile` docstring) describe derive-from-finest + "falls back to area-ranked" — both must be corrected to match the new reality in their slices. No user-facing/tool/help docs are affected.
- **Smoke:** `docs/HUGE_POLYGON_PRECOMPUTE.smoke.md` records the per-band build time + piece counts against a production-sized layer (the budget is measured, never asserted in the suite) and the never-blank degraded behavior.

## Next step

Implementation begins on `feat/huge-polygon-precompute`, Slice 1 first (tests-first, one commit per slice), only after discovery + spec + plan are confirmed.
