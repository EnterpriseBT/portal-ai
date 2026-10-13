# Sync route refuses unknown body keys — Condensed design (#775)

**Issue:** [EnterpriseBT/portal-ai#775](https://github.com/EnterpriseBT/portal-ai/issues/775) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `POST /api/connector-instances/:id/sync` takes no body and has no request schema, so `{"force":true}` is silently ignored with a `202`. That breaks the #745 rule that an unknown key is a `400` naming it, and the strict-body sweep can't see the route because there's no exported schema to sweep. The fix touches core (the schema), api (the parse) and web (`syncForInstance` currently sends its mutation variables as the body, which a strict schema would refuse).

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
| `sync(id)` | `connector-instances.api.ts:203` | `void` variables → sends no body; unaffected |

## Decision — parse before the access check, accept no body

**Options.** (a) Parse after `loadForVerb`, so a caller who can't read the instance hears only 404. (b) Parse first, like `POST /` and `PATCH /:id` in the same router.

**Decision: (b).** It matches the router's other routes. A wrong-shaped body says nothing about the instance, so answering it before the 404 leaks nothing. The parse runs on `req.body ?? {}`, so a missing body and `{}` both pass, and the schema is `z.object({}).strict()`, exported as `ConnectorInstanceSyncRequestBodySchema`. Because the schema's name ends in `RequestBodySchema`, the sweep picks it up and no `LOOSE` entry is needed.

The web side sends no body: `body: () => undefined` on `syncForInstance`, the pattern CLAUDE.md already documents for imperative calls.

## Plan — one slice

**Files**
- Edit `packages/core/src/contracts/connector-instance.contract.ts`: add `ConnectorInstanceSyncRequestBodySchema = z.object({}).strict()` and its type, with a `#745/#775` comment.
- Edit `apps/api/src/routes/connector-instance.router.ts`: in `/:id/sync`, `safeParse(req.body ?? {})` first, and on failure `next(invalidPayload(ApiCode.CONNECTOR_INSTANCE_INVALID_PAYLOAD, "Invalid sync payload", parsed.error))`. In the OpenAPI block, add `requestBody` (`required: false`, `$ref: ConnectorInstanceSyncRequestBody`) and update the `400` description to name both codes.
- Edit `apps/api/src/config/swagger.config.ts`: register `ConnectorInstanceSyncRequestBody` via `z.toJSONSchema`.
- Edit `apps/web/src/api/connector-instances.api.ts`: add `body: () => undefined` to `syncForInstance`.

**Tests**
- `apps/api/src/__tests__/__integration__/routes/connector-instance.router.integration.test.ts`, in the `POST …/sync` describe: `{"force":true,"slug":"file-upload"}` → `400 CONNECTOR_INSTANCE_INVALID_PAYLOAD` whose message names `force`, with no job row created; an explicit `{}` → `202` (the existing no-body case already covers a missing body).
- `apps/web/src/__tests__/api/connector-instances.api.test.ts`: `syncForInstance`'s config `body({instanceId: "ci-1"})` is `undefined`.
- The core sweep (`strict-request-bodies.test.ts`) covers the new schema automatically.
- Run: `npm run test:unit` (core, web), `npm run test:integration -- --testPathPattern connector-instance.router` (api), `type-check`, `lint`, `format:check`.

## Smoke (manual, against your dev stack)

1. With an owner token, `curl -X POST :3001/api/connector-instances/<sync-capable id>/sync -H 'Content-Type: application/json' -d '{"force":true}'` → `400`, `code: CONNECTOR_INSTANCE_INVALID_PAYLOAD`, and the message names `force`.
2. The same request with `-d '{}'`, then with no body → `202` with a `jobId` (wait for the first sync to finish before the second, or expect `409 SYNC_ALREADY_RUNNING`).
3. In the web app, create a REST API connector through the workflow → the initial sync starts (no 400 in the network tab; the request has no body).
4. Click **Sync** on an existing connector's detail page → the sync starts as before.
5. Swagger at `:3001/api/docs` → the `/sync` operation shows the optional empty request body.

## Out of scope

- `POST /:id/test-connection` casts `req.body` without parsing. Its schema is `LOOSE` by design (each adapter reads its own keys), so that's a separate question.
- Other no-body POST routes that might lack a schema. This ticket fixes the one the #772 probe found. A sweep of no-body routes would be its own ticket.
