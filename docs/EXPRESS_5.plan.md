# Express 5 migration — Plan

**TDD-sequenced migration of `apps/api` to Express 5. The guards land first, on Express 4: the route recorder, the empty-body contract, bracket-aware redaction and the headers-sent error guard. The version bump then lands last, verified by tests that already hold the behavior.**

Spec: `docs/EXPRESS_5.spec.md`. Discovery: `docs/EXPRESS_5.discovery.md`. Issue: #897.

Five slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `chore/897-express-5`**, in one PR (per `CLAUDE.md` → "Phase = commit, not PR").

```bash
cd apps/api && npm run test:unit -- --testPathPattern <pattern>
cd apps/api && npm run test:integration    # CI runs it sharded; locally only the touched files
```

Each slice:
1. Write failing tests.
2. Make the smallest change that turns them green.
3. Run the focused tests.
4. Run `npm run lint && npm run type-check` at the boundary.
5. Move to the next slice.

**Sequencing rationale.** Every behavior Express 5 changes gets its guard *before* the bump, while Express 4 still behaves the old way, so each guard can be written green and then must stay green through the bump:

- **Slice 1:** the route recorder, proven equal to today's internals reader on Express 4. The bump otherwise breaks the authorization guard.
- **Slice 2:** `emptyBodyAsObject` plus the organization PATCH fix. On Express 4 the middleware is a no-op, since body-parser 1 already sets `{}`.
- **Slice 3:** bracket-aware `redactQuery`. It's parser-independent, so it's correct on 4 and on 5.
- **Slice 4:** the error handler's headers-sent guard. It's version-independent.
- **Slice 5:** the bump. Express 5, `@types/express` 5, the internals reader deleted, type fixes, and the two cases only Express 5 can show (promise forwarding, and `URIError` under router 2).

No migration and no seed.

---

## Slice 1 — Route recorder

Replaces the Express 4 internals reader in `express-route-inventory.util.ts` with a registration recorder that works on both versions.

**Files**
- Edit `apps/api/src/__tests__/config/express-route-inventory.util.ts`:
  - add `installRouteRecorder()` (self-installed at module load) and the recorder-backed `registeredRoutes(app)`;
  - keep the old reader temporarily as an unexported `registeredRoutesFromInternals` for the parity case.
- New `apps/api/src/__tests__/config/express-route-inventory.util.test.ts`.
- Edit `config/route-authorization.test.ts` and `config/swagger.config.test.ts`: import the util **before** `../../app.js`.

**Steps**
1. **Tests (spec "Route inventory" cases):**
   - the two-level router set;
   - methods chained after `route()`;
   - `mergeParams`;
   - the empty set when the app was built before the recorder;
   - idempotent install;
   - **parity**: on the real app, the recorder's set equals `registeredRoutesFromInternals(app)`.

   Run; they fail.
2. **Implement** the recorder:
   - wrap `route`/`use` on whichever of `express.Router.prototype` or `express.Router` carries `route`;
   - record per-router routes and mounts;
   - walk from `app._router ?? app.router`.

   Green.
3. Both guards pass with their floors unchanged. Record the route count (for the PR).
4. Lint and type-check.

**Done when:** the recorder enumerates exactly the routes the internals reader does, and both guards run through it.

**Risk:** import order. If `app` loads first, the recorder sees nothing. The empty-set case and the guards' floors make that loud.

---

## Slice 2 — Bodiless writes keep `{}`

**Files**
- New `apps/api/src/middleware/empty-body.middleware.ts`.
- Edit `middleware/json-body-only.middleware.ts`: export `BODY_METHODS`.
- Edit `app.ts`: mount it after `rejectNul`.
- Edit `routes/organization.router.ts:186`: `req.body ?? {}`.
- New `__tests__/middleware/empty-body.middleware.test.ts`.
- Extend `__tests__/__integration__/routes/organization.router.integration.test.ts`.

**Steps**
1. **Tests (spec "emptyBodyAsObject" cases, plus Organization PATCH):**
   - POST/PUT/PATCH `undefined` → `{}`;
   - a parsed body untouched;
   - GET/DELETE stay `undefined`;
   - a supertest stack on a bare `express()` (`json` → `jsonBodyOnly` → `rejectNul` → `emptyBodyAsObject`): a `Content-Length: 0` POST sees `{}`, and a form body still gets the 415;
   - a bodiless organization PATCH doesn't 500.

   Run; the unit cases fail because the module doesn't exist yet. On Express 4 the supertest and PATCH cases may already pass. That's expected: they're there to hold through slice 5.
2. **Implement** the middleware, the mount and the PATCH fix. Green.
3. Lint and type-check.

**Done when:** a bodiless write reaches handlers as `{}` by construction, not only by Express 4's default.

**Risk:** none on 4 (a no-op there).

---

## Slice 3 — Bracket-aware `redactQuery`

**Files**
- Edit `apps/api/src/utils/redact-url.util.ts` (`redactQuery` uses `isSensitiveKey`, and its comment is updated).
- Extend `__tests__/utils/redact-url.util.test.ts`.

**Steps**
1. **Tests (spec "redactQuery" cases):**
   - flat `auth[token]`, `token[]` and `token[0]` → redacted. These fail today: the first-hits-only check misses flat bracket keys.
   - nested `{auth:{token}}` still redacted;
   - `page` untouched.

   Run; the flat cases fail.
