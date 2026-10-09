# API rate-limit notice and backoff — Condensed design (#747)

**Issue:** [EnterpriseBT/portal-ai#747](https://github.com/EnterpriseBT/portal-ai/issues/747) · Feature · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** #705 gave map tiles their own bucket and taught the map to pause on a `429`; nothing else in the web app knows what a `429 API_RATE_LIMITED` is. A user over the 300/min API bucket sees every query on screen fail in its own error surface, with no backoff and no single explanation, even though every refusal already carries `Retry-After` and `details.retryAfterSeconds`. Change: reads wait out the window and retry by themselves, the user gets **one** notice naming the wait, and mutations keep their current never-resend behavior with the server's own "Try again in N seconds" copy. `apps/web` only — the server contract is unchanged.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Retry rule (queries + mutations) | `apps/web/src/client.ts:18` (`shouldRetry`), used at `:41`, `:44` | every 4xx → no retry, so a 429 read fails at once |
| Error construction | `apps/web/src/utils/api.util.ts:97` (`fetchWithAuth`) | builds `ApiError(message, code, status, details)`; headers are discarded |
| `ApiError` | `apps/web/src/utils/api.util.ts:37` | carries `details` — so `retryAfterSeconds` already arrives on it |
| Declarative reads | `apps/web/src/utils/api.util.ts:130` (`useAuthQuery`), `queryFn` at `:143` | the one choke point every SDK read goes through |
| Server refusal shape | `apps/api/src/utils/rate-limit-refusal.util.ts` (`rateLimitedError`); header set at `apps/api/src/services/http.service.ts:70–72` | message `"Too many requests. Try again in N seconds."`, `details.retryAfterSeconds`, `Retry-After` |
| Tile precedent | `apps/web/src/modules/MapWidget/utils/tile-protocol.util.ts:75` (`parseRetryAfter`), `:86` (`pauseTileFetches`) | tab-wide pause, clamped [1s, 60s]; tiles use `MAP_TILE_RATE_LIMITED`, not touched here |
| Toast dedupe | `apps/web/src/providers/Toast.provider.tsx:65` | drops a raise matching a *visible* `(message, severity)` — the wait in the message varies, so this alone won't collapse repeats |
| Mutation error copy | `apps/web/src/utils/permission-denied.util.ts` (`serverErrorMessage`) | passes a non-500 message through, so FormAlert/toasts already show "Try again in N seconds." |

## Decision — one tab-wide read pause, one notice, mutations untouched

Options: (a) per-query `retryDelay` only — each query retries on its own clock, but the screen still sees N independent failures and new queries keep spending refused requests into the same window; (b) a tab-wide pause like tiles' — the first 429 sets `rateLimitedUntil`, every read waits it out before fetching, and one notice is raised per window; (c) also hold mutations behind the pause — rejected: it silently delays a user's click by up to 60s, and the ticket's contract is that mutations are never resent and report the wait themselves.

**Decision: (b).**

1. **New `apps/web/src/utils/rate-limit.util.ts`** — module state mirroring the tile pause: `retryAfterMs(error)` (`ApiError.retryAfterSeconds` → ms, clamped [1s, 60s], 2s default — the clamp is the tile precedent's), `pauseApiReads(ms)` (extends, never shortens), `waitForApiReadPause()` (no abort signal: reading react-query's `signal` opts every query into abort-on-unmount, and an orphaned wait ends within 60s), and a tiny subscribe/notify so the UI hears "a new window began, N seconds".
2. **`fetchWithAuth` reads `Retry-After`** (the deliverable): on a 429 it sets `ApiError.retryAfterSeconds` from the header, falling back to `details.retryAfterSeconds`. A new optional field, not a widened `details` contract.
3. **`useAuthQuery`'s `queryFn`** awaits `waitForApiReadPause()` before fetching, and on `API_RATE_LIMITED` calls `pauseApiReads(retryAfterMs(err))` before rethrowing. Reads issued during the window never hit the server.
4. **`client.ts` splits the rule**: queries retry `API_RATE_LIMITED` (up to 3 failures, `retryDelay` = time left in the pause) — a query sits in loading during the wait, so no per-query error renders; mutations keep `shouldRetry` unchanged (4xx → never), now pinned by a test for 429.
5. **The notice**: `useRateLimitNotice()` (new `apps/web/src/utils/use-rate-limit-notice.util.ts`) subscribes and raises `toast.warning("You're making requests faster than allowed. This page will refresh by itself in N seconds.")` — **once per window**: a notify while the previous window is still running is ignored. Called from `AuthorizedLayout` (the only place SDK reads run; already a container), so it sits inside `ToastProvider`. Warning, not error: nothing failed that the user must act on, and errors persist until dismissed.

Only `API_RATE_LIMITED` triggers any of this. `MAP_TILE_RATE_LIMITED` stays the map's (#705); a non-limiter 429 (no code) keeps today's no-retry behavior. Hand-rolled search hooks that call `fetchWithAuth` outside `useAuthQuery` get the retry rule (it keys on the error) but not the pre-flight wait — accepted; they're keystroke-driven and the user sees the notice anyway.

## Plan — 2 slices

**Slice 1 — pause + retry.** Files: new `utils/rate-limit.util.ts`; edit `utils/api.util.ts` (`ApiError.retryAfterSeconds`, header read, `useAuthQuery` wait/pause), `client.ts` (query retry + `retryDelay`). Tests: new `__tests__/rate-limit.util.test.ts` (clamp/default, extend-never-shorten, wait spans an extension); edit `__tests__/client.test.ts` (query retries `API_RATE_LIMITED` with the pause as delay; mutation never retries a 429; `MAP_TILE_RATE_LIMITED`/codeless 429 not retried); `useAuthQuery` test asserting a 429 header lands on the error and a second query waits instead of fetching.

**Slice 2 — the notice.** Files: new `utils/use-rate-limit-notice.util.ts`; edit `layouts/Authorized.layout.tsx`. Tests: new `__tests__/use-rate-limit-notice.test.tsx` — one toast for three 429s in one window, a second toast after the window ends, the wait in the copy, no provider → no throw.

`npm run test:unit -- --testPathPattern '<files>'` (web), `type-check`, `lint`, `format:check`.

## Smoke (manual, against your dev stack)

1. Restart the API with `AUTH_API_RATE_LIMIT_PER_MIN=20`; open a list-heavy page (Dashboard, an entity's records) and click around until the limit trips → **one** warning toast naming the wait; lists show their loading state, not error alerts.
2. Keep navigating during the window → no further toasts; DevTools Network shows no new `/api/*` reads until the window ends.
3. After the wait → the page's data loads by itself, no reload.
4. During a window, submit a create dialog (e.g. New Station) → the dialog's FormAlert reads "Too many requests. Try again in N seconds."; Network shows the POST sent **once**; nothing resends it after the window.
5. Pan a map with the API bucket fine → tile behavior unchanged (#705); no rate-limit toast.

## Out of scope

- Map tiles (#705) and any per-org / tier-derived limit (#574 deferral).
- Holding mutations behind the pause, or a countdown UI — the server's message names the wait.
- Server changes: the 429 contract is reused as-is.
