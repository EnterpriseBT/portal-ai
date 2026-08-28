# Precomputed polygon dissolve (low-zoom choropleths) — Spec

Pins the contract for #472. Discovery: `docs/PRECOMPUTED_POLYGON_DISSOLVE.discovery.md`. Issue: [#472](https://github.com/EnterpriseBT/portal-ai/issues/472) (was epic #470; per-tile dissolve #475 reverted). Branch: `fix/precomputed-polygon-dissolve`.

**What ships:** a low-zoom polygon **choropleth** renders as real, colored polygons — not centroid bins — served from a **per-pin precomputed, per-zoom-simplified, dissolved-by-colorBy geometry**, computed from the pin's durable `pipeline` at **pin create + refresh** (so joined/aggregated multi-source choropleths work), with a **raw-simplified real-polygon fallback** whenever no precompute exists (so the bug is fixed even before the first precompute lands, and for unpinned maps).

## Key decisions (ratified from discovery)

1. **D1 — keyed by the pipeline, materialized per pinned result** (`portalResultId`), not per entity. Dissolves the pin's actual `SELECT` output → multi-source/aggregated choropleths work; no `connectorEntityId` coupling.
2. **D2 — a `dissolve_precompute` job**, enqueued on geo-pin **create** and every **refresh**, under an advisory lock on `portalResultId`; runs the pin's `pipeline.sql` once; failure non-fatal (`degraded`).
3. **D3 — static `map_dissolve_geometries` table**, keyed `(portalResultId, columnName, value, zoomBand)`, FK → `portal_results` `ON DELETE CASCADE`.
4. **D4 — 3 fixed zoom bands below z14**, each a simplify tolerance.
5. **D5 — `AggTreatment` gains `"dissolve"`**; `resolveAggTreatment(kind, treatment?, { hasColorBy })` routes `polygons + colorBy → "dissolve"`. Serve (pin refs) clips precompute on hit, **raw-simplify on miss**; polygons never render as centroid bins again.
6. **Dissolve only for categorical colorBy** — gated by `COUNT(DISTINCT) ≤ DISSOLVE_CARDINALITY_CEILING` (64); numeric/continuous falls back to raw-simplify.

## Scope

### In scope
- `map_dissolve_geometries` table (dual-schema) + migration + type-checks.
- `AggTreatment` `"dissolve"` + `resolveAggTreatment` signature change (shared server/client).
- `dissolve_precompute` job type (metadata/result schemas + `JOB_TYPE_SCHEMAS` entry), processor, advisory lock on `portalResultId`.
- Precompute SQL: run the pin's `pipeline.sql` once → subdivide → two-phase union → simplify per (value, band).
- Enqueue at pin **create** (`POST /api/portal-results`) and **refresh** (`POST /api/portal-results/:id/refresh`), best-effort.
- Tile serve branch for **pin refs** (clip precompute) + raw-simplify fallback; `TileAggregation.treatment`.
- Client paint: polygons below threshold render real geometry with `resolveColorBy`, not the bin fill.

### Out of scope
- Numeric/continuous colorBy low-zoom dissolve (Open Q2) — raw-simplify fallback.
- Unpinned/message-ref low-zoom dissolve (Open Q3) — raw-simplify fallback; no lazy per-tile compute.
- Snapshot-version recompute skip (Open Q5) — recompute on every refresh.
- Offline tile pyramids; line/point low-zoom treatment (unchanged).

## Surface

### 1. `map_dissolve_geometries` table

**File: `apps/api/src/db/schema/map-dissolve-geometries.table.ts`** (new) — static, mirrors `wide-table-columns.table.ts`. The `geom` column is added by migration DDL (Drizzle has no PostGIS type), following how `WideTableReconcilerService` emits `geometry(…,4326)` + GiST.

