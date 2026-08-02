# PostGIS foundation — Spec

**Issue:** [EnterpriseBT/portal-ai#316](https://github.com/EnterpriseBT/portal-ai/issues/316) · **Epic:** [#84](https://github.com/EnterpriseBT/portal-ai/issues/84) · **Shared discovery:** `docs/GIS_TOOLPACK.discovery.md` · **Epic spec:** `docs/GIS_TOOLPACK.spec.md`

Pins the substrate the rest of the GIS epic stands on: the PostGIS extension, `geometry` as a real typed and indexed wide-table column, geometry normalization + validity reporting at import, `ST_*` available to agent SQL, and the `ST_AsMVT` vector-tile endpoint that makes arbitrarily large layers renderable.

This child-level spec **supersedes the epic spec's storage sections** (`Where computation happens`, Surface → `column-definition.model.ts`, Migration, Seed), which were written before PostGIS was adopted. The epic spec's MapSpec / geo-block / geocoding contracts stand and belong to #314 and #315.

## Key decisions (flag for review)

1. **`geometry` is a `ColumnDataType` again; `geoRole` narrows to `lat | lng`.** Under PostGIS the storage genuinely differs (typed, SRID-constrained, GiST-indexed), which is exactly the condition the earlier role-not-type argument depended on. Coordinate pairs stay plain numerics carrying a role.
2. **The database computes; Node does not.** No turf, no proj4. `ST_*` runs in Postgres, so validity repair, geodesic distance/area, and reprojection come from one authority.
3. **Tiles are addressed by `BlockRef`, reusing #312's union** — `…/tiles/message/:messageId/:blockIndex/:z/:x/:y` and `…/tiles/pin/:portalResultId/:z/:x/:y`. The client never supplies SQL; the server reads the persisted pipeline, exactly as `widget-refresh` does.
4. **Degradation is signalled in-band.** Simplification, feature capping, and timeouts each have a response header or typed status the widget renders (epic *Visibility of limits*, rows 2–7). A thinner map that says nothing is a defect.
5. **A type conversion that cannot succeed fails before it starts.** `json → geometry` pre-flights: unconvertible rows are identified and returned; the `ALTER` only runs when it will succeed. Postgres would otherwise abort the whole statement on the first bad row with an opaque error.
6. **Fail-closed on geometry validity.** An unparseable geometry is rejected and reported, never coerced to `NULL` and never silently dropped — a missing parcel is indistinguishable from a parcel that isn't there.

## Scope

### In scope

Extension enablement (local/CI image + RDS migration), the `geometry` column type end-to-end (core enum → reconciler → statement cache → index), geometry audit + normalization at import, the type-transition path, `station_context` SRID exposure, `ST_*` prompt surface, the tile endpoint, and the recorded benchmark.

### Out of scope

The `gis` toolpack and `visualize_map` (#314), the map widget's tile consumption (#314), geocoding (#315), `ST_AsMVT` tiles for anything other than a persisted map block, raster/topology/pgRouting/3D, and backfilling historical JSONB geometry (no production geospatial data exists; re-sync is the conversion path).

## Surface

### Extension + images

- **Migration** `enable-postgis` — `CREATE EXTENSION IF NOT EXISTS postgis;`. Must be the **first** migration touching geometry; every typed column depends on it.
- `docker-compose.yml:53,72` — `postgres:17-alpine` → `postgis/postgis:17-3.5-alpine` for both the app and test databases; `.devcontainer` follows. `infra/cloudformation/database.yml` needs no change (`Engine: postgres` 17.9 supports the extension); enabling is the migration's job.

### `packages/core/src/models/column-definition.model.ts`

```ts
export const ColumnDataTypeEnum = z.enum([
  "string", "number", "boolean", "date", "datetime",
  "enum", "json", "array", "reference", "reference-array",
  "geometry",                                    // #316
]);

/** Coordinate-pair roles only — geometry is a type, not a role (#316). */
export const GeoRoleSchema = z.enum(["lat", "lng"]);

export const ColumnDefinitionSchema = CoreSchema.extend({
  // …existing…
  geoRole: GeoRoleSchema.nullable(),
});
```

`SORTABLE_COLUMN_TYPES` is unchanged and therefore excludes `geometry` (ordering polygons is meaningless). `column-definition.contract.ts:48,71` gain `geoRole`.

### `apps/api/src/services/wide-table-reconciler.service.ts`

`pgTypeForColumnDefinitionType` (`:63`) gains one arm — its `never` exhaustiveness check makes this a compile error until added, which is the intended forcing function:

```ts
case "geometry":
  return "geometry(Geometry, 4326)";
```

`Geometry` (not `Polygon`) because one column may hold mixed polygon/point/line features; the SRID constraint is the part that matters. The reconciler additionally creates **`CREATE INDEX CONCURRENTLY IF NOT EXISTS <col>_gist ON er__<id> USING GIST (<col>)`** for every geometry column, and `wide_table_columns.pgType` records `geometry(Geometry, 4326)` so existing drift detection compares correctly.

### `apps/api/src/services/wide-table-statement.cache.ts` — per-column write expressions

Today the INSERT emits bare placeholders (`:227-231`, `placeholders.push(\`$${…}\`)`), so a bound JSON value cannot become a geometry. Mirror the existing **read**-side type-aware fragment builder (`:147-158`) with a write-side one:

```ts
/** SQL expression wrapping the bound placeholder for a column's pg type.
 *  Default: the bare placeholder. Geometry: parse + constrain + repair. */
export function writePlaceholderExpr(pgType: string, index: number): string {
  return pgType.startsWith("geometry")
    ? `ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($${index}), 4326))`
    : `$${index}`;
}
```

