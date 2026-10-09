# Map tiles and the per-user rate limit — Discovery

**Issue:** [EnterpriseBT/portal-ai#705](https://github.com/EnterpriseBT/portal-ai/issues/705)

**Why this exists.** Every authenticated API call, map tiles included, counts against one per-user budget: 300 requests a minute, a fixed window keyed by the Auth0 subject. Map interaction is by far the most request-intensive thing a user does, because MapLibre fans out 6–10 tiles per view change. So fast pan and zoom exhausts the budget on its own: one smoke-walk run saw 95 of 96 tile responses come back `429 API_RATE_LIMITED`. Three things then go wrong at once:
- the map says "A map tile failed to load — pan or zoom to retry", which tells the user to do the thing that keeps them limited;
- the 429 carries no `Retry-After`, so nothing backs off;
- the user's **whole** API (lists, saves, chat) is throttled for up to a minute, because tiles and everything else share the bucket.

Since #698, tiles already have their own server-side bound: a per-process admission gate with a per-org share, answering `503 MAP_TILE_BUSY` with `Retry-After`. The per-user limiter double-bounds tiles and starves the rest of the app.

This is the change that gives tiles their own budget, makes every rate-limit refusal say when to come back, and has the map treat a limit as a pause rather than a failure.

## The current shape

### Server: the per-user limiter (#574)

| Piece | Location | Note |
|---|---|---|
| Middleware | `apps/api/src/middleware/authenticated-rate-limit.middleware.ts:32-65` | `authenticatedRateLimit(limitPerMinute)`; key `authed:${sub}` (:46); allows if there's no `sub` (:41); fails open on a Redis error (:56-62) |
| Refusal | same, :48-54 | `429 API_RATE_LIMITED` "Too many requests. Try again in a minute.", with **no `Retry-After`** and no details |
| Counter | `apps/api/src/utils/rate-limit.util.ts:45-77` | `incrementRateWindow` → `incrementFixedWindow(key, 60_000, 120s TTL)`; key `usage:rate:${key}:${floor(now/60000)}` (`INCR` + `EXPIRE`), bounded by `withRedisTimeout` |
| Mount | `apps/api/src/routes/protected.router.ts:40-48` | `jwtCheck` → limiter → `requireOrgWritable` → routers; `/portal-map` at :83, after the limiter. **There's no exemption mechanism**: being outside `protectedRouter` is the only way out |
| Config | `apps/api/src/environment.ts:168-175`, `apps/api/.env.example:305-309` | `AUTH_API_RATE_LIMIT_PER_MIN` (default 300); the comment "normal app usage bursts well under this" is false for maps |
| Dangling reference | middleware doc :10-12 | points to `docs/AUTH_API_RATE_LIMITING.condensed.md`, which doesn't exist (swept with no history); per-org limiting is recorded there as deferred |
| Sibling | `middleware/public-rate-limit.middleware.ts:31-39` | per-IP, `SITE_CONFIG_RATE_LIMITED`, also no `Retry-After` |

### Server: the tile admission gate (#698)

| Piece | Location | Note |
|---|---|---|
| Gate | `apps/api/src/utils/admission-gate.util.ts:47-155` | in-memory, per process; `concurrency` + `perKeyLimit`; `queue_full` / `timeout` / `aborted` |
| Tile instance | `apps/api/src/services/portal-map-tile.service.ts:126-158`, :1580-1595 | concurrency 4, per org 2, queue 8, wait 5 s; `503 MAP_TILE_BUSY` + `details.retryAfterSeconds` (2) |
| Headers | `apps/api/src/routes/portal-map.router.ts:74-81` `applyTileErrorHeaders` | sets `Retry-After` on `res` before `next(err)`. `HttpService.error` (`services/http.service.ts:61-75`) writes only the body, so a header must be set on `res` first |
| Log level | `apps/api/src/utils/log-level.util.ts:17-24` | `isExpectedBackpressure` = {`MAP_TILE_BUSY`}: logged at warn, not error |

### Web: the tile pipeline

| Piece | Location | Note |
|---|---|---|
| Status | `apps/web/src/modules/MapWidget/utils/tile-source.util.ts:57-70` `readTileStatus` | 504 → `timedOut`; 503 → `busy`; any other ≥ 400 → `failed`, **so 429 = failed** |
| Fetch + pause | `apps/web/src/modules/MapWidget/utils/tile-protocol.util.ts:63-104`, :144-201 | tab-wide `tileFetchesPausedUntil`; `parseRetryAfter` handles integer seconds only, defaults to 2, **clamps to 1–30 s**; pauses **only on 503** (:183-185); 6 concurrent (#350) |
| Notices | `apps/web/src/modules/MapWidget/MapWidget.component.tsx:359-385` | timeout / failed ("A map tile failed to load — pan or zoom to retry.") / busy ("Map server is busy — tiles will load when you pan or zoom."); last response wins (:166-171) |
| Rest of the app | `apps/web/src/utils/api.util.ts:66-110`, `apps/web/src/client.ts:18-33` | nothing handles 429: no header reading, no retry of a 4xx, no toast. While tiles drain the bucket, every query fails with "Too many requests…" |

### Tests and docs

- Limiter: `__tests__/middleware/authenticated-rate-limit.middleware.test.ts`, `__tests__/utils/rate-limit.util.test.ts`. There are no limiter assertions in `__integration__/routes/protected.router.integration.test.ts`.
- Gate and route: `__tests__/utils/admission-gate.util.test.ts`, `__tests__/services/portal-map-tile.service.test.ts`, `__tests__/routes/portal-map.router.test.ts:66-90`.
- Web: `modules/MapWidget/__tests__/tile-source.util.test.ts`, `tile-protocol.util.test.ts` (the module-global pause must not leak between tests, :224-225), `MapWidget.test.tsx`.
- Docs: `CLAUDE.md:457` (the #698 paragraph), `.env.example`, `docs/SERVER_ERROR_MESSAGES.condensed.md:14`, and the dangling `AUTH_API_RATE_LIMITING` reference.

## The design space

### Decision 1 — how tiles relate to the per-user limiter

- **A. Exempt tiles entirely.** They're bounded by the tile gate alone. It's the simplest option, but the gate only bounds *concurrency* per process and per org. One user can still hold their org's two slots continuously and starve teammates, and there's no per-user ceiling at all.
- **B. A separate per-user tile bucket.** Tiles count against `AUTH_TILE_RATE_LIMIT_PER_MIN` (its own Redis key, `authed-tiles:${sub}`) instead of the API bucket. Heavy panning can never throttle the rest of the app, and a runaway client still hits a ceiling.
- **C. Keep one bucket but raise it.** That just moves the cliff: a big enough map session still locks the whole app.

| | A: exempt | B: own bucket | C: raise |
|---|---|---|---|
| Rest of the API is safe from tiles | Yes | Yes | No |
| Per-user ceiling on tiles | No | Yes | Yes (shared) |
| Mechanism | skip | one more key | config |
| Abuse bound | the gate only | the gate + the bucket | the bucket |

**Lean: B.** It's the only option that both isolates the app from tiles and keeps a per-user ceiling. The gate bounds the database; the bucket bounds one user.

**How the tile bucket is wired (decided).** There are two ways to route tiles to their own bucket:
- **(i) Path match.** One limiter picks the bucket from `req.path`. A later rename of the tile route would quietly drop tiles back into the API bucket, and the bug would return with nothing to flag it.
- **(ii) A separate mount.** `protectedRouter.use("/portal-map", tileRateLimit, portalMapRouter)` goes right after `jwtCheck`, before the API limiter. A tile request is answered there and never reaches the API bucket.

**Decided: (ii).** The separation is structural, not a string match. Tiles then skip `requireOrgWritable`, which is harmless: it gates only mutating methods ("reads always pass", `protected.router.ts:49-50`), and both tile routes are GETs. The mount gets a comment saying that any route added to `portalMapRouter` counts against the tile bucket.

### Decision 2 — `Retry-After` on rate-limit refusals

- **A. The seconds left in the current fixed window** (`ceil((windowEnd − now)/1000)`, 1–60) on every `API_RATE_LIMITED` 429, for both buckets. It's exact, since the window is wall-clock aligned.
- **B. A constant (e.g. 60).** Simpler, but a client that respects it waits up to a minute longer than it has to.
- **C. No header; rely on the message.** That's today's behaviour, and no client can back off correctly.

**Lean: A.** `incrementFixedWindow` already knows the window, so it returns `retryAfterSeconds` alongside the count. The middleware sets the header on `res` and puts the value in `details`, the same way `MAP_TILE_BUSY` does.

### Decision 3 — what the map does on a tile 429

- **A. Treat it as busy:** pause the tab's tile queue for `Retry-After` and show the existing busy notice. That reuses #698's machinery, but "server is busy" isn't true: the *user* is over their tile budget.
- **B. A distinct `rateLimited` status:** pause the same way, with its own notice ("Loading map tiles too quickly — tiles resume in a few seconds."), and never the "failed" one. The pause clamp is raised from 30 to 60 s so a full window is honoured.
- **C. Pause silently with no notice.** The map just looks frozen.

**Lean: B.** It's honest about the cause, so the user doesn't pan harder, and it reuses the pause path. A 429 must never surface as "failed".

### Decision 4 — the rest of the web app's handling of `API_RATE_LIMITED`

- **A. In this ticket**, a global toast or backoff for any 429.
- **B. Defer.** Decision 1 removes the reported cause (tiles starving the API), and a generic 429 experience is a separate UX decision.

**Lean: B.** Record it as a follow-up. With tiles in their own bucket, a 429 on the API bucket means genuinely heavy use, and the existing error surfaces still show "Too many requests…".

## Tradeoff comparison

|  | D1: own tile bucket | D2: window `Retry-After` | D3: `rateLimited` pause | D4: defer global 429 UX |
|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | No (follow-up) |
| Packages | api | api | web | — |
| Contract change | new env var | new header + `details.retryAfterSeconds` | new tile status | — |

## Recommendation

1. Tile routes (`/api/portal-map/tiles/**`) count against a **separate per-user bucket**, `AUTH_TILE_RATE_LIMIT_PER_MIN` (default 1200), keyed `authed-tiles:${sub}`, and never against the API bucket.
2. The limiter middleware takes a bucket name and a limit. `portalMapRouter` is mounted in `protectedRouter` right after `jwtCheck` with its own tile-bucket limiter, ahead of the API limiter. A tile request never reaches the API bucket. Fail-open behaviour is the same for both buckets.
3. Every `429 API_RATE_LIMITED` carries `Retry-After: <seconds to the window's end>` (1–60) and `details.retryAfterSeconds`. `incrementFixedWindow` returns the window end so the value is exact.
4. A 429 with `API_RATE_LIMITED` logs at warn (`isExpectedBackpressure`), the same as `MAP_TILE_BUSY`.
5. The web map gains a `rateLimited` tile status. A tile 429 pauses the tab's tile queue for `Retry-After`, with the pause clamp raised to 60 s, and shows "Loading map tiles too quickly — tiles resume in a few seconds." It is never "failed".
6. Docs: replace the dangling `AUTH_API_RATE_LIMITING.condensed.md` reference with an accurate note, update `.env.example` and the `environment.ts` comment for both buckets, add the tile bucket to `CLAUDE.md`'s #698 paragraph, and correct the `portal-map.router.ts:9-12` header. It still says tile abuse protection is "the org scope plus statement_timeout"; it's now three layers: the tile bucket, the gate, and 6 concurrent fetches per tab.

## Open questions

1. **What default for the tile bucket?** The smoke walk saw about 95 tiles in 25 s from fast panning, roughly 230 a minute at sustained abuse, and normal use is far below that. **Decided: 1200/min**, about five times the abusive-human rate. The margin is deliberately wide for three reasons: 304 revalidations count, a station with several map pins multiplies the fan-out, and a fixed window allows a 2× burst across a minute boundary. Too low brings the bug back in a softer form; too high costs nothing, because the gate still bounds the database. It's tunable per environment.
2. **Should the public limiter also send `Retry-After`?** It shares `incrementFixedWindow`. **Lean: yes, in the same change.** It's one line once the counter returns the window end, and leaving it out would make the two limiters inconsistent.
3. **Per-org limiting (deferred by #574).** **Lean: stay deferred.** The tile gate's per-org share already isolates tenants on the expensive path, and per-org API limiting is a tier and billing decision.
4. **Should the client honour an HTTP-date `Retry-After`?** **Lean: no.** The server only ever sends integer seconds, so `parseRetryAfter` keeps its integer form and the 2 s default.

## Enterprise-scale considerations

- **Concurrency & correctness.** **Lean:** keep the Redis `INCR` fixed window. It's atomic per key across ECS tasks, and a second key is just another counter. `Retry-After` is computed from the same window, so it's consistent across instances.
- **Accuracy & auditability.** **N/A** because rate limiting is ephemeral backpressure, not a billed or audited quantity. Tool spend has its own ledger (#172).
- **Failure modes.** **Lean:** both buckets fail open on Redis errors, as today. When Redis is down, tiles are still bounded by the in-process gate, and the API keeps working. The client's pause is bounded (at most 60 s) and abortable.
- **Scale & unbounded growth.** **Lean:** one more short-TTL key per active user a minute. Tile fan-out is bounded three times: per user (the bucket), per process and per org (the gate), and per tab (6 concurrent, #350).
- **Multi-tenancy.** **Lean:** per-user buckets plus the gate's per-org share. Per-org API limits stay deferred (open question 3).
- **Contract stability.** **Lean:** the new header and `details.retryAfterSeconds` are additive. A future tier-based limit would plug in by choosing the limit per bucket without changing call sites, since the middleware already takes `(bucket, limit)`.
- **Data lifecycle.** **N/A** because the windows are one-minute technical backpressure with no business period. TTL cleanup is automatic.

## What this doesn't decide

- **A global 429 experience in the web app** (toast, backoff, retry for any query). It's a separate UX decision; record it as a follow-up.
- **Per-org API rate limits.** A tier and billing decision, deferred by #574.
- **Tuning the tile gate's constants** (concurrency 4, per org 2): #698's measured choices. This ticket doesn't touch database load.
- **Sliding-window or token-bucket limiting.** The fixed window is adequate once tiles have their own budget; a different algorithm would be its own change.

## Next step

`/spec 705` writes `docs/TILE_RATE_LIMIT.spec.md`: the bucket contract, the `Retry-After` and `details` shape, the `rateLimited` tile status and copy, the env vars, and the test plan. `/plan 705` then slices it TDD-style:
- **API:** the counter returns the window end, and the middleware takes a bucket and sets `Retry-After`, with unit tests.
- **API:** the tile bucket routing in `protectedRouter`, plus the log level, with an integration test proving tiles don't consume the API bucket.
- **Web:** `readTileStatus` and the pause path handle 429, the `rateLimited` notice, and the clamp.
- **Docs and env.**
