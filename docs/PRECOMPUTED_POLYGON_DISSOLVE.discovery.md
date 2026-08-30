# Precomputed polygon dissolve (low-zoom choropleths) — Discovery

**Issue:** [EnterpriseBT/portal-ai#472](https://github.com/EnterpriseBT/portal-ai/issues/472)

**Why this exists.** A polygon **choropleth** — a polygon layer with a categorical `colorBy` (parcels by `owner_type`, by `zip`) — does not render as polygons below zoom 14. It degrades to 24px centroid **bins** (`buildAggregateTileSql`), so the overview map is *wrong*, not merely slow. #450 made the tiles fast; this is the separate contract/correctness problem #337 introduced by routing every non-line kind to `"bins"`.

The obvious fix — dissolve polygons by `colorBy` value **per tile request** — was implemented (#475) and reverted from epic #470 after local smoke: `ST_Collect` keeps all ~400K parcels as one multipolygon (over the 10s budget, unrenderable) and `ST_Union` to truly merge is >90s. Dissolve cost grows with dataset size *on every one of six concurrent tile requests*. The only shape that scales is to move that cost **off the request path**: precompute a dissolved + per-zoom-simplified geometry once, store it, and serve low-zoom tiles by clipping the small stored geometry.

**Keyed by the pipeline, not the entity (revised).** A first pass keyed the precompute by `(connectorEntityId, column)` and ran it at connector-sync time. That only serves a choropleth that is a *plain projection of one entity's stored columns* — but the canonical choropleth is **boundaries ⨝ an aggregated metric** (color zip polygons by joined revenue), where the colorBy value isn't a stored column of the geometry entity and there is no single entity id. So the precompute is keyed by the **map's durable `pipeline`** and computed at **pin/refresh** — it dissolves whatever the pin's `SELECT` actually returns (any join/aggregation), stored per `(portalResultId, colorBy column, zoom band)`. This is the discovery for that precompute-and-serve path.

## The current shape

### Tile serving path (`apps/api`)

| Piece | Location | Role |
|---|---|---|
| Tile routes (message / pin) | `routes/portal-map.router.ts:104` (`handle`), `:65` (`sendTile` + degradation headers) | org-scoped, ref-addressed `/{z}/{x}/{y}` |
| Ref → pipeline resolver | `services/portal-map-tile.service.ts:253` (`resolvePipeline`) | ref → durable `VizPipeline.sql` + `propertyColumnsFromSpec` (`:147`) + `aggregationFromSpec` (`:187`) |
| Zoom handoff | `portal-map-tile.service.ts:228` (`shouldAggregate` = `enabled && z < zoomThreshold`) | picks aggregate vs raw |
| Query builders | `:362` `buildAggregateTileSql` (centroid `ST_SnapToGrid`/`ST_Centroid` bins) · `:317` `buildRawTileSql` (raw + `ST_SimplifyPreserveTopology`) | wrapped in a read-only txn with `SET LOCAL statement_timeout` (`:457`) |
| Error mapping | `:61` `mapTileError`/`unwrapPgError` → typed 504 | #449 |

A **serve-from-precompute** branch slots into `defaultRunTileQuery` (`:428`), parallel to the aggregate branch: when treatment is dissolve and `z < threshold`, `ST_AsMVT(ST_AsMVTGeom(<stored geom>, …))` clipping the stored geometry instead of `pipeline.sql`. It needs the colorBy column + `connectorEntityId` surfaced through `resolvePipeline`/`TileAggregation` (`:168`).

### Map-spec contract (`packages/core`)

`contracts/map-spec.contract.ts`: `MapLayerAggregationSchema:109`, `treatment: z.enum(["bins","none"])` `:120`, `AggTreatment` `:123`, `resolveAggTreatment(kind, treatment?)` `:157` (shared server+client default). `MapLayerStyleSchema.colorBy` `:75` carries `column`/`stops`/`scale` (`categorical`/`step`/`interpolate`). Dissolve is meaningful only for **categorical** colorBy (one multipolygon per discrete value); numeric/interpolate has no discrete value to group on.

### Client paint (`apps/web`)

`modules/MapWidget/utils/map-config.util.ts`, `layerToMapLibre:395`. Polygons emit `-fill` + `-outline` (`:434`); the low-zoom handoff (`:494`) sets raw layers `minzoom = threshold` (`:498`) and pushes a `-agg` centroid-bin fill `maxzoom = threshold` (`:499`). `resolveColorBy:234` compiles the `match`/`step`/`interpolate` fill + legend. For dissolve, the `-agg` fill paints stored real geometry with the **same** `resolveColorBy` expression keyed on `["get", col]`, not the density ramp.

### Sync / wide-table materialization + precompute prior art (`apps/api`)

| Piece | Location | Role |
|---|---|---|
| Sync job | `queues/processors/connector-sync.processor.ts:88` (`adapter.syncInstance` under `SyncLockService.withInstanceLock`) | terminal payload `ConnectorSyncResultSchema` (`packages/core/src/models/job.model.ts:99`) |
| Wide tables | `services/wide-table-reconciler.service.ts`, `db/repositories/wide-table.repository.ts:79` (`er__<connectorEntityId>`) | geometry stored `geometry(Geometry,4326)` + GiST (`:327`, `:544`), written via `ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON,4326))` (`:379`) |
| Maintenance queue | `queues/maintenance.queue.ts:64` (`registerMaintenanceSchedulers`), `maintenance.worker.ts` | idempotent `upsertJobScheduler`; batched processors `entity-record-retention-purge.processor.ts`, `ledger-retention-purge.processor.ts`; summary via `GET /api/admin/maintenance` |
| Instance advisory lock | `services/sync-lock.service.ts:63` (`withInstanceLock`, `pg_try_advisory_lock`) | reuse so precompute never races a live sync |
| Best-effort derived cascade | `wide-table.repository.ts` `markDeletedFromRecordsBestEffort` (#441/#456) | precedent: derived data kept in step at sync, non-fatal, degradation flagged (`mirrorDegraded`) |
| One-shot fan-out | `services/wide-table-resync.service.ts` | job-per-instance backfill trigger (for the migration/backfill of existing entities) |

### Storage (`apps/api` + `packages/core`)

Dual-schema: Zod model `packages/core/src/models/` → Drizzle table `apps/api/src/db/schema/` → `zod.ts` → `type-checks.ts` → migration `apps/api/drizzle/` (latest `0084_*`). Two naming models: **dynamic** per-entity `er__<id>` (unbounded, catalogued by the **static** `wide-table-columns.table.ts`) vs plain **static** tables. The reverted per-tile `buildDissolveTileSql` is recoverable at commit `09c3415a` (revert `0fdbf86e`); `ST_Subdivide` is used nowhere yet.

## The design space

### Decision 1 — What is precomputed, and keyed on what

The precompute must reproduce the map's **actual** result set, which is an arbitrary agent-authored `SELECT` (joins, `GROUP BY`, computed colorBy). It cannot be reconstructed from any single entity's stored columns.

| | A. Per-entity, at sync | B. Per-pipeline, at pin/refresh | C. Per-pipeline, lazy on first low-zoom tile |
|---|---|---|---|
| Multi-source / aggregated maps | **cannot serve** | serves (dissolves the pipeline output) | serves |
| Needs an entity→source link | yes (`connectorEntityId`) | no — keyed by `portalResultId` | no |
| Trigger | connector sync | pin create + refresh (reuses #371 path) | first low-zoom tile miss |
| Freshness | on sync | on refresh (explicit) | on tile fetch |
| Ephemeral (unpinned) maps | n/a | not covered (open at author zoom; raw-simplify) | covered |
| First-view correctness | correct once synced | **degraded until job lands** | **degraded until job lands** |

**Lean: B.** Key the precompute by the map's durable `pipeline`, materialize it per **pinned result** (`portalResultId`), computed at **pin and refresh**. It dissolves whatever the pin's `SELECT` returns — so the canonical *boundaries ⨝ aggregated-metric* choropleth works, with no `connectorEntityId` coupling. Pins are exactly where a low-zoom overview matters (dashboards) and already carry a durable, re-executable pipeline + a refresh trigger + a tile ref — the infrastructure #371 just built. Unpinned chat maps open at author zoom and use the raw-simplify fallback; adding lazy per-tile compute (C) for them is deferred.

### Decision 2 — When/how the precompute runs, and the union strategy

**Lean: a dedicated `dissolve_precompute` job, enqueued when a geo pin is created and on every pin refresh**, run under an advisory lock keyed on `portalResultId` (the same `pg_try_advisory_lock` mechanism as `SyncLockService`, different namespace) so two refreshes of one pin can't race. It runs the pin's `pipeline.sql` **once** (via `buildSessionViews`, like the tile path), then dissolves the result. Union strategy: **`ST_Subdivide` → two-phase grid `ST_Union` → `ST_SimplifyPreserveTopology` per (value, band)**, never a single `ST_Union` of 400K polygons — bounding each union's working set is exactly what the per-tile path failed to do. Off-request, so a generous job-level `statement_timeout`. Failure is **non-fatal**: the job flags `degraded`; serve falls back to raw-simplify.

### Decision 3 — Storage model

**Lean: a static table** `map_dissolve_geometries` — `(portalResultId, columnName, value, zoomBand) → geometry(MultiPolygon,4326)` + GiST index + unique natural key, `baseColumns`, FK to `portal_results` (`ON DELETE CASCADE`). Row count is bounded (values × bands per pinned choropleth). A recompute replaces the pin's rows transactionally (idempotent). No per-entity dynamic DDL; mirrors `wide-table-columns.table.ts`'s static shape.

### Decision 4 — Zoom bands & simplify tolerance

**Lean: a small fixed band set below the z14 raw handoff** — `[0–7], [8–10], [11–13]` — each with a coarser-to-finer `ST_SimplifyPreserveTopology` tolerance (from `tileSimplifyTolerance` at each band's representative zoom; constants in `map-spec` alongside `AGG_*`). z≥14 stays the raw path (#450 already fast there).

### Decision 5 — Contract + serve fallback

**Lean: add `"dissolve"` to `AggTreatment`; `resolveAggTreatment(kind, treatment?, { hasColorBy })` routes `polygons` + `colorBy` → `"dissolve"`.** The tile serve branch (pin refs only): precompute hit → clip the stored geometry, emitting the colorBy value as a feature property so `resolveColorBy` matches; miss (no rows yet / non-categorical / over ceiling / message-ref) → **`buildRawTileSql` with a band tolerance** — simplified *real polygons*, never centroid bins. The bug is fixed even before the first precompute lands; the client `-agg` fill paints real geometry with `resolveColorBy` in both cases.

## Tradeoff comparison

| | D1: per-pipeline @ pin/refresh | D2: pin-scoped job + bounded union | D3: static table keyed by pin | D4: 3 fixed bands | D5: dissolve treatment + raw-simplify fallback |
|---|---|---|---|---|---|
| Spread to spec | Yes (pin/refresh enqueue, ceiling) | Yes (job type, advisory lock, degraded flag) | Yes (table + migration + type-checks) | Yes (band constants + tolerances) | Yes (enum, resolver, serve branch, client paint) |

## Recommendation

1. Key the precompute by the map's durable **`pipeline`**, materialized **per pinned result** — it dissolves the pin's actual `SELECT` output, so joined/aggregated multi-source choropleths work; no `connectorEntityId` coupling.
2. Compute it in a dedicated **`dissolve_precompute` job**, enqueued on **geo-pin create and every pin refresh**, under an advisory lock on `portalResultId`; failure non-fatal + `degraded`.
3. Dissolve only when the pin's colorBy column has `COUNT(DISTINCT) ≤ DISSOLVE_CARDINALITY_CEILING` (categorical); otherwise leave it to the raw-simplify fallback.
4. Bound each union with **`ST_Subdivide` → two-phase grid `ST_Union` → simplify** per (value, band); never a whole-layer union; off-request `statement_timeout`.
5. Store in a **static `map_dissolve_geometries` table** keyed `(portalResultId, columnName, value, zoomBand)`, GiST-indexed, cascade-deleted with the pin; recompute replaces the pin's rows transactionally.
6. Three fixed **zoom bands** below z14, each with its own simplify tolerance.
7. Add **`"dissolve"`** to `AggTreatment`; polygon + colorBy routes to it. Serve (pin refs) clips stored geometry on hit, falls back to **raw-simplify** on miss — **centroid bins are never used for polygons again**.

## Open questions

1. **Ceiling value.** `DISSOLVE_CARDINALITY_CEILING = 64` (× 3 bands = 192 rows/pin) — a choropleth with >64 categories isn't legible. **Lean: 64, revisit if a real layer needs more.**
2. **Numeric/continuous colorBy at low zoom.** No discrete value to dissolve by. **Lean: out of scope — falls back to raw-simplify (correct polygons); a future "quantile-bin dissolve" is its own ticket. The `COUNT(DISTINCT) ≤ ceiling` gate naturally excludes it.**
3. **Unpinned (chat/message-ref) maps.** Not precomputed (ephemeral, no durable key, open at author zoom). **Lean: raw-simplify fallback for them; lazy per-tile compute (Decision 1C) is a deferred follow-up if low-zoom chat overviews become a need.**
4. **Split into two PRs (precompute-write vs serve-read)?** **Lean: one branch, sequenced slices; split only if context forces it (per CLAUDE.md).**
5. **Recompute on every refresh even when geometry didn't change.** **Lean: recompute unconditionally on refresh (correctness); a snapshot-version skip is a follow-up optimization, noted not built.** Pin create + refresh are infrequent, so needless recompute is bounded (unlike per-sync).
6. **Timing vs #371 tile-on-mount.** A freshly pinned large map already renders via tiles on mount (#371); those first low-zoom tiles raw-simplify until the dissolve job lands, then subsequent fetches/refresh serve stored geometry. **Lean: acceptable — correct-but-simpler immediately, dissolved shortly after; the freshness cue already exists.**

## Enterprise-scale considerations

- **Concurrency & correctness.** Precompute runs under an advisory lock on `portalResultId` (the `SyncLockService` mechanism, new namespace) so two refreshes can't race; the recompute replaces a pin's rows in one transaction → readers never see a half-built dimension.
- **Accuracy & auditability.** Derived data, not a record-of-truth (that stays `entity_records`/`er__` and the pin snapshot). The job result payload (values dissolved, rows written, degraded) is inspectable like other job results.
- **Failure modes.** **Fail-open on serve** — a missing/failed precompute degrades to raw-simplified real polygons (correct, slightly slower), never blank or wrong; the safety cost is latency. Precompute failure is non-fatal + flagged.
- **Scale & unbounded growth.** Storage bounded by ceiling × bands **per pinned choropleth** (pins are few and deliberate, unlike per-entity × all-columns); union bounded by `ST_Subdivide`. Non-categorical/over-ceiling columns excluded by the gate.
- **Multi-tenancy.** Rows are pin-scoped; `portal_results` carries `organizationId`, so org isolation rides the pin. The job is on the existing queue with its concurrency cap — can't starve request-path tiles (different path).
- **Contract stability.** The store key `(portalResultId, column, value, band)` is additive; a future lazy message-ref path (Open Q3) or numeric-quantile dissolve plugs in without re-keying. `AggTreatment` gains a value, not a reshape. **Crucially, keying by the pipeline (not an entity) is what makes arbitrary future query shapes — more joins, new aggregations — work with no re-plumbing.**
- **Data lifecycle.** Cascade-deleted with the pin; recompute on refresh keeps geometry current; lifecycle tracks the pin, not an arbitrary window.

## What this doesn't decide

- **Offline vector-tile pyramids (tippecanoe-style).** Gold standard for arbitrary scale, separate infra track; the in-DB per-pin precompute covers large enterprise choropleths and fits this stack.
- **Unpinned/chat map low-zoom dissolve** (lazy per-tile) — deferred (Open Q3); those use raw-simplify.
- **Numeric/continuous colorBy** (quantile-bin dissolve) — deferred (Open Q2).
- **Snapshot-version recompute skip** — a follow-up optimization (Open Q5).
- **Line-layer low-zoom** — already `"none"`, unchanged.

## Next step

Spec (`docs/PRECOMPUTED_POLYGON_DISSOLVE.spec.md`) pins: the `map_dissolve_geometries` table keyed by `portalResultId` (columns, indexes, FK, migration + type-checks), the `AggTreatment` enum + `resolveAggTreatment` change, the `dissolve_precompute` job type + schemas, the precompute SQL that runs the pin's pipeline once then subdivides→unions→simplifies per (value, band), the enqueue at pin-create + refresh under the advisory lock, the tile serve branch + raw-simplify fallback, and the client paint. Plan slices it: (1) contract + table + migration, (2) precompute job + union SQL under the lock (+ the measurement gate), (3) enqueue at pin/refresh, (4) tile serve branch + fallback + client paint — each a green-tested commit on `fix/precomputed-polygon-dissolve`.