Read side: a geometry column projects as `ST_AsGeoJSON(<col>)::jsonb` so every existing consumer (`SELECT *`, the data-table renderer, `sql_query`) keeps receiving GeoJSON and needs no change.

### `apps/api/src/services/geometry-audit.service.ts` (new)

Validity is decided by Postgres, in **one** round-trip per batch, before the write — so repairs and rejections can be *counted and attributed* rather than silently applied:

```ts
export interface GeometryAuditRow { sourceId: string; geoJson: unknown; }
export interface GeometryAuditResult {
  /** Parsed clean — written as-is. */
  ok: string[];
  /** Parsed but invalid (self-intersection, ring order); ST_MakeValid will repair on write. */
  repaired: string[];
  /** Unparseable or non-geometry — NOT written; reported per row. */
  rejected: Array<{ sourceId: string; reason: string }>;
}
/** One statement over `unnest($1::text[], $2::jsonb[])` evaluating
 *  ST_GeomFromGeoJSON / ST_IsValid per row; never throws on bad input. */
export class GeometryAuditService {
  static async auditBatch(rows: GeometryAuditRow[]): Promise<GeometryAuditResult>;
}
```

The sync pipeline calls this for every geometry-typed column, writes `ok ∪ repaired`, **omits** `rejected`, and surfaces `{ repaired: n, rejected: n }` in the sync summary (limits rows 5–6). Rejected rows are addressable by `sourceId`.

### `apps/api/src/adapters/rest-api/geometry.util.ts` (new)

```ts
/** ArcGIS `{rings|paths, spatialReference}` → GeoJSON; passes GeoJSON through;
 *  returns null for anything unrecognized (the audit then rejects it).
 *  Shape translation only — reprojection is ST_Transform's job. */
export function toGeoJsonCandidate(value: unknown): unknown | null;
/** Detects a geometry-shaped value for type inference. */
export function looksLikeGeometry(value: unknown): boolean;
```

Non-4326 sources are reprojected in SQL via `ST_Transform(ST_SetSRID(…, <srid>), 4326)`; an SRID PostGIS does not know returns the typed `GIS_SRID_UNSUPPORTED` (limits row 7).

