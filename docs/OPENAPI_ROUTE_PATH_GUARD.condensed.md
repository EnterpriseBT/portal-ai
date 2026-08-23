# OpenAPI route-path guard — Condensed design (#443)

**Issue:** [EnterpriseBT/portal-ai#443](https://github.com/EnterpriseBT/portal-ai/issues/443) · Task · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** The completeness guards from #420 assert that annotations are *present*, not that they are *valid*. The third assertion counts `@openapi` blocks per router file, so a block that exists but produces garbage passes — verified on `main`: corrupt one inline schema to `{{ type: string }}` and the suite reports `114 passed` while the document carries `{"id":{"{ type: string }":null}}`. This replaces the count with an exact route enumeration and adds a shape check for the garbling. `apps/api` test-only; no runtime code.

## Current shape

| Piece | Location | Note |
|---|---|---|
| The three guards | `src/__tests__/config/swagger.config.test.ts:545-635` | responses / `$ref`s / route parity |
| The weak assertion | `:603-625` | Counts `ROUTE_REGISTRATION` matches vs `@openapi` matches per file, `swagger.router.ts` allow-listed |
| Jest env | `src/__tests__/setup.ts` | Already sets `AUTH0_AUDIENCE`, `AUTH0_DOMAIN`, `DATABASE_URL` **before module imports** |
| Express version | `package.json:57` | `^4.21.0` — so the stack is `app._router.stack`, not Express 5's `app.router` |
| The nested mount | `src/routes/connector-entity.router.ts:47` | `connectorEntityRouter.use("/:connectorEntityId/records", entityRecordRouter)` — path derivation must recurse and substitute params |

Three things measured before choosing (all on `main` @ `2944e57e`):

- **The app imports cleanly inside jest.** `import { app }` throws under bare `tsx` (`auth.middleware.ts:12` builds the Auth0 verifier eagerly), but `setupFiles` already provides the env, so no new harness and no mocking is needed. This is what #420 assumed was expensive; it isn't.
- **A strict OpenAPI validator is not viable here.** The document declares `openapi: "3.0.0"` (`swagger.config.ts:441`) while its 59 `z.toJSONSchema` components embed `$schema: draft/2020-12` and `type: "null"` — both invalid in 3.0. A validator would fail on pre-existing deliberate content and turn this into a 3.1 migration.
- **The shape invariants the garbling violates are already clean:** zero object keys containing `{`/`}` outside the top-level `paths` map, zero keys containing `": "`, and the only 12 `null` values are legitimate `default: null`.

## Decision — exact enumeration from the app, plus a shape check

**Replace the count with a real `(method, path)` set comparison.** Walk `app._router.stack` recursively, recovering each mount prefix from the layer's `regexp.source` and substituting `layer.keys` for the param groups, then diff that set against `spec.paths` **in both directions** — registered-but-undocumented *and* documented-but-unregistered. The second direction is the one the count could never do: it catches a block declaring a path the app doesn't serve. Verified working: 148 registered, minus `GET /api/docs` and `GET /api/docs/spec` (allow-listed, they serve the document), equals the 146 documented operations exactly, with **zero** phantom paths.

Rejected: `express-list-endpoints` as a devDependency (a ~30-line walk needs no dependency), and validating the built document (see the 3.0/2020-12 conflict above).

**Add a shape check for garbled YAML.** Assert no object key outside the top-level `paths` map contains `{`, `}`, or `": "`, and that `null` appears only under `default`. The `{{ }}` corruption produces a property literally named `"{ type: string }"`, so it trips both halves. This is a targeted invariant rather than full validation, and it is stated as such in-file.

**Both new assertions carry a floor.** `registered.length > 100` and the existing operation-count floor, so a walk that silently returns nothing — the failure mode when Express internals change — fails loudly instead of passing vacuously.

**The known coupling, recorded in-file:** this reads Express 4 internals. Express 5 renames `_router` to `router` and changes `path-to-regexp`, so the enumerator breaks on that upgrade. The floor assertion is what turns that into a visible failure. The param regex must also match `(?:\/([^/]+?))` — the character class is `[^/]`, **unescaped**; a hand-typed `[^\/]` silently matches nothing, which cost a debugging cycle here and is exactly the class of error this ticket exists to prevent.

## Plan — 2 slices

**Slice 1 — the enumerator + the exact parity guard.** *Files:* new `apps/api/src/__tests__/config/express-route-inventory.util.ts` (the recursive walk, Express-4 coupling documented); edit `apps/api/src/__tests__/config/swagger.config.test.ts` — replace the count-based case at `:603` with two cases (no registered route undocumented; no documented path unregistered) plus the floor. *Tests:* `cd apps/api && npm run test:unit -- --testPathPattern "config/swagger.config"` — green immediately, since the sets already match; then verify it bites by deleting an `@openapi` block and by corrupting a path string.

**Slice 2 — the shape guard.** *Files:* edit the same test file — one case walking the document for brace/colon keys and stray nulls. *Tests:* same command; verify it bites by reintroducing the `{{ type: string }}` corruption, which must now fail.

## Smoke (manual, against your dev stack)

1. `cd apps/api && npm run test:unit -- --testPathPattern "config/swagger.config"` — all cases pass on the untouched tree.
2. **Prove the path guard bites.** In `src/routes/portal.router.ts`, change the `@openapi` path for `DELETE /api/portals/{id}` to `/api/portalz/{id}`, re-run: it must fail naming both an undocumented route and a documented-but-unregistered path. Restore.
3. **Prove the missing-block guard bites.** Delete an entire `@openapi` block from any router, re-run: it must fail naming that route. Restore.
4. **Prove the shape guard bites** — the original defect. In the same file, change `id: { type: string }` to `id: {{ type: string }}`, re-run: it must fail. Restore. (On `main` today this passes, which is the bug.)
5. **Prove the floor bites.** Temporarily make the enumerator return `[]`; re-run: it must fail on the floor rather than reporting success. Restore.
6. `npm run dev`, open `http://localhost:3001/api/docs` — the document still renders, unchanged. This ticket adds no annotations.
7. `npm run build && npm run type-check && npm run lint && npm run format:check` — all green.

## Out of scope

- **Adding or fixing any annotation.** #420 finished that; this only guards it.
- **Migrating the document to OpenAPI 3.1** so a real validator becomes usable. It is arguably invalid 3.0 today (`type: "null"`, embedded `$schema`) — a genuine finding, but a contract change affecting spec consumers and worth its own ticket.
- **Full JSON-Schema validation** of every component. The shape check targets the observed garbling; it is not a validator and says so in-file.
- **Express 5 readiness.** The enumerator will need updating at that upgrade; the floor assertion makes it fail loudly rather than silently.
