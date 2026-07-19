# Protected-route auth errors mapped to typed 401/403 — Condensed design (#216)

**Issue:** [EnterpriseBT/portal-ai#216](https://github.com/EnterpriseBT/portal-ai/issues/216) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Every protected route returns `500 {"code":"UNKNOWN"}` to anonymous/expired-token callers instead of the documented `401`. `express-oauth2-jwt-bearer`'s `auth()` rejects with `next(new UnauthorizedError(...))`, but the global error handler in `apps/api/src/app.ts` only maps `ApiError` and body-parser errors — the `UnauthorizedError` falls through to the generic 500. Clients (and the web app's status-code-keyed auth handling) can't tell "log in again" from "server broke", and monitoring counts these as server errors. Single-package fix (`apps/api`): one error-handler branch + two error codes, restoring the documented contract.

## Current shape

| Piece | Location | Note |
|---|---|---|
| JWT middleware | `apps/api/src/middleware/auth.middleware.ts:12` | `auth({...})` from `express-oauth2-jwt-bearer`; rejects via `next(err)` |
| Library error base | `express-oauth2-jwt-bearer` `UnauthorizedError` (`dist/index.js:14`) | `status`/`statusCode` = 401; carries `WWW-Authenticate` header |
| Library subclasses | same | `InvalidRequestError` (400), `InvalidTokenError` (401), `InsufficientScopeError` (403) — all `extends UnauthorizedError` |
| Middleware reject path | `dist/index.js:820` | `next(verifier.applyAuthChallenges(e))` — always `next(err)`, never writes the response itself |
| Global error handler | `apps/api/src/app.ts:62–123` | maps `ApiError` (→ `HttpService.error`) and body-parser `type` errors; everything else → generic `500 UNKNOWN` |
| Typed error emit | `HttpService.error` (`apps/api/src/services/http.service.ts:56`) | `res.status(error.status ?? 500).json({ success:false, message, code, ... })` |
| Error codes | `apps/api/src/constants/api-codes.constants.ts:8` (`// Auth`) | has `AUTH_UPSTREAM_ERROR`; no generic unauthorized/forbidden code yet |
| Why untested | route integration tests mock `jwtCheck` as pass-through | the real `next(UnauthorizedError)` path never exercised the handler |

## Decision — map `UnauthorizedError` by its own status

Add one branch to the `app.ts` error handler, placed **after** the `ApiError` branch and **before** the body-parser branches: `if (err instanceof UnauthorizedError)`. Re-emit as a typed `ApiError` preserving the library's `err.status` (401/403/400 across the subclasses) and selecting the `ApiCode` from that status — `401 → AUTH_UNAUTHORIZED`, `403 → AUTH_FORBIDDEN`, any other (e.g. 400 `InvalidRequestError`) → `AUTH_UNAUTHORIZED` at that status. Log at `warn` (auth rejection is expected client behavior, not a server fault — this is the noise-suppression the ticket calls out), then `HttpService.error(res, ...)`.

- **Why `instanceof UnauthorizedError`, not a bare `status`-sniff.** The class is the precise signal — it's the documented rejection type of the JWT middleware and covers all three subclasses in one check. A `status`-only sniff would also swallow unrelated errors that happen to carry a `status` field.
- **Why preserve `err.status` rather than hardcode 401.** `InsufficientScopeError` is a real 403; collapsing it to 401 would misreport authorization failures as authentication failures. The message comes from the library error (`err.message`), never the token.
- Two new codes in the `// Auth` section: `AUTH_UNAUTHORIZED` (401, missing/invalid/expired bearer token) and `AUTH_FORBIDDEN` (403, valid token, insufficient scope).

## Plan — one slice

**Files**
- Edit `apps/api/src/constants/api-codes.constants.ts` — add `AUTH_UNAUTHORIZED` and `AUTH_FORBIDDEN` to the `// Auth` block with JSDoc noting their statuses.
- Edit `apps/api/src/app.ts` — `import { UnauthorizedError } from "express-oauth2-jwt-bearer"`; add the mapping branch (status→code lookup) after the `ApiError` branch. `WWW-Authenticate` from the library error is dropped — the typed body is the contract the client keys off; add a one-line comment saying so.

**Tests**
- Edit `apps/api/src/__tests__/__integration__/app.integration.test.ts` — this file already imports the **real** `app` (real error handler) with a mocked `jwtCheck`. Change the mock so `jwtCheck` calls `next(new UnauthorizedError(...))` when the request carries no `Authorization` header, `next(new InsufficientScopeError())` for a sentinel header value, and `next()` otherwise (existing health/body-parser tests hit unprotected routes, so pass-through-on-header keeps them green). Add a `describe("Auth middleware error mapping")`:
  - `GET /api/organization/current` with no `Authorization` → `401`, body `code === AUTH_UNAUTHORIZED`, `success === false`, and **not** `UNKNOWN`.
  - insufficient-scope sentinel → `403`, `code === AUTH_FORBIDDEN`.
  - This exercises the real handler against the library's real error classes (per the ticket's testing note) with no DB — `jwtCheck` throws before any route/DB work.
- `npm run test:unit` (api), `npm run type-check`, `npm run lint`.

## Smoke (manual, against your dev stack)
1. Start the API (`npm run dev`). With no token: `curl -i http://localhost:3001/api/organization/current` → **401** (not 500), body `{"success":false,"code":"AUTH_UNAUTHORIZED",...}`.
2. Repeat against `curl -i http://localhost:3001/api/stations` and `curl -i http://localhost:3001/api/billing/tiers` → all **401 `AUTH_UNAUTHORIZED`** (uniform across the protected surface).
3. Malformed/expired token: `curl -i -H "Authorization: Bearer not-a-jwt" http://localhost:3001/api/organization/current` → **401 `AUTH_UNAUTHORIZED`** (invalid-token path, still not 500).
4. A valid authenticated request (via the web app or a real token) still returns its normal `2x` payload — the branch only fires on auth rejection.
5. Server log for the rejected calls shows a `warn` ("JWT auth rejected"), not an `error`/"Unhandled error" — the monitoring-noise fix.

## Out of scope
- Refactoring the other pre-`protectedRouter` auth paths (webhook-handle token, SSE query-param auth) — they already emit typed errors.
- Surfacing `WWW-Authenticate` challenge headers to clients — the typed JSON body is the contract; no consumer reads the header.
- Frontend auth-error handling changes — the web app already keys off the 401 status; this restores the status it expects.
