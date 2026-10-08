# A tile for a non-map block is a 404 — Condensed design (#695)

**Issue:** [EnterpriseBT/portal-ai#695](https://github.com/EnterpriseBT/portal-ai/issues/695) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `PortalMapTileService.resolvePipeline` accepts any message block or pin whose `content.pipeline` parses as a `VizPipeline`, whatever kind of block it is. A `data-table` or `d3` answer carries the same durable pipeline, so a tile request against one runs its SQL as a geometry source, and Postgres fails with `column src.geom does not exist`. That came back as **500**, plus an error-log entry, instead of the route's `404 MAP_TILE_NOT_FOUND`. Since #727, which degrades a missing-column tile query to an empty tile, it's a **204** instead: the non-map SQL still runs on every such request, and the answer still claims an empty map rather than no map. The UI only asks for tiles on map blocks, so this takes a direct or crafted request. Authorization is unaffected: a source the caller can't read is refused with a 404 before this point (#692). Only `apps/api` changes.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Source resolution | `apps/api/src/services/portal-map-tile.service.ts:581` `resolvePipeline` | message: block → `content.pipeline` parsed (:624); pin: `content.pipeline` parsed (:650); otherwise `notFound()` (:527) |
| Spec readers | `propertyColumnsFromSpec` (:351), `aggregationFromSpec` (:419) | read `spec.layers` loosely and tolerate a missing or non-map spec, which is why a non-map block gets this far |
| Tile SQL | `:680`–`:795` | every variant selects `src.geom` from the pipeline SQL as a subquery |
| Map spec contract | `packages/core/src/contracts/map-spec.contract.ts:180` `MapSpecSchema` | `layers` 1–8, each with a `kind` and a geometry source; geo block content is `{ spec: MapSpec, pipeline?, … }` (`GeoBaseContentSchema`, :196) |
| Unit tests | `apps/api/src/__tests__/services/portal-map-tile.service.test.ts` | the shared fixture is a **`d3` block with a pipeline and no spec** (:35), which only works today because nothing checks the spec |

## Decision — a tile source must be a map: its type is `geo`

Options: (a) **check the type**: `block.type === "geo"` for a message, `row.type === "geo"` for a pin. A pin keeps its block's type (`portal-results.router.ts:219`), and `dissolve-precompute.service.ts:214` already selects map pins with `WHERE type = 'geo'`. (b) Require `content.spec` to parse as `MapSpecSchema`. (c) Catch the query error (`42703 undefined_column` on `geom`) and map it to 404.

**Decided: (a).** The draft chose (b) on the mistaken belief that pins carry no type; code review on #740 corrected it. The type is the contract the rest of the code already uses for "is this a map", and it costs nothing. (b) would have tied every stored map's tiles to how strict `MapSpecSchema` is. A later tightening would blank existing maps silently, since a 404 logs nothing. It would also run a full Zod parse on every tile request, and a future non-map block with a map-shaped spec would still get through. A non-`geo` source → `notFound()`, before any SQL or scope resolution runs. A `geo` block whose stored spec doesn't parse still renders through the loose spec readers, as before. (c) isn't used: a `geom` failure on a real map is a bug that should stay loud.

## Plan — one slice

**Files**
- Edit: `apps/api/src/services/portal-map-tile.service.ts`: in `resolvePipeline`, the message branch requires `block.type === "geo"` and the pin branch `row.type === "geo"` (after the pin's read check), or throws `notFound()`.

**Tests** (`apps/api/src/__tests__/services/portal-map-tile.service.test.ts`)
- The shared fixture becomes a `geo` block with a minimal valid `MapSpec` (one `points` layer with `geometryColumn: "geom"`, which aggregates like the old spec-less fixture), and the pin fixtures carry `type: "geo"`, so the existing render tests describe real maps.
- New: a message `data-table` block with a valid pipeline → 404 `MAP_TILE_NOT_FOUND`, and the tile query runner is **never called** (a spy on `runTileQuery`).
- New: a `d3` block with a pipeline and a non-map spec → 404.
- New: a pin of type `data-table` with a valid pipeline → 404.
- New: a `geo` block whose stored spec no longer parses as a `MapSpec` still renders (200), so a tighter contract can't blank stored maps.
- `apps/api/src/__tests__/__integration__/routes/portal-map.router.integration.test.ts`: check whether its fixtures seed map blocks without a spec, and fix them the same way if so.
- `npm run type-check`, `lint`; `npm run test:unit -- --testPathPattern portal-map-tile`; `npm run test:integration -- --testPathPattern portal-map`.

## Smoke (manual, against your dev stack)

1. As the e2e owner, find a portal message whose block is **not** a map (e.g. a `data-table` answer): `select id, blocks->0->>'type' from portal_messages where organization_id = '<e2e org>' and blocks->0->>'type' <> 'geo' limit 1`. `GET /api/portal-map/tiles/message/<id>/0/0/0/0` → **404** `MAP_TILE_NOT_FOUND` (it was 204 on `main`, and 500 before #727), and the API log shows no `src.geom` error.
2. The same against a pinned non-map result (`/tiles/pin/<pinId>/0/0/0`) → 404.
3. A real map block (the smoke contours or polygons portal) still serves tiles: open it, pan and zoom, and tiles load (200s in the network tab).

## Out of scope

- Mapping tile query errors in general to 4xx. Only "not a map" is a 404; other failures stay visible.
- Changing what the UI requests. It already asks only for map blocks.
