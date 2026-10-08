# A tile for a non-map block is a 404 — Condensed design (#695)

**Issue:** [EnterpriseBT/portal-ai#695](https://github.com/EnterpriseBT/portal-ai/issues/695) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `PortalMapTileService.resolvePipeline` accepts any message block or pin whose `content.pipeline` parses as a `VizPipeline`, whatever kind of block it is. A `data-table` or `d3` answer carries the same durable pipeline, so a tile request against one runs its SQL as a geometry source, and Postgres fails with `column src.geom does not exist`. That comes back as **500**, plus an error-log entry, instead of the route's `404 MAP_TILE_NOT_FOUND`. The UI only asks for tiles on map blocks, so this takes a direct or crafted request. Authorization is unaffected: a source the caller can't read is refused with a 404 before this point (#692). Only `apps/api` changes.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Source resolution | `apps/api/src/services/portal-map-tile.service.ts:581` `resolvePipeline` | message: block → `content.pipeline` parsed (:624); pin: `content.pipeline` parsed (:650); otherwise `notFound()` (:527) |
| Spec readers | `propertyColumnsFromSpec` (:351), `aggregationFromSpec` (:419) | read `spec.layers` loosely and tolerate a missing or non-map spec, which is why a non-map block gets this far |
| Tile SQL | `:680`–`:795` | every variant selects `src.geom` from the pipeline SQL as a subquery |
| Map spec contract | `packages/core/src/contracts/map-spec.contract.ts:180` `MapSpecSchema` | `layers` 1–8, each with a `kind` and a geometry source; geo block content is `{ spec: MapSpec, pipeline?, … }` (`GeoBaseContentSchema`, :196) |
| Unit tests | `apps/api/src/__tests__/services/portal-map-tile.service.test.ts` | the shared fixture is a **`d3` block with a pipeline and no spec** (:35), which only works today because nothing checks the spec |

## Decision — a tile source must be a map: its spec parses as `MapSpecSchema`

Options: (a) check `block.type === "geo"`. Pins don't carry a block type the same way, and a type string is a weaker contract than the shape the renderer actually reads. (b) **Require `content.spec` to parse as `MapSpecSchema`**, on both the message and the pin branch, before accepting the pipeline. (c) Catch the query error (`42703 undefined_column` on `geom`) and map it to 404. That only treats the symptom: the non-map SQL still runs against the database on every such request, and it could mask a real bug in a map pipeline.

**Decided: (b).** One check on the contract the renderer depends on. A spec that doesn't parse as a map → `notFound()`, the same answer as an unknown block, before any SQL or scope resolution runs. Geo blocks always carry a `MapSpec` (`visualize_map` emits it, `GeoInlineContentSchema` requires it), so valid maps are unaffected. No error mapping (c): a `geom` failure on a real map spec is a bug that should stay loud.

## Plan — one slice

**Files**
- Edit: `apps/api/src/services/portal-map-tile.service.ts`: in `resolvePipeline`, both branches require `MapSpecSchema.safeParse(<content>.spec).success`, or throw `notFound()`. Imported from `@portalai/core/contracts`.

**Tests** (`apps/api/src/__tests__/services/portal-map-tile.service.test.ts`)
- The shared fixture becomes a `geo` block with a minimal valid `MapSpec` (one `polygons` layer with `geometryColumn: "geom"`), so the existing render tests still describe real maps.
- New: a message `data-table` block with a valid pipeline → 404 `MAP_TILE_NOT_FOUND`, and the tile query runner is **never called** (a spy on `runTileQuery`).
- New: a `d3` block with a pipeline and a non-map spec → 404.
- New: a pin whose content has a pipeline but a non-map spec → 404.
- `apps/api/src/__tests__/__integration__/routes/portal-map.router.integration.test.ts`: check whether its fixtures seed map blocks without a spec, and fix them the same way if so.
- `npm run type-check`, `lint`; `npm run test:unit -- --testPathPattern portal-map-tile`; `npm run test:integration -- --testPathPattern portal-map`.

## Smoke (manual, against your dev stack)

1. As the e2e owner, find a portal message whose block is **not** a map (e.g. a `data-table` answer): `select id, blocks->0->>'type' from portal_messages where organization_id = '<e2e org>' and blocks->0->>'type' <> 'geo' limit 1`. `GET /api/portal-map/tiles/message/<id>/0/0/0/0` → **404** `MAP_TILE_NOT_FOUND`, and the API log shows no `src.geom` error.
2. The same against a pinned non-map result (`/tiles/pin/<pinId>/0/0/0`) → 404.
3. A real map block (the smoke contours or polygons portal) still serves tiles: open it, pan and zoom, and tiles load (200s in the network tab).

## Out of scope

- Mapping tile query errors in general to 4xx. Only "not a map" is a 404; other failures stay visible.
- Changing what the UI requests. It already asks only for map blocks.
