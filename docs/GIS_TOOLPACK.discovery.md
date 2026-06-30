# GIS toolpack + map visualization — Discovery

**Issue:** [EnterpriseBT/portal-ai#84](https://github.com/EnterpriseBT/portal-ai/issues/84)

**Depends on:** [#169](https://github.com/EnterpriseBT/portal-ai/issues/169) — the uniform tool cost gate + per-org usage tier. The runaway-spend problem is **not** GIS-specific (`web_search` is unguarded today), so the cost-containment surface lives in #169 and GIS *consumes* it. This doc therefore stops designing bespoke per-tool guards; it decides only what GIS *declares* (`costHint` per tool) and the one genuinely geocode-local concern (address-result caching).

**Why this exists.** Connectors already pull in records carrying geometry — ArcGIS FeatureServer queries return `{rings, spatialReference: {wkid: 102100}}` (Web Mercator) — but that geometry lands as opaque JSON in a JSONB cell with no way to query or render it. This work adds a built-in **GIS** toolpack (geocode/distance/spatial-predicate/buffer/centroid/reproject + a `visualize_map` tool) and the frontend map widget that renders it. Two of the tools — `geocode` / `reverse_geocode` — wrap an **external, metered provider**; rather than re-solve runaway cost here, they declare `costHint: "metered"` and route through #169's gate like any other metered tool. The cardinality concern ("support large datasets whatever the operation") is likewise *already solved* by the `consumption`/`production` surfaces (#152/#159/#161) — GIS just declares it per tool. What's left for this doc: the provider choice, the map renderer, the geometry column type, and the per-tool capability declarations.

## The current shape

### Toolpack + tool registration

| Concern | Where | Notes |
|---|---|---|
| Hand-authored registry | `packages/core/src/registries/builtin-toolpacks.ts` | `BUILTIN_TOOLPACKS` = specs (description + param schema); `CAPABILITIES` matrix attached via `attachCapabilities()` (`builtin-toolpacks.ts:1166`) so capability never drifts from the spec |
| Tool impls | `apps/api/src/tools/*.tool.ts` | One `Tool` subclass per tool; `ToolService.buildTools()` (`tools.service.ts:200+`) instantiates each and calls `.build(stationId, organizationId)` → `ai.tool()` |
| External-metered precedent | `apps/api/src/tools/web-search.tool.ts:1` | Wraps Tavily via `tavily({ apiKey: environment.TAVILY_API_KEY })`; declares `costHint: "metered"` (`builtin-toolpacks.ts:1124`). **No rate limit, no pre-flight cost check, no quota** — it just calls out and errors if Tavily's own key-level quota is hit |
| `rows`/handle precedent | `apps/api/src/tools/visualize.tool.ts:43` | Calls `resolveSqlDelivery()`; inline path bakes rows into the spec, handle path rewrites the spec for a named dataset + returns an envelope |

### Cost control as it exists today (topic the issue cares about)

There are **two** mechanisms, and neither currently covers a single interactive external call:

1. **`CostAcknowledgementService`** (`apps/api/src/services/cost-acknowledgement.service.ts:1`) — the server-enforced gate behind `costHint: "expensive"`. Flow: first call with no `acknowledgeCost` → `recordRejection(portalId, signature, now)` writes `{rejectedAt}` to Redis (15-min TTL) and the route returns `BULK_DISPATCH_COST_NOT_ACKNOWLEDGED`. Retry with `acknowledgeCost: true` → `validate()` checks a pending entry exists **and the portal's latest *user* message timestamp is later than `rejectedAt`** (`:130`). That "a human spoke between the rejection and the retry" check is the objective, non-spoofable gate — it's why the convention is *server* enforcement, not a prompt instruction. **Built for bulk jobs**: the signature hashes `(source/target entity, expression, keyField, batchSize)`. It is the right gate for "geocode this entire column," and the wrong gate for "geocode one address" (forcing a confirmation dance per lookup is absurd).
2. **`token-bucket.util.ts`** (`apps/api/src/utils/token-bucket.util.ts:1`) — a pre-loaded, 1-Hz-refilled token bucket. **Used in exactly one place**: `bulk-transform-tool.dispatcher.ts` throttles per-record tool calls. It is *not* wired to any route, any org, or any external API. There is **no per-org rate-limit middleware and no usage quota anywhere in the codebase.**

So for the runaway-cost concern, we are starting from zero on the interactive path — `web_search` is the only external-metered tool and it has no guard rails at all.

### External providers + secrets

`environment.ts:1` loads all API keys from **plain env vars** at runtime — `TAVILY_API_KEY`, `ANTHROPIC_API_KEY`, OAuth secrets. The secrets themselves live at rest in **AWS Secrets Manager** (declared in the CloudFormation template) and are **injected into the environment as plain env vars by CI/CD** — the app code never calls the Secrets Manager API directly. So a new provider key follows the same path: add it to Secrets Manager + the CloudFormation template, let CI/CD inject it as `GEOCODING_API_KEY`, and read it from `environment.ts` in the tool's `.build()`, mirroring `web-search.tool.ts:21`. (The issue body's `SECRET_ARN_GEOCODING_API_KEY` framing is half-right — the ARN lives in CloudFormation, but the *tool* sees a plain env var, not the ARN.)

### Output cardinality / result-sink

`production` is live on `ToolCapability` (`tool-capability.model.ts:120`); `resolveResultSink` / `resolveSqlDelivery` (`apps/api/src/tools/result-sink.ts`) is the single inline-vs-handle gate. `visualize_map` → `production: { kind:"rows", onLarge:"handle" }`, `resultKind:"geo"` (already in the enum, `tool-capability.model.ts:79`). The eight other GIS tools → `{ kind:"value" }`. (This was already reconciled into the ticket body.)

### Frontend renderer registry

`packages/core/src/ui/ContentBlockRenderer.tsx:297` holds an open `blockRenderers` map; `registerBlockRenderer("geo", fn)` (`:312`) self-registers with no central-switch edit. `QueryResultDataBlockUI` (`QueryResultDataBlock.component.tsx:44`) shows the hydration: handle → `sdk.portalSql.handleSnapshot()` → rows injected into the block alongside the spec. A `geo` renderer follows the Vega-Lite pattern verbatim.

### Column-type inference + geometry

`ColumnDataType` (`column-definition.model.ts:17`) is `string | number | boolean | date | datetime | enum | json | array | reference | reference-array` — **no `geometry`** (the issue body's enum list is also stale). Geometry currently classifies as `json`. The heuristic (`adapters/rest-api/inference.util.ts:55`) buckets by `typeof`; the Haiku classifier (`classifier.haiku.ts:87`) refines semantic type in batches.

## The design space

### Decision 1 — What GIS declares for cost (runaway protection lives in #169)

Runaway-spend protection (per-org rate limit, rolling quota, the `expensive` ack gate) is #169's job — every metered tool, GIS or not, routes through `resolveCostGate`. GIS's only obligations here are **(a) declare the right `costHint` per tool** and **(b) decide the one geocode-local optimization: address-result caching.**

**`costHint` per tool:** the two external-provider tools (`geocode`, `reverse_geocode`) are `metered` — #169's gate then rate-limits + quota-caps them per org. The six pure-compute spatial tools and `visualize_map` are `free` (no external call; `visualize_map`'s cost is bounded by the SQL/handle path, not a metered API). **There is no `expensive` GIS tool in v1** — a bulk "geocode an entire column" tool *would* be `expensive` (consuming #169's ack gate), but it's deferred (see *What this doesn't decide*).

**Address-result cache (the one GIS-local guard worth keeping):** even with #169's quota, re-geocoding the *same* address in a loop wastes budget. A Redis cache keyed by normalized address (lowercase/trim/collapse-whitespace), long TTL, returns `$0` cache hits *before* the call counts against the quota. This is geocode-specific (it keys on address semantics), so it lives in the `geocode` tool/service, not in #169's generic gate.

| | A — rely on #169 only | B — #169 + address cache |
|---|---|---|
| Runaway loop bounded | Yes (quota) | Yes (quota) + repeats are free |
| Wasted budget on repeated addresses | Counts against quota | **Eliminated** |
| New GIS-local infra | none | one Redis cache keyed by address |

**Lean: B.** The cache is cheap, geocode-specific, and removes the most common loop-waste pattern before it touches the shared quota. Everything else (the actual ceiling) is #169.

### Decision 2 — Geocoding provider

| | Mapbox | Google | OpenCage | Nominatim (self-host) |
|---|---|---|---|---|
| Cost model | per-1k, free tier | per-1k, priciest | per-1k, independent | **$0 marginal** (infra + usage policy) |
| Map-tile synergy | same vendor as MapLibre tiles | — | — | — |
| Runaway-$ risk | yes (mitigated by D1) | yes | yes | **none** |
| Ops burden | none | none | none | high (host + import planet/region) |

**Lean: Mapbox for v1**, behind #169's gate + the address cache. Self-hosted Nominatim is the only option that makes runaway cost *structurally* impossible, but it's a separate infra lift; note it as the escape hatch if provider spend ever becomes a real problem. The geocoding provider should sit behind a provider-agnostic interface so swapping to Nominatim later is a config change, not a tool rewrite.

### Decision 3 — Map rendering library

**Lean: MapLibre GL** (as the ticket sketched) — MIT, vector tiles, free tile providers (CARTO/OSM), no token required for the *map* (only geocoding needs a key). Flag the bundle weight (~200 KB gzipped) for lazy-loading the `geo` renderer so it doesn't bloat the main chunk. Leaflet is the fallback if bundle size dominates; Mapbox GL is rejected (commercial token for the map itself).

### Decision 4 — Geometry as a column type

**Lean: add `"geometry"` to `ColumnDataType`**, detect GeoJSON / ArcGIS / `{type:"Feature"}` shapes in the heuristic (`inference.util.ts`), nudge the classifier prompt to recognize it, and reproject ArcGIS Web-Mercator → WGS84 on import in a new `apps/api/src/adapters/rest-api/geometry.util.ts` (coord reprojection is too hairy for a user-written JSONata expression — it belongs in the adapter). The pure-compute spatial tools (`point_in_polygon`, `centroid`, `buffer`, `reproject`, `compute_distance`, `compute_bounding_box`) need no provider and no guard — they're `pure: true` like the math tools.

### Decision 5 — Input cardinality: "large datasets whatever the operation"

The spatial tools split by how many geometries they touch, and the issue's sketch (inline `{ geometries: GeoJSON[] }`, `{ polygon: … }`) only works for *small* inputs baked into the tool call. To scale them to a full imported parcel set without putting 10k geometries in the agent's context, they must declare `consumption` (the input mirror of `production`, #152/#159) and read from a **query handle**, not an inline array. This is free surface — it already exists — but it has to be *declared* per tool, which the issue doesn't do.

| Tool | Touches | `consumption` | `production` | `resultKind` |
|---|---|---|---|---|
| `compute_distance` | 2 points | `none` (inline params) | `value` | `scalar` |
| `point_in_polygon` | 1 point, 1 polygon (or N points) | `none` inline; **`streaming`** for the N-points-vs-polygon form | `value` (1 pt) / `rows` (N pts → per-point flags) | `scalar` / `data-table` |
| `centroid` | 1 geometry | `none` | `value` | `scalar` |
| `buffer` | 1 geometry | `none` | `value` | `scalar` |
| `reproject` | 1 geometry (or a set) | `none` inline; **`streaming`** for a column reproject | `value` / `rows` | `scalar` / `data-table` |
| `compute_bounding_box` | N geometries (a reduce) | **`streaming`** (fold over a handle, like `portfolio_metrics`) | `value` | `scalar` |
| `geocode` / `reverse_geocode` | 1 address/point | `none` | `value` | `scalar` |
| `visualize_map` | N rows (SQL) | `engine-pushdown` | `rows`, `onLarge:"handle"` | `geo` |

**Lean: declare the per-tool `consumption` above from day one.** The single-geometry tools stay inline (`none`); the genuinely set-valued operations — `compute_bounding_box` (reduce over many), and the column-wide forms of `point_in_polygon` / `reproject` — declare `streaming` so they fold over a source handle and scale to any N, exactly as `portfolio_metrics` / `technical_indicator` already do. That is what "large datasets whatever the operation" means concretely: the operation reads a handle, not an inline blob, and emits a `value` (reduce) or a `rows`/handle (map) per its `production`. **Open question:** whether v1 ships the streaming column-wide forms or only the inline single-geometry forms (see Open Questions).

## Tradeoff comparison

| | D1: cost declaration + cache | D2: Mapbox | D3: MapLibre | D4: geometry type | D5: consumption |
|---|---|---|---|---|---|
| Spread to spec | Yes — `costHint` per tool + address cache | Yes — provider iface + env var | Yes — lazy `geo` renderer | Yes — enum + heuristic + reproject util | Yes — `consumption` per tool |
| Blocks the smoke target if cut? | No (parcels have geometry) | No | **Yes** | **Yes** | No (inline forms suffice for the smoke) |
| Reuses existing infra | **#169 gate** + Redis cache | web_search pattern | renderer registry | inference + classifier | record-source / streaming reduce |

## Recommendation

1. **Runaway-spend protection is #169, not GIS.** `geocode`/`reverse_geocode` declare `costHint:"metered"` and route through #169's `resolveCostGate` for the per-org rate limit + rolling quota; GIS adds only a geocode-local Redis **address-result cache** (normalized key, long TTL) so repeated lookups never touch the quota. **This ticket is blocked on #169 landing the gate.**
2. **No `expensive` GIS tool in v1.** The bulk-column geocode tool (which *would* be `expensive` and consume #169's ack gate) is deferred — the smoke target's parcels arrive *with* geometry.
3. **Provider = Mapbox**, behind a provider-agnostic interface; key stored in AWS Secrets Manager (CloudFormation) and injected by CI/CD as a plain `GEOCODING_API_KEY` env var read from `environment.ts` — the same path as every other key; the tool never touches the Secrets Manager API.
4. **Map widget = MapLibre GL**, lazy-loaded via `registerBlockRenderer("geo", …)`; `visualize_map` is `resultKind:"geo"`, `production:{kind:"rows",onLarge:"handle"}`, `consumption:"engine-pushdown"`, routed through `resolveResultSink` with no open-coded threshold.
5. **Geometry column type** added to `ColumnDataType`, detected heuristically + by classifier, with ArcGIS→WGS84 reprojection on import in a new `geometry.util.ts`.
6. **Per-tool capability declarations from day one** — `costHint`, `consumption`, `production`, `resultKind` per the Decision-1 and Decision-5 tables. The single-geometry compute tools are `pure:true`, `consumption:"none"`, `value`-producing; the set-valued forms (`compute_bounding_box`, column-wide `point_in_polygon`/`reproject`) declare `consumption:"streaming"` so they scale to any N off a handle.

## Open questions

1. **Sequencing against #169.** GIS's metered tools can't ship guarded until #169's gate exists. Do we hard-block GIS on #169 merging, or build GIS behind a feature flag and flip it on when #169 lands? **Lean: hard-block the *metered* tools (`geocode`/`reverse_geocode`) on #169; ship the pure-compute + `visualize_map` slices first** — they have no metered call and need nothing from #169, so the bulk of GIS proceeds in parallel and only the two geocoding tools wait.
2. **What does the agent see when #169's quota trips?** **Lean: #169's typed `TOOL_USAGE_QUOTA_EXCEEDED`** surfaces to the agent so it can tell the user "geocoding budget is exhausted" — never a silent skip that fabricates coordinates. (Owned by #169; noted here so the GIS tool's error handling expects it.)
3. **Cache key normalization + TTL** (GIS-local, Decision 1B). **Lean: normalize (lowercase, trim, single-space) and a 30-day TTL** — geocoding results are effectively static and the cache removes the most common loop-waste before it reaches #169's quota.
4. **Streaming column-wide forms in v1, or inline-only?** The set-valued `consumption:"streaming"` forms of `point_in_polygon`/`reproject` (Decision 5) scale to a full column but are more to build/test than the inline single-geometry forms. **Lean: ship `compute_bounding_box` streaming (it's a natural reduce and the smoke's "fit to bounds" wants it) but defer the column-wide `point_in_polygon`/`reproject` to v1.5** — the inline forms cover the agent's interactive use; the column-wide forms are an optimization, not a capability gap.
5. **Reprojection scope.** Only EPSG:3857↔4326 (the ArcGIS case), or the generic `proj4` surface? **Lean: ship the generic `proj4` surface but only *test/guarantee* 3857↔4326** for v1 — the generic path is nearly free once `proj4` is in, and it future-proofs other connectors.

## What this doesn't decide

- **The cost gate itself + per-org tiering/monetization** — that's #169. GIS only *declares* `costHint` and consumes the gate. The runaway-spend ceiling, the per-org tier, and any pricing live there.
- **The bulk-column geocode tool** (geocode every address in an entity). It's `expensive` and would consume #169's ack gate, but the smoke target doesn't need it and shipping it expands the cost surface. Deferred; dedups via the address cache when it lands.
- **Column-wide `point_in_polygon` / `reproject` streaming forms** — deferred to v1.5 (Open Q4); inline single-geometry forms ship in v1.
- **PostGIS / SQL-level spatial queries.** Geometry stays in JSONB; spatial predicates are tool-driven. Deferred — a separate, bigger lift (the survey notes the wide-table pgType *can* hold PostGIS types, but pushing queries down is out of scope).
- **Vector-tile self-hosting, drawing tools, real-time geofencing, 3D/terrain, routing/directions, heavy spatial analysis** — all from the ticket's out-of-scope, unchanged.
- **Self-hosted Nominatim.** Named as the structural-zero-cost escape hatch, but the provider-agnostic interface is the only v1 accommodation; actually standing it up is deferred.

## Next step

Write `docs/GIS_TOOLPACK.spec.md` (contract: the provider-agnostic geocoding interface + address-cache behavior, how the metered tools declare `costHint` and consume #169's gate, the `geometry` column-type rules, the per-tool `consumption`/`production` declarations, and the `visualize_map` MapSpec shape) and `docs/GIS_TOOLPACK.plan.md` (TDD slices). Likely slicing, ordered so nothing blocks on #169 except the two metered tools: (1) pure spatial tools + capability declarations, including `compute_bounding_box` streaming (no provider, fully testable in isolation); (2) `geometry` column type + ArcGIS reprojection; (3) `visualize_map` + the lazy `geo` renderer; (4) **[blocked on #169]** `geocode`/`reverse_geocode` behind a fake provider + the address cache, consuming `resolveCostGate`; (5) Mapbox provider wiring; (6) docs + smoke walkthrough. Each slice ships green and independently; slice 4 waits for #169's gate, the rest proceed in parallel.
