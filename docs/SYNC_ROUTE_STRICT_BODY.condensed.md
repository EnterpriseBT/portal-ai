# Sync route refuses unknown body keys — Condensed design (#775)

**Issue:** [EnterpriseBT/portal-ai#775](https://github.com/EnterpriseBT/portal-ai/issues/775) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc). Scope widened after code review (see the issue's amendment): the parse order, `test-connection`, and non-JSON bodies app-wide.

**Why.** `POST /api/connector-instances/:id/sync` takes no body and has no request schema, so `{"force":true}` is silently ignored with a `202`. That breaks the #745 rule that an unknown key is a `400` naming it, and the strict-body sweep can't see the route because there's no exported schema to sweep. The fix touches core (the schema), api (the parse) and web (`syncForInstance` currently sends its mutation variables as the body, which a strict schema would refuse). Code review found the same gap twice more: `test-connection` accepted any key, and a non-JSON body reached every route as `{}`, so `-d 'force=true'` passed even the strict schema.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Sync route | `apps/api/src/routes/connector-instance.router.ts:1886` | access check → eligibility → single-flight → `enqueueSync`; never reads `req.body` |
| Its OpenAPI block | `connector-instance.router.ts:1711` | no `requestBody`; `400` described only as "does not support sync" |
| Parse-order precedent | `PATCH /:id`, `connector-instance.router.ts:1578` | `safeParse` → `invalidPayload(CONNECTOR_INSTANCE_INVALID_PAYLOAD, …)` **before** the access check |
| Contract | `packages/core/src/contracts/connector-instance.contract.ts:161` | `ConnectorInstancePatchRequestBodySchema` is the `.strict()` sibling to mirror |
| Strict sweep | `packages/core/src/__tests__/contracts/strict-request-bodies.test.ts` | sweeps every exported `*RequestBodySchema` |
| Swagger components | `apps/api/src/config/swagger.config.ts:254` | `TestConnectionRequestBody` is the registration shape to copy |
| `syncForInstance` | `apps/web/src/api/connector-instances.api.ts:218` | no `body` option → `useAuthMutation` sends `{instanceId}` (`utils/api.util.ts:251`) |
| Its caller | `RestApiConnectorWorkflow.component.tsx:693` | the REST connector's initial sync, which would 400 without the web fix |
| `sync(id)` | `connector-instances.api.ts:203` | `void` variables → sends no body today; gets the same guard |
| `test-connection` | `connector-instance.router.ts` (`/:id/test-connection`) | `(req.body ?? {}) as TestConnectionParams`; schema was `.catchall` and `LOOSE`; only the REST adapter implements it, reading `endpointEntityId` |
| Body parsing | `apps/api/src/app.ts:67` | `express.json()` is the only parser; other content types leave `req.body` as `{}`. Webhooks parse their own body and mount before it |

## Decision 1 — parse after the access check, accept no body

**Options.** (a) Parse after `loadForVerb`, so a caller who can't read the instance hears only 404. (b) Parse first, like `POST /` and `PATCH /:id` in the same router.

**Decision: (a)**, revised in review (the first draft chose (b)). A route's status for a caller who can't read the object shouldn't depend on the body ("unreadable == absent"). The parse runs on `req.body ?? {}`, so a missing body and `{}` both pass, and the schema is `z.object({}).strict()`, exported as `ConnectorInstanceSyncRequestBodySchema`. Because the schema's name ends in `RequestBodySchema`, the sweep picks it up and no `LOOSE` entry is needed.

The web side sends no body: `body: () => undefined` on `syncForInstance`, the pattern CLAUDE.md already documents for imperative calls. `sync(id)` gets the same guard so no caller can trip the route.

## Decision 2 — `test-connection` is strict

The `.catchall` existed for adapters that might read other keys. None does, so it only hid typos. The schema becomes `.strict()` (off the `LOOSE` list), the route parses it after the access and adapter checks, and `TestConnectionParams` becomes the schema's type. An adapter that needs a key adds it to the schema.

## Decision 3 — a non-JSON body is a 415, app-wide

Options: refuse per route, or once after `express.json()`. Per route can't tell "no body" from "a body nobody parsed". **Decision: a global `jsonBodyOnly` middleware** right after `express.json()`: a body (non-zero `Content-Length` or any `Transfer-Encoding`) that isn't `application/json` is `415 REQUEST_UNSUPPORTED_MEDIA_TYPE`. No route takes multipart (uploads are presigned S3), and no client (web, CLIs) sends anything else. It runs before auth, like the existing body-parser 400/413.

## Plan — one slice, plus a review follow-up

**Files**
- Edit `packages/core/src/contracts/connector-instance.contract.ts`: add `ConnectorInstanceSyncRequestBodySchema = z.object({}).strict()` and its type, with a `#745/#775` comment.
- Edit `apps/api/src/routes/connector-instance.router.ts`: in `/:id/sync`, `safeParse(req.body ?? {})` after `loadForVerb`, and on failure `next(invalidPayload(ApiCode.CONNECTOR_INSTANCE_INVALID_PAYLOAD, "Invalid sync payload", parsed.error))`. In the OpenAPI block, add `requestBody` (`required: false`, `$ref: ConnectorInstanceSyncRequestBody`) and update the `400` description to name both codes.
- Edit `apps/api/src/config/swagger.config.ts`: register `ConnectorInstanceSyncRequestBody` via `z.toJSONSchema`.
- Edit `apps/web/src/api/connector-instances.api.ts`: add `body: () => undefined` to `syncForInstance` and `sync`.
- Review follow-up: strict `TestConnectionRequestBodySchema` (core, `LOOSE` entry removed), parsed in `/:id/test-connection`, with a `400` in its OpenAPI block; `TestConnectionParams` = the schema type. New `apps/api/src/middleware/json-body-only.middleware.ts` mounted in `app.ts`, and `ApiCode.REQUEST_UNSUPPORTED_MEDIA_TYPE`. CLAUDE.md + copilot mirror record the 415 rule.

**Tests**
- `apps/api/src/__tests__/__integration__/routes/connector-instance.router.integration.test.ts`, in the `POST …/sync` describe: `{"force":true,"slug":"file-upload"}` → `400 CONNECTOR_INSTANCE_INVALID_PAYLOAD` whose message names `force`, with no job row created; an explicit `{}` → `202` (the existing no-body case already covers a missing body); an unknown instance with a bad body → `404`; a form-encoded body → `415`, no job.
- `connector-instances.test-connection.integration.test.ts`: an unknown key → `400` naming it; an unknown instance with a bad body → `404`.
- `app.integration.test.ts`: form, text, multipart and untyped bodies → `415`; a bodiless POST and `application/json; charset=utf-8` pass.
- `apps/web/src/__tests__/api/connector-instances.api.test.ts`: `syncForInstance`'s config `body({instanceId: "ci-1"})` is `undefined`.
- The core sweep (`strict-request-bodies.test.ts`) covers the new schema automatically.
- Run: `npm run test:unit` (core, web), `npm run test:integration -- --testPathPattern connector-instance.router` (api), `type-check`, `lint`, `format:check`.

## Smoke (manual, against your dev stack)

1. With an owner token, `curl -X POST :3001/api/connector-instances/<sync-capable id>/sync -H 'Content-Type: application/json' -d '{"force":true}'` → `400`, `code: CONNECTOR_INSTANCE_INVALID_PAYLOAD`, and the message names `force`.
2. The same request with `-d '{}'`, then with no body → `202` with a `jobId` (wait for the first sync to finish before the second, or expect `409 SYNC_ALREADY_RUNNING`).
3. In the web app, create a REST API connector through the workflow → the initial sync starts (no 400 in the network tab; the request has no body).
4. Click **Sync** on an existing connector's detail page → the sync starts as before.
5. Swagger at `:3001/api/docs` → the `/sync` operation shows the optional empty request body.
6. `curl -X POST …/sync -d 'force=true'` (form-encoded, curl's default) → `415 REQUEST_UNSUPPORTED_MEDIA_TYPE`, and no job starts.
7. `curl -X POST …/sync` against an id the caller can't read, with `-d '{"force":true}'` (JSON) → `404 CONNECTOR_INSTANCE_NOT_FOUND`, not a 400.
8. In the REST API connector workflow, open **Test** on an endpoint → the sample loads as before. With JSON `{"endpointEntityId":"…","pageSize":5}` to `/test-connection` → `400` naming `pageSize`.

## Out of scope

- Other no-body POST routes that might lack a schema. The 415 closes the non-JSON path for all of them, but a JSON body with unknown keys still reaches any route without one. A sweep of no-body routes would be its own ticket.
- Reordering parse-vs-access on the router's other routes (`POST /`, `PATCH /:id`). They keep their order; only sync and test-connection changed here.
