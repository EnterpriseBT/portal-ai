# Express 5 migration — Discovery

**Issue:** [EnterpriseBT/portal-ai#897](https://github.com/EnterpriseBT/portal-ai/issues/897)

**Why this exists.** The API runs `express@4.22.1`, which pins `qs ~6.14.0`. `qs@6.14.3` carries four moderate advisories (GHSA-q8mj-m7cp-5q26, GHSA-6pq8-jhm2-2vcw, GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g), the worst of them remote DoS. Express 4's `extended` query parser runs every request's query string through it. No Express 4 release takes a patched `qs`, and #896 declined a root `overrides` entry that Express 4 doesn't declare. Express 5.3.0 depends on `qs ^6.16.0` and `router@2` / `path-to-regexp@8`, and all of the API's middleware either declares Express 5 support or declares no `express` peer at all.

The advisories are moderate, so the Trivy gate (fixable CRITICAL/HIGH) has never blocked on them, but they sit in the request path of every API call. This is the framework upgrade that removes them, and on the way it settles four behaviors Express 5 changes underneath us: body absence, query parsing, async errors, and the route inventory our authorization guard depends on.

## The current shape

### App assembly (`apps/api`, the only Express user in the repo)

| Piece | Location | Note |
|---|---|---|
| App + `trust proxy` | `apps/api/src/app.ts:34`, `:42` | — |
| Middleware order | `app.ts:49-115` | pino-http → request context → helmet → webhook router (own `express.raw`/`express.text`, `routes/webhook.router.ts:105,212`) → `express.json` :69 → `cors` :71 → `jsonBodyOnly` :91 → `rejectNul` :94 → swagger `/api/docs` :96 → health, OAuth, SSE, public → `protectedRouter` at `/api` :115 |
| Protected stack | `routes/protected.router.ts:40-71` | `jwtCheck` → tile bucket → `authenticatedRateLimit` → `requireOrgWritable` |
| Rate limiting | `middleware/authenticated-rate-limit.middleware.ts`, `public-rate-limit.middleware.ts` | Custom, Redis-backed; no `express-rate-limit` |
| Error handler | `app.ts:118-246` | Checks `res.headersSent` only on the `REQUEST_ABANDONED` branch (:133); `URIError` → 400 at :181 |
| Other Express app | `apps/api/src/scripts/mock-toolpack-server.ts:649-664` | Dev script; literal routes, already reads `req.body ?? {}` |

Third-party middleware: `cors` 2.8.6 and `helmet` 8.3.0 (no `express` peer), `express-oauth2-jwt-bearer` 1.7.4 (no peer; its types import `Handler`), `swagger-ui-express` 5.0.1 (peer `>=4.0.0||>=5.0.0-beta`), `pino-http` ^11, `supertest` ^7.2.2.

### What Express 5 changes, measured against this code

| Express 5 change | Exposure here |
|---|---|
| `path-to-regexp@8` route syntax | **None.** Every one of the 254 route registrations is a plain segment or `:param` (no `* ? ( ) + [ ]`, no regex literals). The 4 `mergeParams` routers behave the same |
| Query parser `extended` → `simple` | No route needs nested or array queries. All 52 `req.query` reads are `typeof === "string"` guards or zod `safeParse` over `z.string()`/`z.enum`/`z.coerce.number()` (`packages/core/src/contracts/*.contract.ts`). Lists are comma strings, and `filters` is base64 (`utils/filter-sql.util.ts:75`). Nothing writes to `req.query`. **But** `redactQuery` (`utils/redact-url.util.ts:83-92`) matches keys with `SENSITIVE_NAMES.has(normalizeName(key))`, which relies on `qs` nesting `auth[token]` into an object; under `simple` that becomes a flat key `"auth[token]"`, and the logged query (`utils/logger.util.ts:147`) stops redacting it |
| `req.body` is `undefined` when nothing was parsed (body-parser 2) | `jsonBodyOnly` lets a bodiless POST/PUT/PATCH through. 46 router `safeParse(req.body)` calls would turn today's `{}` into a 400 on all-optional schemas. `organization.router.ts:186` destructures `req.body` and would throw. Many handlers already use `req.body ?? {}`; `rejectNul` already handles `undefined` (`reject-nul.middleware.ts:57`) |
| Rejected promises reach `next(err)` | 181 async handlers with try/catch → `next(error)`, no wrapper. Today a stray rejection hits `index.ts:41`'s `unhandledRejection` logger and the request hangs; under 5 it reaches the error handler, which is an improvement |
| `res.status` validates integers | Only `services/http.service.ts:56,74`, fed by `ApiError.status` (integers today) |
| Removed APIs (`res.send(n)`, `req.param`, `sendfile`, `app.del`, `redirect('back')`, `req.host`) | None used |
| `app._router` → `app.router`; router 2 layers drop `regexp` | **Breaks** `__tests__/config/express-route-inventory.util.ts:86` (reads `app._router.stack`, rebuilds mount prefixes from `layer.regexp.source`/`fast_slash` :42-57). It feeds `config/route-authorization.test.ts:23-31` (the #685/#692 authorization guard) and `config/swagger.config.test.ts:647-654`. Both assert minimum route counts, so they fail loudly rather than vacuously |
| `@types/express` 5 | Merging in `src/types/express.d.ts:56-75` (`auth`, `rawBody`, `application`); `RequestHandler` in `auth.middleware.ts:22-63`; ~189 `return res…`/`return HttpService…` in handlers; generic usage otherwise minimal |

SSE (`job-events.router.ts:60`, `portal-events.router.ts:88,304`) writes through `SseUtil` (`writeHead`/`write`), and listens with `req.on("close")`. Nothing there is Express-version-specific, but a rejection after `writeHead` would hit the error handler with headers already sent (see Decision 4).

### qs after the bump

`npm ls qs` today: `express → qs@6.14.3`, `body-parser@1.20.9 → qs@6.16.2`, `superagent` (supertest, dev only) deduped to 6.14.3. After Express 5 the runtime copies are ≥ 6.16, while the dev-only superagent copy can still resolve 6.14.x. `npm audit` will still list it unless supertest's chain moves, but it isn't in the API image.

## The design space

### Decision 1 — Query parser

- **A. Keep `extended`** (`app.set("query parser", "extended")`). No behavior change; `qs` (now patched) still parses every query, nested forms included.
- **B. Adopt Express 5's default `simple`** (Node's `querystring`): flat keys only, a repeated key still yields an array. Fix `redactQuery` to use the bracket-aware `isSensitiveKey` (:43) so `auth[token]` stays redacted as a flat key.

| | A. extended | B. simple |
|---|---|---|
| Behavior change for clients | None | `?a[b]=c` arrives as key `"a[b]"`; no route reads such a key |
| Attack surface | `qs` parsing on every request (the subject of this ticket) | Node's built-in parser; `qs` out of the request path |
| Code change | One line | Redaction fix + test |

**Lean: B.** Nothing needs nested queries, and taking `qs` out of the per-request path is the durable fix for this ticket's class of advisory. The redaction regression is the one real cost, and it gets a test.

### Decision 2 — `req.body` when nothing was parsed

- **A. Restore `{}` globally.** A small middleware right after `express.json` sets `req.body = {}` for POST/PUT/PATCH when it's `undefined`, so every handler keeps today's contract.
- **B. Fix per handler.** Make every `safeParse(req.body)` use `req.body ?? {}`, plus a guard test.
- **C. Accept the change.** A bodiless write becomes a 400 wherever a schema allows an empty object.

| | A. global `{}` | B. per handler | C. accept |
|---|---|---|---|
| Client-visible change | None | None | Bodiless POSTs to all-optional routes start failing |
| Touch points | 1 middleware | ~46 + future ones | 0 (+ the `organization.router.ts:186` crash fix) |
| Drift risk | None | A new handler forgets it | — |

**Lean: A.** It keeps the API's contract with one mount point and no per-route discipline. `organization.router.ts:186` is fixed anyway, since it shouldn't depend on the middleware.

### Decision 3 — Route inventory under router 2

The authorization guard has to enumerate every route. Router 2's layers no longer expose a path or `regexp.source`, so reverse-engineering mount prefixes stops working.

- **A. Port the introspection** to `app.router.stack` and router 2's layer shape. It stays coupled to undocumented internals, and the next router release can break it again.
- **B. Record routes at registration.** Before the app is imported, the test patches `Router` and `app` registration methods (`get/post/put/patch/delete/all/use`) to record `(mount, method, path)`. It's built on public APIs, works on any version, and is what the inventory semantically wants.
- **C. Statically parse the router sources.** Brittle against dynamic registration.

**Lean: B.** It ends the internals coupling that the util's header (:11-24) already warns about. The guard's minimum-count assertions stay, so a broken recorder fails loudly.

### Decision 4 — Errors after headers are sent

- **A. Leave as is.**
- **B. In the global handler**, if `res.headersSent`, log it and delegate to Express's default (`next(err)`, which ends the socket) instead of writing a JSON error.

**Lean: B.** Express 5 makes async rejections reach the handler, SSE routes send headers early, and writing an error body after `writeHead` throws `ERR_HTTP_HEADERS_SENT` inside the error handler.

### Decision 5 — Fallback

A root `overrides` of `qs ^6.16.2` under Express 4 would clear the audit finding. **Lean: not taken.** Express 4 doesn't declare that range, and the migration's measured exposure is small: no path syntax and no removed APIs. It stays a recorded fallback only if the migration stalls on something unforeseen.

## Tradeoff comparison

|  | Query parser `simple` | Global body `{}` | Registration recorder | headersSent guard |
|---|---|---|---|---|
| Client-visible change | Bracket keys flat (unused) | None | None | None |
| Spread to spec | Yes | Yes | Yes | Yes |
| New test | Redaction of flat `auth[token]` | Bodiless POST → handler sees `{}` | Inventory counts unchanged vs. Express 4 | Rejection after `writeHead` |

## Recommendation

1. Upgrade `apps/api` to `express ^5.3.0` and `@types/express ^5`, keeping `swagger-ui-express`, `cors`, `helmet` and `express-oauth2-jwt-bearer` at current versions (all compatible).
2. Use Express 5's default `simple` query parser, and make `redactQuery` match keys with the bracket-aware `isSensitiveKey`.
3. Mount a body-normalizing middleware directly after `express.json` that sets `req.body = {}` for POST/PUT/PATCH when no parser ran, and stop `organization.router.ts:186` destructuring an unchecked body.
4. Replace `express-route-inventory.util.ts`'s `_router` introspection with a registration recorder, and keep the authorization and swagger guards' minimum-count assertions. The first slice proves the recorder yields the same inventory on Express 4 before the bump.
5. The global error handler delegates to `next(err)` when `res.headersSent`.
6. Re-verify the `URIError` → 400 mapping (`app.ts:181`) under router 2's param decoding, with a test.
7. `npm audit` after the bump shows no runtime `qs` finding; a dev-only `superagent` copy is noted on the PR if it remains.

## Open questions

1. **Do `@types/express` 5's handler return types reject the ~189 `return res…` statements?** Lean: bump and let `type-check` answer. If it does, rewrite mechanically to `res…; return;` in the same slice, never with a cast or an `eslint-disable`.
2. **Does `express-oauth2-jwt-bearer` 1.7.4 behave on Express 5?** It declares no peer, and its types import `Handler`. Lean: covered by the integration suite (every protected route goes through `jwtCheck`). If its types clash, move to its latest (1.11.0) in the same slice.
3. **Should the dev-only `superagent` → `qs@6.14.x` copy block the ticket?** Lean: no. It's never in the image or in a request path. Record it on the PR, and let a supertest bump take it later.

## Enterprise-scale considerations

- **Concurrency & correctness:** N/A because the change is per-request framework behavior with no shared state. The body and query decisions are chosen precisely so that request semantics don't change.
- **Accuracy & auditability:** Lean: keep log redaction exact. Decision 1's `redactQuery` fix ensures no token reaches the logs under the new parser, with a test.
- **Failure modes:** Lean: Express 5 is strictly better here, because a stray async rejection becomes a 500 through the error handler instead of a hung request. Decision 4 keeps that path from throwing after headers are sent.
- **Scale & unbounded growth:** Lean: the patched `qs` (and, with `simple`, Node's parser) removes the advisories' DoS vectors from the per-request path. No new fan-out.
- **Multi-tenancy:** Lean: the authorization guard must keep proving every route is classified, which is why Decision 3 rebuilds the inventory rather than weakening the guard.
- **Contract stability:** Lean: no client-visible API change. Paths, query semantics for every used parameter, and bodiless-write behavior are all preserved.
- **Data lifecycle:** N/A because no data, retention or periods are involved.

## What this doesn't decide

- **A supertest/superagent bump** for the dev-only `qs` copy: unrelated to the shipped image.
- **Removing the now-redundant try/catch → `next(error)` blocks** that Express 5 makes optional: large churn for no behavior change; a separate cleanup if wanted.
- **A global 404 handler:** absent today, and unchanged by Express 5.
- **Tidying `organization.router.ts:340`'s DELETE body** (which contradicts `json-body-only.middleware.ts:6`): noted, out of scope unless Express 5 changes its behavior.

## Next step

`/spec 897` turns the recommendation into a contract: the middleware order, the inventory recorder's interface, and the acceptance criteria (audit, guard counts, bodiless-write and redaction behavior). `/plan 897` then slices it test-first:
1. The registration recorder, proven against Express 4.
2. The Express 5 and types bump with the type-check fixes.
3. The body normalization and `organization.router.ts:186`.
4. The query parser and the redaction fix.
5. The error-handler guard and the `URIError` re-check.

Each slice is one commit on `chore/897-express-5`, with the integration suite as the broad regression net.
