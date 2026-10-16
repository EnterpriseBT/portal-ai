# Malformed list queries answer 400 — Condensed design (#756)

**Issue:** [EnterpriseBT/portal-ai#756](https://github.com/EnterpriseBT/portal-ai/issues/756) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Thirteen list routes call `<X>ListRequestQuerySchema.parse(req.query)` inside their `try`. A bad query (`?limit=abc`, `offset=-1`, `sortOrder=sideways`) throws a `ZodError`, and the `catch` wraps it in a `500` with an unrelated `*_NOT_FOUND` / `*_FETCH_FAILED` code. #687 then hides the message. A client error is reported as a server fault: it's logged at error level, it counts toward 5xx alerting, and the field isn't named. #745 moved every other request-validation path onto `invalidPayload` and deliberately left these out because the status changes. `apps/api` only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| The 13 `.parse(req.query)` sites | `routes/portal.router.ts:232`, `portal-results.router.ts:451`, `station.router.ts:187`, `jobs.router.ts:100`, `entity-tag.router.ts:87`, `connector-entity.router.ts:134`, `field-mapping.router.ts:157`, `curated-view.router.ts:273`, `connector-definition.router.ts:112`, `entity-group.router.ts:118`, `connector-instance.router.ts:163`, `column-definition.router.ts:119`, `toolpacks.router.ts:169` | Inside `try`; the `catch` turns a non-`ApiError` into a 500 |
| `invalidPayload(code, label, error)` | `utils/zod-issue.util.ts:66` | `400`, first issue in the message, ≤ 20 issues + `issueCount` in `details` |
| Reference adoption | `routes/organization.router.ts:1487` (`AUDIT_LOG_INVALID_QUERY`) | `safeParse` → `if (!parsed.success) return next(invalidPayload(…))` |
| Existing query codes | `constants/api-codes.constants.ts` | `CURATED_VIEW_INVALID_QUERY`, `ENTITY_GROUP_INVALID_QUERY` exist; the other 11 domains have none |
| Guard | `__tests__/invalid-request-code.guard.test.ts` | Flags a hand-built schema 400 (`schemaFailure400s`), but not a `.parse()` whose throw becomes a 500 |

## Decision — inline `safeParse` vs a shared helper

- **A. Inline**, exactly as `organization.router.ts:1487`: `const parsed = Schema.safeParse(req.query); if (!parsed.success) return next(invalidPayload(ApiCode.<DOMAIN>_INVALID_QUERY, "Invalid <thing> query", parsed.error));`
- B. A `parseQuery(schema, query, code, label)` helper that throws `ApiError`. That's shorter, but it depends on every `catch` passing an `ApiError` through. They do today, but nothing enforces it, and it adds a second idiom next to the one #745 just made uniform.

**Chosen: A.** It's the established shape, and the guard can recognize it. The parse moves **above** the `try`, so a validation failure never touches the 500 path.

## Decision — keeping it fixed

Add a third rule to `invalid-request-code.guard.test.ts`: in `routes/`, a call `<expr>.parse(req.query | req.body | req.params)` fails CI. `JSON.parse` is excluded, since the webhook route parses its raw body. It gets a fixture self-test like the existing rules, and an allowlist that starts empty and only shrinks. Then CLAUDE.md's "the list routes still `.parse(req.query)` … so don't copy that shape" note can be replaced with the rule.

## Plan — 1 slice

**Files**
- edit `constants/api-codes.constants.ts`: add `PORTAL_`, `PORTAL_RESULT_`, `STATION_`, `JOB_`, `ENTITY_TAG_`, `CONNECTOR_ENTITY_`, `FIELD_MAPPING_`, `CONNECTOR_DEFINITION_`, `CONNECTOR_INSTANCE_`, `COLUMN_DEFINITION_`, `TOOLPACK_INVALID_QUERY`. Each code uses its domain's existing prefix.
- edit the 13 routers: `safeParse` + `invalidPayload` above the `try`. Each route's `@openapi` block gains or keeps a `400` response (`$ref: ApiErrorResponse`) naming the code.
- edit `__tests__/invalid-request-code.guard.test.ts`: the `.parse(req.*)` rule plus its fixtures.
- edit `CLAUDE.md` + `.github/copilot-instructions.md`: drop the "list routes still `.parse(req.query)`" caveat and name the new guard rule.

**Tests**
- integration `src/__tests__/__integration__/routes/list-query-validation.integration.test.ts`, table-driven over the 13 endpoints, each with a value its schema refuses (`?limit=abc` on the paginated lists, `?kind=nope` on toolpacks, which isn't paginated): `400 <DOMAIN>_INVALID_QUERY`, with the field named in `message` and in `details.issues[0].path`. A valid default query is still `200`.
- unit: the guard's fixture self-test flags `Foo.parse(req.query)` and ignores `JSON.parse(req.body)` and `safeParse`.
- Run: `npm run test:unit -- --testPathPattern invalid-request-code`, `npm run test:integration -- --testPathPattern list-query-validation`.

## Smoke (manual, against your dev stack)

Use a bearer token copied from the web app's network tab (`$T`):

1. `curl -s -H "Authorization: Bearer $T" "localhost:3001/api/portals?limit=abc" | jq '{success,code,message,details}'`: `400`-shaped body, `code` = `PORTAL_INVALID_QUERY`, and `message` names `limit`.
2. Repeat for `stations?offset=-1`, `jobs?sortOrder=sideways`, `connector-entities?limit=0`, `toolpacks?kind=nope`: each returns its own `*_INVALID_QUERY`.
3. `curl … "localhost:3001/api/portals"` with no query still returns `200`, the same as before.
4. In the web app, open Portals, Stations, Jobs, Connectors and the Columns list. Each loads and paginates as before, with no console errors.

## Out of scope

- Query validation for routes that already use `safeParse` (entity records, audit log, grants, …): already 400s.
- Changing any list schema's accepted values. Only the response to a value the schema already refuses changes.
