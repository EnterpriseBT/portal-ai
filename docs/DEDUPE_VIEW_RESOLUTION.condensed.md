# Dedupe per-user view resolution on the agent SQL path — Condensed design (#647)

**Issue:** [EnterpriseBT/portal-ai#647](https://github.com/EnterpriseBT/portal-ai/issues/647) · Feature · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** On the hot agent SQL path, `sql-query.tool` runs `explainSqlQuery` (→ `resolveViewsForSession`) and then, in the common under-threshold case, the synchronous run (→ `resolveViewsForSession` **again**) — so the whole per-user view resolution (role names + `loadSet` with per-grant `findById`, `stationViews.findByStationId`, N `curatedViews.findById`, per-view `statementCache.get` + `curatedViewFieldMappings.findByCuratedViewId`) runs **twice** per query. Correctness is identical both times; this is pure latency/DB load. Single-package: `apps/api`.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Explain probe | `apps/api/src/tools/sql-query.tool.ts:141` | `PortalSqlService.explainSqlQuery({ sql, stationId, organizationId, userId })` |
| Sync run | `apps/api/src/tools/sql-query.tool.ts:181` | `resolveResultSink(…)` → `runSqlQuery` (not called directly — a shared sink) |
| `explainSqlQuery` | `apps/api/src/services/portal-sql.service.ts:1043` | calls `this.resolveViewsForSession(stationId, organizationId, userId)` (`:1058`, default `db`) |
| `runSqlQuery` | `apps/api/src/services/portal-sql.service.ts:908` | calls the same `resolveViewsForSession` (`:942`, default `db`) |
| `resolveViewsForSession` | `apps/api/src/services/portal-sql.service.ts:726` | returns `SessionViewBuild` — **pure data** (DDL strings + `viewMap`), no bound connection |
| Request scope | `apps/api/src/utils/request-context.util.ts` | an `AsyncLocalStorage<RequestContext>` (`{ log }`), set per request by `request-context.middleware.ts` |

## Decision — per-request memo, not signature threading

Both calls run within one request's `requestContext` ALS scope, and `SessionViewBuild` is client-independent pure data (grants don't change mid-request — the issue confirms a stale-within-request value is fine). So memoize `resolveViewsForSession` by `(stationId, userId, organizationId)` in a per-request memo carried on the ALS store. The second call (explain→run, sequential) hits the memo; a worker with no request context just resolves normally.

- **Cache the resolved value, not the promise** — a transient rejection isn't cached, so the tool's existing "explain probe failed → fall back to sync" path still re-resolves cleanly on the run.
- **Correctness-neutral & fail-open:** no ALS store (job worker, tests) → `memoizeForRequest` just runs the factory. The escalated job path resolves once anyway.
- Memoizing `resolveViewsForSession` (not the inner `resolveGrantedViewColumns`) caches the whole chain **including** the DDL build, so the second call does zero work.

*Rejected:* thread the `SessionViewBuild` from `explainSqlQuery` into the run — the run goes through the shared `resolveResultSink`, so it would plumb an optional build through a sink used by many tools. *Rejected:* a TTL cache keyed by `(stationId,userId)` — risks staleness across requests when a grant changes; request-scoped is exactly the right lifetime.

## Plan — 1 slice

**Files**
- Edit `apps/api/src/utils/request-context.util.ts` — add an optional per-request `memo?: Map<string, unknown>` to `RequestContext` + a `memoizeForRequest<T>(key, factory)` helper (fail-open when no store; caches the resolved value).
- Edit `apps/api/src/services/portal-sql.service.ts` — wrap `resolveViewsForSession`'s body in `memoizeForRequest("views:" + stationId + ":" + userId + ":" + organizationId, …)`.

**Tests** (npm scripts, never raw jest)
- `apps/api/src/__tests__/utils/request-context.util.test.ts` — `memoizeForRequest` runs the factory once per key within `requestContext.run`, and every time with no store.
- `apps/api/src/__tests__/services/portal-sql.service.test.ts` (or the existing suite) — within `requestContext.run`, two `resolveViewsForSession` calls invoke the underlying resolution once (spy `resolveGrantedViewColumns`); with no context, twice.

## Smoke (manual, against your dev stack)

1. `npm run dev`; open a portal and run an agent SQL query (e.g. "show me contacts") that stays under the cost threshold.
2. In the API logs, confirm the per-user resolution's DB reads (`stationViews.findByStationId` / `curated_views` lookups) fire **once** for the query, not twice. (A debug log or a temporary counter confirms; the response is unchanged.)
3. Run a query that escalates (over threshold) → still correct; the job path resolves once (no request memo there, by design).

## Out of scope

- Memoizing `resolveGrantedViewColumns` for the cross-tool case (station_context + sql in one turn) — the target here is the explain+run double-call; a broader turn-level cache can follow if measured.
- Any change to the resolution logic itself or the escalation thresholds.