### Type transition — `apps/api/src/constants/column-definition-transitions.constants.ts`

```ts
export const ALLOWED_TYPE_TRANSITIONS: Record<string, string[]> = {
  string: ["enum"], enum: ["string"],
  date: ["datetime"], datetime: ["date"],
  json: ["geometry"], geometry: ["json"],      // #316
};
```

Unlike the existing re-label transitions, this one **converts data**, so the column-definition update route pre-flights via `GeometryAuditService`: any `rejected` rows ⇒ `422 GEOMETRY_CONVERSION_FAILED` naming the count and a bounded sample of `sourceId`s, and the `ALTER` never runs. On a clean pre-flight the reconciler issues `ALTER … TYPE geometry(Geometry,4326) USING ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(<col>::text), 4326))` and creates the GiST index. The web mirror (`EditColumnDefinitionDialog.component.tsx:34`) gains the same pair.

### Tile endpoint — `apps/api/src/routes/portal-map.router.ts` (new), mounted at `protected.router.ts` as `/portal-map`

```
GET /api/portal-map/tiles/message/:messageId/:blockIndex/:z/:x/:y.mvt
GET /api/portal-map/tiles/pin/:portalResultId/:z/:x/:y.mvt
```

- **Addressing** reuses #312's `BlockRef` split; the server loads the block and reads its persisted pipeline SQL. **No SQL, no filter, and no table name is ever accepted from the client.**
- **Scoping** on the owning row's `organizationId`; cross-org returns the same `404 MAP_TILE_NOT_FOUND` as a missing block — no existence leak.
- **Validation**: `z ∈ [0,22]`, `x,y ∈ [0, 2^z)`, else `400`.
- **Query**: `ST_AsMVT` over `ST_AsMVTGeom(ST_Transform(geom, 3857), ST_TileEnvelope(z,x,y), 4096, 64, true)`, with the block's SQL as the source subquery, `WHERE geom && ST_Transform(ST_TileEnvelope(z,x,y), 4326)` for index use, and `ST_SimplifyPreserveTopology` at a zoom-derived tolerance.
- **Response**: `200` `application/vnd.mapbox-vector-tile` (protobuf); `204` for a genuinely empty tile; `504 MAP_TILE_TIMEOUT` on `statement_timeout` — the widget renders an error tile rather than blank ground (limits row 4).
- **Degradation headers** (limits rows 2–3): `X-Portal-Tile-Simplified: <tolerance>` whenever tolerance > 0, and `X-Portal-Tile-Truncated: <cap>` when the per-tile feature cap `MAP_TILE_FEATURE_CAP = 50_000` clipped the tile.
- **Caching**: `Cache-Control: private, max-age=60`, plus an `ETag` over `(pipelineHash, z, x, y, snapshotUpdatedAt)`.
- Free and unmetered, like `widget-refresh`; the per-org `viz-refresh` rate window is **not** applied (a single pan issues dozens of legitimate tile requests) — abuse protection is the org scope plus the DB's own `statement_timeout`.

### `apps/api/src/constants/api-codes.constants.ts`

`MAP_TILE_NOT_FOUND`, `MAP_TILE_TIMEOUT`, `GEOMETRY_CONVERSION_FAILED`, `GEOMETRY_INVALID_ON_IMPORT`, `GIS_SRID_UNSUPPORTED` (+ recommendation strings).

### Agent surface

`station-context.tool.ts:266,310` emits `type: "geometry"` and the column's SRID. `system.prompt.ts` teaches the `ST_*` vocabulary (predicates, `geography` casts for distance/area, `ST_Transform`, and the construction idioms `ST_MakeLine` / `ST_HexagonGrid` / `ST_Union` / `ST_SimplifyPreserveTopology`). `transform-entity-records.tool.ts:239`'s existing `ST_Area(geometry::geography)` example is **verified to execute**, not removed.

## Migration