2. **Implement:** swap the key check to `isSensitiveKey`. Green.
3. Lint and type-check.

**Done when:** redaction is correct for both parsers' shapes, so slice 5's parser change can't leak a token into logs.

**Risk:** none.

---

## Slice 4 — Error handler never writes after headers

**Files**
- Edit `apps/api/src/app.ts`: the error handler takes `next`, with an early `headersSent` → warn + `next(err)`.
- Extend `__tests__/__integration__/app.integration.test.ts`.

**Steps**
1. **Tests (spec "Error handler", first case):** a test-only route that sends headers (`writeHead` + `write`) and then calls `next(err)`. The response ends cleanly, nothing throws `ERR_HTTP_HEADERS_SENT`, and the warn is logged.
   - It's registered on a bare `express()` that reuses the exported handler. If the handler isn't exported, extract it as `apiErrorHandler` in `app.ts` so the test can mount it.

   Run; it fails (the handler writes JSON after headers).
2. **Implement** the guard. Green.
3. Lint and type-check.

**Done when:** a post-header error is handed to Express's default (socket closed) on Express 4, ready for 5's promise forwarding.

**Risk:** extracting `apiErrorHandler` is a small refactor. Keep the mount order identical in `app.ts`.

---

## Slice 5 — Express 5

**Files**
- `apps/api/package.json`: `express ^5.3.0`, `@types/express ^5.0.6`.
- `package-lock.json`.
- `app.ts`: the query-parser comment.
- `__tests__/config/express-route-inventory.util.ts`: delete `registeredRoutesFromInternals`, the `RouteLayer` type and the parity case.
- `src/types/express.d.ts` only if required.
- Handler files the v5 types flag.
- Extend `__tests__/__integration__/app.integration.test.ts`.

**Steps**
1. **Tests (spec "Error handler", remaining cases):**
   - an async handler that rejects with `ApiError(409)` and no try/catch answers 409. Express 4 leaves this request hanging, so it's written in this slice.
   - the existing `URIError` → 400 case keeps passing on router 2.

   Run on Express 4; the 409 case fails (it times out).
2. **Bump** with `npm install express@^5.3.0 @types/express@^5.0.6 --workspace @portalai/api`.
3. Run `npm run type-check` and fix what it reports mechanically (`res…; return;`, never casts or disables). If `express-oauth2-jwt-bearer`'s types clash, bump it to `^1.11.0`.
4. Delete the internals reader and the parity case. The recorder is now the only path.
5. If router 2 surfaces a bad `%` differently, widen the `URIError` check in the error handler, keeping the response pinned.
6. Green, in this order:
   1. the focused tests;
   2. the full `apps/api` unit suite;
   3. the integration files touched in slices 2, 4 and 5 locally;
   4. `npm run build` / lint / type-check.

   Re-run both guards and confirm the route count matches slice 1's.
7. `npm audit --omit=dev` shows no `qs` finding, and `npm ls qs --omit=dev` shows only ≥ 6.16. Note any dev-only `superagent` copy for the PR.

**Done when:** every acceptance criterion in the spec except the post-merge deploy holds, and CI's sharded integration suite is green.

**Risk:**
- **Type fixes may be large but mechanical.** If more than ~200 sites change, they get their own commit inside this slice (`chore(api): v5 handler return types (#897)`) so the bump's behavioral diff stays readable.
- **An untested Express 4 assumption.** That's what CI's full integration suite is for. Anything it finds is fixed in this slice, with a test.

---

## Sequence summary

| # | Lands | Gate |
|---|---|---|
| 1 | Route recorder (Express 4 parity) | Recorder set = internals set; guards green |
| 2 | `emptyBodyAsObject` + org PATCH | Bodiless writes see `{}`; form body 415 |
| 3 | Bracket-aware `redactQuery` | Flat bracket keys redacted |
| 4 | Error handler headers-sent guard | No throw after `writeHead` |
| 5 | Express 5 + types, reader deleted | Full suites green, route count unchanged, no runtime `qs` finding |

## Cross-slice notes

- **The route count is the migration's invariant.** Record it in slice 1 and assert it again in slice 5; put both numbers on the PR.
- **Docs to sync in the same PR:**
  - `CLAUDE.md` → "API Style Guide": the `json-body-only` sentence ("a body `express.json()` can't parse never reaches a route… arrives as `{}`") gains the `emptyBodyAsObject` contract. Mirror it in `.github/copilot-instructions.md` if the sentence is there.
  - `apps/api/README.md`: wherever it names the Express version or the middleware order.
  - `docs/SUPPLY_CHAIN.md` needs no change: Trivy and the audit policy are unchanged.
- **Integration locally:** only the touched files (`feedback_test_only_touched_files_locally`). CI's sharded suite is the authority, and it needs the STRIPE_* exports for the billing suites if run in full here.
- **Post-merge:** deploy-dev's Trivy gate, verify-login, and a short app-dev smoke (CSV import → records → portal) are the remaining checks.

## Next step

Implementation starts on `chore/897-express-5` with slice 1, tests first, one commit per slice, once this plan is confirmed.
