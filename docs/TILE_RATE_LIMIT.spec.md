# Map tiles and the per-user rate limit — Spec

**Issue:** [EnterpriseBT/portal-ai#705](https://github.com/EnterpriseBT/portal-ai/issues/705) · Bug · **Discovery:** `docs/TILE_RATE_LIMIT.discovery.md`

This spec pins three things:
- map tiles get their own per-user rate-limit bucket, mounted ahead of the API limiter;
- every rate-limit 429 says exactly when to come back;
- the map treats a 429 as a timed pause with its own notice, never as "failed".

> **Amended after code review (#748).** Tiles refuse with their own `429 MAP_TILE_RATE_LIMITED`, and only that code logs at warn (`API_RATE_LIMITED` stays an error). `HttpService.error` sets `Retry-After` from `details.retryAfterSeconds` for every error, replacing the per-site header code (including #698's `applyTileErrorHeaders`), and both limiters build their refusal with `rateLimitedError` (`utils/rate-limit-refusal.util.ts`). The tile mount carries `requireOrgWritable` and ends in a `404 MAP_TILE_NOT_FOUND`. The web map counts a 429 as `rateLimited` only when it carries `Retry-After`, and its notice says tiles load on the next pan or zoom. Where this conflicts with the text below, this note wins.

## Key decisions (flag for review)

1. **Tiles have a separate bucket.** The tile bucket is `AUTH_TILE_RATE_LIMIT_PER_MIN` (default **1200**), keyed `authed-tiles:${sub}`. Tiles never count against the API bucket (`authed:${sub}`, unchanged, so existing windows aren't reset on deploy).
2. **A separate mount, not a path match.** `protectedRouter.use("/portal-map", tileLimiter, portalMapRouter)` goes right after `jwtCheck`, ahead of the API limiter. Tiles skip `requireOrgWritable`, which only gates mutating methods; both tile routes are GET.
3. **`Retry-After` is the seconds left in the fixed window** (1–60), computed from the same `now` the counter used. Both limiters send it, and it also rides `details.retryAfterSeconds`.
4. **The counter's return type doesn't change.** A pure helper, `secondsUntilWindowEnd(windowMs, now)`, sits beside `incrementFixedWindow`, so the six existing counter callers are untouched.
5. **Failure modes are unchanged.** Both buckets fail open on a Redis error or timeout. With Redis down, tiles are still bounded by the in-process admission gate (#698).
6. **`API_RATE_LIMITED` is expected backpressure**, logged at warn like `MAP_TILE_BUSY`. `SITE_CONFIG_RATE_LIMITED` (anonymous scraping) stays as it is.
7. **The web map adds a `rateLimited` tile status.** It pauses the tab's tile queue for `Retry-After`, and the clamp's ceiling goes from 30 s to **60 s**. It has its own notice and is never `failed`.

## Scope

### In scope
- `apps/api`: the limiter middleware takes a bucket; the window-end helper; the tile mount; `Retry-After` on both limiters; the backpressure log level; env and docs.
- `apps/web`: tile status, pause and notice for a 429.
- Docs: `.env.example`, the `environment.ts` comments, `CLAUDE.md` (#698 paragraph plus the `.github/copilot-instructions.md` mirror), the limiter's dangling doc reference, and the `portal-map.router.ts` header.

### Out of scope
- **A global 429 experience in the web app** (a toast or retry for any query). Filed as a follow-up when the PR opens.
- **Per-org API limits** (deferred by #574) and **tier-derived limits**. The `limitPerMinute` argument stays the seam.
- **Tile admission gate constants** and **the limiting algorithm** (fixed window stays).

## Surface

### `apps/api/src/utils/rate-limit.util.ts`

```ts
/** #705: seconds until the fixed window containing `now` ends — the exact
 *  Retry-After for a refusal counted in that window. Always in [1, windowMs/1000]. */
export function secondsUntilWindowEnd(windowMs: number, now: number = Date.now()): number;
// = Math.max(1, Math.ceil(((Math.floor(now / windowMs) + 1) * windowMs - now) / 1000))

export const RATE_WINDOW_MS = 60_000; // exported; incrementRateWindow uses it
```

`incrementRateWindow` and `incrementFixedWindow` keep their signatures and return a `number`.

### `apps/api/src/middleware/authenticated-rate-limit.middleware.ts`

```ts
export type AuthRateLimitBucket = "api" | "tiles";

export function authenticatedRateLimit(opts: {
  bucket: AuthRateLimitBucket;
  limitPerMinute: number;
}): RequestHandler;
```

- **Key:** `api` → `authed:${sub}`; `tiles` → `authed-tiles:${sub}`.
- **No `sub`:** allow, as today.
- **Over the limit:** a single `now = Date.now()` is passed to both `incrementRateWindow(key, now)` and `secondsUntilWindowEnd(RATE_WINDOW_MS, now)`. The middleware then sets `res.setHeader("Retry-After", String(s))` and calls `next(new ApiError(429, ApiCode.API_RATE_LIMITED, msg, { retryAfterSeconds: s }))`.
  - `api` message: `"Too many requests. Try again in ${seconds(s)}."`
  - `tiles` message: `"Too many map tile requests. Try again in ${seconds(s)}."`
  - `seconds(s)` renders "1 second" or "N seconds". The code is the same for both buckets.
- **Redis error or timeout:** warn with `{ error, sub, bucket }` and allow.
- **Module doc:** the `docs/AUTH_API_RATE_LIMITING.condensed.md` pointer is replaced with an inline note. Per-org limiting needs a per-request DB lookup and is deferred (#574); the two buckets and why tiles have their own (#705) are described.

### `apps/api/src/middleware/public-rate-limit.middleware.ts`

When over the limit, it sets the same `Retry-After` and passes `details: { retryAfterSeconds }` with the message `"Too many requests. Try again in ${seconds(s)}."`. The code stays `SITE_CONFIG_RATE_LIMITED`.

### `apps/api/src/routes/protected.router.ts`

```ts
protectedRouter.use(jwtCheck);
// #705: map tiles have their own per-user bucket … mounted BEFORE the API
// limiter so a tile request never reaches it. Any route added to
// portalMapRouter counts against the tile bucket. Skips requireOrgWritable,
// which only gates mutating methods — tile routes are GET.
protectedRouter.use(
  "/portal-map",
  authenticatedRateLimit({ bucket: "tiles", limitPerMinute: environment.AUTH_TILE_RATE_LIMIT_PER_MIN }),
  portalMapRouter
);
protectedRouter.use(authenticatedRateLimit({ bucket: "api", limitPerMinute: environment.AUTH_API_RATE_LIMIT_PER_MIN }));
protectedRouter.use(requireOrgWritable);
// … the later `protectedRouter.use("/portal-map", portalMapRouter)` is removed.
```

### `apps/api/src/environment.ts` + `apps/api/.env.example`

`AUTH_TILE_RATE_LIMIT_PER_MIN: parseInt(process.env.AUTH_TILE_RATE_LIMIT_PER_MIN || "1200", 10)`, with a comment that says:
- it's per user, separate from the API bucket;
- why it's generous (tile fan-out, 304s count, multi-map stations);
- the in-process gate still bounds the database.

The `AUTH_API_RATE_LIMIT_PER_MIN` comment drops "normal app usage bursts well under this" in favour of "map tiles have their own bucket". `.env.example` gets the matching commented line.

### `apps/api/src/utils/log-level.util.ts`

`BACKPRESSURE_API_CODES` gains `ApiCode.API_RATE_LIMITED`, and the doc comment names it. `app.ts`'s comment changes to "expected load-shedding (503 MAP_TILE_BUSY, 429 API_RATE_LIMITED)".

### `apps/api/src/routes/portal-map.router.ts`

- The header (:9-12) is corrected: abuse protection is the per-user tile bucket (#705), the tile admission gate (#698, per process and per org), and the client's six concurrent fetches per tab (#350).
- Both `@openapi` blocks gain a `429` response with a `Retry-After` header, described as "Per-user tile rate limit exceeded (API_RATE_LIMITED)".

### `apps/api/src/constants/api-codes.constants.ts`

There are no new codes. The `API_RATE_LIMITED` user copy at :861 is unchanged.

### `apps/web/src/modules/MapWidget/utils/tile-source.util.ts`

```ts
export interface TileStatus { …; /** 429 API_RATE_LIMITED (#705): the caller's per-user tile bucket is spent; tiles resume after Retry-After. */ rateLimited: boolean; }
EMPTY_TILE_STATUS.rateLimited = false;
readTileStatus: failed = status >= 400 && ![503, 504, 429].includes(status); rateLimited = status === 429;
```

### `apps/web/src/modules/MapWidget/utils/tile-protocol.util.ts`

- `MAX_RETRY_AFTER_MS = 60_000`, with the doc saying the range is now "[1s, 60s]" so a full limiter window is honoured.
- `fetchTile` pauses on `res.status === 503 || res.status === 429`, using the comment "a saturated gate or a spent tile bucket". It still throws afterwards so MapLibre retries.

### `apps/web/src/modules/MapWidget/MapWidget.component.tsx`

A new notice after `busy`:

```tsx
{tiles.rateLimited ? (
  <Typography variant="caption" color="warning.main" data-testid="map-widget-tile-rate-limited">
    Loading map tiles too quickly — tiles resume in a few seconds.
  </Typography>
) : null}
```

`MapWidget.stories.tsx` gets a `rateLimited` field on its status fixture, plus a story that shows the notice.

## Migration / Seed

None: there's no schema change.

## TDD test plan

API tests run from `apps/api` with `npm run test:unit -- --testPathPattern <…>` and `npm run test:integration -- --testPathPattern <…>`. Web tests run from `apps/web` with `npm run test:unit -- --testPathPattern MapWidget`.

### API unit
- `__tests__/utils/rate-limit.util.test.ts`, `secondsUntilWindowEnd`. These cases check where in the window `now` falls:
  - window start → 60;
  - mid-window (`+15_500` ms) → 45 (ceil);
  - 1 ms before the end → 1;
  - exactly on the boundary → 60.
  (4 cases)
- `__tests__/middleware/authenticated-rate-limit.middleware.test.ts`:
  - the `api` bucket keys `authed:<sub>`, and the `tiles` bucket keys `authed-tiles:<sub>`;
  - over the limit sets `Retry-After` to the window's remainder (fixed `now`), and the error carries `details.retryAfterSeconds` and the per-bucket message;
  - at the limit, the request passes;
  - no `sub` → allow;
  - Redis throws → allow and warn with the bucket.
  The existing cases are updated to the options signature. (≈7)
- `__tests__/middleware/public-rate-limit.middleware.test.ts`: the refusal sets `Retry-After` and `details`. (1)
- `__tests__/utils/log-level.util.test.ts` (existing): `API_RATE_LIMITED` → true; `SITE_CONFIG_RATE_LIMITED` and `DB_ADMISSION_TIMEOUT` → false. (2)

### API integration
`__tests__/__integration__/routes/rate-limit-buckets.integration.test.ts` (new: it sets `AUTH_TILE_RATE_LIMIT_PER_MIN=3` and `AUTH_API_RATE_LIMIT_PER_MIN=2` in `process.env` before its dynamic `import("app.js")`, because `environment.ts` reads them at import; it mocks `jwtCheck` to set `req.auth.payload.sub` to a per-test subject). These run against real Redis, and keys are cleaned per test.
- After the API bucket is exhausted (a GET on any list returns 429 with a `Retry-After` header in [1, 60] and `details.retryAfterSeconds`), a tile request is **not** 429. It still reaches the tile router: 404 or 400, not 429.
- After the tile bucket is exhausted, a tile request returns 429 `API_RATE_LIMITED` with `Retry-After`, and an API GET is still not 429 (it reaches its router).
- A tile request leaves the `authed:<sub>` counter untouched (read the Redis key).

(3 cases)

### Web unit
- `tile-source.util.test.ts`: 429 → `{ rateLimited: true, failed: false, busy: false }`; 503 and 504 unchanged. (1)
- `tile-protocol.util.test.ts`:
  - a 429 pauses the tab queue for `Retry-After` (a later fetch waits; fake timers);
  - `parseRetryAfter("60")` → 60 000, and `"120"` → 60 000;
  - the existing 30 s clamp case is updated.
  (3)
- `MapWidget.test.tsx`: `rateLimited: true` renders `map-widget-tile-rate-limited`, not `map-widget-tile-failed`. (1)

**Totals ≈ 22 cases** (about 14 API unit, 3 integration and 5 web), plus updates to existing fixtures for the new `rateLimited` field.

Also: `npm run type-check`, `npm run lint` and `npm run format:check` at the root.

## Acceptance criteria

- [ ] Panning a map until the tile bucket is spent never makes a non-tile API call return 429.
- [ ] A tile request never increments the API bucket.
- [ ] A tile request over `AUTH_TILE_RATE_LIMIT_PER_MIN` gets `429 API_RATE_LIMITED`, with a `Retry-After` equal to the seconds left in the minute and `details.retryAfterSeconds`.
- [ ] Every API-bucket and public-limiter 429 carries `Retry-After` and `details.retryAfterSeconds`.
- [ ] A rate-limited map shows "Loading map tiles too quickly — tiles resume in a few seconds.", never "A map tile failed to load", and stops requesting tiles until `Retry-After` elapses. Tiles then load on the next pan or zoom.
- [ ] A 429 `API_RATE_LIMITED` logs at warn, not error.
- [ ] With Redis down, tiles and the API both still serve (fail open).
- [ ] No doc still points to `AUTH_API_RATE_LIMITING.condensed.md`, and the `portal-map.router.ts` header describes the current protections.

## Risks & rollback

- **Tile bucket too low.** The map pauses in normal use. It's detected by warn-level 429 logs on `/api/portal-map`; the fix is raising `AUTH_TILE_RATE_LIMIT_PER_MIN`, with no deploy. Too high costs nothing, because the gate bounds the database.
- **Mount order regression.** If someone moves the API limiter above the tile mount, tiles share the bucket again. The integration test catches this.
- **Fail-open** is unchanged and recorded. A Redis outage removes both per-user ceilings, but the gate and the client's concurrency cap still bound tiles.
- **Rollback:** reverting the PR restores today's behaviour. No data or schema is involved, and the `authed:` key is unchanged.

## Files touched

- **api (edit):** `utils/rate-limit.util.ts`, `middleware/authenticated-rate-limit.middleware.ts`, `middleware/public-rate-limit.middleware.ts`, `routes/protected.router.ts`, `routes/portal-map.router.ts`, `utils/log-level.util.ts`, `app.ts` (comment), `environment.ts`, `.env.example`.
- **api tests:** `__tests__/utils/rate-limit.util.test.ts`, `__tests__/middleware/authenticated-rate-limit.middleware.test.ts`, `__tests__/middleware/public-rate-limit.middleware.test.ts`, `__tests__/utils/log-level.util.test.ts`, `__tests__/__integration__/routes/rate-limit-buckets.integration.test.ts` (new).
- **web (edit):** `modules/MapWidget/utils/tile-source.util.ts`, `utils/tile-protocol.util.ts`, `MapWidget.component.tsx`, `stories/MapWidget.stories.tsx`, `__tests__/tile-source.util.test.ts`, `__tests__/tile-protocol.util.test.ts`, `__tests__/MapWidget.test.tsx`.
- **docs:** `CLAUDE.md`, `.github/copilot-instructions.md`.

## Next step

`/plan 705` writes `docs/TILE_RATE_LIMIT.plan.md` with about four TDD slices, each a commit on `fix/705-tile-rate-limit`:
1. The window-end helper, plus `Retry-After` on both limiters.
2. The bucket option, the tile mount, env, and the integration test.
3. The backpressure log level, plus API docs and the OpenAPI 429s.
4. Web status, pause, clamp and notice, plus the `CLAUDE.md` mirror.
