# Precomputed polygon dissolve (low-zoom choropleths) — Spec

Pins the contract for #472. Discovery: `docs/PRECOMPUTED_POLYGON_DISSOLVE.discovery.md`. Issue: [#472](https://github.com/EnterpriseBT/portal-ai/issues/472) (was epic #470; per-tile dissolve #475 reverted). Branch: `fix/precomputed-polygon-dissolve`.

**What ships:** a low-zoom polygon **choropleth** renders as real, colored polygons — not centroid bins — served from a **sync-time precomputed, per-zoom-simplified, dissolved-by-colorBy geometry**, with a **raw-simplified real-polygon fallback** whenever no precompute exists (so the visible bug is fixed even before the first precompute lands).

## Key decisions (confirm before implementation)

1. **D1 — precompute every categorical column ≤ ceiling, discovered at sync** (no author-time coupling). Ceiling `DISSOLVE_CARDINALITY_CEILING = 64`.
2. **D2 — a dedicated `dissolve_precompute` job**, enqueued on `connector_sync` success, run under `SyncLockService.withInstanceLock`; failure non-fatal (`dissolveDegraded`).
3. **D3 — static `map_dissolve_geometries` table**, keyed `(organizationId, connectorEntityId, columnName, value, zoomBand)`.
4. **D4 — 3 fixed zoom bands below the z14 raw handoff**, each with a simplify tolerance.
5. **D5 — `AggTreatment` gains `"dissolve"`**; `resolveAggTreatment(kind, treatment?, { hasColorBy })` routes `polygons + colorBy → "dissolve"`, else unchanged. Serve clips precompute on hit, **raw-simplify on miss** — polygons never render as centroid bins again.
6. **D6 (⚠ confirm) — the map→entity link.** The serve path must resolve `connectorEntityId` + colorBy column to find the precompute, but `VizPipeline` carries no entity id and view names are the entity `key`. **Lean: add optional `connectorEntityId` to `MapGeometrySourceSchema`** — the map tool sets it, serve reads it, maps authored before this fall back to raw-simplify. Alternative (no author-path change): match the pipeline's `FROM` against the station's known entity keys. Flagged because it decides whether this ticket touches the map-authoring path.

## Scope

### In scope
- `map_dissolve_geometries` table (dual-schema) + migration + type-checks.
- `AggTreatment` `"dissolve"` + `resolveAggTreatment` signature change (shared server/client).
- `connectorEntityId` on the geo layer source + the map tool setting it (D6 lean).
- `dissolve_precompute` job type (metadata/result schemas + JOB_TYPE_SCHEMAS entry), processor, and its enqueue on sync success.
- The precompute SQL (subdivide → two-phase union → simplify per value/band), under the instance lock.
- Tile serve branch (clip precompute) + raw-simplify fallback; wire `connectorEntityId` through `resolvePipeline`/`TileAggregation`.
- Client paint: polygons below threshold render real geometry with `resolveColorBy`, not the bin fill.
- Backfill fan-out for existing geometry entities.

### Out of scope
- Numeric/`step`/`interpolate` colorBy low-zoom dissolve (no discrete value) — falls back to raw-simplify (Open Q2).
- Change-detection skip of needless recompute (Open Q5) — recompute runs every sync.
- Offline vector-tile pyramids (tippecanoe) — separate infra track.
- Line/point low-zoom treatment — unchanged (`none` / `bins`).

## Surface

### 1. `map_dissolve_geometries` table

**File: `apps/api/src/db/schema/map-dissolve-geometries.table.ts`** (new) — static, mirrors `wide-table-columns.table.ts`. The `geometry` column is added by DDL after `pgTable` (Drizzle has no PostGIS type), following how `WideTableReconcilerService` emits `geometry(Geometry,4326)` + GiST.

```ts
export const mapDissolveGeometries = pgTable(
  "map_dissolve_geometries",
  {
    ...baseColumns,
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    connectorEntityId: text("connector_entity_id").notNull().references(() => connectorEntities.id),
    columnName: text("column_name").notNull(),      // the wide-table colorBy column, e.g. c_own_type
    value: text("value").notNull(),                 // one categorical value (text-cast)
    zoomBand: integer("zoom_band").notNull(),       // 0|1|2 — index into DISSOLVE_ZOOM_BANDS
    // geom geometry(MultiPolygon,4326) — added by migration DDL, not Drizzle
    featureCount: integer("feature_count").notNull(), // source polygons dissolved (audit)
  },
  (t) => [
    uniqueIndex("map_dissolve_geometries_key_unique")
      .on(t.connectorEntityId, t.columnName, t.value, t.zoomBand)
      .where(sql`deleted IS NULL`),
    index("map_dissolve_geometries_entity_idx").on(t.connectorEntityId),
    // + GiST on geom, created in the migration DDL
  ]
);
```