```ts
export const mapDissolveGeometries = pgTable(
  "map_dissolve_geometries",
  {
    ...baseColumns,
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    portalResultId: text("portal_result_id").notNull().references(() => portalResults.id, { onDelete: "cascade" }),
    columnName: text("column_name").notNull(),   // the pin's colorBy column, e.g. c_own_type
    value: text("value").notNull(),              // one categorical value (text-cast)
    zoomBand: integer("zoom_band").notNull(),    // 0|1|2 — index into DISSOLVE_ZOOM_BANDS
    featureCount: integer("feature_count").notNull(), // source polygons dissolved (audit)
    // geom geometry(MultiPolygon,4326) — added by migration DDL, not Drizzle
  },
  (t) => [
    uniqueIndex("map_dissolve_geometries_key_unique")
      .on(t.portalResultId, t.columnName, t.value, t.zoomBand)
      .where(sql`deleted IS NULL`),
    index("map_dissolve_geometries_pin_idx").on(t.portalResultId),
    // + GiST on geom, created in the migration DDL
  ]
);
```

- Core Zod model `packages/core/src/models/map-dissolve-geometry.model.ts`; drizzle-zod select/insert in `zod.ts` **omit** `geom` (same treatment the wide-table geometry column gets — it is not round-tripped through drizzle-zod). Type-checks assert the non-`geom` columns bidirectionally.
- FK `ON DELETE CASCADE` from `portal_results` so unpinning purges its dissolve rows.

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

Both callers already have colorBy in hand: server `aggregationFromSpec` (`portal-map-tile.service.ts:203`) passes `{ hasColorBy: colorByColumn != null }`; client `layerToMapLibre` (`map-config.util.ts:495`) passes `{ hasColorBy: !!style.colorBy }`. `AGG_ZOOM_THRESHOLD` (z14) stays the band boundary. **No change to `MapGeometrySourceSchema`** — the serve path uses the pin ref, not an entity id on the source.

### 3. Zoom bands + ceiling (constants)

**File: `packages/core/src/constants/*` (alongside `AGG_ZOOM_THRESHOLD`)**

```ts
export const DISSOLVE_ZOOM_BANDS = [
  { band: 0, maxZoomExclusive: 8,  representativeZoom: 6 },
  { band: 1, maxZoomExclusive: 11, representativeZoom: 9 },
  { band: 2, maxZoomExclusive: 14, representativeZoom: 12 },
] as const;
export const DISSOLVE_CARDINALITY_CEILING = 64;
```

Tolerance per band = `tileSimplifyTolerance(representativeZoom)` (`portal-map-tile.service.ts:245`). `bandForZoom(z)` helper maps a zoom to its band (or null at z≥14).

### 4. `dissolve_precompute` job

**File: `packages/core/src/models/job.model.ts`** — new type + schemas + registry entries (`JobTypeEnum:39`, `JobTypeMap:510`, `JOB_TYPE_SCHEMAS:543`):

```ts
// JobTypeEnum: add "dissolve_precompute"
/** dissolve_precompute — off-request dissolve of a pinned map's polygon
 *  choropleth. Locks `portalResultId` (advisory) so two refreshes can't race. */
export const DissolvePrecomputeMetadataSchema = z.object({
  portalResultId: z.string(),
  organizationId: z.string(),
});
export const DissolvePrecomputeResultSchema = z.object({
  columnName: z.string().nullable(),          // null ⇒ nothing to dissolve (non-categorical/over ceiling)
  valuesDissolved: z.number().int().nonnegative(),
  rowsWritten: z.number().int().nonnegative(),
  skipped: z.enum(["over-cardinality", "non-polygon", "no-colorby", "none"]).optional(),
  degraded: z.literal(true).optional(),       // a band failed; non-fatal
});
```

### 5. Precompute processor

