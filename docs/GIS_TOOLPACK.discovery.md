# GIS toolpack + map visualization — Discovery

**Issue:** [EnterpriseBT/portal-ai#84](https://github.com/EnterpriseBT/portal-ai/issues/84) (PRD rewritten 2026-07-31; this doc supersedes the June-29 discovery that lived on the deleted first `feat/gis-toolpack` branch)

> **Revised 2026-08-02 (second revision) — PostGIS goes first.** Spatial capability now lives in the **database**, not in Node: the epic gained a first child, [#316](https://github.com/EnterpriseBT/portal-ai/issues/316), which enables the PostGIS extension, makes `geometry` a real SRID-constrained column type with a GiST index, and normalizes geometry on import via `ST_*`. Consequences for the decisions below: **Decision 4's reversal is itself partly reversed** — `geometry` returns as a `ColumnDataType` (under PostGIS the storage genuinely differs, which was the exact condition the role-not-type argument depended on), while `geoRole` survives for `lat`/`lng` only; and **Decision 5's tool cardinality shifts from `streaming` folds to `engine-pushdown`**, because a spatial predicate belongs on an indexed column, not in a Node loop. The reasoning that produced the intermediate shape is left intact below — each step was correct for the substrate it assumed, and the sequence is the point.
>
> **Revised 2026-08-02 at spec time, two changes.** (a) **Decision 4 reversed:** `geometry` does *not* join `ColumnDataType`. Geometry is JSON and latitude is a number — storage type and geospatial meaning are orthogonal — so a single nullable `geoRole` annotation carries both the geometry case and the lat/lng-pair case (Decision 3), collapsing two mechanisms into one and avoiding an enum widening with no behavioural gain (`json` is already non-sortable, already JSONB; reprojection triggers on shape detection, not the label). This also dissolves the type-transition-allowlist question the enum would have raised. (b) **Map blocks pin:** #312 merged, pre-admitting `geo` to `PortalResultTypeSchema`, so the "not pinnable" note below is obsolete — GIS registers the `geo` entry in `PINNED_CONTENT_SCHEMAS` and inherits materialization + refresh. Open questions 1 and 2 are resolved (see their entries).

**Why this exists.** Connectors already import records carrying geometry — ArcGIS FeatureServer responses arrive as `{rings, spatialReference: {wkid: 102100}}` (Web Mercator) — but that geometry lands as opaque JSON in a JSONB cell: nothing can query, compute over, or render it. The PRD adds a built-in `gis` pack (spatial compute, metered geocoding, an expensive bulk-column geocode job, and `visualize_map`), a frontend map renderer, a `geometry` column type inferred and reprojected on import, and a lat/lng coordinate-pair hint — tier-gated to Pro/Enterprise. The PRD deliberately deferred three mechanisms to this doc: the map render path, the map library, and the geocoding provider. This is the doc that decides them against the post-Vega, post-cost-gate, tier-gated codebase.

## The current shape

### Toolpack registry + capability model

| Concern | Where | Note |
|---|---|---|
| Pack slug enum | `packages/core/src/registries/builtin-toolpacks.ts:32-40` | 7 packs; `gis` slot compile-checked by `tier-catalog.ts:41` |
| Pack spec shape | `builtin-toolpacks.ts:86-93` | `slug/name/description/iconSlug/tools[]`; `VISUALIZE_PACK :221-256` is the closest template |
| Capability matrix | `builtin-toolpacks.ts:1053-1189` + `attachCapabilities :1191` | throws for any tool without an entry; factories `pureMath :945`, `pureReduce :961`, `streamingReduce :981` fit the spatial tools |
| Coherence rules | `packages/core/src/models/tool-capability.model.ts:154-236` | `pure` ⇒ no reads/writes/locks; `writes[]` ⇒ `locks[]`; `geo` render ⇒ `production.kind: "rows"`. **`resultKind: "geo"` already reserved at `:77`** |
| Pins/guards | `packages/core/src/__tests__/registries/builtin-toolpacks.test.ts:14` (pack count), `tool-capabilities.test.ts:87-144` (costHint pin #186), `apps/api/src/__tests__/services/tools.service.test.ts:723` (cost-gate wrap guard), `system.prompt.test.ts` | all four suites gain GIS entries |

### Tool implementation, registration, dual-mode cardinality

`Tool<TSchema>` base (`apps/api/src/types/tools.ts:3-18`); thin tools delegating math to a service (`npv.tool.ts`); external-metered precedent `web-search.tool.ts:20-23` (env key, throws at build when unset, no hand-rolled cost logic). Registration in `tools.service.ts`: `ALL_TOOL_PACKS :146-154`, tier entitlement split `:425-447`, one `if (enabledPacks.has(…))` block per pack, then `wrapWithCostGate :720-753` with `deferChargeToJob: resultKind === "progress"` (`:750`).

**Cardinality is a runtime mode, not twin tools (#158).** `withComputeInput` (`apps/api/src/tools/compute-input.util.ts:35-64`) adds `queryHandle` XOR `rows` to any input schema; `record-source.ts:83-191` resolves either into a materialized set or an async batch stream. Precedents: `portfolio-metrics.tool.ts:88-105` (streaming reduce), `technical-indicator.tool.ts:62-95` (map-shaped, escalates to a transform handle past `INLINE_ROWS_THRESHOLD`). Output goes through `result-sink.ts:32-40`; the guard `no-open-coded-sink.test.ts` forbids hand-rolled thresholds. Column-wide `point_in_polygon`/`reproject` and streaming `compute_bounding_box` are therefore **pattern application, not new surface**.

### Cost gate, usage, ack, jobs

`cost-gate.service.ts`: `registerCostResolver :50-66` (per-call units), `checkAdmission :143-219` (typed `TOOL_USAGE_RATE_LIMITED` / `TOOL_USAGE_QUOTA_EXCEEDED` denials, fail-open on infra), `commitCharge :232-300` (bill-on-success #187: `UsageService.tryCharge` + #221 ledger row in one transaction, deduped by `toolCallId`). Tool-enqueued jobs exist twice: `transform-entity-records.tool.ts` (ack-gate branch `:572-621`, enqueue `:697`, returns `blockKind: "bulk-job-progress"`), charging from the processor via `commitCharge({ toolCallId: "job:<id>" })` (`bulk-transform.processor.ts:112-121`). New job types are four declarations in `job.model.ts` (`JobTypeEnum :38`, metadata/result schemas, `JobTypeMap :430`, `JOB_TYPE_SCHEMAS :460`) plus `JOB_LOCK_KEYS :520-531`; locking asserts throw `409 ENTITY_LOCKED_BY_JOB` (`job-lock.service.ts:98,137`). Redis for a geocode cache: `utils/redis.util.ts:10` (`getRedisClient`), key-namespacing precedent `utils/connector-cache-keys.util.ts`.

### The visualization pipeline (post-Vega)

`visualize_d3.tool.ts:19` takes `{ sql, instruction, title? }` — intent, never a program; `resolveSqlDelivery :101`; codegen loop (≤3 attempts) with typed `VISUALIZE_D3_CODEGEN_FAILED` fallback to a data-table. Block payload `{ type: "d3", program, pipeline, rows | handle-envelope }` where `pipeline = { sql, stationId, organizationId }` is the durable descriptor (`d3-widget.contract.ts:27`). Re-execution: `POST /api/portal-sql/widget-refresh` (`portal-sql-handle.router.ts:113`) → `portal-viz-refresh.service.ts:61-93` re-runs the SQL through the same sink. Display routing: `portal.service.ts:191` maps `resultKind` → block arm (`bulk-job-progress :196`, `d3 :209`, `data-table :224`) — **a `geo` arm is the only portal-layer change**. **Viz blocks do not pin**: `PortalResultTypeSchema` is `["text","data-table"]` (`portal-result.model.ts:13`), enforced at `portal-results.router.ts:159-167` (`docs/GATE_VIZ_PINNING.md`).

Frontend: `registerBlockRenderer("geo", …)` is already documented as the intended extension (`packages/core/src/ui/ContentBlockRenderer.tsx:12-18,66-72`); registration precedent `apps/web/src/modules/D3Widget/utils/register.util.tsx:11` from `main.tsx:10`. Handle hydration via `sdk.portalSql.handleSnapshot` (`QueryResultDataBlock.component.tsx:140`); widget chrome/status-chip vocabulary + `onHeight` (`D3Widget.component.tsx:68-90`); in-view render gating (`D3WidgetGate.component.tsx:48`); refresh/freshness (`use-widget-refresh.util.ts:43`). **The D3 sandbox iframe is not reusable for maps**: its srcdoc CSP forbids network (`sandbox-srcdoc.util.ts`), and MapLibre needs tile/glyph fetches; D3 is inlined as raw UMD text via a vite virtual module (`vite.config.ts:56-85`). The one `React.lazy` precedent is `PaginationToolbar.component.tsx:56`; no `manualChunks` config exists yet.

### Column types, inference, storage

`ColumnDataTypeEnum` (`column-definition.model.ts:17`) is a flat 10-value enum; `ColumnDefinitionSchema :42-52` has **no semantic/role slot** for a lat/lng pair (only `type/description/validationPattern/validationMessage/canonicalFormat/system`); `SORTABLE_COLUMN_TYPES :37` must exclude `geometry`. Heuristic inference collapses any object to `json` (`inference.util.ts:55-65`, truth table `:14-22`); the Haiku classifier's valid-type list widens automatically since its response schema reuses `ColumnDataTypeEnum` (`classifier.haiku.ts:71-82`), but the agent-facing type list at `system.prompt.ts:325` is hand-edited. Reprojection slots into the rest-api adapter's transform hop (`transform.util.ts`; ArcGIS quirks already live nearby: `fetch.util.ts:108-125`, `rest-api.adapter.ts:1170`). Storage: wide tables project `c_<key>` columns (`wide-table-projection.util.ts:30`) with `json → jsonb` in the reconciler (`wide-table-reconciler.service.ts:80-81`) — `geometry` needs a mapping there. **No PostGIS extension is declared anywhere**, yet `transform-entity-records.tool.ts:239` advertises `ST_Area(geometry::geography)` in its prompt — pre-existing drift this work must correct or confirm.

### Tiers, entitlements, pack inventory

`pro` (`tier-catalog.ts:130`) and `enterprise` (`:152`) spread `[...BuiltinToolpackSlugSchema.options]` — **Pro/Enterprise gating is automatic once the slug exists**; `standard :84` / `plus :104-109` enumerate explicitly and need no edit. Enforcement: `entitlement.service.ts:54-147` (`splitBuiltinPacks`), station write guard 403 (`station.router.ts:102`), `buildStationContext` pack inventory (`portal.service.ts:1062`). Web surfacing fails open (`use-builtin-entitlements.util.ts:35-53`); not-on-plan renders as a dashed chip + tooltip (`ToolPackChip.component.tsx:39-75`); `tool-pack-icons.util.ts:38-47` needs a `gis` icon entry (CI-guarded, #303). `portalops tier apply` ships catalog changes per env.

## The design space

### Decision 1 — `visualize_map` render mechanism

- **A — agent-authored declarative MapSpec.** Input `{ sql, spec, title? }`; `spec` is a Zod-validated declarative object (basemap, layers keyed to result columns, popup template). Deterministic: no codegen sub-call, no retry loop, no `CODEGEN_FAILED` fallback; validation errors are typed and instant. Block payload mirrors d3: `{ type: "geo", spec, pipeline, rows | handle }`.
- **B — codegen sub-call synthesizes the MapSpec.** Mirror `visualize_d3`'s intent-not-program stance: agent sends `instruction`, a Haiku call emits the spec. Adds latency, cost, and a retry/fallback path for a spec that is bounded enough for the main agent to author directly.
- **C — full program codegen in the D3 sandbox.** Not viable: the sandbox CSP forbids the network access MapLibre requires for tiles/glyphs; lifting it re-opens the sandbox's security posture for one renderer.

| | A — declarative spec | B — codegen spec | C — sandbox program |
|---|---|---|---|
| Determinism / failure modes | typed validation, no fallback | codegen retries + fallback | codegen + sandbox + CSP relax |
| Extra latency/cost per call | none | one Haiku call | one Sonnet-class call |
| Flexibility | bounded by MapSpec schema | same schema | unbounded (unneeded) |
| Fits durable `pipeline` refresh | yes | yes | awkward |

**Lean: A.** `visualize_d3` went codegen because D3 programs are unbounded; a map spec is a small closed vocabulary the agent can author directly — same reason it authors SQL. The spec schema lives in `packages/core/src/contracts` beside `d3-widget.contract.ts`.

### Decision 2 — Map widget: library, mount, loading

- **A — MapLibre GL, direct-mount `MapWidget` module.** MIT, vector tiles, no token for rendering. New `apps/web/src/modules/MapWidget/` mirroring D3Widget's gate/chrome/refresh utilities but mounting MapLibre directly (no iframe). Loaded via `React.lazy` + a `manualChunks` entry (~200 KB gzip kept out of the main chunk).
- **B — Leaflet.** Smaller, raster-only, sluggish at 10k features; weaker choropleth/heatmap story.
- **C — Mapbox GL / Google.** Commercial token for the *renderer itself*; rejected on principle for a per-view-billed dependency.

**Lean: A.** Direct mount is forced anyway (tile fetches vs sandbox CSP); MapLibre is the only option that is simultaneously free-to-render, vector-capable, and heatmap/cluster-capable.

### Decision 3 — Where the lat/lng coordinate-pair hint lives

- **A — per-column `geoRole` on `ColumnDefinitionSchema`.** Nullable `"lat" | "lng"` field; import inference sets it when confident (name match + numeric range check), user-overridable wherever column definitions are edited; `visualize_map` also accepts explicit `latColumn`/`lngColumn` spec fields as the final override.
- **B — entity-level pair annotation.** A `{lat, lng}` pointer on the connector entity; single source of truth per entity but a new concept, and breaks when an entity has two coordinate pairs (origin/destination).
- **C — no persistence; agent picks at call time.** Zero schema change — the agent reads column names from the station-context catalog and passes `latColumn`/`lngColumn`. But nothing is "inferred + overridable" as the PRD requires, and every map call re-derives the guess.

**Decided: A — and it is now the *only* geo-annotation mechanism** (see the revised Decision 4, which folds the geometry case into the same `geoRole` field). It matches the PRD contract (inferred, persisted, overridable), survives multiple pairs per entity, and C's call-time override remains available since the spec fields exist regardless.

### Decision 4 — Geocoding provider + zero-charge cache

**Provider — lean: Mapbox** behind a provider-agnostic `GeocodingProvider` interface (carried from the June discovery unchanged: clean API, generous free tier; Nominatim self-host stays the structural escape hatch). Key = `GEOCODING_API_KEY` in `environment.ts` + the three CloudFormation sites (`infra/cloudformation/backend.yml:59,232,489`), mirroring `TAVILY_API_KEY`.

**Cache** — Redis via `getRedisClient()`, key `geocode:<provider>:<normalized-address>` (lowercase/trim/collapse-whitespace), 30-day TTL, **global not per-org** (address→coords is org-independent public data; sharing maximizes savings). Zero-charge mechanism: `registerCostResolver("geocode", …)` (`cost-gate.service.ts:50-66`) so a cache hit resolves to 0 units — admission still runs (rate limit still applies), but nothing is charged or ledgered. Whether the resolver can consult Redis (async) is a spec-level verification; fallback design is the tool signaling a cached result for `commitCharge` to skip.

### Decision 5 — Bulk-column geocode job shape

New `bulk_geocode` job type cloned from the `bulk_transform` precedent end-to-end: ack-gate branch in the tool (`computeJobSignature` over source column + target + entity), enqueue via `JobsService`, `resultKind: "progress"` + `deferChargeToJob`, `blockKind: "bulk-job-progress"` live widget, `JOB_LOCK_KEYS` entry (`targetConnectorEntityIds`, `portalId`), processor charging `commitCharge({ toolCallId: "job:<id>", units: <successful uncached geocodes> })`. The job reads the address column, geocodes through the same provider+cache, and writes GeoJSON Points into a `geometry` target column (upserting the column definition if absent — the multi-column-writes machinery from `BULK_TRANSFORM_MULTI_COLUMN_WRITES` is the write path). **Lean: this shape;** the alternative (synchronous tool that escalates like `sql_query`) fails the ack-gate requirement for expensive work.

## Tradeoff comparison

| | D1: declarative spec | D2: MapLibre direct | D3: `geoRole` column field | D4: Mapbox + global cache | D5: `bulk_geocode` job |
|---|---|---|---|---|---|
| Spread to spec | Yes — MapSpec contract | Yes — module layout, chunking | Yes — schema + inference + override | Yes — provider iface, resolver, keys | Yes — job schemas, signature, units |
| New pattern introduced | No (mirrors d3 contract) | No (mirrors D3Widget module) | Small (first semantic column field) | No (web_search + resolver exist) | No (clones bulk_transform) |
| Blocks the parcel smoke if cut | Yes | Yes | No | No | No |

## Recommendation

1. `gis` pack: slug in the enum, spec literal with `iconSlug` (+ `tool-pack-icons.util.ts` entry), CAPABILITIES entries per the PRD table, appended to `BUILTIN_TOOLPACKS`; all four pin/guard suites updated in the same commits.
2. Spatial compute tools delegate math to a `gis.service.ts` using per-module turf (`@turf/distance`, `@turf/boolean-point-in-polygon`, `@turf/centroid`, `@turf/bbox`, `@turf/buffer`) + `proj4` for reprojection; column-wide forms use `withComputeInput` + `record-source` with `consumption: streaming`; output through the result sink only.
3. `visualize_map` = `{ sql, spec, title? }` with an agent-authored, Zod-validated MapSpec; block `{ type: "geo", spec, pipeline, rows | handle }`; a `geo` arm in `resolveDisplayBlock`; refresh through the existing widget-refresh route untouched.
4. Frontend = `apps/web/src/modules/MapWidget/` (MapLibre GL, direct mount, `React.lazy` + `manualChunks`), registered via `registerBlockRenderer("geo", …)` from `main.tsx`, reusing the gate/chrome/status-chip/refresh utilities; CARTO light/dark basemaps (key-free, attribution required) with OSM fallback.
5. **One** `geoRole: "geometry" | "lat" | "lng" | null` field on `ColumnDefinitionSchema` (revised — no `ColumnDataTypeEnum` change): heuristic shape detection sets `"geometry"`, name+range heuristics set `"lat"`/`"lng"`, all user-overridable in `EditColumnDefinitionDialog`, surfaced to the agent via `station_context`, with `visualize_map`'s explicit column fields authoritative.
6. ArcGIS→WGS84 reprojection in the adapter transform hop (`geometry.util.ts`); `system.prompt.ts` geo guidance describes the role, not a type.
7. `geocode`/`reverse_geocode` behind a `GeocodingProvider` interface (Mapbox first), `GEOCODING_API_KEY` through the standard secrets path, global Redis address cache with 0-unit cache hits via a registered cost resolver.
8. `bulk_geocode` job per Decision 5.
9. Correct the `ST_Area(geography)` prompt drift in `transform-entity-records.tool.ts:239` (no PostGIS exists) as part of the doc-sync pass.

## Open questions

1. ~~**Can a cost resolver consult Redis?**~~ **Resolved 2026-08-02:** yes — `CostResolver` is typed `(input) => number | Promise<number>` and `resolveCallCost` awaits it (`cost-gate.service.ts:43,68`). The address cache is consulted inside the registered resolver, so a cache hit resolves to 0 units directly; no fallback mechanism needed.
2. ~~**Where does the user override the geo annotation?**~~ **Resolved 2026-08-02:** `apps/web/src/components/EditColumnDefinitionDialog.component.tsx` already edits `ColumnDefinition.type` behind a transition allowlist; `geoRole` becomes a plain field on that form (no transition policy needed, since it is not the storage type). `CreateColumnDefinitionDialog` gains the same field.
3. **Basemap attribution + dark theme.** CARTO's free basemaps require attribution and the app has a dark theme. **Lean: CARTO light/dark keyed to the active MUI theme, attribution control always on.**
4. **Does `bulk_geocode` write lat/lng numeric columns too?** Some consumers (choropleth joins, exports) want plain numbers. **Lean: write only the GeoJSON Point geometry column; lat/lng extraction is SQL (`->>'coordinates'`), not duplicated storage.**

## Enterprise-scale considerations

- **Concurrency & correctness** — Job charge idempotency via `toolCallId: "job:<id>"` dedup (existing); entity locking via `JOB_LOCK_KEYS` prevents user/worker races; Redis cache writes are idempotent SETs. Lean: no new machinery.
- **Accuracy & auditability** — Every paid geocode itemizes in the #221 ledger (per-call and per-job); cache hits are deliberately un-ledgered (no charge, no dispute surface). Lean: existing ledger suffices.
- **Failure modes** — Provider down/rate-limited → typed tool error the agent relays, never fabricated coordinates; gate infra errors keep the existing fail-open policy (consciously acceptable: geocode units are cheap and bounded by the provider's own key quota); Redis-cache outage degrades to cache-miss (paid calls, still quota-bounded). Tile-provider outage degrades the widget to its error state, data intact.
- **Scale & unbounded growth** — Map payloads bounded by the existing sink threshold + handle snapshot caps + a per-layer client feature cap in the renderer; bulk geocode bounded by ack gate + per-org quota + per-minute rate; global cache bounded by TTL. Lean: declare the client per-layer cap in the MapSpec contract so it's visible, not silent.
- **Multi-tenancy** — Per-org quota/rate via the gate; the global geocode cache is shared deliberately (public data, cost saving) — no org-identifiable data in keys beyond the address itself. Lean: global cache, documented.
- **Contract stability** — Cost classes pinned (#186); tier availability data-defined on tier rows (#214) so per-client custom tiers can include `gis` without code; provider interface isolates a future Nominatim/Google swap; MapSpec is a versionable contract in `packages/core/src/contracts`.
- **Data lifecycle** — Usage windows follow the org's billing period (existing gate semantics); ledger retention already purged by the #221 job; cache TTL 30 days (geocodes are effectively static). N/A beyond that: no new durable stores.

## What this doesn't decide

- **PostGIS / SQL-pushdown spatial predicates** — geometry stays JSONB; deferred until query performance demands it (bigger lift, own ticket).
- **The pinning mechanism itself** — shipped in #312, which pre-admitted `geo` to `PortalResultTypeSchema`; GIS only registers the `geo` entry in `PINNED_CONTENT_SCHEMAS` and inherits materialization, refresh, and persist-back.
- **Self-hosted Nominatim / tile self-hosting** — the provider interface and basemap config are the only accommodations.
- **Drawing tools, geofencing/push, 3D/terrain, routing, isochrones/network/hotspot analysis** — PRD out-of-scope, unchanged.
- **Choropleth statistical binning UX** — the MapSpec carries per-layer styling keyed to columns; anything smarter (Jenks breaks, legends beyond categorical) waits for real demand.

## Next step

`/spec 84` writes `docs/GIS_TOOLPACK.spec.md`: the MapSpec + `geo` block contract, the `GeocodingProvider` interface + cache/zero-charge semantics, the `geometry`/`geoRole` schema and inference rules, per-tool capability declarations, and the `bulk_geocode` job schemas/signature. `/plan 84` then slices roughly: (1) pure spatial tools + capabilities + pins; (2) `geometry` column type + inference + ArcGIS reprojection + `geoRole`; (3) MapSpec contract + `visualize_map` + `geo` display arm; (4) MapWidget module + renderer registration + stories; (5) geocoding provider + cache + metered tools; (6) `bulk_geocode` job + lock + progress UX; (7) tier/docs/prompt sync + smoke. Slices 1–4 have no external dependency; 5–6 need the Mapbox key provisioned in app-dev.
