# Map tiles and the per-user rate limit — Plan

**A TDD-sequenced implementation of #705.** It gives map tiles their own per-user rate-limit bucket mounted ahead of the API limiter, adds `Retry-After` and `details.retryAfterSeconds` to every rate-limit 429, logs `API_RATE_LIMITED` at warn, and makes the web map pause with a `rateLimited` notice instead of reporting "failed".

Spec: `docs/TILE_RATE_LIMIT.spec.md`. Discovery: `docs/TILE_RATE_LIMIT.discovery.md`. Issue: #705. It builds on the shipped #574 (per-user limiter) and #698 (tile admission gate, client `Retry-After` pause).

There are four slices. Each sits behind a green test suite and leaves the repo compilable, and each lands as a **commit on `fix/705-tile-rate-limit`**: one fix, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package. Never invoke jest directly (`feedback_use_npm_test_scripts`):

```bash
cd apps/api && npm run test:unit -- --testPathPattern '<pattern>'
cd apps/api && npm run test:integration -- --testPathPattern rate-limit-buckets
cd apps/web && npm run test:unit -- --testPathPattern MapWidget
```

Each slice follows the same steps:
1. Write the failing tests.
2. Make the smallest change that turns them green.
3. Run the focused tests.
4. Run `npm run lint && npm run type-check` at the boundary.
5. Move on to the next slice.

**Sequencing rationale.** The server contract comes before the client that reads it:
- **Slice 1** adds the `Retry-After` helper and header. It's pure, with no routing change, so every later 429 already carries the header.
- **Slice 2** adds the bucket split and tile mount. This is the actual fix for the reported starvation, proven end to end against real Redis.
- **Slice 3** moves the log level to warn and syncs the API docs. These only make sense once both buckets exist.
- **Slice 4** is the web map. It depends only on the HTTP contract (429 plus `Retry-After`), which slices 1 and 2 pin.

There's no migration or seed.

---

## Slice 1 — `Retry-After` on every rate-limit 429

Both limiters say exactly when the window resets. The middleware signatures don't change yet.

**Files**

- Edit: `apps/api/src/utils/rate-limit.util.ts`: export `RATE_WINDOW_MS = 60_000` (which `incrementRateWindow` uses) and `secondsUntilWindowEnd(windowMs, now)`.
- Edit: `apps/api/src/middleware/authenticated-rate-limit.middleware.ts` and `public-rate-limit.middleware.ts`:
  - one `now` is passed to the counter and to the helper;
  - the 429 calls `res.setHeader("Retry-After", …)`, sets `details: { retryAfterSeconds }`, and uses the "Try again in N second(s)." copy (spec → Surface).
  - The `_res` parameter becomes `res`.
- Edit tests: `__tests__/utils/rate-limit.util.test.ts`, `__tests__/middleware/authenticated-rate-limit.middleware.test.ts`, `__tests__/middleware/public-rate-limit.middleware.test.ts`.

**Steps**

1. **Tests (spec → API unit: the 4 `secondsUntilWindowEnd` cases).**
   - The helper's start, mid, last-ms and boundary cases.
   - In the limiter tests, an over-limit request with a fixed `now` sets the `Retry-After` header to the window remainder, carries `details.retryAfterSeconds`, and uses the new message, for both the authenticated and public limiters.
   - "1 second" is used for singular.
   - Run them; they fail.
2. **Implement** the helper and the header and details on both middlewares. Green.
3. Lint + type-check.

**Done when:** every `API_RATE_LIMITED` and `SITE_CONFIG_RATE_LIMITED` 429 carries `Retry-After` in [1, 60] plus `details.retryAfterSeconds`; the six other counter callers are untouched.

**Risk:** low. `HttpService.error` already forwards `details` on a 4xx, and the header must be set before `next(err)`.

---

## Slice 2 — a separate tile bucket, mounted before the API limiter

The fix itself: tile requests count against `authed-tiles:${sub}` and never touch `authed:${sub}`.

**Files**

- Edit: `apps/api/src/middleware/authenticated-rate-limit.middleware.ts`:
  - `authenticatedRateLimit({ bucket, limitPerMinute })`, with `AuthRateLimitBucket = "api" | "tiles"`;
  - the key is chosen per bucket, and the message per bucket;
  - the fail-open warning includes `bucket`;
  - the module doc's dangling `AUTH_API_RATE_LIMITING.condensed.md` pointer is replaced with the inline note (spec → Surface).
