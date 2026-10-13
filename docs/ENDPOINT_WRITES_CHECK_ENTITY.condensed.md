# Endpoint writes check the entity's own permissions — Condensed design (#782)

**Issue:** [EnterpriseBT/portal-ai#782](https://github.com/EnterpriseBT/portal-ai/issues/782) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** A REST endpoint is a connector entity with its own permissions. #780 made the endpoint **read** routes respect them (list, by-id GET, test-connection). The other three routes keyed on an entity id still check only the **connector**: `requireRestApiInstance(req, instanceId, "write")`, plus that the entity is in the org and on that connector. So a member who owns a connector can edit or delete an endpoint the owner added to it, and run `discover-columns` (a live upstream sample) on an entity they can't read. The fix is API only (`apps/api`).

## Current shape

| Piece | Location | Note |
|---|---|---|
| `PATCH /:entityId` | `apps/api/src/routes/api-endpoints.router.ts` | parses the body (400 first, as the router's other routes do), then `findByEntityId` + org/instance compare → 404; no entity verb |
| `DELETE /:entityId` | same file | `findByEntityId` + org/instance compare → 404; no entity verb |
| `POST /:entityId/discover-columns` | same file | instance compare only, then `restApiAdapter.discoverColumnsWithSamples`; the route map records "writes nothing" |
| The loader | `apps/api/src/services/object-access.service.ts:59` `loadForVerb` | 404 unless in org **and** readable (`readableInOrg`, `:39`), then `set.check("resource.<verb>")` → 403 `PERMISSION_DENIED` (#713) |
| Entity routes' pattern | `connector-entity.router.ts` (PATCH/DELETE) | `loadForVerb(set, org, "entity", row, "write" \| "delete", 404)` |
| Route map | `apps/api/src/__tests__/config/route-authorization.map.ts:66`, `:533`, `:679` | `by:` says "ConnectorInstanceAccessService.load … + entity on the instance (#685)" |
| Read-side test | `__tests__/__integration__/routes/rest-api-endpoint-entity-read.authorization.integration.test.ts` | owner/member fixture from #780 |
| Web callers | `apps/web/src/api/api-connector.api.ts:145` (`discoverColumns`) | PATCH and DELETE have no UI caller |

## Decision — each route checks its own verb on the entity, through `loadForVerb`

Keep the connector check (`requireRestApiInstance`, write), and then authorize the entity row:
- **PATCH** → `loadForVerb(set, org, "entity", existing.entity, "write", 404)`.
- **DELETE** → `loadForVerb(…, "delete", 404)`, matching `connector-entity.router.ts`.
- **discover-columns** → `readableInOrg(set, org, "entity", endpoint.entity)` else 404. It writes nothing and returns samples, so **read** is the verb on the entity. That matches #780's test-connection. The connector stays write-gated, as today.

So an unreadable endpoint is a 404 on every verb, identical to an absent one. A readable but unwritable one is a 403 `PERMISSION_DENIED` on PATCH and DELETE (#713/#711). The checks run after the existing org/instance compare and before the job lock, so a refusal never takes a lock and `discover-columns` never calls upstream. The route map's `by:` strings name the entity check.

## Plan — one slice

**Files**
- `apps/api/src/routes/api-endpoints.router.ts`: the three handlers above. Load the permission set once per request with `PermissionService.loadSet(req.application!.metadata)`; `#782` comments.
- `apps/api/src/__tests__/config/route-authorization.map.ts`: the three `by:` strings gain "+ entity write/delete/read via ObjectAccessService (#782)".

**Tests**
- Extend `rest-api-endpoint-entity-read.authorization.integration.test.ts` (rename the describe to cover reads and writes). The member gets:
  - PATCH/DELETE/discover-columns on the owner's endpoint → 404 `REST_API_ENDPOINT_NOT_FOUND`, nothing changed or deleted (re-read as the owner), and no upstream fetch.
  - On an entity they can read but not write (created by `SYSTEM_TEST`, which members may read): PATCH and DELETE → 403 `PERMISSION_DENIED`, and discover-columns → 200.
  - On their own endpoint: PATCH 200, discover-columns 200.
- The owner can PATCH and DELETE the member's endpoint (200).
- `npm run test:integration -- --testPathPattern 'rest-api-endpoint-entity|api-endpoints|test-connection'` (api); `npm run test:unit -- --testPathPattern route-authorization` (api); `type-check`, `lint`, `format:check`.

## Smoke (manual, against your dev stack)

No UI exercises PATCH or DELETE, so this is a curl walk. Use two identities in `e2e-fixture`: the owner, and a member who owns a REST connector the owner added an endpoint to.
1. As the member, `PATCH …/api-endpoints/<owner's entityId>` with `{"label":"x"}` → `404 REST_API_ENDPOINT_NOT_FOUND`. As the owner, GET it: the label is unchanged.
2. As the member, `DELETE` it → 404, and the owner still lists it.
3. As the member, `POST …/<owner's entityId>/discover-columns` → 404.
4. As the member, PATCH your own endpoint's label → 200. As the owner, PATCH the member's endpoint → 200.

## Out of scope

- `POST /api-endpoints` (create): it creates a new entity under the connector, so the connector's write check is the right one. It's unchanged.
- Rewriting the router onto a shared loader for all endpoint routes. The three handlers are the whole gap.
