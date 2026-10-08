# Stored pipelines naming a column the view no longer exposes — Condensed design (#727)

**Issue:** [EnterpriseBT/portal-ai#727](https://github.com/EnterpriseBT/portal-ai/issues/727) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** A saved map or chart stores its pipeline SQL. When the curated view stops exposing a column that SQL names (the projection changed, or a viewer whose grants hide it), Postgres raises **42703** `column "c_name" does not exist`. Nothing maps that SQLSTATE, so every map tile and every widget refresh answers **500**: one per tile, a broken render, and a flood of errors in the log (app-dev, 2026-10-07 21:37). The missing table (42P01) is already handled as "absent" on both paths. A missing column is the same situation and should read the same. `apps/api` only; the web already handles the chosen responses.

## Current shape

| Piece | Location | Note |
|---|---|---|
| SQL error mapping | `services/portal-sql.service.ts:1191` `translateExecutionError` | 42P01 → `400 PORTAL_SQL_FORBIDDEN "unknown entity: …"`, 57014 → timeout, 25006 → read-only; **anything else passes through raw**. Called by `runSqlQuery` (agent `sql_query`, `resolveSqlDelivery`, handle produce and re-exec) and `explainSqlQuery` |
| Tile query | `services/portal-map-tile.service.ts:1101-1148` (`runSessionViewTile`) | the catch maps 42P01 → empty result (→ 204), 57014 via `mapTileError`; **rethrows the rest** → 500 |
| Widget refresh | `services/portal-viz-refresh.service.ts:86` `refresh` → `executePipeline` (:243) → `resolveSqlDelivery` | no catch; typed refusals are only `VIZ_WIDGET_NOT_FOUND` (404) and `VIZ_WIDGET_NOT_REFRESHABLE` (422) |
| Pin refresh | `refreshPinnedResult` (:155) → the same `executePipeline` (:193) | same exposure |
| Web | `apps/web/src/utils/use-widget-refresh.util.ts:103` | `422 VIZ_WIDGET_NOT_REFRESHABLE` → `notRefreshable` ("can't auto-refresh — re-run the prompt"); tiles: 204 is a silent empty tile, any other ≥400 shows "A map tile failed to load" |

## Decision — treat a missing column like a missing table, and say so per surface

1. **`translateExecutionError`:** `42703` becomes `400 PORTAL_SQL_FORBIDDEN "unknown column: <name>"`, parsed from `column "x" does not exist` or `column x.y does not exist`. This is the sibling of "unknown entity". To the caller, a column the view hides is indistinguishable from one that doesn't exist. Every `runSqlQuery` consumer gets it, so the agent's `sql_query` also gets a clear refusal instead of a 500.
2. **Tiles:** `42703` is handled like `42P01`: an empty result, so a **204**. The map draws nothing for that tile, silently, as it already does for a view the caller can't read. A per-tile error would re-fire on every pan and zoom.
3. **Widget and pin refresh:** an "unknown entity" or "unknown column" refusal from `executePipeline` becomes **`422 VIZ_WIDGET_NOT_REFRESHABLE`**, with the message "This widget's query no longer matches the data you can see — re-run the prompt to rebuild it." The web already turns that code into the "can't auto-refresh, re-run the prompt" state, so no client change is needed. That code's hint in `api-codes.constants.ts` (written for "predates live refresh") widens to cover a stale query too.

*Not chosen:*
- **A new error code.** It needs a web change for the same user-facing outcome.
- **Rewriting the stored pipeline to drop the column.** That silently changes what a saved chart shows.

## Plan — 1 slice

**Files:**
- `services/portal-sql.service.ts` (`translateExecutionError`)
- `services/portal-map-tile.service.ts` (the `runSessionViewTile` catch)
- `services/portal-viz-refresh.service.ts` (wrap `executePipeline`)
- `constants/api-codes.constants.ts` (the hint)

**Tests:**
- `__tests__/__integration__/services/portal-sql.service.integration.test.ts`: selecting a column the view doesn't expose → `400 PORTAL_SQL_FORBIDDEN "unknown column: …"`, next to the 42P01 case.
- `__tests__/__integration__/routes/portal-map.router.integration.test.ts`: a stored pipeline naming a missing column → **204**, next to "no granted view → 204 (42P01)".
- `__tests__/services/portal-viz-refresh.service.test.ts`: `executePipeline` rejecting with the unknown-column refusal → `422 VIZ_WIDGET_NOT_REFRESHABLE`, for both widget and pin refresh. Any other error still propagates.

Run the touched tests via `npm run test:unit` / `test:integration -- --testPathPattern …`, plus `type-check` and `lint`.

## Smoke (app-dev, after deploy)

1. Open a portal whose saved map's pipeline names a column the view no longer exposes. The 2026-10-07 case was `customers.c_name`; reproduce it by removing a column from a view's projection after making the map. The map loads with that layer empty, there are no "tile failed" banners, and the logs show no tile 500s.
2. Refresh that widget. It shows "can't auto-refresh — re-run the prompt", not an error.
3. Ask the agent for that column through `sql_query`. It gets "unknown column", not a 500.

## Out of scope

- Pin **create** re-materializing an expired handle (`portal-result-pin.service.ts:226`) now gets the 400 instead of a 500. That's acceptable; it can map to the 422 later if wanted.
- The dissolve precompute processor, which runs in the queue, not on a request path.