Two, ordered: (1) `enable-postgis` — `CREATE EXTENSION IF NOT EXISTS postgis` (idempotent, must precede any geometry DDL); (2) `add-geometry-column-type` — the `geometry` enum value is a **core Zod enum**, not a pg enum, so this migration carries only `column_definitions.geo_role text` (nullable). Wide-table geometry columns are created by the reconciler at runtime, not by a migration. **No backfill** — existing `json` geometry columns convert on demand through the pre-flighted transition, or on re-sync.

## Seed

`SYSTEM_COLUMN_DEFINITIONS` (`seed.service.ts:31`) gains three idempotent `system: true` rows, upserted by `key`: `geometry` (type `geometry`, `geoRole: null`), `latitude` (`number`, `geoRole: "lat"`), `longitude` (`number`, `geoRole: "lng"`). The existing `address` row is unchanged and remains #315's geocode input.

## TDD test plan

`cd apps/api && npm run test:unit` / `npm run test:integration`; `cd packages/core && npm run test:unit`.

### `packages/core` — `__tests__/models/column-definition.model.test.ts`

`geometry` accepted by the enum; `geoRole` accepts `lat`/`lng` and **rejects `"geometry"`** (the narrowing is the contract); `geometry` absent from `SORTABLE_COLUMN_TYPES`. ≈ 5 cases.

### `apps/api` unit — `__tests__/services/{wide-table-reconciler,wide-table-statement.cache,geometry-audit.service}.test.ts`, `adapters/rest-api/geometry.util.test.ts`, `__tests__/routes/portal-map.router.test.ts`

`pgTypeForColumnDefinitionType("geometry")` → `geometry(Geometry, 4326)`; `writePlaceholderExpr` wraps only geometry types and leaves others bare; the read projection emits `ST_AsGeoJSON(...)::jsonb`. `toGeoJsonCandidate`: ArcGIS rings → Polygon, paths → LineString, GeoJSON passthrough, garbage → `null`; `looksLikeGeometry` across the three shapes plus negatives. Tile route: z/x/y bounds rejected; unknown block → 404; **cross-org → 404, not 403**; timeout → 504; header emitted when simplified; header emitted when capped; empty tile → 204. ≈ 22 cases.

### `apps/api` integration — `__integration__/db/postgis.integration.test.ts`, `wide-table-geometry.integration.test.ts`, `routes/portal-map.router.integration.test.ts`, `services/geometry-audit.integration.test.ts`

Extension present and migration idempotent across two runs; a synced geometry column materializes as `geometry(Geometry,4326)` with a GiST index present in `pg_indexes`; a spatial predicate uses the index (`EXPLAIN` contains `Index Scan` / `Bitmap Index Scan`); `ST_Intersects` / `ST_DWithin` / `ST_Area(::geography)` all execute through the **read-only** tool session under `statement_timeout`; audit classifies clean/invalid/unparseable and the sync reports the counts with `sourceId`s; a rejected row is **absent** from the wide table rather than `NULL`; `json → geometry` with a bad row returns `422 GEOMETRY_CONVERSION_FAILED` and leaves the column `json`; the clean case converts and indexes; a tile request returns a decodable MVT whose feature count matches the envelope, and a foreign org gets 404. ≈ 18 cases.

### Prompt + seed

`system.prompt.test.ts`: geo guidance names the `ST_*` idioms; the `transform-entity-records` example is asserted **executable** against the live extension (integration). Seed idempotency is covered above. ≈ 3 cases.

**Totals ≈ 48 cases.** The extension migration is exercised by the integration suite (it cannot run at all without it), so it needs no separate test.

## Acceptance criteria

