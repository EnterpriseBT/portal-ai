# OpenAPI 3.1 migration — Condensed design (#446)

**Issue:** [EnterpriseBT/portal-ai#446](https://github.com/EnterpriseBT/portal-ai/issues/446) · Task · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** The document declares `openapi: "3.0.0"` while 59 of its components come from `z.toJSONSchema(…)`, which emits JSON Schema **draft 2020-12** (`const`, `$schema`, `type: "null"`). 3.0 permits none of those, so the two halves disagree about their dialect and nothing can validate the result — **1928 conformance errors**. Re-declaring the same bytes as `3.1.0`, where 2020-12 is native, drops that to **2**. The version string is the bug. `apps/api` only; no runtime path.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Declared version | `src/config/swagger.config.ts:441` | `openapi: "3.0.0"` |
| Generated components | `swagger.config.ts:82-91` and on | 59 × `z.toJSONSchema(schema, JSON_SCHEMA_OPTS)` — 2020-12 |
| `nullable: true` sites | 106 across 9 files | 81 in `swagger.config.ts`; rest in `column-definition` (8), `connector-instance-layout-plans` (5), `entity-tag` (4), `connector-instance` (3), `station` (2), `entity-group` (2), `organization` (1), `entity-record` (1) routers |
| Real defect 1 | `src/routes/jobs.router.ts:139-146` | `$ref`s the generic `sortByParam` **and** declares an inline `sortBy` with the real enum `[created, status, type]` (matching `SORTABLE_COLUMNS` at `:227`) — two declarations of one parameter |
| Real defect 2 | `src/routes/toolpacks.router.ts:653-661` | `POST /api/toolpacks/{id}/refresh` has no `parameters:` block, so `{id}` is undeclared |
| Existing guards | `src/__tests__/config/swagger.config.test.ts` | #420 responses + `$ref`s; #443 route parity + the heuristic shape check |
| Tooling | `swagger-ui-dist` 5.32.0, `swagger-jsdoc` 6.2.8 | Both handle 3.1 |

## Decision — bump, convert, and gate on conformance only

**Validator: `@readme/openapi-parser`** (7.0.1, 1.6 MB, 19 transitive deps, dev-only in `apps/api`). It validates against the OpenAPI meta-schema and reports exactly the **2** real defects above. Rejected `@redocly/cli`: its 126 findings are 124 style opinions, and its 12 "missing `security`" are *all* false positives — the OAuth callbacks, `/api/health`, the SSE streams, the public map tiles, `/api/public/site-config` (which has a merged test asserting `security` is **undefined**, #311) and the two HMAC-verified webhooks.

**The 106 `nullable` sites are converted, and this is not cleanup.** Measured: the 3.1 document validates with all 106 still present, because 2020-12 schemas are open and ignore unrecognized keywords. So `nullable` does not become invalid under 3.1 — it becomes **silently meaningless**, and a bump that leaves it voids nullability on 106 fields the 3.0 document genuinely asserted. Nothing mechanical would ever report that. Convert to `type: [X, "null"]`, or `anyOf: [{$ref}, {type: "null"}]` where the sibling is a `$ref`; read `swagger.config.ts:1035` and `:1186` individually (no adjacent `type:`).

**A separate guard asserts zero `nullable` in the built document**, since conformance provably cannot see it and a contributor copying a nearby 3.0-shaped annotation reintroduces it silently.

**#443's heuristic shape guard stays.** #446 says to delete it as redundant; that is wrong, and it was measured — injecting #443's exact garbling (a property named `"{ type: string }"` with a `null` value) into the 3.1 document leaves the validator reporting the same 2 errors. Unknown 2020-12 keywords may hold any value, so a collapsed YAML flow map is *conformant*. The two checks cover disjoint failures.

## Plan — 4 slices

**Slice 1 — the 2 conformance defects + the consumer check.** Drop the generic `$ref: sortByParam` at `jobs.router.ts:139` (keep the inline enum); add the `{id}` path parameter to `toolpacks.router.ts:653`. Grep `apps/web` and `packages/*` for anything reading the declared version or codegen-ing from the spec, and record the finding in this doc. *Tests:* `cd apps/api && npm run test:unit -- --testPathPattern "config/swagger.config"` stays green.

**Slice 2 — convert the 106 `nullable` sites.** 9 files. *Tests:* same command; plus assert by hand that the built document's `nullable` count is 0 before slice 4 automates it.

**Slice 3 — declare `3.1.0`** at `swagger.config.ts:441`. One line, landing only after slice 2 so nullability is never silently absent on `main`. *Tests:* same command.

**Slice 4 — the gate.** Add `@readme/openapi-parser` to `apps/api` devDependencies; add two cases to `swagger.config.test.ts` — the document validates with zero errors, and it contains zero `nullable` keys, each with its reason in-file. *Tests:* `npm run test:unit` in `apps/api`, then `npm run build && npm run type-check && npm run lint && npm run format:check` at the root.

## Smoke (manual, against your dev stack)

1. `npm run dev`, open `http://localhost:3001/api/docs` — the document still renders, and a nullable field (e.g. an `organization` response property) shows its type including null rather than a bare type.
2. `curl -s localhost:3001/api/docs/spec | jq -r '.openapi'` → `3.1.0`. Then `jq '[.. | objects | select(has("nullable"))] | length'` → `0`.
3. Exercise one converted surface for real — open a connector instance with a null `defaultStationId` or an un-interpreted layout plan — and confirm the response still matches what the docs now declare.
4. `cd apps/api && npm run test:unit -- --testPathPattern "config/swagger.config"` — all cases pass.
5. **Prove the conformance gate bites:** add a duplicate `- in: query` `name: limit` parameter to any documented route, re-run, confirm failure. Restore.
6. **Prove the `nullable` guard bites:** add `nullable: true` to any schema in an annotation, re-run, confirm failure naming its path. Restore.
7. **Prove the shape guard still bites** (the #443 case the validator misses): change an inline `{ type: string }` to `{{ type: string }}`, re-run, confirm failure. Restore.

## Out of scope

- **Redocly's style rules** — `operationId` on 146 operations, a `4XX` on 21, `summary` on 3. A much larger conversation; the 21 missing `4XX` are plausibly real and worth their own ticket. The 12 `security` findings are **false positives**, recorded here so nobody "fixes" them.
- **Retuning `JSON_SCHEMA_OPTS`** for 3.1. The generator's output already validates; retuning it has a 59-component blast radius for no validity gain.
- **Spec-driven client generation.** A valid document is a precondition, not a commitment.
- **Deleting #443's shape guard** — measured to still be load-bearing (see Decision).