**File: `apps/api/src/queues/processors/dissolve-precompute.processor.ts`** (new). Under an advisory lock on `portalResultId` (reuse `SyncLockService`'s `pg_try_advisory_lock` pattern with a new namespace constant — factor a `withAdvisoryLock(namespace, key, fn)` if clean; returns `superseded`-style no-op if not acquired):

1. Load the `portal_results` row; parse `content.spec`. If not a polygon layer with a `colorBy`, return `{ skipped: "non-polygon" | "no-colorby" }`.
2. Resolve `pipeline` (`content.pipeline`) + the colorBy column. Build session views (`PortalSqlService.buildSessionViews(pipeline.stationId, organizationId)`), then in a read-only tx run `SELECT count(DISTINCT <colorBy>) FROM (<pipeline.sql>) src WHERE geom IS NOT NULL`. If `> DISSOLVE_CARDINALITY_CEILING`, return `{ skipped: "over-cardinality" }`.
3. Per zoom band, dissolve **bounded** (the shape that must not repeat #475's >90s):

```sql
WITH src AS (<pipeline.sql>),                         -- join/aggregation runs ONCE
parts AS (
  SELECT (<colorBy>)::text AS value, ST_Subdivide(geom, 256) AS g
  FROM src WHERE geom IS NOT NULL
),
gridded AS (   -- phase 1: union within a coarse grid bucket (bounds each union)
  SELECT value, ST_SnapToGrid(ST_Centroid(g), <cell>) AS bucket, ST_Union(g) AS g
  FROM parts GROUP BY value, bucket
)
SELECT value,
       ST_Multi(ST_CollectionExtract(
         ST_SimplifyPreserveTopology(ST_Union(g), <band tolerance>), 3)) AS geom,
       count(*) AS feature_count
FROM gridded GROUP BY value;
```

4. **Replace** the pin's rows transactionally (delete `WHERE portal_result_id = $1` then insert the new band rows in one tx → readers never see a half-built dimension), writing `geom` via `ST_GeomFromGeoJSON`/`ST_Multi` (or directly from the SQL above) + `ST_MakeValid(ST_SetSRID(…,4326))`.
5. Off-request `statement_timeout` (`DISSOLVE_STATEMENT_TIMEOUT_MS`, a large constant). A per-band failure is caught → `degraded`, other bands still written.

**Registered** in `jobs.worker.ts` dispatch.

### 6. Enqueue at pin create + refresh

- **`apps/api/src/routes/portal-results.router.ts`** `POST /` (after the `portalResults.create`, before the 201): if the pinned block is a geo polygon-with-colorBy, enqueue one `dissolve_precompute` job for the new `portalResult.id`. Best-effort — a failed enqueue is logged, never fails the pin.
- **`apps/api/src/routes/portal-results.router.ts`** `POST /:id/refresh` (after the refresh persists the fresh snapshot): re-enqueue for the same `portalResultId` (recompute over the refreshed data).

No change to `connector-sync.processor.ts` — the precompute is decoupled from connector sync.

### 7. Tile serve branch + fallback

**File: `apps/api/src/services/portal-map-tile.service.ts`**

- `TileAggregation` (`:168`) gains `treatment: AggTreatment`. `aggregationFromSpec` populates it (`resolveAggTreatment(kind, agg.treatment, { hasColorBy: colorByColumn != null })`).
- `resolvePipeline` already returns the pin's `portalResultId` context (the ref carries it for `kind === "pin"`); thread it (or the `ref`) into `defaultRunTileQuery`.
- `defaultRunTileQuery` (`:405`): when `treatment === "dissolve" && z < zoomThreshold`:
  - **Pin ref + hit** (≥1 `map_dissolve_geometries` row for `(portalResultId, colorByColumn, bandForZoom(z))`): `ST_AsMVT(ST_AsMVTGeom(ST_Transform(geom,3857), envelope, …))` over the stored rows filtered `geom && ST_Transform(envelope,4326)`, emitting `value AS <colorByColumn>` so client `["get", col]` colorBy matches. **The pipeline SQL is not run.**
  - **Miss** (no rows / message ref / non-categorical): `buildRawTileSql` with the band tolerance — real simplified polygons; set `X-Portal-Tile-Simplified` (#449).
- Never `buildAggregateTileSql` for a polygon dissolve layer.

### 8. Client paint

**File: `apps/web/src/modules/MapWidget/utils/map-config.util.ts`** — `layerToMapLibre` (`:494`). For `treatment === "dissolve"` (tiled): set raw layers `minzoom = threshold` and push a `-agg` **fill of real geometry** painted with the `resolveColorBy` expression (`:504` branch) — **not** the density ramp, **no** centroid layer. The tile source yields the colorBy column as a property (§7), so `resolveColorBy` on `["get", col]` colors it. `"bins"` branch unchanged for points/no-colorBy polygons.

## Migration

`cd apps/api && npm run db:generate -- --name add_map_dissolve_geometries`. Hand-add to the generated SQL: `ALTER TABLE map_dissolve_geometries ADD COLUMN geom geometry(MultiPolygon,4326);` + `CREATE INDEX … USING GIST (geom);`. No backfill (existing pins get precompute on their next refresh; a one-shot enqueue-for-all-geo-pins is a trivial admin action, noted not built). No production data at risk (project memory).

## Seed

None — populated by the job.

## TDD test plan

Run via npm scripts (`feedback_use_npm_test_scripts`): `cd packages/core && npm run test:unit`; `cd apps/api && npm run test:unit && npm run test:integration`; `cd apps/web && npm run test:unit`.

### Layer 1 — core contract (`packages/core`)
1. `AggTreatment` accepts `"dissolve"`; `MapLayerAggregationSchema` round-trips it.
2. `resolveAggTreatment`: polygons + `hasColorBy` → `"dissolve"`; polygons without colorBy → `"bins"`; lines → `"none"`; explicit wins.
3. `DissolvePrecomputeMetadataSchema`/`ResultSchema` parse; `JOB_TYPE_SCHEMAS.dissolve_precompute` present (registry completeness compile check).
4. `MapDissolveGeometry` model round-trips (non-geom fields).
5. `bandForZoom` maps representative zooms to the right band and returns null at z≥14.

### Layer 2 — DB / type-checks (integration)
6. `map_dissolve_geometries` insert + geometry DDL: a GeoJSON MultiPolygon round-trips in→out; GiST present; `&&` predicate index-usable (mirrors `wide-table-geometry.integration.test.ts`).
7. Unique key `(portalResultId, columnName, value, zoomBand)` rejects a duplicate live row.
8. FK `ON DELETE CASCADE`: deleting the `portal_results` row purges its dissolve rows.
9. Dual-schema guards compile; a deliberate mismatch fails `type-check`.

### Layer 3 — precompute processor (integration, real PostGIS)
10. Given a pin whose pipeline yields overlapping polygons + a 3-value categorical colorBy, the processor writes one MultiPolygon per (value, band); `featureCount` = source count; every geom `ST_IsValid`.
11. **A joined/aggregated pipeline** (geometry from one view ⨝ a categorical metric from another) dissolves correctly — proves the pipeline-keyed model (not entity-keyed).
12. Two-phase union output equals a single `ST_Union` (same dissolved area within tolerance) — correctness, not plan.
13. colorBy over `DISSOLVE_CARDINALITY_CEILING` → `{ skipped: "over-cardinality" }`, no rows.
14. Recompute replaces prior rows transactionally (second run: same count, not doubled; no zero-row window).
15. Advisory lock not acquired → superseded no-op, no writes.
16. A forced per-band failure → `degraded`, other bands written.

### Layer 4 — tile serve (integration)
17. Dissolve hit: a low-zoom **pin** tile returns MVT features carrying the colorBy value as a property, sourced from `map_dissolve_geometries` (assert the pipeline SQL was not the source — e.g. rename the underlying view and still get a tile).
18. Dissolve miss (no rows): falls back to `buildRawTileSql` (real simplified polygons) + `X-Portal-Tile-Simplified`; **never** centroid bins.
19. A **message** ref at low zoom → raw-simplify fallback (never precompute, never bins).
20. `z ≥ zoomThreshold` → raw path unchanged; `bandForZoom` selects the right band below.

### Layer 5 — client (`apps/web`)
21. `layerToMapLibre` for a tiled polygon dissolve layer emits a `-agg` **fill** with the colorBy expression (not density, no centroid layer), gating the raw layer at `minzoom = threshold`.
22. Tiled polygon without colorBy still uses `"bins"`; points still use `"bins"`.

### Layer 6 — enqueue
23. Pinning a geo polygon-with-colorBy block enqueues one `dissolve_precompute` (spy the queue); a non-polygon/no-colorBy pin enqueues nothing; a failed enqueue doesn't fail the pin.
24. Refreshing such a pin re-enqueues for the same `portalResultId`.

**Totals ≈ 24 cases** (5 core, 4 db, 7 processor, 4 serve, 2 web, 2 enqueue).

## Acceptance criteria

- [ ] A polygon choropleth below z14 renders as **real colored polygons**, not centroid bins, in the dev app.
- [ ] A **joined/aggregated** choropleth (boundaries ⨝ a categorical metric) renders correctly at low zoom — the pipeline-keyed model serves it.
- [ ] With no precompute yet (or an unpinned map), the same map still renders real simplified polygons — never bins, never blank.
- [ ] After pinning/refresh, `map_dissolve_geometries` holds one valid MultiPolygon per (value, band) for the pin; every geom `ST_IsValid`.
- [ ] The dissolve tile serve does **not** run the pin's pipeline SQL (served from stored geometry); a low-zoom tile returns within the tile budget on the ~400K parcel layer.
- [ ] Precompute runs off the request path under the `portalResultId` advisory lock; two refreshes can't race; failure is non-fatal + flagged.
- [ ] Recompute on refresh keeps geometry current; readers never see a half-built dimension.
- [ ] `npm run lint && npm run type-check` clean; all suites green.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| **Bounded union still too slow** on ~400K polygons (the #475 failure, off-request). | Two-phase subdivided/grid union + off-request `statement_timeout`; **measure against the real parcel layer before finalizing the SQL** (slice-2 gate). If still too slow: coarsen grid / raise subdivide count / simplify-before-union at high bands. |
| First low-zoom pin view degraded until the job lands (interacts with #371 tile-on-mount). | Fallback is correct real polygons (raw-simplify), not blank; dissolved geometry serves on the next fetch/refresh. Acceptable + stated (discovery Open Q6). |
| Aggregated pipeline is expensive to run even once. | It runs **once** off-request (not per tile); the whole point of moving it off the request path. |
| Half-built dimension mid-recompute. | Delete-then-insert per pin in one transaction. |
| Storage growth. | Bounded by ceiling × bands per pinned choropleth; pins are few and deliberate. |

**Rollback:** revert the migration (drop table) + `git revert`; serve falls back to raw-simplify with the treatment change reverted → prior behavior. Data-lossless (derived data only).

## Files touched

**`packages/core`** — new: `models/map-dissolve-geometry.model.ts`; edit: `contracts/map-spec.contract.ts` (treatment enum + `resolveAggTreatment`), `models/job.model.ts` (job type + schemas), `constants/*` (bands + ceiling), `models/index.ts`. New tests.

**`apps/api`** — new: `db/schema/map-dissolve-geometries.table.ts`, `queues/processors/dissolve-precompute.processor.ts`, the migration, integration tests; edit: `db/schema/zod.ts`, `type-checks.ts`, `db/schema/index.ts`, `services/portal-map-tile.service.ts` (`TileAggregation`, `aggregationFromSpec`, `resolvePipeline`, `defaultRunTileQuery`), `services/sync-lock.service.ts` (or a new `advisory-lock` helper for the `portalResultId` namespace), `routes/portal-results.router.ts` (enqueue on create + refresh), `queues/jobs.worker.ts` (dispatch), `constants/*` (statement timeout).

**`apps/web`** — edit: `modules/MapWidget/utils/map-config.util.ts` (dissolve paint) + its test.

No new dependency; no env change (new tuning constants only).

## Next step

`docs/PRECOMPUTED_POLYGON_DISSOLVE.plan.md` — 4 TDD slices: (1) contract + table + migration + type-checks + constants; (2) precompute processor + union SQL under the advisory lock + **the union measurement gate**; (3) enqueue at pin create/refresh; (4) tile serve branch + fallback + client paint. Slices 1–2 are the risk; if the union measurement fails, revisit the SQL before serve/client work.
