# GIS pack foundation: map visualization — Plan

**Slices the `gis` toolpack, `visualize_map`, the `geo` display block, and the MapLibre `MapWidget` into TDD commits — the one pack tool SQL can't replace, plus the renderer that turns #316's typed geometry into an interactive, pinnable, self-refreshing map.**

Spec: `docs/GIS_TOOLPACK.spec.md` (shared, epic-level; *partly superseded* — see below). Discovery: `docs/GIS_TOOLPACK.discovery.md` (shared). Issue: [#314](https://github.com/EnterpriseBT/portal-ai/issues/314) (epic [#84](https://github.com/EnterpriseBT/portal-ai/issues/84)). **Base branch `epic/gis-toolpack`, not `main`.** Builds directly on the substrate shipped by **#316** (PR #326, merges into the epic first).

6 slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/gis-pack-foundation`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit && npm run test:integration
cd apps/web && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

## What #316 already shipped (so this plan does NOT re-do it)

Grounded against `feat/postgis-foundation` — these are **done**, and #314 depends on them rather than rebuilding them:

| Substrate | Where (#316) | Consequence for #314 |
|---|---|---|
| `geometry` as a real `ColumnDataTypeEnum` value; `GeoRoleSchema = z.enum(["lat","lng"])` (geometry is a **type**, not a role) | `column-definition.model.ts:29,41,65` | **No `geoRole` migration, no contract change.** The spec's `geoRole:["geometry",…]` seed table is superseded. |
| Canonical geo column defs seeded (`geometry`/`latitude`/`longitude` `system` rows) | `seed.service.ts:299,311,322` | **The "seed canonical geo defs" deliverable is already satisfied.** No seed slice. |
| Geometry reads back as a GeoJSON object (`ST_AsGeoJSON(col)::jsonb`) | `wide-table-statement.cache.ts:167` | `visualize_map`'s SQL rows carry GeoJSON for geometry columns transparently. |
| `ST_AsMVT` vector-tile endpoint: `GET /api/portal-map/tiles/{message/:messageId/:blockIndex \| pin/:portalResultId}/:z/:x/:y.mvt`, org-scoped, `ETag`/`Cache-Control`, `X-Portal-Tile-Simplified`/`X-Portal-Tile-Truncated` headers, `204`/`400 MAP_TILE_NOT_FOUND`/`404`/`504 MAP_TILE_TIMEOUT`; pipeline SQL must expose a raw column named **`geom`** | `portal-map.router.ts`, `portal-map-tile.service.ts` (`MAP_TILE_FEATURE_CAP=50_000`) | The tile **source** the widget's large-data path points at. #314 consumes it; it does not build it. |
| `station_context` emits `srid` per column (`type==="geometry" ? 4326 : null`) | `station-context.tool.ts:270` | AC "agent sees geometry columns (with SRID) in `station_context`" is **already met**. (`geoRole` is not emitted; #314 does not need it.) |
| Agent `ST_*` guidance block ("Geospatial is PostGIS-native") — predicates, `geography` casts, `ST_Transform`, compute-upstream idioms | `system.prompt.ts:~580` | #314's prompt work is **additive** (`visualize_map` usage), never a restatement of `ST_*`. |

**Also dropped from the historical spec:** the six hand-rolled spatial tools (`compute_distance`/`point_in_polygon`/`centroid`/`buffer`/`compute_bounding_box`/`reproject`) — `ST_*` in agent SQL replaces them — and all geocoding (`geocode`/`reverse_geocode`/`bulk_geocode` → **#315**). So `gis` ships **one** tool: `visualize_map`.

Sequencing rationale — pure core contract first (slice 1, everything imports it); the api tool in isolation (slice 2, unit-tested before it's reachable); the cross-package **activation** that lights the pack up end-to-end + all pins (slice 3); the renderer's inline path (slice 4); the large-data tile path + every no-quiet-degradation notice (slice 5); doc/prompt sync + smoke (slice 6). No slice uses anything from a later one.

---

## Slice 1 — MapSpec + `geo` block contract + pinned entry (core)

The declarative contract `visualize_map` authors and the widget reads. Pure schema; nothing imports the api/web yet.

**Files**

- New: `packages/core/src/contracts/map-spec.contract.ts` — `MapBasemapSchema`, `MapGeometrySourceSchema` (`{geometryColumn}` XOR `{latColumn,lngColumn}`), `MapExpressionSchema` (recursive), `MapLayerStyleSchema` (expression-capable `color`/`opacity`/`radius`/`width`/`outline*` + `colorBy` sugar), `MapLayerSchema` (`kind` ∈ points/polygons/lines/heatmap/cluster; `superRefine`: polygons/lines require `geometryColumn`), `MapSpecSchema` (`basemap` default, `initialView` default `"fit"`, `layers` 1–8, `popup.template`). The geo block content: `GeoBaseContentSchema` (`spec`, `title?`, `pipeline?: D3PipelineSchema`, **reserved** `program: z.string().min(1).optional()`), `GeoInlineContentSchema` (`+ rows`), `GeoHandleContentSchema` (`+ QueryHandleEnvelopeFieldsSchema.shape`), `GeoBlockContentSchema = union([Handle, Inline])` **handle-first** (mirrors `d3-widget.contract.ts:74`).
- New: `packages/core/src/constants/large-data-ops.constants.ts` gains `MAP_LAYER_FEATURE_CAP = 10_000` (or append to the existing file if present).
- Edit: `packages/core/src/contracts/pinned-result.contract.ts:48` — add `geo: GeoInlineContentSchema` to `PINNED_CONTENT_SCHEMAS` (the #312 seam; `geo` is already in `PortalResultTypeSchema`).
- Edit: `packages/core/src/contracts/index.ts` — export the new contract.

**Decision this slice pins (spec left it to #314):** the **inline-vs-tiles discriminant is the block union, not a per-layer source variant** — `GeoInlineContentSchema` (has `rows`) → the widget builds GeoJSON sources; `GeoHandleContentSchema` (has the handle envelope) → the widget uses vector **tiles** keyed to the block's own message/pin coordinates. This is the spatial analogue of a query handle and mirrors d3's handle/inline split, so `MapGeometrySourceSchema` stays `geometryColumn | latlng` (it names *columns*, not transport). The historical spec's "per-layer tile source variant" is **not** adopted.

**Steps**

1. **Tests (spec cases: MapSpec block, ≈ the 16 `packages/core` cases).** `__tests__/contracts/map-spec.contract.test.ts`: defaults applied; ≥1 and ≤8 layers enforced; `polygons`/`lines` reject a lat/lng source; `colorBy` accepted incl. explicit `stops`; **an expression is accepted anywhere a literal style value is** (`["case", ["==", ["get","prop_class"], "vacant"], "#ff8a00", "#cfd8dc"]`), a non-array garbage style value is rejected, nested expressions recurse; the reserved `program` field parses but is ignored on the spec path; the geo block union resolves handle-first. `pinned-result.contract.test.ts`: `PINNED_CONTENT_SCHEMAS.geo` is defined and accepts the inline shape. Run; fail.
2. **Implement** the schemas above. Green.
3. Lint + type-check (`packages/core`).

**Done when:** the MapSpec + geo-block contracts parse/reject per the cases and `geo` is pinnable; nothing else references them yet.

**Risk:** the recursive `MapExpressionSchema` (`z.lazy`) — pin the base case (min-1 array) so a bare `[]` is rejected.

---

## Slice 2 — `visualize_map` tool + `geo` display arm (api)

The tool that validates a spec, runs SQL through the sink, and emits a `geo` block — mirrors `visualize-d3.tool.ts` **minus** the codegen loop. Unit-tested in isolation; not yet in a pack.

**Files**

- New: `apps/api/src/tools/visualize-map.tool.ts` — `Tool` subclass, input `{ sql, spec, title? }`; `execute`: validate `spec` with `MapSpecSchema` (fail → `MAP_SPEC_INVALID`), `resolveSqlDelivery({sql},{stationId,organizationId})`, emit `{ type:"geo", spec, ...titleField, pipeline:{sql,stationId,organizationId}, rows | ...envelope }` (handle branch first). No `program`, no codegen, no retry/fallback.
- Edit: `apps/api/src/services/portal.service.ts:213` — add a `geo` arm beside the `d3` arm in `resolveDisplayBlock` (`(resultKind==="geo" || (resultKind===undefined && toolResult?.type==="geo")) && toolResult?.type==="geo"`), so the block routes by type even before the capability lands in slice 3.
- Edit: `apps/api/src/constants/api-codes.constants.ts` — `MAP_SPEC_INVALID` (+ recommendation entry).
- Edit: `apps/api/src/config/swagger.config.ts` — register `MapSpec`/geo-block components if the tool surfaces them (per the OpenAPI convention).

**Steps**

1. **Tests (spec `apps/api` unit: the `visualize_map` cases).** `__tests__/tools/visualize-map.tool.test.ts`: invalid spec → `MAP_SPEC_INVALID`; a small result routes inline (`rows`) and a large one routes to a handle envelope — **both through `resolveSqlDelivery`, no open-coded threshold**; the emitted block shape is asserted for each branch. Run; fail.
2. **Implement** the tool + the `geo` arm + the code. Green. (`no-open-coded-sink.test.ts` auto-scans `src/tools/*.tool.ts` and passes because the tool uses `resolveSqlDelivery`.)
3. Lint + type-check (`apps/api`).

**Done when:** `visualize_map` validates, delivers via the sink, and emits a routable `geo` block; the tool is not yet built into any pack (no guard references it).

**Risk:** the `geo` arm's `resultKind===undefined` fallback must exactly mirror the `d3` arm so type-only routing works before slice 3's capability.

---

## Slice 3 — `gis` pack activation + all pins (core + api + web)

The one cross-package slice: register the pack, wire its build, add the icon, and update **every** pin together so the tree stays green. After this, Pro/Enterprise stations list `gis`; Standard/Plus show it not-on-tier.

**Files**

- Edit: `packages/core/src/registries/builtin-toolpacks.ts` — `"gis"` in `BuiltinToolpackSlugSchema:40`; `GIS_PACK` literal (`iconSlug:"Map"`, one tool `visualize_map` with its `parameterSchema` + examples, description **matching the tool file's `description`**); append to `BUILTIN_TOOLPACKS:1208`; add the `visualize_map` `CAPABILITIES` entry (`costHint:"free"`, `consumption` engine-pushdown, `production:{kind:"rows",onLarge:"handle"}`, `resultKind:"geo"`, `computeShape:"reduce"`).
- Edit: `apps/api/src/services/tools.service.ts` — `ALL_TOOL_PACKS` + a `gis` build block constructing `VisualizeMapTool`.
- Edit: `apps/web/src/utils/tool-pack-icons.util.ts:38` — a `gis` → `Map` (or `Public`) icon entry (distinct glyph; CI-guarded #303).
- Edit (pins): `packages/core/__tests__/registries/builtin-toolpacks.test.ts:14` (7→8 + slug list), `tool-capabilities.test.ts` (costHint pin + `geo ⇒ production.kind:"rows"` coherence), `apps/api/__tests__/services/tools.service.test.ts:724` (add `gis` to the wrap-guard pack list so `visualize_map` is built + asserted wrapped), `apps/web/__tests__/ToolPackIconUtil.test.ts` (gis icon coverage).

**Steps**

1. **Tests (spec pins).** Update the four pin suites above to expect `gis` (count, costHint, coherence, wrap, icon). Run; fail on the not-yet-registered pack.
2. **Implement** the slug + `GIS_PACK` + capability + build block + icon. Green. Verify tier auto-pickup: `pro`/`enterprise` spread `[...BuiltinToolpackSlugSchema.options]` (`tier-catalog.ts:138,162`) so no tier-catalog edit is needed; `standard`/`plus` enumerate and correctly omit `gis`.
3. Lint + type-check (all three packages).

**Done when:** all pin/guard suites pass with `gis`; a Pro-tier station build includes the pack + `visualize_map`, a Standard one doesn't.

**Risk:** the pack literal's tool `description` and the tool file's `description` must match (a pinning test asserts the mirror) — author both from one string.

---

## Slice 4 — MapWidget module: inline render path (web)

The renderer, MapLibre direct-mount, mirroring `modules/D3Widget/`. This slice covers the **inline GeoJSON** path (small results) end-to-end; the tile path + degradation notices are slice 5.

**Files**

- New: `apps/web/src/modules/MapWidget/` — `MapWidget.component.tsx` (container `MapWidget` + pure `MapWidgetUI`, per the Component File Policy), `MapWidgetGate.component.tsx` (in-view mount, mirrors `D3WidgetGate:48`), `utils/register.util.tsx` (`registerMapBlockRenderer` → `registerBlockRenderer("geo", …)`), `utils/maplibre-loader.util.ts` (`React.lazy` + dynamic `import("maplibre-gl")`), `index.ts` (barrel), `__tests__/`, `stories/MapWidget.stories.tsx`. Reuse the shared `apps/web/src/utils/use-widget-refresh.util.ts` and the status-chip/`onHeight` chrome vocabulary from `D3Widget.component.tsx`.
- Edit: `apps/web/src/main.tsx` — import + call `registerMapBlockRenderer()` beside `registerD3BlockRenderer()`.
- Edit: `apps/web/vite.config.ts` — add `build.rollupOptions.output.manualChunks` isolating `maplibre-gl` (no `build` key exists yet; this is the repo's first `manualChunks` entry).
- Add dep: `maplibre-gl` (+ types) to `apps/web`.

**Steps**

1. **Tests (spec `apps/web` cases — inline subset).** `modules/MapWidget/__tests__/*` render **`MapWidgetUI`** (props-only, no MapLibre network): points-only, polygons-only, mixed, heatmap, cluster, empty state, fit-to-bounds, popup template renders from `spec.popup.template`, theme-keyed basemap (`carto-light`/`carto-dark`), an **expression-styled** layer renders and `colorBy` renders a **legend**; renderer registration dispatches a `geo` block; the gate mounts only in view. (MapLibre GL is mocked at the module boundary; the UI asserts the spec→layer/style/legend mapping, not canvas pixels.) Run; fail.
2. **Implement** the module + registration + chunking. Green.
3. Lint + type-check (`apps/web`); confirm the build output keeps `maplibre-gl` out of the main chunk.

**Done when:** an inline `geo` block renders points/polygons/lines/heatmap/cluster with expression + `colorBy` styling, a legend, popups, fit-to-bounds, and a theme basemap; the gate defers mount until in view.

**Risk:** bundle weight — assert the `manualChunks` split in the build; a regression shows as main-chunk growth. Keep all MapLibre imports behind the lazy loader so tests never touch WebGL.

---

## Slice 5 — Vector-tile source + authenticated tiles + no-quiet-degradation notices (web)

The large-data path and the epic's hard **visibility-of-limits** rule. Every cap/simplification/failure is a **visible notice with its own test asserting the notice** (spec *Visibility of limits* rows 1–4, 8–11).

**Files**

- Edit: `apps/web/src/modules/MapWidget/MapWidget.component.tsx` (+ a `utils/tile-source.util.ts`) — when the block is the **handle** variant, add a native MapLibre **vector source** pointing at `/api/portal-map/tiles/message/:messageId/:blockIndex/{z}/{x}/{y}.mvt` (the widget knows its own message/block coords; pin context uses the `pin/:portalResultId` route). **Authenticated tile fetching** via MapLibre's `transformRequest`, attaching the app's SDK credentials (this is *why* the renderer is direct-mount, not sandboxed — no credential is handed to model-authored JS; the reserved `program` hatch stays inline-only).
- Edit: the widget reads response headers `X-Portal-Tile-Simplified` / `X-Portal-Tile-Truncated` and the `504` state to drive notices.

**Notices (each a test asserting the notice, not just the behaviour):**

| Spec row | Trigger | Notice |
|---|---|---|
| 1 | inline layer > `MAP_LAYER_FEATURE_CAP` | "Showing first N of M features" on the layer |
| 2 | any layer zoom-simplified (`X-Portal-Tile-Simplified`) | **persistent** "simplified at this zoom" indicator; clears at full detail |
| 3 | tile density cap (`X-Portal-Tile-Truncated`) | "partial at this zoom — zoom in for all features" |
| 4 | tile `504 MAP_TILE_TIMEOUT` | widget error state + one visible notice, never a blank map |
| 8 | MapSpec > 8 layers / layer references a missing column | typed validation error the agent relays — no partial render (validated in the tool, surfaced here) |
| 9 | expression malformed at paint time | widget error state |
| 10 | popup template references an absent field | renders the field name as **unresolved**, not a blank popup |
| 11 | pinned map refresh fails | last snapshot + notice (inherited from #312) |

**Steps**

1. **Tests.** `modules/MapWidget/__tests__/*`: a handle-variant block mounts a vector source at the tile URL; `transformRequest` attaches auth; each notice row above renders when its trigger is simulated (mock tile headers / `504` / malformed expression / missing popup field / feature-cap). Run; fail.
2. **Implement** the tile source, auth transform, and the notice surfaces. Green.
3. Lint + type-check (`apps/web`).

**Done when:** a ≥100-feature result renders through tiles (small results still inline through slice 4's path, no tile round-trip), pans/zooms at interactive latency, and **every** limit above announces itself. New caps discovered here are added to the spec's table in this PR.

**Risk:** the inline-vs-tile decision must be the block union alone (slice 1's discriminant) — no second open-coded threshold in the widget.

---

## Slice 6 — Prompt + doc sync + smoke

Additive agent guidance and the doc surfaces that a new pack/tool touches (per `CLAUDE.md` → "Keeping Documentation in Sync"). No behaviour change; pure sync + regression pins.

**Files**

- Edit: `apps/api/src/prompts/system.prompt.ts` — **additive** `visualize_map` guidance (how to author a MapSpec; that expressions style *existing* features so map-only geometry — arcs, hexbins, label points, service radii — is derived **upstream in `ST_*` SQL** then fed to `visualize_map`). Does **not** restate #316's `ST_*` block.
- Edit: `packages/core/src/registries/builtin-toolpacks.ts` — confirm the hand-authored mirror description matches the tool (slice 3 pin).
- Edit: `packages/core/src/content/glossary.util.ts`, `faq.util.ts` — "map visualization", "GIS toolpack" (shared with the marketing site per #311); re-attach in-app routes via `glossary-routes.util.ts` if a term is added.
- Edit: `README.md` / `apps/api/README.md` toolpack docs — list `gis` / `visualize_map`.

**Steps**

1. **Tests (spec regression pins).** `system.prompt.test.ts`: the geo guidance names the compute-upstream idiom **and no `ST_*` token appears in an agent-facing tool description** (the #316 drift fix stays intact); `glossary.util.test.ts` / `faq.util.test.ts` pins for the new entries. Run; fail.
2. **Implement** the prose. Green.
3. Lint + type-check.
4. **Smoke:** run `/smoke 314` to scaffold `docs/GIS_PACK_FOUNDATION.smoke.md` from the shared spec's acceptance criteria (the parcel walkthrough with **no external provider**, tier gating, inline-vs-tile, pin/refresh, the highlight-the-vacant expression case, and each visibility notice).

**Done when:** the agent is taught `visualize_map` without duplicating `ST_*` guidance; glossary/FAQ/README name the pack; the smoke checklist exists for the user to walk.

**Risk:** none beyond keeping the mirror/description in lockstep.

---

## Sequence summary

| # | Lands | Package(s) | Gating check |
|---|---|---|---|
| 1 | MapSpec + `geo` block + pinned entry + feature-cap constant | core | contract cases green; `geo` pinnable |
| 2 | `visualize_map` tool + `geo` display arm + `MAP_SPEC_INVALID` | api | tool cases green; sink-only (no-open-coded-sink) |
| 3 | `gis` pack + capability + build + icon + **all pins** | core+api+web | pack-count / costHint / coherence / wrap / icon pins green; tier auto-pickup |
| 4 | MapWidget inline render path + chunking + stories | web | `MapWidgetUI` cases green; maplibre out of main chunk |
| 5 | vector-tile source + auth + **every degradation notice** | web | one test per notice green |
| 6 | prompt + glossary/FAQ/README sync; scaffold smoke | api+core+docs | prompt/glossary/FAQ pins green |

## Cross-slice notes

- **Slice 3 is the only cross-package slice** — it must land core+api+web together because adding `gis` to `BUILTIN_TOOLPACKS` auto-breaks the web icon guard and the api wrap guard until the icon + build block land. Don't split it.
- **Description mirror:** `visualize_map`'s `description` exists twice — the tool file (slice 2) and the `GIS_PACK` literal (slice 3). A pinning test asserts they match; author from one string.
- **`geoRole` is out.** #316 shipped `geoRole = ["lat","lng"]`; `visualize_map` reads geometry via the block's rows/tiles, and a lat/lng-only table plots as points via the `MapGeometrySourceSchema` lat/lng arm — no geoRole plumbing in #314.
- **Tile SQL contract:** the handle path only tiles correctly if the pipeline SQL exposes a raw `geom` column (#316's `ST_AsMVT` requirement). `visualize_map`'s guidance (slice 6) must tell the agent to select the raw geometry column as `geom` when the result may be large.
- **Doc-sync is a slice, not a follow-up** (slice 6) — a new pack/tool changes glossary/FAQ/README/system-prompt; stale docs are a bug in this PR.
- **Dependency on #326:** implementation of slices 2–5 exercises #316's substrate (geometry columns, the tile endpoint). #326 must merge into `epic/gis-toolpack` first; until then, keep-pace-merge the epic into this branch as #326 lands.

## Next step

Once the shared discovery + spec are re-confirmed for this child and this plan is reviewed, implementation begins on `feat/gis-pack-foundation`, **slice 1 first**, tests-first, one commit per slice — after #326 has merged into the epic (or against it via keep-pace merge).
