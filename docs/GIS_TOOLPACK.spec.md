# GIS toolpack + map visualization — Spec

**Issue:** [EnterpriseBT/portal-ai#84](https://github.com/EnterpriseBT/portal-ai/issues/84) · **Discovery:** `docs/GIS_TOOLPACK.discovery.md`

**Status: partly superseded.** The epic was restructured on 2026-08-02 into three sequential children — #316 (PostGIS substrate + vector tiles) → #314 (pack + map) → #315 (geocoding) — and two decisions taken after this spec was drafted invalidate parts of it:

1. **PostGIS is the substrate**, so geometry math is `ST_*` in the database, not turf in Node (revised *Where computation happens*; Key decisions 3 and 5).
2. **The pack carries no hand-rolled spatial tools.** The nine-tool surface below collapses to **`visualize_map`** (this spec's MapSpec contract) plus **`geocode` / `reverse_geocode` / bulk geocode** (#315). `compute_distance`, `point_in_polygon`, `centroid`, `buffer`, `compute_bounding_box`, and `reproject` are dropped — each is one line of `ST_*` the agent composes directly, and a fixed-signature wrapper is strictly *less* expressive than the SQL it wraps. The capability table below is therefore historical for those six rows.

What stands unchanged: the MapSpec + expression contract, the `geo` block shape and its reserved `program` hatch, the pinned-content entry, the geocoding/cache/cost contracts, and the enterprise-scale posture. Each child re-pins its own surface in its plan.

Pins the `gis` built-in toolpack (six pure spatial tools, two metered geocoders, an expensive bulk-column geocode job, and `visualize_map`), the declarative MapSpec + `geo` block contract and its MapLibre renderer, and the `geoRole` column annotation with ArcGIS→WGS84 normalization on import.

## Key decisions (flag for review)

1. **`visualize_map` takes an agent-authored MapSpec whose style values accept MapLibre expressions** (discovery D1-A, extended 2026-08-02) — no codegen sub-call. Expressions (`case` / `match` / `interpolate` / `get`) give full data-driven symbology as **JSON the agent authors**, so no model-written JS executes and no network channel opens to it. The block contract **reserves an optional `program` variant** (see *Escape hatch*) so a sandboxed codegen renderer can land in a later child without a contract break or a re-pin.

   Why not mirror `visualize_d3`'s codegen sandbox: that sandbox is safe precisely because its CSP is `default-src 'none'` (`sandbox-srcdoc.util.ts:15`) — every network channel closed, which is affordable for D3 because it needs none. A map needs tiles, glyphs, and sprites, so a codegen map sandbox must open `connect-src`/`img-src` **to model-authored JS**. That is a new security surface, and it buys little here: MapLibre's expression DSL already covers the styling range, while our own renderer can generate legends from the spec (a program would have to draw its own each time) and we can validate that referenced columns exist in the result schema (a program can't be validated at all).
2. **MapLibre GL, direct-mount** (D2-A). The D3 sandbox iframe is unusable: its srcdoc CSP forbids network, and tiles/glyphs are network fetches. `React.lazy` + the repo's first `manualChunks` entry keeps ~200 KB out of the main chunk.
3. **`geometry` is a real column type; `geoRole` covers `lat`/`lng` only** (D4, twice-revised 2026-08-02). The role-not-type argument held only while geometry lived in JSONB — under #316's PostGIS substrate the storage genuinely differs (typed, SRID-constrained, GiST-indexed), so the type carries information. Coordinate pairs remain plain numbers, so the role still does that job. **#316 owns this contract**; the `geoRole`-shaped surface described below is superseded where the two disagree, and the plan re-derives it.
4. **Canonical geo column definitions are seeded** as `system` rows alongside `email` / `name` / `address`, so the role arrives through the existing field-mapping catalog rather than inference alone.
5. **No hand-rolled spatial tools** (D5, superseded) — the capability table's six pure-compute rows are historical. Spatial questions are answered by the agent writing `ST_*` SQL through `sql_query`; the pack ships only what SQL cannot do. Fewer tools is the *more* expressive design, because a wrapper's signature is a ceiling and SQL has none.
6. **Mapbox behind a provider interface**, key via the standard Secrets-Manager → CI/CD → env-var path; a **global** Redis address cache makes repeats **zero-unit** through the async `CostResolver` (discovery Q1: `resolveCallCost` awaits, verified at `cost-gate.service.ts:43,68`).
7. **Bulk geocode writes GeoJSON Points only** — lat/lng are SQL extractions, never duplicated columns (confirmed).
8. **Geo blocks pin** by registering one `PINNED_CONTENT_SCHEMAS` entry; #312 shipped the mechanism and pre-admitted `geo`.
9. Enterprise-scale carry-forward: charges bill on success and itemize in the #221 ledger; provider/Redis failures are typed tool results the agent relays, **never fabricated coordinates**; per-layer feature cap declared in the contract, not implicit; the bulk job locks its target entity.

## Scope

### In scope

Core contracts (`geoRole`, MapSpec, `geo` block + pinned entry, GIS pack + capabilities), the DB column + migration + seeds, nine tool implementations + a `GisService`, the geocoding provider/cache/cost-resolver, the `bulk_geocode` job, geo inference + ArcGIS reprojection, `geoRole` in `station_context`, the `MapWidget` module + `geo` renderer, the `geoRole` form field, tier/icon/doc surfaces.

### Out of scope

PostGIS and SQL-pushdown spatial predicates; vector-tile self-hosting; self-hosted Nominatim; drawing tools; geofencing; 3D/terrain; routing; isochrone/network/hotspot analysis; choropleth statistical binning beyond categorical/threshold styling.

## Where computation happens (PostGIS is the substrate — #316)

**Revised 2026-08-02:** the epic now enables PostGIS first ([#316](https://github.com/EnterpriseBT/portal-ai/issues/316)), so geometry math runs **in the database**, not in Node. The division of labour:

| Stage | Runs where | Does what |
|---|---|---|
| Storage | Postgres — typed `geometry(Geometry, 4326)` wide column + GiST index (#316) | geometry with a tracked SRID; coordinate pairs stay plain numerics labelled by `geoRole`. |
| Selection / filtering **and geometry math** | Postgres — `ST_*` | `ST_Intersects` / `ST_DWithin` / `ST_Contains` (index-backed), `ST_Distance` and `ST_Area` on `geography` (spheroidal, not approximate), `ST_Transform`, `ST_Centroid`, `ST_Buffer`, `ST_Extent`, `ST_MakeValid`. |
| Tools | thin projections over that SQL | the pack composes `ST_*` and returns results through the sink — no turf, no proj4, no per-row Node loop. |
| Delivery | `resolveSqlDelivery` | inline rows ≤ `INLINE_ROWS_THRESHOLD`, else a query handle. |
| Render | `MapWidget` → MapLibre | rows → GeoJSON (`ST_AsGeoJSON`) per layer `source`; styling from expressions; ≤ `MAP_LAYER_FEATURE_CAP` features per layer. |

So the database stores, filters, **and computes**; the renderer paints. `visualize_map` is the seam: SQL selects and shapes the records, the spec says how to draw them. This is what buys correctness (validity repair, geodesic distance/area, SRID tracking) and scale (a predicate uses the index instead of streaming every candidate row into Node under a 30s timeout).

### Raising the declarative ceiling — and where it actually stops

MapLibre expressions style *existing* features: they map feature properties to paint values. They cannot invent geometry, draw outside the map canvas, animate over time, or compute across features at render time. The ceiling is nonetheless higher than that sounds, because **geometry can be computed upstream** — and the agent must be told so (`system.prompt.ts`):

- **Derive geometry in SQL** — and with PostGIS this is genuinely powerful rather than a workaround: `ST_MakeLine` for origin→destination arcs, `ST_HexagonGrid` for real hexbins (not `GROUP BY` on rounded coordinates), `ST_Union` to dissolve, `ST_ConvexHull` for extents, `ST_SimplifyPreserveTopology` to make a dense layer renderable.
- **Derive geometry with the pack's tools** where they earn their place: `buffer` (service radii), `centroid` (polygon label points), `reproject` (non-WGS84 sources) — each a thin `ST_*` projection.
- **Style per-feature with expressions**: conditional fills/strokes, continuous ramps, multi-variable nested conditions.

What genuinely remains behind the reserved `program` hatch is **render-time behaviour**, not data shape: time playback/animation, chrome outside the canvas (e.g. a bivariate 3×3 legend matrix), D3 overlays (contours, Voronoi, inset charts), and brushing/filtering that recomputes on interaction.

### The `ST_Area` prompt line — inverted, not removed

`transform-entity-records.tool.ts:239` already advertises `ST_Area(geometry::geography) / 4047 AS c_acreage`. That instruction is **broken today** (no extension) and was briefly scoped as a drift fix; #316 makes it **correct** instead. So the deliverable inverts: rather than deleting the example, #316 verifies it executes through the read-only tool path, and the regression test asserts the opposite of what was planned — that `ST_*` in agent-facing copy is *backed by a live extension*. Worth recording because that stale line is what made the architecture look PostGIS-backed when it wasn't.

## Surface

### `packages/core/src/models/column-definition.model.ts`

```ts
/** How a column participates in geospatial operations (#84). Orthogonal to
 *  `type`: geometry is JSON, coordinates are numbers. */
export const GeoRoleSchema = z.enum(["geometry", "lat", "lng"]);
export type GeoRole = z.infer<typeof GeoRoleSchema>;

export const ColumnDefinitionSchema = CoreSchema.extend({
  // …existing fields unchanged (type stays ColumnDataTypeEnum)…
  geoRole: GeoRoleSchema.nullable(),
});
```

`SORTABLE_COLUMN_TYPES` and `ColumnDataTypeEnum` are **not** modified. `column-definition.contract.ts:48,71` (create/update bodies) gain `geoRole: GeoRoleSchema.nullish()`.

### `packages/core/src/contracts/map-spec.contract.ts` (new)

```ts
export const MapBasemapSchema = z.union([
  z.enum(["carto-light", "carto-dark", "osm"]),
  z.object({ url: z.string().url() }),
]);

/** Where a layer's geometry comes from — a GeoJSON column, or a lat/lng pair.
 *  Explicit and authoritative: an entity may carry two coordinate pairs. */
export const MapGeometrySourceSchema = z.union([
  z.object({ geometryColumn: z.string().min(1) }),
  z.object({ latColumn: z.string().min(1), lngColumn: z.string().min(1) }),
]);

/**
 * A style value is either a literal or a **MapLibre expression** — a JSON
 * array whose head is an operator (`["case", …]`, `["match", …]`,
 * `["interpolate", …]`, `["get", "col"]`). Expressions are the flexibility
 * seam: full per-feature, data-driven symbology authored as JSON, with no
 * model-written JS and no network access granted to it. Passed through to
 * MapLibre as-is; a malformed expression surfaces as the widget's typed
 * error state, never a silent mis-render.
 */
export const MapExpressionSchema: z.ZodType<unknown> = z.lazy(() =>
  z.array(z.union([z.string(), z.number(), z.boolean(), z.null(), MapExpressionSchema])).min(1)
);
const styleValue = <T extends z.ZodTypeAny>(literal: T) =>
  z.union([literal, MapExpressionSchema]);

export const MapLayerStyleSchema = z.object({
  color: styleValue(z.string()).optional(),
  /** Sugar over an expression: categorical/threshold colouring keyed to a
   *  result column. Compiles to a `match`/`step` expression, and is what the
   *  renderer reads to auto-generate a legend. */
  colorBy: z.object({
    column: z.string().min(1),
    palette: z.array(z.string()).optional(),
    /** Explicit value→colour pairs; omitted ⇒ palette assigned in sort order. */
    stops: z.array(z.tuple([z.union([z.string(), z.number()]), z.string()])).optional(),
  }).optional(),
  opacity: styleValue(z.number().min(0).max(1)).optional(),
  radius: styleValue(z.number().positive()).optional(),
  width: styleValue(z.number().positive()).optional(),
  /** Outline colour/width for polygons + lines — expression-capable, which is
   *  how "highlight the vacant ones" gets a heavier stroke as well as a fill. */
  outlineColor: styleValue(z.string()).optional(),
  outlineWidth: styleValue(z.number().nonnegative()).optional(),
});

export const MapLayerSchema = z.object({
  kind: z.enum(["points", "polygons", "lines", "heatmap", "cluster"]),
  source: MapGeometrySourceSchema,
  label: z.string().optional(),
  style: MapLayerStyleSchema.optional(),
}).superRefine((l, ctx) => {
  // polygons/lines need real geometry — a coordinate pair cannot express them.
  if ((l.kind === "polygons" || l.kind === "lines") && !("geometryColumn" in l.source))
    ctx.addIssue({ code: "custom", path: ["source"],
      message: `layer kind '${l.kind}' requires geometryColumn` });
});

export const MapSpecSchema = z.object({
  basemap: MapBasemapSchema.default("carto-light"),
  initialView: z.union([
    z.object({ center: z.tuple([z.number(), z.number()]), zoom: z.number() }),
    z.literal("fit"),
  ]).default("fit"),
  layers: z.array(MapLayerSchema).min(1).max(8),
  /** Mustache-style template over the feature's row fields. */
  popup: z.object({ template: z.string().min(1) }).optional(),
});
```

**Geo block content** (mirrors `d3-widget.contract.ts` exactly, handle branch first):

```ts
const GeoBaseContentSchema = z.object({
  spec: MapSpecSchema,
  title: z.string().optional(),
  pipeline: D3PipelineSchema.optional(),   // the shared durable descriptor
});
export const GeoInlineContentSchema = GeoBaseContentSchema.extend({
  rows: z.array(z.record(z.string(), z.unknown())),
});
export const GeoHandleContentSchema = GeoBaseContentSchema.extend(
  QueryHandleEnvelopeFieldsSchema.shape
);
export const GeoBlockContentSchema = z.union([GeoHandleContentSchema, GeoInlineContentSchema]);
```

**Two source kinds (revised 2026-08-02).** A layer's data arrives either as **inline GeoJSON** — rows already delivered by the sink, for small results — or from a **vector-tile source** pointing at #316's org-scoped `ST_AsMVT` endpoint, for large ones. `MapLayerSchema.source` therefore gains a tile variant alongside `geometryColumn` / lat-lng, and the widget maps it to a native MapLibre vector source. This is what makes "large geometry dataset" a server concern rather than a client limit: tiles transfer only the viewport, simplified per zoom, so `MAP_LAYER_FEATURE_CAP` applies to the inline path only. #314 pins the exact discriminant.

**Escape hatch (contract reserved, not implemented in #314).** `GeoBaseContentSchema` carries an optional `program: z.string().min(1).optional()`. `visualize_map` never emits it and the #314 renderer ignores it; reserving the field now means a future child can add a codegen path + a network-permitted sandbox runtime (CSP allowlisting only the tile host) without changing the block type, the pinned-content schema, or any persisted row. The renderer's contract is: **`program` present ⇒ sandbox path, else spec path** — so the two can coexist per block rather than as a global mode.

### `packages/core/src/contracts/pinned-result.contract.ts`

```ts
PINNED_CONTENT_SCHEMAS.geo = GeoInlineContentSchema;   // the #312 seam
```

### `packages/core/src/constants/large-data-ops.constants.ts`

```ts
/** Max features rendered per map layer (#84). Bounds the client; the wire
 *  payload is already bounded by the sink threshold + handle snapshot cap. */
export const MAP_LAYER_FEATURE_CAP = 10_000;
/** Geocode address-cache TTL — results are effectively static. */
export const GEOCODE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
```

### `packages/core/src/registries/builtin-toolpacks.ts`

Slug `"gis"` appended to `BuiltinToolpackSlugSchema` (`:32-40`); `GIS_PACK` spec literal (`iconSlug: "Map"` — geo-themed; `TravelExplore` is already taken by `web_search`, and the exact glyph is adjustable since the CI guard only requires *an* entry in `tool-pack-icons.util.ts`), appended to `BUILTIN_TOOLPACKS`; nine `CAPABILITIES` entries:

| Tool | costHint | consumption | production | resultKind | computeShape |
|---|---|---|---|---|---|
| `visualize_map` | free | engine-pushdown | `{kind:"rows", onLarge:"handle"}` | `geo` | reduce |
| `geocode`, `reverse_geocode` | metered | none | `{kind:"value"}` | scalar | map |
| `compute_distance`, `centroid`, `buffer` | free | none | `{kind:"value"}` | scalar | map (`pure: true`) |
| `compute_bounding_box` | free | streaming | `{kind:"value"}` | scalar | reduce |
| `point_in_polygon`, `reproject` | free | streaming | `{kind:"rows", onLarge:"handle"}` | data-table | map |

`point_in_polygon` / `reproject` are **single dual-mode tools** (#158): `withComputeInput` (`compute-input.util.ts:35-64`) adds `rows` XOR `queryHandle`; inline single-geometry params live alongside. `tier-catalog.ts` needs **no edit** — `pro` (`:130`) and `enterprise` (`:152`) spread `[...BuiltinToolpackSlugSchema.options]`; `standard`/`plus` enumerate and correctly omit `gis`.

### `apps/api` — tools

`GisService` (`src/services/gis.service.ts`) holds the math over per-module turf (`@turf/distance`, `@turf/boolean-point-in-polygon`, `@turf/centroid`, `@turf/bbox`, `@turf/buffer`) + `proj4`; tools stay thin `Tool` subclasses (`types/tools.ts:3-18`), one file each in `src/tools/`. Output **only** via `resolveResultSink` / `resolveSqlDelivery` (`no-open-coded-sink.test.ts` enforces it).

- `geocode({ address })` → `{ lat, lng, formattedAddress, confidence, cached }`; `reverse_geocode({ lat, lng })` → `{ address, components, confidence, cached }`.
- `GeocodingProvider` (`src/services/geocoding/provider.ts`): `{ geocode(address): Promise<GeocodeHit>; reverseGeocode(lat, lng): Promise<ReverseHit> }`; `MapboxGeocodingProvider` is the only implementation. Missing `environment.GEOCODING_API_KEY` throws at `build()` (the `web-search.tool.ts:20-23` precedent).
- Cache: `geocode:v1:<provider>:<normalized-address>` (lowercase, trim, collapse whitespace), `GEOCODE_CACHE_TTL_MS`, **global** (address→coords is org-independent public data).
- Zero-charge: `registerCostResolver("geocode", async (input) => (await cacheHas(input)) ? 0 : 1)` (+ the same for `reverse_geocode`) — legal because `CostResolver` returns `number | Promise<number>`.
- `visualize_map({ sql, spec, title? })`: validates `spec` with `MapSpecSchema`, calls `resolveSqlDelivery`, emits `{ type: "geo", spec, pipeline: { sql, stationId, organizationId }, rows | …envelope }`. `resolveDisplayBlock` (`portal.service.ts:191`) gains a `geo` arm beside `d3 :209`.

### `apps/api` — bulk geocode job

`job.model.ts`: `JobTypeEnum` (`:38-46`) + `"bulk_geocode"`; `BulkGeocodeMetadataSchema` (JSDoc declaring the locked ids) `{ connectorEntityId, sourceColumnKey, targetColumnKey, portalId, expectedRecords }`; `BulkGeocodeResultSchema` `{ geocoded, cached, failed, durationMs }`; `JobTypeMap` (`:430`), `JOB_TYPE_SCHEMAS` (`:460`), and `JOB_LOCK_KEYS` (`:520-531`) entry `{ targetConnectorEntityIds, portalId }` mirroring `bulk_transform`.

Tool `bulk_geocode_records`: ack-gate via `CostAcknowledgementService.computeJobSignature` → `BULK_DISPATCH_COST_NOT_ACKNOWLEDGED` on first call (the `transform-entity-records.tool.ts:572-621` pattern), `assertConnectorEntityUnlocked` (`job-lock.service.ts:137`), enqueue via `JobsService`, returns `{ jobId, expectedRecords, blockKind: "bulk-job-progress", blockContent }`. `resultKind: "progress"` ⇒ the wrap sets `deferChargeToJob` (`tools.service.ts:750`); the processor (`queues/processors/bulk-geocode.processor.ts`) charges `commitCharge({ toolCallId: "job:<jobId>", units: <successful uncached geocodes> })` — retry-safe by dedup key.

### `apps/api` — codes, env, inference

`api-codes.constants.ts`: `GEOCODE_PROVIDER_UNAVAILABLE`, `GEOCODE_ADDRESS_UNRESOLVED`, `GIS_GEOMETRY_INVALID`, `GIS_CRS_UNSUPPORTED`, `MAP_SPEC_INVALID` (+ recommendation entries). Provider/geometry failures return **typed tool results**, never fabricated coordinates.

`environment.ts:49` gains `GEOCODING_API_KEY`; `infra/cloudformation/backend.yml` mirrors `TAVILY_API_KEY`'s three sites (`:59` parameter, `:232` task-role grant, `:489-490` container secret); `.env.example` updated.

Inference (`adapters/rest-api/inference.util.ts:55-65`): before the object→`json` collapse, detect `{type, coordinates}` | `{rings|paths, spatialReference}` | `{type:"Feature", geometry}` → suggest `geoRole: "geometry"`; numeric columns whose key matches `/^(lat|latitude)$/i` (range ⊂ [-90, 90]) or `/^(lon|lng|long|longitude)$/i` (⊂ [-180, 180]) → `"lat"` / `"lng"`. `classifier.haiku.ts:71-82` response gains optional `suggestedGeoRole`. New `adapters/rest-api/geometry.util.ts`: `normalizeGeometry(value): GeoJSON | null` — ArcGIS rings/paths → GeoJSON, `wkid 102100 | 3857` → WGS84 via `proj4`, idempotent on already-WGS84 GeoJSON; called from the transform hop (`transform.util.ts`).

`station-context.tool.ts:266,310` emits `geoRole` per column so the agent routes by declaration.

### `apps/web`

- `src/modules/MapWidget/` — `MapWidget.component.tsx` (container + `MapWidgetUI`), `MapWidgetGate.component.tsx` (in-view mount, mirroring `D3WidgetGate:48`), `utils/register.util.tsx` → `registerBlockRenderer("geo", …)` called from `main.tsx`, `utils/maplibre-loader.util.ts` (`React.lazy` + dynamic import), `__tests__/`, `stories/`. Reuses the shared `useWidgetRefresh` (now at `src/utils/`, message **and** pin refs) and the status-chip/`onHeight` chrome vocabulary. Interactions: pan/zoom, click→popup from `spec.popup.template`, hover highlight, fit-to-bounds, basemap keyed to the MUI theme (`carto-light`/`carto-dark`) with attribution control always on. Per-layer features clamped to `MAP_LAYER_FEATURE_CAP` with a visible "showing first N" note.
- `vite.config.ts` — first `build.rollupOptions.output.manualChunks` entry isolating `maplibre-gl`.
- `EditColumnDefinitionDialog` / `CreateColumnDefinitionDialog` — a `geoRole` `Select` (None / Geometry / Latitude / Longitude). **No transition allowlist involvement**: `geoRole` is not the storage type, so `ALLOWED_TYPE_TRANSITIONS` / `BLOCKED_TYPES` are untouched.
- `utils/tool-pack-icons.util.ts:38-47` — a `gis` entry (CI-guarded, #303).
- `utils/glossary.util.ts`, `faq.util.ts` — geospatial column role, map visualization, geocoding.

## Migration

`npm run db:generate -- --name add-column-definition-geo-role` — one nullable `geo_role text` column on `column_definitions` (`drizzle-zod` + `type-checks.ts` re-derive; build fails on drift). **No enum migration** (the revised design touches no pg enum) and **no backfill**: existing rows get `NULL`, and the seed below plus inference populate roles going forward.

## Seed

`SYSTEM_COLUMN_DEFINITIONS` (`apps/api/src/services/seed.service.ts:31`) gains three canonical `system: true` rows, matching how `email` / `name` / `address` already work — so a field mapping can adopt a geo role without inference:

| key | label | type | geoRole | notes |
|---|---|---|---|---|
| `geometry` | Geometry | `json` | `geometry` | "GeoJSON geometry in WGS84 (EPSG:4326)" |
| `latitude` | Latitude | `number` | `lat` | validation message names the −90…90 range |
| `longitude` | Longitude | `number` | `lng` | −180…180 |

Every existing row keeps `geoRole: null`. The pre-existing `address` (string) definition is the bulk-geocode input column — no new seed needed for it. Seeding is idempotent (upsert by `key`), so re-running `db:seed` on a populated org is safe.

## TDD test plan

Per package — `npm run test:unit`, plus `npm run test:integration` in `apps/api`. Never raw jest.

### `packages/core` — `__tests__/contracts/map-spec.contract.test.ts` (new), `pinned-result.contract.test.ts`, `models/column-definition.model.test.ts`, `registries/builtin-toolpacks.test.ts`, `registries/tool-capabilities.test.ts`

MapSpec: defaults applied; ≥1 and ≤8 layers; `polygons`/`lines` reject a lat/lng source; `colorBy` accepted (incl. explicit `stops`); **an expression is accepted anywhere a literal style value is** (`["case", ["==", ["get","prop_class"], "vacant"], "#ff8a00", "#cfd8dc"]`) and a non-array garbage value is rejected; nested expressions recurse; an optional `program` field parses but is ignored by the spec path; geo block union resolves handle-first. `PINNED_CONTENT_SCHEMAS.geo` now defined and accepts the inline shape. `geoRole` nullable + rejects unknown roles; `ColumnDataTypeEnum` **unchanged** (regression pin). Pack count 7→8; every GIS tool has a capability; costHint pin extended; coherence holds (`geo` ⇒ `rows`). ≈ 16 cases.

### `apps/api` unit — `__tests__/services/gis.service.test.ts`, `geocoding/*.test.ts`, `__tests__/tools/visualize-map.tool.test.ts`, `adapters/rest-api/geometry.util.test.ts`, `inference.util.test.ts`, `__tests__/services/tools.service.test.ts`

*(The turf/dual-mode tool cases below are void — those tools are dropped; #316 tests `ST_*` correctness against PostGIS itself and #314 tests the render path.)* Geocode: provider hit, **cache hit returns `cached: true` and resolver yields 0 units**, provider down → typed `GEOCODE_PROVIDER_UNAVAILABLE`, unresolvable address → `GEOCODE_ADDRESS_UNRESOLVED`, missing key throws at build. `visualize_map`: invalid spec → `MAP_SPEC_INVALID`; inline vs handle both routed through the sink; block shape asserted. `geometry.util`: ArcGIS rings→GeoJSON, wkid 102100 reprojected, idempotent on WGS84, invalid → `null`. Inference: the three geometry shapes → `"geometry"`; lat/lng names+ranges → roles; out-of-range numeric not tagged. Cost-gate wrap guard enumerates `gis`. Prompt regression: **no `ST_*` token appears in agent-facing tool descriptions or `system.prompt`** (the drift fix), and the geo guidance names the compute-upstream idiom. ≈ 36 cases.

### `apps/api` integration — `__integration__/routes/…`, `__integration__/queues/bulk-geocode.integration.test.ts` (new)

Seeded geo definitions exist and are idempotent across two `db:seed` runs; a `geoRole` update round-trips via the column-definition route; `station_context` emits `geoRole`; `bulk_geocode` — first call returns the ack rejection, acked call enqueues + locks (a competing mutation gets `409 ENTITY_LOCKED_BY_JOB`), processor writes GeoJSON Points and charges once with `toolCallId: "job:<id>"`, re-run is idempotent. ≈ 9 cases.

### `apps/web` — `modules/MapWidget/__tests__/*`, `__tests__/{EditColumnDefinitionDialog,CreateColumnDefinitionDialog}.test.tsx`, `tool-pack-icons` guard, `glossary.util.test.ts` / `faq.util.test.ts`

MapWidget UI: points-only, polygons-only, mixed, heatmap, cluster, empty state, error state, fit-to-bounds, popup template, feature-cap notice, theme-keyed basemap; **an expression-styled layer renders and a malformed expression falls into the widget error state**; `colorBy` renders a legend; renderer registration dispatches a `geo` block; the gate mounts only in view. `geoRole` select renders, submits, and clears to null. Icon + glossary/FAQ pins. ≈ 18 cases.

**Totals ≈ 79 cases as drafted; the per-child plans restate them** (the dropped-tool cases fall away, and #316 adds extension/typed-column/tile cases). The migration needs no dedicated test (dual-schema type-checks + the integration suite cover it); the seed does (idempotency case above).

## Acceptance criteria

- A Pro/Enterprise station lists the GIS pack with its icon; Standard/Plus surface it as not-on-tier and its tools are uncallable.
- The parcel walkthrough passes: ArcGIS FeatureServer → JSONata → sync stores WGS84 GeoJSON with `geoRole: "geometry"` → *"show all vacant parcels on a map, colored by zoning"* → `visualize_map` → interactive map; clicking a parcel pops its address + class.
- A ≥100-feature result arrives as a query handle, a small one inline; both render through the same `geo` path with no open-coded threshold.
- A map block re-executes through widget-refresh **and pins**, materializing + refreshing like any durable block.
- A table with `lat`/`lng` numeric columns and no geometry column plots as points.
- The conditional-highlight case works without codegen: *"show all the parcels in Salt Lake County and highlight the vacant ones"* renders one polygons layer whose fill and outline come from a `case` expression (or `colorBy`), with a legend generated from the spec. A malformed expression shows the widget's typed error state rather than a blank or mis-styled map.
- `geocode` resolves sanity addresses; a repeat address is served from cache at **zero units**; provider-down / unresolvable / quota-exhausted paths surface as typed results the agent relays — never invented coordinates; successful calls itemize in the usage ledger.
- `bulk_geocode` requires the ack, locks its entity (mutations 409), writes GeoJSON Points into the target column, reports via the progress block, and charges once.
- Column-wide `point_in_polygon`/`reproject` operate over a handle at any N; `compute_bounding_box` folds a handle to one bbox; `reproject` round-trips 3857↔4326 within 1e-6; `point_in_polygon` agrees with turf on fixtures.
- Seeded `geometry` / `latitude` / `longitude` definitions are available for field mapping; a user can set or clear any column's `geoRole`, and the agent sees it in `station_context`.
- All pins/guards pass with `gis`: pack count, costHint, capability coherence, cost-gate wrap, `no-open-coded-sink`, `system.prompt`, tool-pack icons.

## Risks & rollback

- **Provider spend** — bounded by the org's metered quota + per-minute rate (existing gate), the global address cache, and the ack gate on the bulk path. Gate infra errors keep the documented **fail-open** posture: acceptable because a geocode unit is cheap and the provider key carries its own ceiling; the alternative (fail-closed) would break maps on a Redis blip.
- **Bundle weight** — MapLibre is lazy + own chunk; a regression shows up as main-chunk growth in the build output.
- **Reprojection correctness** — only 3857↔4326 is guaranteed; other CRS return typed `GIS_CRS_UNSUPPORTED` rather than silently wrong coordinates.
- **Codegen deferral is deliberate, not an oversight** — the reserved `program` field means adopting a sandboxed map program later is additive. The security reason it is not in #314: a map sandbox must grant network access to model-authored JS, unlike the d3 sandbox's `default-src 'none'`. Whoever picks that up owns a tile-host-only CSP allowlist and an exfiltration review.
- **Rollback** — the pack is data-gated: dropping `"gis"` from the slug enum (or a tier's list) removes the tools with no data migration; the `geo_role` column is additive and nullable, and seeded rows are `system` rows that can be soft-deleted. No destructive step to reverse.

## Files touched

- **core:** `models/column-definition.model.ts` · `contracts/{column-definition,map-spec,pinned-result,index}.ts` · `constants/large-data-ops.constants.ts` · `registries/builtin-toolpacks.ts` · tests
- **api:** `db/schema/column-definitions.table.ts` + `zod.ts` + `type-checks.ts` + `drizzle/<migration>` · `services/seed.service.ts` · `services/gis.service.ts` · `services/geocoding/{provider,mapbox,cache}.ts` · `tools/{visualize-map,geocode,reverse-geocode,compute-distance,point-in-polygon,centroid,buffer,compute-bounding-box,reproject,bulk-geocode-records}.tool.ts` · `services/tools.service.ts` · `services/portal.service.ts` · `services/cost-gate.service.ts` (resolver registration) · `constants/api-codes.constants.ts` · `models`→`job.model.ts` (core) + `queues/processors/bulk-geocode.processor.ts` + `queues/processors/index.ts` · `adapters/rest-api/{inference.util,classifier.haiku,classifier.prompt,transform.util,geometry.util}.ts` · `tools/station-context.tool.ts` · `tools/transform-entity-records.tool.ts` (ST_* drift fix) · `prompts/system.prompt.ts` · `environment.ts` · `config/swagger.config.ts` · `infra/cloudformation/backend.yml` · tests
- **web:** `modules/MapWidget/**` · `main.tsx` · `vite.config.ts` · `components/{Edit,Create}ColumnDefinitionDialog.component.tsx` · `utils/{tool-pack-icons,glossary,faq}.util.ts` · tests + stories
- **docs:** `README`/toolpack docs · `CUSTOM_TOOLPACK_INTEGRATION.md` untouched (no wire-contract change)

## Next step

`/plan 84` slices this into TDD commits on this branch — roughly: (1) `geoRole` contract + migration + seeds; (2) `GisService` + the six pure spatial tools + capabilities/pins; (3) streaming/dual-mode forms; (4) MapSpec + `visualize_map` + the `geo` display arm + the pinned-content entry; (5) MapWidget module + renderer + chunking + stories; (6) geocoding provider + cache + zero-unit resolver; (7) `bulk_geocode` job + lock + progress; (8) inference + ArcGIS normalization + `station_context`; (9) prompt/doc/icon sync + smoke. Slices 1–5 need no external key; 6–7 need `GEOCODING_API_KEY` provisioned in app-dev.
