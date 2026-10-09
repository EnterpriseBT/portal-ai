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

1. **New `apps/web/src/utils/rate-limit.util.ts`** — module state mirroring the tile pause: `retryAfterMs(error)` (`ApiError.retryAfterSeconds` → ms, clamped [1s, 60s], 2s default — the tile precedent's clamp), `pauseApiReads(ms)` (extends, never shortens), `waitForApiReadPause(signal?)` (abortable; after the window, each waiter adds a random 0–3s release spread so a busy page doesn't spend the fresh bucket in one instant), and a subscribe/notify that fires once per **new** window — listeners are isolated, so a throwing notice can't replace the 429.
2. **`fetchWithAuth` owns the pause, for GETs only.** A GET waits out a running pause before sending, and a refused GET (`API_RATE_LIMITED`) starts one, so every read honours it whichever hook issued it (`useAuthQuery`, `listAll`'s page loop, search hooks, imperative GET reads). A write never waits and never starts a pause. On a 429 it also sets `ApiError.retryAfterSeconds` from `Retry-After`, falling back to `details.retryAfterSeconds` — a new optional field, not a widened `details` contract.
3. **`useAuthQuery` passes react-query's `signal` only while a pause is running**, so a held query whose page unmounts stops waiting and never sends. Reading `context.signal` opts a query into abort-on-unmount, so every other query stays unchanged.
4. **`client.ts` splits the rule**: queries retry `API_RATE_LIMITED` (up to 3 failures, `retryDelay` = the window plus the release spread) — a query sits in loading during the wait, so no per-query error renders; mutations keep `shouldRetry` unchanged (4xx → never), pinned by a test for 429.
5. **The notice**: `useRateLimitNotice()` (new `apps/web/src/utils/use-rate-limit-notice.util.ts`) raises `toast.warning("You're making requests faster than allowed. Data will load again in N seconds.", { autoHideMs: wait })` once per window. Mounted **once** in `ApplicationProvider`, inside `ToastProvider`, so every page gets it whatever its layout (the portal page uses `FullScreenLayout`). It stays up for the wait it names via a new `ToastOptions.autoHideMs` override, since the default warning duration (6s) is far shorter than a window. Warning, not error: nothing failed that the user must act on.

Only `API_RATE_LIMITED` triggers any of this. `MAP_TILE_RATE_LIMITED` stays the map's (#705); a non-limiter 429 (no code) keeps today's no-retry behavior. A toast rather than a banner, though the toast pattern reserves conditions for their own surface: the ticket chose it, a spent bucket is the direct result of the user's own activity, and the notice ends with the window.

## Plan — 2 slices

**Slice 1 — pause + retry.** Files: new `utils/rate-limit.util.ts`; edit `utils/api.util.ts` (`ApiError.retryAfterSeconds`, header read, GET pause in `fetchWithAuth`, `useAuthQuery` signal), `client.ts` (query retry + `retryDelay`). Tests: new `__tests__/rate-limit.util.test.ts` (clamp/default, extend-never-shorten, wait spans an extension); edit `__tests__/client.test.ts` (query retries `API_RATE_LIMITED` with the pause as delay; mutation never retries a 429; `MAP_TILE_RATE_LIMITED`/codeless 429 not retried); `useAuthQuery` test asserting a 429 header lands on the error and a second query waits instead of fetching.

**Slice 2 — the notice.** Files: new `utils/use-rate-limit-notice.util.ts`; edit `providers/Application.provider.tsx`, `utils/toast.context.tsx` + `providers/Toast.provider.tsx` (`autoHideMs`). Tests: new `__tests__/use-rate-limit-notice.test.tsx` — one toast for three 429s in one window, a second toast after the window ends, the wait in the copy, no provider → no throw.

`npm run test:unit -- --testPathPattern '<files>'` (web), `type-check`, `lint`, `format:check`.

## Smoke (manual, against your dev stack)

1. Restart the API with `AUTH_API_RATE_LIMIT_PER_MIN=20`; open a list-heavy page (Dashboard, an entity's records) and click around until the limit trips → **one** warning toast naming the wait, which stays up until the wait ends; lists show their loading state, not error alerts.
2. Keep navigating during the window → no further toasts; DevTools Network shows no new `/api/*` reads until the window ends.
3. After the wait → the page's data loads by itself, no reload.
4. During a window, submit a create dialog (e.g. New Station) → the dialog's FormAlert reads "Too many requests. Try again in N seconds."; Network shows the POST sent **once**; nothing resends it after the window.
5. Pan a map with the API bucket fine → tile behavior unchanged (#705); no rate-limit toast.
6. Trip the limit on a portal page (`/portals/:id`, full-screen layout) → the same single toast appears there.

## Out of scope

- Map tiles (#705) and any per-org / tier-derived limit (#574 deferral).
- Holding mutations behind the pause, or a countdown UI — the server's message names the wait.
- Server changes: the 429 contract is reused as-is.
