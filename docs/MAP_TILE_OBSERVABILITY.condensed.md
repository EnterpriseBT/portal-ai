# Map tile failure observability — Condensed design (#449)

**Issue:** [EnterpriseBT/portal-ai#449](https://github.com/EnterpriseBT/portal-ai/issues/449) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc). Child of epic [#470](https://github.com/EnterpriseBT/portal-ai/issues/470); branches off `epic/map-tiles-at-scale`.

**Why.** A map tile that hits the 10s `statement_timeout` fails **invisibly** everywhere but local dev: the timeout returns `500 UNKNOWN` (not the typed `504 MAP_TILE_TIMEOUT` the widget already renders), the `X-Portal-Tile-*` degradation notices are stripped cross-origin by CORS, and a failed tile is handed to MapLibre as empty bytes so it caches empty and never retries. Three independent one-fix-each defects across `apps/api` + `apps/web`; no contract change. This is the reporting surface #450's performance work is debugged through, so it lands first in the epic.

## Current shape

| Piece | Location | Defect |
|---|---|---|
| Tile-service catch reads `err.code` | `apps/api/src/services/portal-map-tile.service.ts:464-474` | Drizzle wraps the pg error in `DrizzleQueryError` (`.code` undefined; real code on `.cause`), so `57014` never matches → escapes as `500 UNKNOWN` |
| Existing correct unwrap | `apps/api/src/services/portal-sql.service.ts:573-584` | Already unwraps `.cause` — to be shared, not re-derived |
| CORS | `apps/api/src/app.ts:41-45` | `cors({ origin })` sets no `exposedHeaders`, so cross-origin JS can't read `X-Portal-Tile-*` / `ETag` |
| Web tile fetch | `apps/web/src/modules/MapWidget/utils/tile-protocol.util.ts:124-129` | Returns empty `ArrayBuffer` for **any** non-OK → MapLibre caches a failure as a valid empty tile, never retries |
| Tile status | `apps/web/src/modules/MapWidget/utils/tile-source.util.ts:13-57` | `timedOut` flagged only on `504`; a non-timeout failure sets no state |
| Widget notice | `apps/web/src/modules/MapWidget/MapWidget.component.tsx:344-352` | Renders `timedOut` etc.; no `failed` notice |

## Decision — three targeted fixes, one shared unwrap

1. **Server: unwrap the pg code.** New `apps/api/src/utils/pg-error.util.ts` → `pgErrorCode(err): string | undefined` (reads `err.cause?.code ?? err.code`). Tile-service catch uses it (`pgErrorCode(err) === "57014"` → `504 MAP_TILE_TIMEOUT`); `translateExecutionError` refactors onto it so the two can't drift (the ticket's "share it, don't re-derive").
2. **Server: expose the headers.** `cors({ origin, exposedHeaders: ["X-Portal-Tile-Simplified","X-Portal-Tile-Truncated","X-Portal-Tile-Aggregated","ETag"] })`.
3. **Web: distinguish empty from failed.** `fetchTile` returns empty bytes only for `204/304`; on any other non-OK it reports status via `onStatus` then **throws** (MapLibre errors the tile → retryable, not cached-empty). `TileStatus` gains `failed: boolean` (`readTileStatus`: `status >= 400 && status !== 504`); `MapWidget` renders a `failed` notice mirroring the `timedOut` one.

Rejected: a bespoke error type or a tile-retry scheduler — out of proportion; MapLibre's own errored-tile retry is exactly what throwing re-enables.

## Plan — 1 slice

- **Files.** New: `apps/api/src/utils/pg-error.util.ts`. Edit: `portal-map-tile.service.ts` (use helper), `portal-sql.service.ts` (refactor onto helper), `app.ts` (exposedHeaders), `tile-protocol.util.ts` (throw on failure), `tile-source.util.ts` (`failed` flag), `MapWidget.component.tsx` (failed notice).
- **Tests** (all via `npm run test:unit` per package):
  - New `apps/api/src/__tests__/utils/pg-error.util.test.ts` — code read from `.cause`, from top-level, and `undefined` when absent.
  - `apps/api/src/__tests__/services/portal-map-tile.service.test.ts` — a `57014` wrapped in a `{cause}` shape → `ApiError 504 MAP_TILE_TIMEOUT`; a non-timeout error rethrows.
  - `apps/web/.../__tests__/tile-source.util.test.ts` — `failed` true for 500, false for 204/304/200/504.
  - `apps/web/.../__tests__/tile-protocol.util.test.ts` — throws on 500, returns empty on 204/304, returns bytes on 200; `onStatus` called in all cases.

## Smoke (manual, against your dev stack)

1. Open a `geo` map over a large polygon layer at its authored low zoom (or force a tile `statement_timeout`). **Before:** blank map, network shows `500 {code:UNKNOWN}`. **After:** the failing tile returns `504`, and the widget shows *"A map tile timed out — pan or zoom to retry."*
2. On a **deployed/cross-origin** stack (app-dev, or web pointed at a non-proxy API): a degraded-but-successful tile now shows its `Simplified` / `Aggregated` notice (previously dead cross-origin). Confirm the `X-Portal-Tile-*` response headers are readable in devtools.
3. Force a non-timeout tile failure (e.g. a 500): the widget shows the new *failed* notice, and panning away and back **re-requests** the tile (not served from an empty cache).

## Out of scope

- The tile **performance** itself (the 10s budget) — that's #450.
- Any change to which headers the server *emits* (#316 owns that); this only exposes + reads them.
- WKB→GeoJSON pin materialization (#371).
