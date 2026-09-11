# Authenticated API rate limiting — Condensed design (#574)

**Issue:** [EnterpriseBT/portal-ai#574](https://github.com/EnterpriseBT/portal-ai/issues/574) · Feature · **small / condensed** (discovery + spec + plan + smoke in one doc). Child of epic [#578](https://github.com/EnterpriseBT/portal-ai/issues/578) — branches off `epic/security-readiness`.

**Why.** Authenticated routes have no per-principal rate limit — only the per-IP public limiter (#311) and the per-tool cost gate (#169) exist. A per-principal limit on the authenticated API is basic abuse protection and shields the shared SaaS from a noisy tenant. Single package (`apps/api`); reuses the existing Redis fixed-window primitive.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Fixed-window primitive | `apps/api/src/utils/rate-limit.util.ts` | `incrementRateWindow(key)` → count in the current wall-clock minute; **throws on Redis error/timeout** (caller treats as "allow") |
| Limiter pattern to mirror | `apps/api/src/middleware/public-rate-limit.middleware.ts` | Per-IP middleware: increment, 429 if over, **fail-open** in `catch`. Exact template. |
| Auth principal | `req.auth?.payload.sub` (Auth0 subject) | Available right after `jwtCheck` with **no DB lookup** (routes read it directly, e.g. `billing.router.ts:34`) |
| Org resolution | `getApplicationMetadata` (`metadata.middleware.ts`) | Resolves `organizationId` via **two DB lookups** (user + `getCurrentOrganization`); applied **per-route**, not globally |
| Mount point | `protectedRouter` (`routes/protected.router.ts:31`) | `protectedRouter.use(jwtCheck)` then sub-routers. SSE (`/api/sse`), health, and `/api/public` are mounted **outside** this router → already exempt. |
| Conventions | `PUBLIC_SITE_RATE_LIMIT_PER_MIN` (env, default 60); `SITE_CONFIG_RATE_LIMITED` (429 code) | Follow both. |

## Decision — per-user (Auth0 `sub`), global on `protectedRouter`, fail-open

- **Principal = the Auth0 `sub` (per user).** Chosen over per-org because `sub` is available with **zero DB cost** at the mount point, so the limiter stays a pure Redis+fail-open middleware. Per-org would require the two-query `getApplicationMetadata` lookup **on every authenticated request** (it's currently per-route), coupling a hot middleware to the DB and muddying the fail-open story — a real cost for the narrower "aggregate-tenant" abuse case. Per-user already caps each principal, which is the primary noisy-tenant vector. Per-org is a **documented deferral** (revisit if org-id lands in the JWT, making it free, or if aggregate-tenant abuse proves real).
- **Fixed-window minute**, reusing `incrementRateWindow` — matches the public limiter and the cost gate's rate half; no new primitive.
- **Fail-open on Redis error/timeout** — mirror `publicRateLimit`'s `try/catch`, documented in-file, consistent with every existing limiter.
- **Config shaped for later tiering.** The limit is a single env default now (`AUTH_API_RATE_LIMIT_PER_MIN`), but the middleware takes the limit as an argument (like `publicRateLimit(limit)`) so a future tier-derived limit slots in at the mount site without touching the limiter. No tier logic built now (no speculative infra).

## Plan — 1 slice

**Files:**
- `apps/api/src/middleware/authenticated-rate-limit.middleware.ts` (new) — `authenticatedRateLimit(limitPerMinute)`: key `authed:${req.auth?.payload.sub}`, `incrementRateWindow`, 429 `API_RATE_LIMITED` when over, fail-open in `catch`. If `sub` is somehow absent, allow (jwtCheck already guarantees it upstream).
- `apps/api/src/constants/api-codes.constants.ts` (edit) — add `API_RATE_LIMITED` + its message-map entry.
- `apps/api/src/environment.ts` (edit) — `AUTH_API_RATE_LIMIT_PER_MIN` (default `300` — generous; normal app usage bursts well under this).
- `apps/api/src/routes/protected.router.ts` (edit) — `protectedRouter.use(authenticatedRateLimit(environment.AUTH_API_RATE_LIMIT_PER_MIN))` immediately after `protectedRouter.use(jwtCheck)`.

**Tests** (`npm run test:unit`): `apps/api/src/__tests__/middleware/authenticated-rate-limit.middleware.test.ts`, mirroring `public-rate-limit.middleware.test.ts` — under limit → `next()` no error; over limit → `next(ApiError 429 API_RATE_LIMITED)`; two different `sub`s counted independently (isolation); Redis throw → `next()` with no error (fail-open). Mock `incrementRateWindow`.

## Smoke (manual, against your dev stack)

With `npm run dev` and a low limit for the test (`AUTH_API_RATE_LIMIT_PER_MIN=5` in `apps/api/.env`):

1. **Limit fires per principal:** with a valid token, `for i in $(seq 1 7); do curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/profile; done` → first 5 are `200`, then `429` with body code `API_RATE_LIMITED`.
2. **Other principals unaffected:** a second user's token still gets `200` while the first is limited (independent windows).
3. **Exempt paths:** `/api/health` and an `/api/sse/...` stream are never limited (mounted outside `protectedRouter`).
4. **Fail-open on Redis down:** stop the Redis container, repeat step 1 → requests still `200` (degrade to allow), and a warn line is logged. Restart Redis.
5. **Window resets:** after ~60s the count resets and requests succeed again.

## Out of scope

- **Per-org / aggregate-tenant limiting** — deferred (needs a per-request DB lookup today); the middleware's shape leaves room for it.
- **Tier-derived limits** — the mount site can pass a tier-based number later; no tier logic built now (#172/#214 own entitlements).
- **Sliding-window / token-bucket** — fixed-window matches the existing primitive and is sufficient for abuse protection.
- **Per-route custom limits** (e.g. a stricter cap on an expensive endpoint) — a single global limit now; per-route overrides can layer on later.