- Core Zod model `packages/core/src/models/map-dissolve-geometry.model.ts` (mirrors an existing `*.model.ts`); the `geom` value is GeoJSON (`z.record`/`z.unknown`) at the model boundary — the geometry column is not round-tripped through drizzle-zod (as `er__` geometry isn't). drizzle-zod select/insert in `zod.ts` **omit** `geom` (same treatment the wide-table geometry column gets); type-checks assert the non-geometry columns bidirectionally.
- FK `ON DELETE CASCADE` from `connectorEntities` so dropping an entity purges its dissolve rows.

### 2. `AggTreatment` + `resolveAggTreatment`

**File: `packages/core/src/contracts/map-spec.contract.ts`**

```ts
// :120
treatment: z.enum(["bins", "none", "dissolve"]).optional(),

// :157 — signature gains colorBy awareness; dissolve needs a category to group on
export function resolveAggTreatment(
  kind: MapLayerKind,
  treatment?: AggTreatment,
  opts?: { hasColorBy?: boolean }
): AggTreatment {
  if (treatment) return treatment;
  if (kind === "lines") return "none";
  if (kind === "polygons" && opts?.hasColorBy) return "dissolve";
  return "bins";
}
```

Both callers already have colorBy in hand: server `aggregationFromSpec` (`portal-map-tile.service.ts:203`) passes `{ hasColorBy: colorByColumn != null }`; client `layerToMapLibre` (`map-config.util.ts:495`) passes `{ hasColorBy: !!style.colorBy }`. `AGG_ZOOM_THRESHOLD` stays the band boundary (z14).

### 3. `connectorEntityId` on the geo source (D6 lean)

**File: `packages/core/src/contracts/map-spec.contract.ts`** — extend `MapGeometrySourceSchema` (`:36`):

```ts
z.object({ geometryColumn: z.string().min(1), connectorEntityId: z.string().optional() }),
```

Optional so existing specs still parse (they fall back to raw-simplify). The map-authoring tool sets it when it resolves the layer's entity. **File to update:** the geo/map tool that builds the `MapSpec` (`apps/api/src/tools/*map*.tool.ts`) — resolve the source entity's id onto the layer source. (If confirm on D6 goes the other way, this section is replaced by an entity-key-match helper in `portal-map-tile.service.ts` and the tool is untouched.)

### 4. Zoom bands (constants)

**File: `packages/core/src/constants/*` (alongside `AGG_ZOOM_THRESHOLD`)**

```ts
// [minZoomInclusive, simplifyToleranceDegrees] — bands below the z14 raw handoff
export const DISSOLVE_ZOOM_BANDS = [
  { band: 0, maxZoomExclusive: 8,  tolerance: /* ~z6 px */ },
  { band: 1, maxZoomExclusive: 11, tolerance: /* ~z9 px */ },
  { band: 2, maxZoomExclusive: 14, tolerance: /* ~z12 px */ },
] as const;
export const DISSOLVE_CARDINALITY_CEILING = 64;
```

Tolerances reuse the `tileSimplifyTolerance(z)` formula (`portal-map-tile.service.ts:245`) at each band's representative zoom.

### 5. `dissolve_precompute` job

**File: `packages/core/src/models/job.model.ts`** — new type + schemas + registry entries (`JobTypeEnum:39`, `JobTypeMap:510`, `JOB_TYPE_SCHEMAS:543`):

```ts
// JobTypeEnum: add "dissolve_precompute"
export const DissolvePrecomputeMetadataSchema = z.object({
  connectorInstanceId: z.string(),   // the entity the job locks (via its instance)
  organizationId: z.string(),
  connectorEntityId: z.string(),
});
export const DissolvePrecomputeResultSchema = z.object({
  columnsProcessed: z.number().int().nonnegative(),
  valuesDissolved: z.number().int().nonnegative(),
  rowsWritten: z.number().int().nonnegative(),
  skippedHighCardinality: z.array(z.string()),   // columns over the ceiling
  degraded: z.literal(true).optional(),          // a column/band failed; non-fatal
});
```

The metadata's JSDoc declares it **locks `connectorInstanceId`** (per the async-job locking rules in CLAUDE.md).

**File: `packages/core/src/models/job.model.ts`** — add `dissolveDegraded: z.literal(true).optional()` to `ConnectorSyncResultSchema` (mirror of `mirrorDegraded:123`) for when the *enqueue* of the follow-up fails (best-effort).

### 6. Precompute processor

**File: `apps/api/src/queues/processors/dissolve-precompute.processor.ts`** (new). Runs under `SyncLockService.withInstanceLock(connectorInstanceId, …)` (returns `superseded` if not acquired — same shape as connector-sync). For the entity's `er__<id>` table:

1. Resolve the geometry column + candidate categorical columns from `wide_table_columns` (`pgType = 'text'`); for each, `SELECT count(DISTINCT c_col)` — keep those ≤ `DISSOLVE_CARDINALITY_CEILING`, record the rest in `skippedHighCardinality`.
2. Per kept column × zoom band, dissolve **bounded** (the shape that must not repeat #475's >90s):

```sql
-- two-phase, subdivided union → simplify, per (value, band)
WITH parts AS (
  SELECT c_col AS value, ST_Subdivide(c_geometry, 256) AS g
  FROM "er__<id>" WHERE deleted IS NULL AND c_geometry IS NOT NULL
),
gridded AS (   -- phase 1: union within a coarse grid bucket (bounds each union)
  SELECT value, ST_SnapToGrid(ST_Centroid(g), <cell>) AS bucket, ST_Union(g) AS g
  FROM parts GROUP BY value, bucket
)
SELECT value,
       ST_Multi(ST_CollectionExtract(
         ST_SimplifyPreserveTopology(ST_Union(g), <band tolerance>), 3)) AS geom
FROM gridded GROUP BY value;   -- phase 2: union the bucket unions
```

3. Replace the entity's rows for the processed columns **transactionally** (delete-then-insert within one tx → readers never see a half-built dimension), writing `geom` via `ST_MakeValid(ST_SetSRID(…,4326))` and `featureCount`.
4. Run with a **job-level `statement_timeout`** far above the tile budget (a constant, e.g. `DISSOLVE_STATEMENT_TIMEOUT_MS`), since this is off-request. A per-column/band failure is caught, flags `degraded`, and does not abort the rest.

**Enqueue:** in `apps/api/src/queues/processors/connector-sync.processor.ts` after a successful non-superseded sync (`return result`), enqueue one `dissolve_precompute` job per geometry-bearing entity of the instance (best-effort — a failed enqueue sets `dissolveDegraded` on the sync result, never throws). Registered in `jobs.worker.ts`'s dispatch.

### 7. Tile serve branch + fallback

**File: `apps/api/src/services/portal-map-tile.service.ts`**

- `TileAggregation` (`:168`) gains `treatment: AggTreatment` and `connectorEntityId: string | null` (resolved per D6). `aggregationFromSpec` populates them.
- `resolvePipeline` (`:253`) returns `connectorEntityId` (from the layer source, D6 lean).
- `defaultRunTileQuery` (`:405`): when `treatment === "dissolve" && z < zoomThreshold`:
  - **Hit** (`connectorEntityId` + `colorByColumn` known, ≥1 `map_dissolve_geometries` row for the band): `ST_AsMVT(ST_AsMVTGeom(ST_Transform(geom,3857), envelope, …))` over the stored rows filtered `geom && envelope`, emitting `value AS <colorByColumn>` so the client `["get", col]` colorBy matches. No `pipeline.sql` run.
  - **Miss** (no rows / no entity id / non-categorical): `buildRawTileSql` with the band tolerance — real simplified polygons. Sets the `X-Portal-Tile-Simplified` degradation header (#449).
- Band selection: map `z` → `DISSOLVE_ZOOM_BANDS[].band`.
- Never `buildAggregateTileSql` for a polygon dissolve layer.

### 8. Client paint

**File: `apps/web/src/modules/MapWidget/utils/map-config.util.ts`** — `layerToMapLibre` (`:494`). For `treatment === "dissolve"` (tiled): set raw layers `minzoom = threshold` and push a `-agg` **fill of real geometry** painted with the `resolveColorBy` expression (`:504` branch), **not** the density ramp and **not** a centroid layer. The tile source already yields the colorBy column as a feature property (§7), so `resolveColorBy` keyed on `["get", col]` colors it. The `"bins"` branch is unchanged for points.

## Migration

`cd apps/api && npm run db:generate -- --name add_map_dissolve_geometries`. Hand-add to the generated SQL (Drizzle can't emit PostGIS): `ALTER TABLE map_dissolve_geometries ADD COLUMN geom geometry(MultiPolygon,4326);` + `CREATE INDEX … USING GIST (geom);`. No backfill in the migration — existing entities are backfilled by the fan-out job (§ below), not DDL. No production data at risk (project memory).

## Seed

None — the table is populated by the precompute job, not seeded.

## Backfill

**File: `apps/api/src/services/dissolve-precompute-resync.service.ts`** (new, mirrors `wide-table-resync.service.ts`) — enqueue one `dissolve_precompute` job per existing geometry-bearing connector entity, so already-synced layers get precompute without a re-sync. Triggered once (admin/CLI or a one-shot on deploy).

## TDD test plan

Run via npm scripts (`feedback_use_npm_test_scripts`): `cd packages/core && npm run test:unit`; `cd apps/api && npm run test:unit && npm run test:integration`; `cd apps/web && npm run test:unit`.

### Layer 1 — core contract (`packages/core`)
1. `AggTreatment` accepts `"dissolve"`; `MapLayerAggregationSchema` round-trips it.
2. `resolveAggTreatment`: polygons + `hasColorBy` → `"dissolve"`; polygons without colorBy → `"bins"`; lines → `"none"`; explicit treatment always wins.
3. `MapGeometrySourceSchema` accepts an optional `connectorEntityId`; a spec without it still parses (fallback path).
4. `DissolvePrecomputeMetadataSchema`/`ResultSchema` parse; `JOB_TYPE_SCHEMAS.dissolve_precompute` present (registry completeness compile check).
5. `ConnectorSyncResultSchema` accepts `dissolveDegraded: true`.
6. `MapDissolveGeometry` model round-trips (non-geom fields).

### Layer 2 — DB / type-checks (integration)
7. `map_dissolve_geometries` insert + the geometry DDL: a GeoJSON MultiPolygon round-trips in→out via `ST_GeomFromGeoJSON`/`ST_AsGeoJSON`; GiST index present; a spatial `&&` predicate is index-usable (mirrors `wide-table-geometry.integration.test.ts`).
8. Unique key `(connectorEntityId, columnName, value, zoomBand)` rejects a duplicate live row.
9. FK `ON DELETE CASCADE`: deleting the connector entity purges its rows.
10. Dual-schema guards compile (`type-check`); a deliberate mismatch fails.

### Layer 3 — precompute processor (integration, real PostGIS)
11. Given an `er__` table with a categorical column (3 values) over overlapping polygons, the processor writes one MultiPolygon per (value, band); `featureCount` = source count; **`ST_IsValid`** on every stored geom.
12. The two-phase union output equals a single `ST_Union` (same dissolved area within tolerance) — correctness, not plan.
13. A column over `DISSOLVE_CARDINALITY_CEILING` is skipped and listed in `skippedHighCardinality`.
14. Recompute replaces prior rows transactionally (a second run yields the same row count, not doubled; no window with zero rows — assert via a concurrent read or a post-count).
15. Not acquiring the instance lock → `superseded`, no writes.
16. A forced per-band failure sets `degraded`, still writes the other bands.

### Layer 4 — tile serve (integration)
17. Dissolve hit: a low-zoom tile for a precomputed (entity, column) returns MVT features carrying the colorBy value as a property, sourced from `map_dissolve_geometries` (assert the pipeline SQL was *not* the source — e.g. drop/rename the underlying view and still get a tile).
18. Dissolve miss (no precompute rows): falls back to `buildRawTileSql` (real polygons, simplified) + sets `X-Portal-Tile-Simplified`; **never** centroid bins.
19. `z ≥ zoomThreshold` still uses the raw path (unchanged).
20. Band selection maps representative zooms to the right `zoomBand`.

### Layer 5 — client (`apps/web`)
21. `layerToMapLibre` for a tiled polygon dissolve layer emits a `-agg` **fill** using the colorBy expression (not the density ramp, no centroid layer) and gates the raw layer at `minzoom = threshold`.
22. A tiled polygon layer *without* colorBy still uses `"bins"` (unchanged).
23. Points with aggregation still use `"bins"`.

### Layer 6 — enqueue + backfill
24. A successful `connector_sync` enqueues one `dissolve_precompute` per geometry entity (spy on the queue); a failed enqueue sets `dissolveDegraded`, sync still `completed`.
25. `dissolve-precompute-resync` enqueues one job per existing geometry entity.

**Totals ≈ 25 cases** (6 core, 4 db, 6 processor, 4 serve, 3 web, 2 enqueue/backfill).

## Acceptance criteria

- [ ] A polygon choropleth below z14 renders as **real colored polygons**, not centroid bins, in the dev app.
- [ ] With no precompute yet, the same map still renders real (simplified) polygons — never bins, never blank.
- [ ] After a sync, `map_dissolve_geometries` holds one valid MultiPolygon per (categorical column ≤ ceiling, value, band); every geom is `ST_IsValid`.
- [ ] The dissolve tile serve does **not** run the layer pipeline SQL (served from stored geometry); a low-zoom tile returns within the tile budget on the ~400K parcel layer.
- [ ] Precompute runs off the request path, under the instance advisory lock, and never races or blocks a live sync; failure is non-fatal and flagged.
- [ ] Recompute on each sync keeps geometry current; readers never see a half-built dimension.
- [ ] `npm run lint && npm run type-check` clean; all suites green.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| **Bounded union still too slow** on ~400K polygons (the #475 failure, off-request). | Two-phase subdivided/grid union + off-request `statement_timeout`; **measure against the real parcel layer before finalizing the SQL** (Open Q3 / the plan's slice-2 gate). If still too slow, coarsen the grid / raise subdivide count / simplify-before-union at high bands. |
| D6 entity link wrong/missing → serve can't find precompute. | Miss falls back to raw-simplify (correct polygons); no blank/incorrect map. Confirm D6 direction first. |
| Precompute storage growth. | Bounded by ceiling × values × 3 bands × geometry cols; high-cardinality excluded by construction. |
| Stale precompute between syncs. | Recompute every sync (Open Q5 accepts the cost; change-detection is a later optimization). |
| Half-built dimension visible mid-recompute. | Delete-then-insert per entity in one transaction. |

**Rollback:** revert the migration (drop table) + `git revert`; serve falls back to raw-simplify with the treatment change reverted → prior behavior. Data-lossless (derived data only).

## Files touched

**`packages/core`** — new: `models/map-dissolve-geometry.model.ts`; edit: `contracts/map-spec.contract.ts` (treatment enum, `resolveAggTreatment`, source `connectorEntityId`), `models/job.model.ts` (job type + schemas + `dissolveDegraded`), `constants/*` (bands + ceiling), `models/index.ts`. New tests under `__tests__`.

**`apps/api`** — new: `db/schema/map-dissolve-geometries.table.ts`, `queues/processors/dissolve-precompute.processor.ts`, `services/dissolve-precompute-resync.service.ts`, the migration, integration tests; edit: `db/schema/zod.ts`, `type-checks.ts`, `db/schema/index.ts`, `services/portal-map-tile.service.ts` (`TileAggregation`, `aggregationFromSpec`, `resolvePipeline`, `defaultRunTileQuery`), `queues/processors/connector-sync.processor.ts` (enqueue), `queues/jobs.worker.ts` (dispatch), the map tool (D6 lean).

**`apps/web`** — edit: `modules/MapWidget/utils/map-config.util.ts` (dissolve paint) + its test.

No new dependency; no env change (new tuning constants only).

## Next step

`docs/PRECOMPUTED_POLYGON_DISSOLVE.plan.md` — 4 TDD slices: (1) contract + table + migration + type-checks + constants (green: schema/model tests); (2) precompute processor + union SQL under the lock + **the union measurement gate** (green: processor integration tests); (3) tile serve branch + fallback + client paint (green: serve + web tests); (4) enqueue on sync + backfill fan-out (green: enqueue tests). Each a compilable, green-tested commit on `fix/precomputed-polygon-dissolve`. Slices 1–2 are the risk; if the union measurement fails, we revisit the SQL before serve/client work.
