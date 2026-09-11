# Security response headers (helmet) — Condensed design (#572)

**Issue:** [EnterpriseBT/portal-ai#572](https://github.com/EnterpriseBT/portal-ai/issues/572) · Feature · **small / condensed** (discovery + spec + plan + smoke in one doc). Child of epic [#578](https://github.com/EnterpriseBT/portal-ai/issues/578) — branches off `epic/security-readiness`.

**Why.** The API sets **no** security response headers — no `helmet`, so no HSTS, `X-Content-Type-Options`, frame protection, or CSP. Pen tests and buyer questionnaires all check these; today's SaaS fails them. Add `helmet` middleware in `apps/api/src/app.ts` with an API-appropriate policy. Single package (`apps/api`), one middleware, no contract change.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Middleware chain | `apps/api/src/app.ts:27-79` | `httpLogger` → `requestContextMiddleware` → webhooks (raw body) → `express.json` → `cors` → routers. **No helmet anywhere.** |
| CORS config | `apps/api/src/app.ts:40-58` | Allowlist origin `CORS_ORIGIN`, `exposedHeaders` for tile-status + ETag (#449). Must stay intact. |
| Swagger UI (HTML) | `apps/api/src/routes/swagger.router.ts:11-18` | `swagger-ui-express` at `/api/docs`; injects an inline setup `<script>` + inline `customCss` — needs `'unsafe-inline'` script/style to render. |
| SSE | `apps/api/src/app.ts:66` (`/api/sse`) | `text/event-stream`; header middleware is harmless to it (CSP governs HTML, not `EventSource`). |
| SPA / map tiles | separate origin (`apps/web`) | Consume the API **cross-origin** via CORS `fetch` (tiles too — the tile-status `exposedHeaders` prove XHR/fetch, not `<img>`). |
| helmet dependency | `apps/api/package.json` | **Absent** — must be added. |

## Decision — global helmet, CORP `cross-origin`, CSP relaxed only on `/api/docs`

- **A (chosen).** Mount `helmet()` globally, early in the chain (before `cors`), with two deliberate overrides:
  1. `crossOriginResourcePolicy: { policy: "cross-origin" }` — the API is consumed cross-origin by design; the **CORS allowlist is the access boundary**, not CORP. helmet's `same-origin` default risks a subtle break of the SPA's fetches and MapLibre tile loads.
  2. A **route-scoped CSP** for `/api/docs`: keep a strict global CSP (`default-src 'self'`, which is inert for the API's JSON since CSP only constrains HTML rendering), and mount a helmet CSP with `scriptSrc`/`styleSrc` including `'unsafe-inline'` **only** on the swagger router so the docs UI still renders.
  - Leave COEP off (helmet default) — enabling it would demand CORP/CORS on every subresource for no benefit here.
- **B (rejected).** Global helmet with defaults, no overrides — breaks Swagger UI (inline script blocked by default CSP) and risks the cross-origin CORP break. Fails deliverables 2–3.
- **C (rejected).** Hand-rolled `res.setHeader` middleware — reinvents helmet, drifts from the policy every reviewer recognizes, more to maintain.

**Chosen: A.** `helmet` is the industry-standard answer buyers expect to see; the two overrides are the minimum needed to keep the SPA, SSE, and docs working (acceptance criteria 2).

HSTS is emitted globally; browsers ignore it over local `http`, and the deployed API is behind TLS (ALB), so it takes effect only where it should. `X-Frame-Options: SAMEORIGIN` + `frame-ancestors` deny embedding — nothing frames the API.

## Plan — 1 slice

**Files:**
- `apps/api/package.json` (edit) — add `helmet` to `dependencies`.
- `apps/api/src/app.ts` (edit) — `app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }))` mounted right after `requestContextMiddleware`, before the webhook/json/cors mounts.
- `apps/api/src/routes/swagger.router.ts` (edit) — prepend a route-scoped `helmet.contentSecurityPolicy({ directives: { ...defaults, scriptSrc: ["'self'", "'unsafe-inline'"], styleSrc: ["'self'", "'unsafe-inline'"] } })` (using `helmet.contentSecurityPolicy.getDefaultDirectives()`) before `swaggerUi.serve`, so the relaxed CSP applies only to `/api/docs`.

**Tests** (`npm run test:unit` / integration — never raw jest): add `apps/api/src/__tests__/__integration__/routes/security-headers.integration.test.ts`:
- `GET /api/health` carries `strict-transport-security`, `x-content-type-options: nosniff`, `x-frame-options` (or CSP `frame-ancestors`), and a `content-security-policy`.
- `GET /api/docs/` returns 200 and its CSP permits `'unsafe-inline'` (docs render).
- A cross-origin `GET` still returns the CORS `access-control-allow-origin` and the tile `exposedHeaders` (CORS behavior intact); `cross-origin-resource-policy: cross-origin`.

## Smoke (manual, against your dev stack)

With the dev stack running (`npm run dev`):

1. **Headers present:** `curl -sI http://localhost:3001/api/health` → shows `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Content-Security-Policy`, and no `X-Powered-By`.
2. **Swagger UI still works:** open `http://localhost:3001/api/docs` in a browser — the UI renders fully (no blank page / CSP console errors); "Try it out" still executes.
3. **SPA unaffected:** load `http://localhost:3000`, sign in, exercise a data view + a map view — API calls and **map tiles** load (no CORS/CORP errors in the console).
4. **SSE unaffected:** trigger a job (e.g. a sync) and confirm the live status stream still updates (the `/api/sse` EventSource stays open).
5. **CORS intact:** in the browser network tab, an API response still carries `Access-Control-Allow-Origin` and the `X-Portal-Tile-*` exposed headers.

## Out of scope

- The **SPA's own** CSP (`apps/web`) and the marketing site — the API's headers don't govern another origin; a web-side CSP is its own ticket if wanted.
- Report-only CSP telemetry / `report-uri` collection — no reporting endpoint exists; deferred.
- Subresource Integrity, COEP/cross-origin isolation, Permissions-Policy tuning — deeper browser-isolation hardening beyond the questionnaire baseline this ticket targets.