- PostGIS is present in local, CI, and app-dev; `db:migrate` is idempotent; the full existing suite passes against the new base image with no regressions.
- A synced ArcGIS entity lands in `geometry(Geometry, 4326)` with a GiST index, and a spatial predicate on it uses that index.
- Agent SQL can call `ST_Intersects`, `ST_DWithin`, and `ST_Area(geometry::geography)` through the normal read-only path; the `transform-entity-records` prompt example executes.
- An invalid polygon is repaired and **counted**; an unparseable one is rejected, **named by `sourceId`**, and absent from the table — never `NULL`, never silently skipped.
- `json → geometry` on a column with bad rows fails pre-flight with the count and sample, leaving the column untouched; on clean data it converts and indexes.
- `ColumnDataTypeEnum` contains `geometry`; `geoRole` accepts only `lat`/`lng`; seeded geo definitions exist and re-seed cleanly.
- A tile request returns a valid MVT for its envelope; cross-org gets 404; a timeout gets 504; simplification and feature-capping each announce themselves in a response header.
- Distance and area match PostGIS `geography` as the reference.
- The benchmark (turf-vs-PostGIS on the parcel query at current size and 500k synthetic; tile latency at z8/z12/z16) is committed with the smoke doc.

## Risks & rollback

- **Base-image swap is the widest blast radius** — every test and every developer's stack. Detected immediately by the full suite; the image is a one-line revert while no geometry column exists.
- **`CREATE EXTENSION` needs elevated rights.** Fine locally and on RDS's `rds_superuser`; if app-dev's role lacks it, the extension is created once out-of-band and the migration's `IF NOT EXISTS` is a no-op. Verify before the app-dev deploy, not after.
- **`CREATE INDEX CONCURRENTLY` cannot run inside a transaction** — the reconciler must issue it outside its DDL transaction, or fall back to a plain `CREATE INDEX` while tables are small. Named here because it is a silent-failure trap.
- **Fail-closed on geometry is deliberate**: rejecting a row loses data the user supplied, but writing `NULL` would make an unmappable parcel indistinguishable from an absent one. The rejection is reported with identifiers so it can be fixed at source.
- **Tile endpoint is a new authenticated binary surface.** Mitigations are contractual: server-held SQL only, org-scoped, bounded z/x/y, `statement_timeout`, ETag caching.
- **Rollback**: the extension can stay installed harmlessly; reverting means dropping `geometry` from the enum, reverting `pgTypeForColumnDefinitionType`, and re-syncing affected entities as `json`. No production geospatial data exists, so no data migration is owed.

## Files touched

- **core:** `models/column-definition.model.ts` · `contracts/column-definition.contract.ts` · tests
- **api:** `drizzle/<enable-postgis>` + `<add-geometry-column-type>` · `db/schema/column-definitions.table.ts` (+ `zod.ts`, `type-checks.ts`) · `services/wide-table-reconciler.service.ts` · `services/wide-table-statement.cache.ts` · `services/geometry-audit.service.ts` (new) · `adapters/rest-api/geometry.util.ts` (new) + `inference.util.ts` + `transform.util.ts` · `constants/column-definition-transitions.constants.ts` · `constants/api-codes.constants.ts` · `routes/portal-map.router.ts` (new) + `routes/protected.router.ts` + `config/swagger.config.ts` · `routes/column-definition.router.ts` (pre-flight) · `services/seed.service.ts` · `tools/station-context.tool.ts` · `prompts/system.prompt.ts` · tests
- **web:** `components/EditColumnDefinitionDialog.component.tsx` + `CreateColumnDefinitionDialog.component.tsx` (transition mirror + `geoRole` field)
- **infra/dev:** `docker-compose.yml` · `.devcontainer/*` · `docs/POSTGIS_FOUNDATION.benchmark.md` (new)

## Next step

`/plan 316` slices this on this branch — roughly: (1) extension + image swap, green suite on PostGIS; (2) core enum + `geoRole` narrowing + migration + seeds; (3) reconciler type + GiST index + statement-cache write/read expressions; (4) geometry audit + import normalization + sync reporting; (5) the pre-flighted type transition; (6) tile endpoint; (7) agent surface (`station_context`, prompts) + benchmark + doc sync. Slice 1 is the riskiest and gates everything.
