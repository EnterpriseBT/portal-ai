# Precomputed polygon dissolve (low-zoom choropleths) — Discovery

**Issue:** [EnterpriseBT/portal-ai#472](https://github.com/EnterpriseBT/portal-ai/issues/472)

**Why this exists.** A polygon **choropleth** — a polygon layer with a categorical `colorBy` (parcels by `owner_type`, by `zip`) — does not render as polygons below zoom 14. It degrades to 24px centroid **bins** (`buildAggregateTileSql`), so the overview map is *wrong*, not merely slow. #450 made the tiles fast; this is the separate contract/correctness problem #337 introduced by routing every non-line kind to `"bins"`.

The obvious fix — dissolve polygons by `colorBy` value **per tile request** — was implemented (#475) and reverted from epic #470 after local smoke: `ST_Collect` keeps all ~400K parcels as one multipolygon (over the 10s budget, unrenderable) and `ST_Union` to truly merge is >90s. Dissolve cost grows with dataset size *on every one of six concurrent tile requests*. The only shape that scales is to move that cost **off the request path**: precompute a dissolved + per-zoom-simplified geometry once at sync, store it, and serve low-zoom tiles by clipping the small stored geometry. This is the discovery for that precompute-and-serve path.

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

### Decision 1 — What is precomputed, and keyed on what (the colorBy-at-author-time problem)

`colorBy` is chosen when the map is authored, *after* sync. So sync can't know "the" dimension.

| | A. All categorical cols ≤ ceiling | B. Author-declared dimensions | C. On-demand, then cached | D. Per pinned-map spec |
|---|---|---|---|---|
| Author-time coupling | none — any qualifying col works | needs a declaration surface | none | only pinned maps |
| Wasted compute | some (unviewed cols) | minimal | none | minimal |
| First-view correctness | correct immediately | correct if declared | **degraded until built** | correct once pinned |
| Storage | bounded by ceiling × cols × bands | smallest | grows with use | small |

**Lean: A, bounded by a cardinality ceiling, with C as the miss fallback.** At sync, scan each geometry-layer entity's non-geometry columns; for every column whose `COUNT(DISTINCT)` ≤ `DISSOLVE_CARDINALITY_CEILING` (e.g. 64), precompute its dissolve. This decouples from author choice (any qualifying column the author later picks is ready) and bounds storage by construction. A colorBy on a column that wasn't precomputed (too high-cardinality, or numeric) never dissolves — it falls back to raw-simplify (Decision 5), never bins.

### Decision 2 — When/how the precompute runs, and the union strategy

| | A. Inline in `syncInstance` | B. Dedicated job after sync (own type) | C. Maintenance cron sweep |
|---|---|---|---|
| Sync latency | inflated | unaffected | unaffected |
| Retry independent of sync | no | yes | yes |
| Freshness | immediate | ~immediate (chained) | lagging |

**Lean: B — a dedicated `dissolve_precompute` job, enqueued on `connector_sync` success, run under `withInstanceLock(connectorInstanceId)`.** Keeps sync latency flat, retries on its own budget, and the lock guarantees it never races the next sync. Union strategy: **chunked `ST_Subdivide` → grid/gather `ST_Union` per (value, band)**, not a single `ST_Union` of 400K polygons — subdivide bounds each union's working set, which is precisely what made the per-tile path blow up. Failure is **non-fatal**: flag `dissolveDegraded` on the sync result (mirror of `mirrorDegraded`), serve falls back to raw-simplify.

### Decision 3 — Storage model

**Lean: a static table** `map_dissolve_geometries` — `(organizationId, connectorEntityId, columnName, value, zoomBand) → geometry(Geometry,4326)` + GiST index + unique natural key, `baseColumns`, FKs to `organizations`/`connectorEntities` (`ON DELETE CASCADE`). Row count is bounded (cols × distinct values × bands), unlike the per-entity `er__` mirror — so a static table (mirroring `wide-table-columns.table.ts`) fits, and no dynamic-DDL-per-entity is needed. A recompute replaces the entity's rows transactionally (idempotent).

### Decision 4 — Zoom bands & simplify tolerance

**Lean: a small fixed band set below the z14 raw handoff** — e.g. `[0–7], [8–10], [11–13]` — each with a coarser-to-finer `ST_SimplifyPreserveTopology` tolerance (constants in `map-spec` alongside `AGG_*`). Three bands keep storage ~3× per value while giving legible detail at each zoom; z≥14 stays the raw path (#450 already fast there).

### Decision 5 — Contract + serve fallback

**Lean: add `"dissolve"` to `AggTreatment`; `resolveAggTreatment` routes `polygons` (and `heatmap`? no — polygons only) with a **categorical** colorBy to `"dissolve"` by default.** The tile serve branch: precompute hit → clip stored geometry; miss (no precompute yet / non-categorical / high-cardinality) → **`buildRawTileSql` with a band tolerance**, i.e. simplified *real polygons*, never centroid bins. This makes the map correct even before the first precompute lands (fixing the visible bug immediately) and better once it lands (bounded, fast). The client `-agg` fill paints real geometry with `resolveColorBy` in both cases.

## Tradeoff comparison

| | D1: all-cats-≤-ceiling (+on-demand miss) | D2: dedicated post-sync job | D3: static table | D4: 3 fixed bands | D5: dissolve treatment + raw-simplify fallback |
|---|---|---|---|---|---|
| Spread to spec | Yes (ceiling, discovery scan) | Yes (job type, lock, degraded flag) | Yes (table + migration + type-checks) | Yes (band constants + tolerances) | Yes (enum, resolver, serve branch, client paint) |

## Recommendation

1. Precompute dissolved geometry for **every categorical column** on a geometry-layer entity whose distinct count ≤ `DISSOLVE_CARDINALITY_CEILING`, discovered by a sync-time scan — no author-time coupling.
2. Run it as a dedicated **`dissolve_precompute` job** enqueued on `connector_sync` success, under `SyncLockService.withInstanceLock`; failure is non-fatal and flagged `dissolveDegraded`.
3. Bound each union with **chunked `ST_Subdivide` → gather `ST_Union`** per (value, band); never a whole-layer union.
4. Store in a **static `map_dissolve_geometries` table** keyed `(org, connectorEntityId, columnName, value, zoomBand)`, GiST-indexed, cascade-deleted with the entity; recompute replaces the entity's rows transactionally.
5. Three fixed **zoom bands** below z14, each with its own simplify tolerance.
6. Add **`"dissolve"`** to `AggTreatment`; polygon + categorical colorBy defaults to it. Serve clips the stored geometry on hit and falls back to **raw-simplify** (real polygons) on miss — **centroid bins are never used for polygons again**.
7. Backfill existing entities via the `wide-table-resync.service.ts` fan-out pattern (one precompute job per geometry entity).

## Open questions

1. **Ceiling value.** 64 distinct values × 3 bands = 192 rows/column — comfortable. A choropleth with >64 categories is not legible anyway. **Lean: 64, a `map-spec` constant, revisit if a real layer needs more.**
2. **Numeric/`step` colorBy at low zoom.** Dissolve-by-value doesn't fit a continuous scale. **Lean: out of scope — numeric colorBy falls back to raw-simplify (correct polygons, no per-value merge). A future "quantile-bin dissolve" is its own ticket.**
3. **Does dissolve subsume #450's cause-2 (bound the work)?** The precompute reads the whole layer once per sync, not per request. **Lean: yes for the low-zoom polygon path; #450's join-drop already covers the raw path, so no further budget work here.**
4. **Split into two tickets (precompute-write vs serve-read)?** They share the contract + storage. **Lean: one branch, sequenced slices (contract+storage → precompute job → serve branch + client + fallback → backfill); split to a second PR only if context forces it (per CLAUDE.md).**
5. **Recompute trigger granularity.** Every sync recomputes all qualifying columns for the entity. A large layer synced often could recompute needlessly when geometry didn't change. **Lean: recompute unconditionally on sync for v-complete correctness; a change-detection skip (checksum of the layer's geometry+column) is a follow-up optimization, noted not built.**

## Enterprise-scale considerations

- **Concurrency & correctness.** Precompute runs under `withInstanceLock(connectorInstanceId)` — never races a live sync (the exact class of bug #460/#463 fixed for reap). Recompute replaces an entity's rows in one transaction → readers never see a half-built dimension.
- **Accuracy & auditability.** The store is derived, not a record-of-truth; the record-of-truth stays `entity_records`/`er__`. The job's summary payload (rows written per column/band, degraded flag) surfaces via `GET /api/admin/maintenance`, mirroring the retention purges.
- **Failure modes.** **Fail-open on serve** — a missing/failed precompute degrades to raw-simplified real polygons (correct, slightly slower), never a blank or wrong map; the safety cost is latency, not correctness. Precompute failure is non-fatal + flagged.
- **Scale & unbounded growth.** Storage bounded by the cardinality ceiling × bands × geometry columns; the union is bounded by `ST_Subdivide`. High-cardinality columns are excluded by construction (they'd neither dissolve well nor legibly render).
- **Multi-tenancy.** Per-org, per-entity rows (`organizationId` scope + FK). The precompute is a background job on the existing queue with its concurrency cap — a large tenant's precompute can't starve request-path tiles (different path entirely).
- **Contract stability.** The store key `(org, entity, column, value, band)` is additive; a future "declared choropleth dimension" (Decision 1B) or numeric-quantile dissolve plugs in without re-keying. `AggTreatment` gains a value, not a reshape.
- **Data lifecycle.** Rows are cascade-deleted with the connector entity; recompute on each sync keeps geometry current; no arbitrary technical window — lifecycle tracks the entity and the sync cadence.

## What this doesn't decide

- **Offline vector-tile pyramids (tippecanoe-style).** The gold standard for truly arbitrary scale, but a separate infra track; the in-DB precompute covers large enterprise layers and fits this stack.
- **Numeric/interpolate colorBy low-zoom treatment** (quantile-bin dissolve) — deferred (Open Q2).
- **Change-detection skip** to avoid needless recompute — a follow-up optimization (Open Q5).
- **Line-layer low-zoom** — already `"none"` (importance-ranked raw), unchanged.

## Next step

Spec (`docs/PRECOMPUTED_POLYGON_DISSOLVE.spec.md`) pins: the `map_dissolve_geometries` table (columns, indexes, FKs, migration + type-checks), the `AggTreatment` enum + `resolveAggTreatment` change, the `dissolve_precompute` job type + metadata/result schemas, the precompute SQL (subdivide→union→simplify per value/band), the tile serve branch + raw-simplify fallback, and the client paint. Plan (`docs/PRECOMPUTED_POLYGON_DISSOLVE.plan.md`) slices it: (1) contract + storage table + migration, (2) precompute job + union SQL under the lock, (3) tile serve branch + fallback + client paint, (4) backfill fan-out — each a green-tested commit on `fix/precomputed-polygon-dissolve`.
