# Express 5 migration — Spec

**Issue:** [EnterpriseBT/portal-ai#897](https://github.com/EnterpriseBT/portal-ai/issues/897) · **Discovery:** `docs/EXPRESS_5.discovery.md`

This spec pins the contract for moving `apps/api` from Express 4.22 to Express 5.3: the dependency ranges, two new or changed middleware behaviors, the route-inventory recorder that replaces the Express 4 internals reader, the error handler's headers-sent guard, and the tests that hold them. Clients see no API change.

## Key decisions (flag for review)

1. **Query parser: Express 5's default `simple`.** `qs` leaves the per-request path, and `redactQuery` becomes bracket-aware so a flat `auth[token]` key stays redacted.
2. **Bodiless writes still see `{}`.** A new `emptyBodyAsObject` middleware restores Express 4's contract for POST/PUT/PATCH, so no route's validation changes.
3. **The route inventory records registrations instead of reading internals.** It works on Express 4 and 5, and it's proven on 4 first.
4. **The error handler never writes after headers are sent.** It delegates to Express's default handler (`next(err)`), which closes the socket.
5. **No `qs` override.** The discovery's fallback isn't taken. A dev-only `superagent` → `qs@6.14.x` copy, if one remains, is recorded on the PR and not blocking.
6. **Discovery's open questions, as resolved here:**
   - Q1: type errors from `@types/express@5` are fixed mechanically (`res…; return;`), never with casts or disables.
   - Q2: `express-oauth2-jwt-bearer` stays unless its types clash, in which case it moves to `^1.11.0`.
   - Q3: the dev-only `qs` copy doesn't block.

## Scope

### In scope
- `apps/api/package.json`: `express ^5.3.0`, `@types/express ^5.0.6`, plus the lockfile.
- `emptyBodyAsObject` middleware, mounted in `app.ts`.
- `redactQuery` made bracket-aware.
- `express-route-inventory.util.ts` rebuilt on a registration recorder, with both guard tests importing it before `app`.
- The global error handler's headers-sent guard.
- `organization.router.ts:186` reads `req.body ?? {}`.
- Type fixes `@types/express@5` requires.
- `URIError` → 400 re-verified under router 2.

### Out of scope
Everything listed under the discovery's "What this doesn't decide":
- the supertest/superagent bump;
- removing redundant try/catch blocks;
- a global 404;
- the DELETE `/organization/:id` body.

Also out of scope: adding schema validation to the organization PATCH body. It's unvalidated today; that's a separate finding.

## Surface

### Dependencies — `apps/api/package.json`
- `"express": "^5.3.0"`. Express 5 depends on `qs ^6.16.0`, `body-parser ^2`, `router ^2` and `path-to-regexp ^8`.
- `"@types/express": "^5.0.6"` (devDependency).
- Unchanged: `cors ^2.8.5`, `helmet ^8.3.0`, `swagger-ui-express ^5.0.1`, `express-oauth2-jwt-bearer ^1.6.0`, `pino-http ^11`, `supertest ^7.2.2`.
- After `npm install`, `npm ls qs --omit=dev` lists no version below 6.16.

### Query parser — `apps/api/src/app.ts`
- No `app.set("query parser", …)` call: Express 5's default `simple` (Node `querystring`) applies.
- A comment at the app setup records the choice (#897): flat keys, a repeated key yields an array, and no `qs` per request.
- `scripts/mock-toolpack-server.ts` is unchanged; it reads no query.

### `redactQuery` — `apps/api/src/utils/redact-url.util.ts`

```ts
export function redactQuery<T>(query: T): T
```

- A key is redacted when `isSensitiveKey(key)` holds. `isSensitiveKey` (the existing function, :43) splits on `[` and `]`, so `auth[token]`, `token[]` and `token[0]` all count.
- The previous check was `SENSITIVE_NAMES.has(normalizeName(key))`.
- Nested objects and arrays are still walked, so the function stays correct for any parser.
- The doc comment drops "qs nests `auth[token]`", and says it holds for flat bracket keys and nested objects alike.

### `emptyBodyAsObject` — new `apps/api/src/middleware/empty-body.middleware.ts`

```ts
export const emptyBodyAsObject = (req: Request, _res: Response, next: NextFunction): void
```

- For `POST`/`PUT`/`PATCH` with `req.body === undefined`, it sets `req.body = {}`. Every other method, and any defined body, passes through untouched.
- It reuses `jsonBodyOnly`'s `BODY_METHODS`, now exported from `json-body-only.middleware.ts`.
- It's mounted in `app.ts` directly **after `rejectNul`**. By then `jsonBodyOnly` has refused any non-JSON body with content (415), so only a genuinely bodiless write is normalized, and `rejectNul` still sees the raw `undefined`.
- The webhook router (mounted earlier with its own parsers) is unaffected.
- The doc comment states the contract: "Express 4 gave routes `{}` for a bodiless write; Express 5 gives `undefined`. Routes `safeParse(req.body)`, so this keeps an empty-schema write a success (#897)."

### `organization.router.ts:186`
`const { defaultStationId } = (req.body ?? {}) as { defaultStationId?: string | null };`. That keeps the handler safe whether or not the middleware runs (e.g. in a router-level test).

### Route inventory — `apps/api/src/__tests__/config/express-route-inventory.util.ts`

```ts
/** Installs the recorder. Must run before the app module is imported. */
export function installRouteRecorder(): void
/** Every route the app registers, as "<METHOD> <path-template>". */
export const registeredRoutes: (app: unknown) => Set<string>     // unchanged signature
export const documentedOperations: (spec: unknown) => Set<string> // unchanged
```

- **Recording.** `installRouteRecorder()` wraps the Router's `route(path)` and `use(path?, ...handlers)`. The Router is Express 5's `express.Router.prototype`, or Express 4's `express.Router` object, whichever carries `route`. For each router instance, the wrappers record:
  - `routes`: `(path, Route)`. The `Route`'s `methods` map is read at enumeration time, so methods added after `route()` are seen.
  - `mounts`: `(path ?? "/", childRouter)` for each handler that is itself a recorded router.
  - Registration is otherwise passed through unchanged. Calling `installRouteRecorder()` twice is a no-op.
- **Enumeration.** `registeredRoutes(app)` starts at the app's root router (`app.router` on 5, `app._router` on 4; both are public enough to read once), then walks `mounts` depth-first, joining paths.
  - `:name` becomes `{name}`, trailing `/` is trimmed, and only `get/post/put/patch/delete` are kept, all as today.
  - An unrecorded app (the recorder installed too late) returns an empty set, which the callers' floors catch.
- **Module self-install.** The util calls `installRouteRecorder()` at module load. Both guard tests import it **before** `../../app.js`:
  - `config/route-authorization.test.ts`
  - `config/swagger.config.test.ts`
  
  ESM evaluates imports in order, so registration is recorded.
- **The header comment** replaces "Express 4 coupling" with the recorder's single requirement: imported first. The floors (`> 180` / `> 80` GETs, `> 100`) stay.
- **No internals.** No reads of `_router.stack`, `layer.regexp`, `fast_slash` or `keys`.

### Error handler — `apps/api/src/app.ts:118`
The first statement after `const log = …` is:

```ts
if (res.headersSent) {
  log.warn({ err, route: redactUrl(req.originalUrl) }, "Error after response headers were sent");
  return next(err);
}
```

- The handler's signature gains `next` (it's currently `_next`).
- The existing `REQUEST_ABANDONED` branch keeps its `res.destroyed` check. This early return makes its own `headersSent` check redundant, but harmless.

### `URIError` → 400 — `app.ts:181`
The behavior is unchanged: a malformed `%` in a route param answers `400 REQUEST_URL_INVALID_ENCODING`. If router 2 surfaces the decode failure differently (no `status`, or a different error class), the check widens to match it. The test pins the response, not the error's shape.

### Types
- `src/types/express.d.ts` keeps its `declare global namespace Express` merge (`auth`, `rawBody`, `application`). It's adjusted only if `@types/express@5`'s `Request` shape requires it.
- Handler returns that the v5 types reject are rewritten as statement-then-`return;`. No `as any`, no `@ts-expect-error`, no `eslint-disable`.

No `ApiCode` additions, no schema or migration, and no OpenAPI change: no route's request or response shape changes.

## Migration
## Seed
None: no database change.

## TDD test plan

All commands run from `apps/api`: `npm run test:unit -- --testPathPattern <pattern>` locally, and `npm run test:integration` in CI.

### Route inventory (`__tests__/config/express-route-inventory.util.test.ts`, new)
- A two-level router (app → `/api` router → `/items/:id` GET+DELETE, and `/nested` router → `/x` POST) yields exactly `GET /api/items/{id}`, `DELETE /api/items/{id}`, `POST /api/nested/x`.
- Methods added after `route()` (`router.route("/r").get(h).post(h)`) are both recorded.
- `mergeParams` routers are recorded the same way.
- An app built before the recorder was installed yields an empty set.
- Installing twice records each route once.
- **Express 4 parity (slice 1 only):** on the current Express 4 app, the recorder's set equals the old internals reader's set. That's a one-off assertion, removed when the internals reader is deleted in slice 2.

≈ 6 cases.

### Guards (existing)
`config/route-authorization.test.ts` and `config/swagger.config.test.ts` pass unchanged on Express 5, with their floors.

### `emptyBodyAsObject` (`__tests__/middleware/empty-body.middleware.test.ts`, new)
- POST, PUT and PATCH with `undefined` body → `{}`.
- POST with a parsed body → untouched.
- GET and DELETE with `undefined` → stays `undefined`.
- **Via supertest on a bare `express()`** with the real stack (`express.json` → `jsonBodyOnly` → `rejectNul` → `emptyBodyAsObject`):
  - a bodiless `Content-Length: 0` POST reaches the handler with `{}`;
  - a form-encoded body still gets the 415.

≈ 6 cases.

### `redactQuery` (`__tests__/utils/redact-url.util.test.ts`, extend)
- Flat keys `{"auth[token]": "x"}`, `{"token[]": "x"}`, `{"token[0]": "x"}` → redacted.
- Nested `{auth: {token: "x"}}` → still redacted.
- `{page: "2"}` → untouched.

≈ 4 cases.

### Error handler (`__tests__/__integration__/app.integration.test.ts`, extend; it already pins the `URIError` → 400 case)
- A route that writes headers (SSE-style `writeHead` + `write`) then rejects:
  - the response ends without a second write;
  - no `ERR_HTTP_HEADERS_SENT` is raised;
  - the warn line is logged.
- An async handler rejecting with `ApiError(409, …)` and no try/catch answers 409 through the handler. This is Express 5's promise forwarding.
- The existing malformed-`%` case keeps passing on router 2.

≈ 4 cases.

### Organization PATCH (`__tests__/__integration__/routes/organization.router.integration.test.ts`, extend)
A bodiless PATCH (`Content-Length: 0`) doesn't 500; it behaves as `{}`.

≈ 1 case.

### Regression net
The full unit suite and `npm run test:integration` (sharded in CI) run on Express 5; all 83 supertest files go through the real app. Also `npm run type-check`, `npm run lint`, and `npm run build`, which runs the Docker-equivalent `tsc`.

**Totals ≈ 21 new cases**, plus the existing suites as the regression net.

## Acceptance criteria
- [ ] `npm audit --omit=dev` reports no `qs` finding. `npm ls qs --omit=dev` shows only ≥ 6.16.
- [ ] `apps/api` runs `express@5.3.x`. Build, type-check, lint, and the unit and integration suites are green.
- [ ] The authorization and OpenAPI guards enumerate the same route set as before the migration (the count is recorded on the PR) without reading Express internals.
- [ ] A bodiless POST/PUT/PATCH behaves exactly as before (handlers see `{}`), and a non-JSON body is still a 415.
- [ ] `?auth[token]=…`, `?token[]=…` and `?access_token=…` are redacted in request logs.
- [ ] An error after response headers are sent never throws inside the error handler.
- [ ] A malformed percent-encoded param is still a 400 `REQUEST_URL_INVALID_ENCODING`.
- [ ] After merge, the API image passes the Trivy gate, and deploy-dev's verify-login is green.

## Risks & rollback
- **A behavior change hidden behind green tests.** The highest risk is a route relying on Express 4 semantics no test covers. Two things mitigate it:
  - the integration suite runs every route through the real app;
  - app-dev deploys on merge, and verify-login plus a short smoke of core flows (import, records, portal) follow.
- **Rollback.** Revert the squash commit. Nothing persists: no schema or data change.
- **The route recorder silently recording nothing.** The guards would then pass vacuously. The kept floors make that a loud failure.
- **Fail mode.** The error handler's headers-sent branch fails *closed* for the client: the socket is closed rather than sending a malformed response. An async rejection now becomes a 500 instead of a hung request. Both are safer than today.
- **Log redaction regression under the new parser.** Covered by the `redactQuery` cases. The logger reads `req.query` (`utils/logger.util.ts:147`), so the flat form is exactly what it receives.

## Files touched
- `apps/api/package.json`, `package-lock.json`
- `apps/api/src/app.ts`: parser comment, mount `emptyBodyAsObject`, error-handler guard
- `apps/api/src/middleware/empty-body.middleware.ts` (new); `apps/api/src/middleware/json-body-only.middleware.ts`: export `BODY_METHODS`
- `apps/api/src/utils/redact-url.util.ts`
- `apps/api/src/routes/organization.router.ts`
- `apps/api/src/types/express.d.ts` (only if the v5 types require it)
- `apps/api/src/__tests__/config/express-route-inventory.util.ts`, `route-authorization.test.ts`, `swagger.config.test.ts`
- New tests:
  - `__tests__/config/express-route-inventory.util.test.ts`
  - `__tests__/middleware/empty-body.middleware.test.ts`
- Extended tests: `__tests__/utils/redact-url.util.test.ts`, `__tests__/__integration__/app.integration.test.ts`, `__tests__/__integration__/routes/organization.router.integration.test.ts`
- Handler files `@types/express@5` flags, if any (mechanical `return` rewrites)

## Next step
`/plan 897` sequences five TDD slices on `chore/897-express-5`:
1. The registration recorder with Express 4 parity (still on Express 4).
2. The Express 5 and types bump, the internals reader deleted, and the type fixes.
3. `emptyBodyAsObject` and the organization PATCH.
4. Query parser and redaction.
5. The error-handler guard and the `URIError` re-check.

Each lands green on its own commit.
