# Precomputed polygon dissolve (low-zoom choropleths) — Plan

**TDD-sequenced implementation of the per-pin dissolve precompute: the contract + storage + constants, the pin-scoped precompute job (bounded union under an advisory lock, gated by a measurement), the enqueue at pin create/refresh, and the tile serve branch + raw-simplify fallback + client paint that flips the treatment live.**

Spec: `docs/PRECOMPUTED_POLYGON_DISSOLVE.spec.md`. Discovery: `docs/PRECOMPUTED_POLYGON_DISSOLVE.discovery.md`. Issue: #472 (was epic #470; per-tile dissolve #475 reverted). Builds on **shipped #371** (pin materialization + tile-on-mount + `geoReencodeRows`) and #449/#450 (tile error surface + budget), all on `main`.

4 slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `fix/precomputed-polygon-dissolve` / PR #477** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit && npm run test:integration
cd apps/web && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — build the store and the compute before flipping the treatment that reads them, so no intermediate slice renders a broken map:

- **Slice 1** — contract + storage + constants + job schemas. Adds `"dissolve"` to the enum and the `opts` param to `resolveAggTreatment` **without changing its routing** (polygons still → `"bins"`), so behavior is unchanged until slice 4. No compute, no serve.
- **Slice 2** — the precompute processor + bounded-union SQL under the `portalResultId` advisory lock. **Gated by a real measurement** against the ~400K parcel layer (the #475 failure mode, moved off-request). Populates the store; nothing reads it yet.
- **Slice 3** — enqueue the job at pin create + refresh. The store now fills in real usage; still nothing reads it.
- **Slice 4** — **flip the routing** (`polygons + colorBy → "dissolve"`) and land both consumers together: the tile serve branch (clip precompute; raw-simplify fallback) and the client paint (real geometry, not bins). The fix goes live atomically here — the raw-simplify fallback fixes the visible bug even for pins whose precompute hasn't landed.

No seed. One migration (slice 1).

---

## Slice 1 — Contract + storage table + constants + job schemas

The durable surface everything else builds on. Enum + storage + constants + job type, no behavior change (routing flip is slice 4).

**Files**

- Edit: `packages/core/src/contracts/map-spec.contract.ts` — `AggTreatment` enum gains `"dissolve"`; `resolveAggTreatment` gains `opts?: { hasColorBy?: boolean }` **but keeps returning `"bins"` for polygons** (routing flip deferred to slice 4).
- Edit: `packages/core/src/constants/*` — `DISSOLVE_ZOOM_BANDS`, `DISSOLVE_CARDINALITY_CEILING`, `bandForZoom(z)`.
- Edit: `packages/core/src/models/job.model.ts` — `"dissolve_precompute"` in `JobTypeEnum`; `DissolvePrecomputeMetadataSchema`/`ResultSchema`; `JobTypeMap` + `JOB_TYPE_SCHEMAS` entries.
- New: `packages/core/src/models/map-dissolve-geometry.model.ts` — `MapDissolveGeometrySchema` + model/factory (mirrors an existing `*.model.ts`); `geom` as GeoJSON (`z.unknown`) at the model boundary.
- Edit: `packages/core/src/models/index.ts` — export it.
- New: `apps/api/src/db/schema/map-dissolve-geometries.table.ts` — the table (spec §1).
- Edit: `apps/api/src/db/schema/index.ts`, `db/schema/zod.ts` (select/insert **omitting** `geom`), `db/schema/type-checks.ts` (bidirectional non-`geom` assertions).
- New migration: `npm run db:generate -- --name add_map_dissolve_geometries`, then hand-add the PostGIS DDL (`ADD COLUMN geom geometry(MultiPolygon,4326)` + `CREATE INDEX … USING GIST (geom)`).
- New tests: `packages/core/__tests__/contracts/map-spec.contract.test.ts` (extend), `__tests__/models/map-dissolve-geometry.model.test.ts`; `apps/api/src/__tests__/__integration__/db/map-dissolve-geometries.integration.test.ts`.

**Steps**

1. **Tests (spec cases 1, 3, 4, 5, 6–9).** Core: enum accepts `"dissolve"`; `resolveAggTreatment` accepts `opts` and (this slice) polygons still resolve `"bins"`; job schemas parse + registry complete; model round-trips; `bandForZoom` maps zooms→bands, null at z≥14. DB (integration): GeoJSON MultiPolygon round-trips through the geometry DDL + GiST usable; unique key rejects dupes; `ON DELETE CASCADE` from `portal_results`; type-check guards compile. Run; fail.
2. **Implement** the enum value, `opts` param (no routing change), constants, job schemas, model, table + DDL migration, zod/type-checks. Green.
3. Lint + type-check (root).

**Done when:** cases 1, 3–9 pass; `db:migrate` on a fresh DB creates the table with the geometry column + GiST; behavior everywhere else is unchanged (polygons still bin).

**Risk:** the `geom` column omitted from drizzle-zod must still satisfy type-checks — mirror exactly how the wide-table geometry column is handled in `zod.ts`/`type-checks.ts`.

---

## Slice 2 — Precompute processor + bounded union (measurement-gated)

The off-request compute. Runs the pin's pipeline once, dissolves per (value, band), stores. **This slice carries the measurement gate** — the #475 failure mode moved off the request path must be proven bounded before serve/client work.

**Files**

- New: `apps/api/src/queues/processors/dissolve-precompute.processor.ts` — the processor (spec §5).
- Edit: `apps/api/src/services/sync-lock.service.ts` — extract/add a `withAdvisoryLock(namespace, key, fn)` (or a `withPortalResultLock`) reusing the `pg_try_advisory_lock` mechanism with a new namespace constant.
- Edit: `apps/api/src/queues/jobs.worker.ts` — dispatch `dissolve_precompute`.
- Edit: `apps/api/src/constants/*` — `DISSOLVE_STATEMENT_TIMEOUT_MS`, the grid cell size.
- New tests: `apps/api/src/__tests__/__integration__/queues/dissolve-precompute.processor.integration.test.ts` (real PostGIS).

**Steps**

1. **Integration tests (spec cases 10–16).** A pin whose pipeline yields overlapping polygons + a 3-value categorical colorBy → one valid MultiPolygon per (value, band), `featureCount` correct, all `ST_IsValid`; **a joined/aggregated pipeline dissolves correctly** (case 11 — proves pipeline-keyed, not entity-keyed); two-phase union equals a single `ST_Union` within tolerance; over-ceiling colorBy → `skipped: "over-cardinality"`; recompute replaces (no doubling, no zero-row window); lock not acquired → superseded no-op; forced per-band failure → `degraded`, other bands written. Run; fail.
2. **Implement** the processor: advisory lock → parse spec/colorBy → `buildSessionViews` → cardinality check → per-band bounded union SQL (subdivide → grid union → union → simplify) → transactional delete-then-insert. Green.
3. **Measurement gate (spec Risks).** Run the processor against a production-sized layer (the ~400K parcel `owner_type` pin on the dev DB); **record the wall-clock per band** in the slice's commit message / a note in the smoke doc. If any band exceeds a sane off-request budget, tune (grid cell, `ST_Subdivide` count, simplify-before-union at coarse bands) **before** proceeding to slice 4. This is a recorded measurement, not a test assertion (per `CLAUDE.md` → "Don't assert query plans in the test suites").
4. Lint + type-check.

**Done when:** cases 10–16 pass; the measurement confirms bounded off-request timing on the real layer; the store fills correctly. Nothing reads it yet.

**Risk:** **the union is still too slow** (the whole reason #475 was reverted). Mitigation is the explicit measurement gate in step 3 — serve/client work does not start until the compute is proven bounded. Fallback tunings named above; worst case the slice re-scopes the union shape before slice 4.

---

## Slice 3 — Enqueue at pin create + refresh

Wire the processor to the pin lifecycle so the store fills automatically. Small, no reader yet.

**Files**

- Edit: `apps/api/src/routes/portal-results.router.ts` — `POST /` (after `create`) and `POST /:id/refresh` (after the snapshot persists): enqueue one `dissolve_precompute` for the `portalResultId` when the block is a geo polygon-with-colorBy. Best-effort (log on failure, never fail the pin/refresh).
- New/extend tests: `apps/api/src/__tests__/__integration__/routes/portal-results.router.integration.test.ts` (or the existing pin test) — cases 23, 24.

**Steps**

1. **Tests (spec cases 23, 24).** Pinning a geo polygon-with-colorBy block enqueues one job (spy the queue); a non-polygon/no-colorBy pin enqueues nothing; a failed enqueue doesn't fail the pin; refresh re-enqueues for the same id. Run; fail.
2. **Implement** the enqueue calls (a small guard: parse the stored content's spec, check polygon + colorBy). Green.
3. Lint + type-check.

**Done when:** cases 23–24 pass; pinning/refreshing a choropleth populates `map_dissolve_geometries` in a running stack. Still no serve path reads it.

**Risk:** none material — the enqueue is best-effort and guarded; the processor (slice 2) is already green.

---

## Slice 4 — Flip the treatment: tile serve branch + fallback + client paint

The fix goes live, atomically. The routing change and both consumers land together so no map renders half-migrated.

**Files**

- Edit: `packages/core/src/contracts/map-spec.contract.ts` — `resolveAggTreatment` now routes `polygons + hasColorBy → "dissolve"` (spec case 2).
- Edit: `apps/api/src/services/portal-map-tile.service.ts` — `TileAggregation.treatment`; `aggregationFromSpec` passes `{ hasColorBy }`; `defaultRunTileQuery` dissolve branch (pin hit → clip stored geometry emitting the colorBy value as a property; miss / message-ref / non-categorical → `buildRawTileSql` at band tolerance + `X-Portal-Tile-Simplified`); thread the pin `portalResultId` from the ref.
- Edit: `apps/web/src/modules/MapWidget/utils/map-config.util.ts` — `layerToMapLibre` dissolve branch: real-geometry `-agg` fill with `resolveColorBy` (not the density ramp, no centroid layer), gate raw layer `minzoom = threshold`.
- Extend tests: `portal-map-tile` integration (cases 2, 17–20); `map-config.util.test.ts` (21, 22).

**Steps**

1. **Tests (spec cases 2, 17–22).** `resolveAggTreatment` polygons + colorBy → `"dissolve"` (2). Serve: dissolve hit serves stored geometry with the colorBy property, **not** the pipeline SQL (rename the underlying view, still get a tile — 17); miss → raw-simplify + simplified header, never bins (18); message ref → raw-simplify (19); z≥threshold raw path + band selection (20). Client: dissolve layer emits real-geometry colorBy fill, gates raw layer (21); no-colorBy polygon + points still `"bins"` (22). Run; fail.
2. **Implement** the routing flip + serve branch + client paint. Green.
3. Lint + type-check; run the touched suites in all three packages.

**Done when:** cases 2, 17–22 pass; a polygon choropleth below z14 renders as real colored polygons end-to-end (precompute hit) and as raw-simplified polygons before precompute lands — **never centroid bins**.

**Risk:** the routing flip touches shared `resolveAggTreatment` (server + client). Landing both consumers in this same slice is the mitigation — no intermediate where one side flipped and the other didn't. Confirm the `-agg` fill's `resolveColorBy` reads the tile feature property the serve branch emits (`value AS <colorByColumn>`).

---

## Sequence summary

| Slice | Lands | Spec cases | Tests |
|---|---|---|---|
| 1 | contract + table + migration + constants + job schemas (no routing change) | 1, 3–9 | core unit + api integration |
| 2 | precompute processor + bounded union + advisory lock + **measurement gate** | 10–16 | api integration |
| 3 | enqueue at pin create + refresh | 23, 24 | api integration |
| 4 | routing flip + tile serve branch + fallback + client paint | 2, 17–22 | api integration + web unit |

Total ≈ **24 cases**, one migration (slice 1). Commits on `fix/precomputed-polygon-dissolve`; PR #477 grows commit-by-commit.

---

## Cross-slice notes

- **The treatment routing flip is deferred to slice 4 on purpose.** Slice 1 adds the `"dissolve"` enum value and the `opts` param but leaves `resolveAggTreatment` returning `"bins"` for polygons; the flip + both consumers (serve, client) land together in slice 4. Between slices 1–3 every map renders exactly as today — no half-migrated intermediate.
- **The measurement gate (slice 2 step 3) is the crux.** #475 was reverted because the union was >90s; this whole ticket bets that moving it off-request + bounding it (subdivide + two-phase grid union) makes it tractable. Prove it on the real layer before building the reader. Record the numbers (measurement, not a plan assertion — `CLAUDE.md`).
- **Fallback is the safety net.** The raw-simplify miss path (slice 4) means the visible bug is fixed for *every* choropleth the moment slice 4 lands, whether or not its precompute exists yet — so a slow/absent precompute degrades to correct-but-simpler, never to bins or blank.
- **Pipeline-keyed, not entity-keyed.** Case 11 (joined/aggregated pipeline) is the load-bearing test — it's why the store keys on `portalResultId` and the processor runs `pipeline.sql`, so a `boundaries ⨝ metric` choropleth works with no entity coupling.
- **Interaction with #371 tile-on-mount.** A freshly pinned large map already renders via tiles on mount; its first low-zoom tiles raw-simplify until the (slice-3-enqueued) job lands, then serve stored geometry on the next fetch/refresh. Acceptable + recorded (discovery Open Q6).
- **Advisory lock reuse.** Slice 2 factors the `pg_try_advisory_lock` mechanism out of `SyncLockService` (or adds a sibling) with a new namespace so a pin-dissolve lock is distinct from a connector-instance sync lock.
- **Doc-sync (CLAUDE.md → "Keeping Documentation in Sync").** No user-facing help/glossary/tool surfaces change (this is an internal render path). The smoke doc (`/smoke`) records the measurement + the manual walkthrough. No README/CLAUDE.md convention changes.

## Next step

Implement slice 1 on `fix/precomputed-polygon-dissolve`, tests-first, one commit. Before coding, re-read the spec's *Surface* §1–§4 — the table, enum, constants, and job schemas are pinned there against the real `wide-table-columns.table.ts` / `job.model.ts` shapes; lift, don't reinvent. Only after discovery + spec + plan are confirmed does implementation start.