- Edit: `apps/api/src/routes/protected.router.ts`:
  - `/portal-map` is mounted with the tile limiter right after `jwtCheck`, with the mount comment from the spec;
  - the API limiter uses the options form;
  - the old `/portal-map` mount at :83 is removed.
- Edit: `apps/api/src/environment.ts`: add `AUTH_TILE_RATE_LIMIT_PER_MIN` (default 1200) with its comment, and reword the `AUTH_API_RATE_LIMIT_PER_MIN` comment.
- Edit: `apps/api/.env.example`: the commented `AUTH_TILE_RATE_LIMIT_PER_MIN=1200` block, and the reworded API block.
- New: `apps/api/src/__tests__/__integration__/routes/rate-limit-buckets.integration.test.ts`.
- Edit test: `__tests__/middleware/authenticated-rate-limit.middleware.test.ts`, moved to the options signature, plus bucket-key cases.

**Steps**

1. **Unit tests (spec → API unit: the bucket cases).**
   - `api` keys `authed:<sub>` and `tiles` keys `authed-tiles:<sub>`; each bucket has its own message.
   - At the limit the request passes; with no `sub` it's allowed; when Redis throws, the request is allowed and the warning includes `bucket`.
   - Run them; they fail on the signature.
2. **Integration tests (spec → API integration, 3 cases).**
   - Set `process.env.AUTH_TILE_RATE_LIMIT_PER_MIN = "3"` and `AUTH_API_RATE_LIMIT_PER_MIN = "2"` *before* `await import("app.js")`.
   - Mock `jwtCheck` with `jest.unstable_mockModule` so it sets `req.auth = { payload: { sub } }` from a test-controlled variable. Each case uses a fresh `sub`, so Redis keys never collide; the cases also `DEL` their `usage:rate:authed*:<sub>:*` keys in `afterEach`.
   - Case 1: exhaust the API bucket with a GET on a list route, and expect a tile GET to be not 429.
   - Case 2: exhaust the tile bucket, and expect a 429 `API_RATE_LIMITED` with `Retry-After`, while an API GET is still not 429.
   - Case 3: one tile request leaves the `authed:<sub>` key absent.
   - Run them; they fail (tiles currently share the bucket).
3. **Implement** the options signature, the mount move and the env var. Green on both suites.
4. Run the existing `portal-map.router` unit and integration suites. The tile routes moved mount position but kept their path, so these should be unaffected. Lint + type-check.

**Done when:** the three integration cases pass, `/api/portal-map/tiles/**` resolves exactly as before, and no non-tile route moved.

**Risk:** mount order. Express runs `use()` handlers in registration order, so the tile mount must sit after `jwtCheck` and before the API limiter. Integration case 1 fails if it's ever reordered. Tiles now skip `requireOrgWritable`, which is a no-op for GET (spec → Key decision 2).

---

## Slice 3 — warn-level backpressure, plus API docs

**Files**

- Edit: `apps/api/src/utils/log-level.util.ts`: `BACKPRESSURE_API_CODES` gains `API_RATE_LIMITED`, and the doc comment says why (a client over its budget is expected load-shedding, not a server fault).
- Edit: `apps/api/src/app.ts`: the comment at the backpressure branch names both codes.
- Edit: `apps/api/src/routes/portal-map.router.ts`:
  - correct the header (:9-12) to describe the three layers of protection;
  - add a `429` response with a `Retry-After` header to both `@openapi` blocks.
