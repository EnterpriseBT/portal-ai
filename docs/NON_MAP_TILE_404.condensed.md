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

## Adversarial

Probes for how #695 breaks. The change adds one early 404, for any tile source whose type isn't `geo`, after the existing org and read checks. So the probes ask whether that 404 tells callers anything the other 404s don't, whether a real map can be refused by mistake, and whether any path still runs a non-map pipeline as a tile. **Branch under test:** `fix/695-non-map-tile-404` (PR [#740](https://github.com/EnterpriseBT/portal-ai/pull/740)). API probes use `curl` against `:3001` with the e2e owner and member tokens, in `e2e-fixture`. Fixtures: message `4969aa01-…`, where block 2 is a `data-table` with a pipeline; geo messages `698c0000-…-0001` and `-0002` (block 0); Org B's ids from the #731/#736 walks. Delete any pin a probe creates.

### §1 Boundary & limit inputs
- [ ] Same message, valid and invalid indexes: `…/tiles/message/4969aa01-…/2/0/0/0` (table), `…/99/0/0/0` (out of range), and a `tool-result` block index. Expected safe result: 404 `MAP_TILE_NOT_FOUND` with the **identical body** for all three. — backend
- [ ] A geo message at an extreme valid tile (`z=22` and a far `x/y`). Expected safe result: 200 or 204 (an empty tile), never 404. Being a map doesn't depend on the tile address. — backend

### §2 Malformed & injection input: N/A. No new input parsing; the route's existing z/x/y and id validation is unchanged.
### §3 Concurrency & races: N/A. A read-only check on stored rows, with no writer involved.

### §4 Auth & permission boundaries
- [ ] As the **member**, who can't read the portal behind message `4969aa01-…`, request a tile for (a) its `data-table` block and (b) a geo block in a portal they can't read. Expected safe result: the same 404 body for both, identical to the owner's non-map 404. The type check never runs ahead of the read check, so it isn't an oracle. — backend
- [ ] As the **owner**, pin the `data-table` block, then share the pin read-only with the member. As the member, request the pin's tile. Expected safe result: 404 `MAP_TILE_NOT_FOUND`. Being able to read a non-map pin doesn't make it renderable. — backend

### §5 Multi-tenant isolation
- [ ] As the e2e owner, request a tile for an Org B **geo** message or pin id, and for an Org B **non-map** one. Expected safe result: the same 404 body for both, identical to an unknown id. Another org's type isn't revealed. — backend

### §6 State & lifecycle abuse
- [ ] Pin a geo block, confirm its tile is 200, then delete the pin and request it again. Expected safe result: 404 after the delete, with the same body as for a non-map pin. — backend
- [ ] Pin a `data-table` block whose stored row is `type = 'data-table'`. Then set its `content` to a geo-looking spec in SQL (`update portal_results set content = content || '{"spec":{"layers":[{"kind":"points","source":{"geometryColumn":"geom"}}]}}'`). Expected safe result: still 404. Only the type decides, so a map-shaped spec on a non-map row doesn't run its SQL. — backend

### §7 Misuse sequences
- [ ] In the browser as the owner, open the polygons map portal (geo message `698c0000-…-0001`), then pan and zoom. Expected safe result: tiles load (200s in the network log), and the map shows no "tile failed" notice. The map path is unaffected.

### Findings
| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk; empty when every probe held)_ | | low / med / high | fixed-in-PR / waived: <reason> |

### Sign-off
- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name>: confirmed against my own running stack

### Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org/message/pin ids):