- Edit: `CLAUDE.md` (#698 paragraph, :457) and `.github/copilot-instructions.md` (:44): a sentence saying map tiles have their own per-user bucket (`AUTH_TILE_RATE_LIMIT_PER_MIN`) mounted ahead of the API limiter, and that every rate-limit 429 carries `Retry-After`.
- Edit test: `__tests__/utils/log-level.util.test.ts`.

**Steps**

1. **Tests (spec → API unit: log-level).** `API_RATE_LIMITED` → true; `SITE_CONFIG_RATE_LIMITED` and `DB_ADMISSION_TIMEOUT` → false. Run them; they fail.
2. **Implement** the set addition, then the doc and comment edits. Green.
3. Lint + type-check. Confirm the Swagger spec still builds (`portal-map.router` unit suite, or `GET /api/docs/spec` on the dev stack).

**Done when:** a 429 logs at warn, and no source or doc still points to `AUTH_API_RATE_LIMITING.condensed.md` (`git grep AUTH_API_RATE_LIMITING` matches only phase docs).

**Risk:** none. It's a log level and prose.

---

## Slice 4 — the web map pauses on a 429 and says why

**Files**

- Edit: `apps/web/src/modules/MapWidget/utils/tile-source.util.ts`:
  - add `rateLimited` to `TileStatus` and to `EMPTY_TILE_STATUS`;
  - in `readTileStatus`, 429 → `rateLimited`, and `failed` excludes 429.
- Edit: `apps/web/src/modules/MapWidget/utils/tile-protocol.util.ts`:
  - `MAX_RETRY_AFTER_MS = 60_000`, with the doc range updated;
  - pause on 503 **or** 429.
- Edit: `apps/web/src/modules/MapWidget/MapWidget.component.tsx`: the `map-widget-tile-rate-limited` notice (spec copy, `warning.main`).
- Edit: `apps/web/src/modules/MapWidget/stories/MapWidget.stories.tsx`: add `rateLimited` to the fixture, plus a "Tiles rate-limited" story.
- Edit tests: `__tests__/tile-source.util.test.ts`, `__tests__/tile-protocol.util.test.ts`, `__tests__/MapWidget.test.tsx`. Existing `TileStatus` fixtures gain `rateLimited: false`.

**Steps**

1. **Tests (spec → web unit, 5 cases).**
   - `readTileStatus(429)` → `{ rateLimited: true, failed: false, busy: false }`.
   - A 429 response pauses the queue: a second fetch waits until `Retry-After` elapses (fake timers; reset the module-global pause between tests as the existing 503 case does at :224-225).
   - `parseRetryAfter("60")` → 60 000, and `"120"` → 60 000; the old 30 s clamp case is updated.
   - The notice renders for `rateLimited`, and the failed notice doesn't.
   - Run them; they fail.
2. **Implement.** Green.
3. Lint + type-check from the root. The new required `TileStatus` field ripples to any typed fixture, so run the root `npm run type-check`, not only web's (`feedback_core_model_change_run_full_build`).

**Done when:** a tile 429 never yields `failed`, pauses the tab's tile queue for up to 60 s, and shows the rate-limited notice.

**Risk:** the module-global pause leaking between tests. Follow the existing reset pattern.

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 | `secondsUntilWindowEnd`; `Retry-After` and details on both limiters | API unit: rate-limit util and both middlewares |
| 2 | `{ bucket, limitPerMinute }`; tile mount before the API limiter; `AUTH_TILE_RATE_LIMIT_PER_MIN` | API unit + `rate-limit-buckets` integration |
| 3 | `API_RATE_LIMITED` → warn; router header and OpenAPI 429; `CLAUDE.md` and copilot mirror | API unit: log-level; Swagger builds |
| 4 | `rateLimited` status, 429 pause, 60 s clamp, notice, story | web unit: MapWidget; root type-check |

## Cross-slice notes

- **Doc sync** is split between slices 2 and 3:
  - `environment.ts`, `.env.example` and the limiter module doc in slice 2;
  - the router header, OpenAPI, `CLAUDE.md` and the copilot mirror in slice 3.
  - No Help, glossary or FAQ surface mentions rate limits (checked at slice 3 with `git grep -i "rate limit" packages/core/src/content apps/web/src/utils/getting-started.util.ts`).
- **Prettier** runs on staged files via the pre-commit hook. Don't use `--no-verify`.
- **Follow-up to file when the PR opens:** a global web-app experience for `API_RATE_LIMITED` (spec → Out of scope).
- **Smoke** (after slice 4, via `/smoke`): set `AUTH_TILE_RATE_LIMIT_PER_MIN` low in the local `.env`, pan a map until it's rate-limited, then confirm the notice, the absence of "failed", that tiles resume after the window, and that other pages still load.

## Next step

Implementation starts on `fix/705-tile-rate-limit` with slice 1, tests first, one commit per slice, once you've confirmed the discovery, spec and plan.
