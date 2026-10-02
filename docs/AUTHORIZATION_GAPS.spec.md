# Authorization gaps (SSE + unguarded mutations) — Spec

This spec pins the server-side authorization for every route named in [#685](https://github.com/EnterpriseBT/portal-ai/issues/685): who may call it, the check it runs, and the status it returns. It also pins the CI guard that keeps new routes from shipping unguarded. Discovery: `docs/AUTHORIZATION_GAPS.discovery.md`.

## Key decisions (flag for review)

1. **Identity comes from the request.** A portal turn, its station context, its SQL session and its dissolve precompute run as the **caller** (`req.application.metadata.userId`), never `portal.createdBy`.
2. **SSE resolves the caller like REST.** Every `/api/sse` route runs `sseAuth, getApplicationMetadata`, then the same check as its REST sibling.
3. **Unreadable == absent.** A caller who can't read the object (another org, or another member's per-user object) gets **404** with the domain's `*_NOT_FOUND` code. A caller who can read it but can't perform the mutation gets **403** `INSUFFICIENT_ROLE`, from `PermissionSet.check`. This matches the existing siblings.
4. **Portals are per-user**, enforced through the existing MemberAccess `created_by_caller` grants. Pinned results are how portal output is shared, and pins are unchanged.
5. **A create checks two things:** `read` on the parent it is created under (404 if unreadable), and a create check on the new type:
   - **Owned create** `{type, createdBy: userId}` for the data types members own (`DATA_RESOURCE_TYPES`): portal, entity, entity_record, field_mapping, connector_instance.
   - **Class create** `{type}` for the types members hold nothing on: tag, entity_group, column_definition, toolpack. These are owner/admin only (open question 1).
6. **Child rows are authorized through their parent, and must belong to it.** A group member needs `write entity_group` on `:entityGroupId`. A tag assignment needs `write entity` on `:connectorEntityId` and `read tag` on its tag. A child whose parent id or org doesn't match the URL is a 404.
7. **The SQL-handle SSE stream is deleted.** The REST snapshot is scoped to the handle's stored org, and user when recorded.
8. **The guard is a two-way classification map.** Every registered mutation route (POST/PATCH/PUT/DELETE) and every `/api/sse` route must appear in it, and every entry must be a registered route. An unclassified route fails CI.

## Scope

### In scope

- `apps/api` routes, middleware and services for the surfaces below.
- Integration tests: owner vs member, plus cross-org, for each.
- The guard test.
- Updating the swagger docs for the removed route and the new 403/404 responses.

### Out of scope

- UI affordances (#684, which depends on this).
- Portal sharing.
- Changing MemberAccess or other seeded policies.
- A working live SQL-handle stream.
- Cost or egress policy for connector draft helpers.
- Audit records for refused attempts.

## Surface

### Status-code rule (applies to every row below)

| Situation | Status | Code |
|---|---|---|
| No / invalid JWT | 401 | (unchanged, `jwtCheck`) |
| Object missing, other org, or caller lacks `read` on it (or its parent) | 404 | domain `*_NOT_FOUND` |
| Object readable, caller lacks the mutation verb | 403 | `INSUFFICIENT_ROLE` (via `PermissionService.check` / `PermissionSet.check`) |
| Child id doesn't belong to the URL's parent | 404 | the child's `*_NOT_FOUND` |

Checks use the existing signatures:
- `PermissionService.loadSet(ctx): Promise<PermissionSet>` (`services/permission.service.ts:84`);
- `PermissionService.check(ctx, action, object?)` (`:211`);
- `set.can(action, object)` and `set.check(action, object)`;
- `set.visibilityPredicate(type, {createdByCol, idCol})`.

`action` is `"resource.read" | "resource.write" | "resource.delete"`. `object` is `{type, id?, createdBy?}`.

One `loadSet` per request: a handler that needs both read and write loads the set once and calls `can` / `check` on it.

### SSE (`apps/api/src/routes/sse.router.ts`, mounted at `app.ts:85-87`)

| Route | Middleware | Authorization | Behaviour change |
|---|---|---|---|
| `GET /api/sse/portals/:portalId/stream` (`portal-events.router.ts:77`) | `sseAuth, getApplicationMetadata` | Portal in the caller's org, and `can("resource.read", portal)`, else 404 `PORTAL_NOT_FOUND`. Running a pending turn additionally needs `can("resource.write", portal)`, else 403 | `buildStationContext({ …, userId })` and `PortalService.streamResponse({ …, userId })` receive `req.application.metadata.userId` |
| `GET /api/sse/portals/:portalId/events` (`:250`) | same | org + `read portal`, else 404 | none |
| `GET /api/sse/jobs/:id/events` (`job-events.router.ts:56`) | same | Job in the caller's org and `can("resource.read", {type:"job", id, createdBy})`, else 404 `JOB_NOT_FOUND`. Mirrors `jobs.router.ts:327-362` | none |
| `GET /api/sse/portal-sql/handle/:handleId/stream` (`portal-sql-handle.router.ts:253-307`) | n/a | **Route deleted**, with its `@openapi` block | `PortalSqlHandleService.stage()` stops publishing batches to `streamChannelKey` (no subscriber remains). `streamChannelKey` / `STREAM_CHANNEL_PREFIX` are removed |

`PortalService.getPortal(portalId, opts?)` (`services/portal.service.ts:418`) is unchanged. Callers do the org and permission check first.

Inside `PortalService.streamResponse` and the bulk-result path, the dissolve-precompute enqueue (`portal.service.ts:593, 820`) and the message rows use the `userId` passed in, not `portal.createdBy`. That's the persisted assistant message's `createdBy` and the precompute `userId`. The user message's `createdBy` in `addMessage` becomes the caller as well (see the portal REST table).

### SQL handle REST snapshot (`portal-sql-handle.router.ts:82-108`)

`GET /api/portal-sql/handle/:handleId`:
1. Calls `PortalSqlHandleService.getMeta(handleId)` (`services/portal-sql-handle.service.ts:581`). An expired handle stays 404 `READ_HANDLE_EXPIRED`.
2. Requires `meta._organizationId === organizationId`, and when `meta._userId` is set, `meta._userId === userId`. Anything else is **404 `READ_HANDLE_EXPIRED`**, the same response as a missing handle, so the check reveals nothing.
3. Only then calls `getSnapshot`.

`POST /api/portal-sql/widget-refresh` is unchanged; it's already org-scoped and passes the caller.

### Portals (`routes/portal.router.ts`)

| Route | Check |
|---|---|
| `GET /api/portals` (`:197`) | Adds `set.visibilityPredicate("portal", {createdByCol: portals.createdBy, idCol: portals.id})` to the org filter |
| `POST /api/portals` (`:89`) | Station in org and `can("resource.read", station)` (404 `STATION_NOT_FOUND`), then `check("resource.write", {type:"portal", createdBy: userId})` |
| `GET /api/portals/:id` (`:305`), `GET /:id/running-jobs` (`:819`) | org + `read portal`, else 404 `PORTAL_NOT_FOUND` |
| `PATCH /api/portals/:id` (`:557`), rename and `lastOpened` | org + `read` (404), then `check("resource.write", portal)` |
| `POST /api/portals/:id/messages` (`:710`) | org + `read` (404) + `write`. `PortalService.addMessage` records `createdBy` = the caller (it gains a `userId` argument) |
| `DELETE /api/portals/:id/messages` (`:408`, reset) | org + `read` (404) + `write` |
| `DELETE /api/portals/:id` (`:658`) | org + `read` (404), then `check("resource.delete", portal)` |

Where `portal = {type: "portal", id: p.id, createdBy: p.createdBy}`.

### Toolpacks (`routes/toolpacks.router.ts`)

| Route | Check |
|---|---|
| `POST /api/toolpacks` (`:301`) | `check("resource.write", {type:"toolpack"})` (class) **before** the entitlement check. A member gets 403, not an upgrade error |
| `PATCH /:id` (`:449`), `POST /:id/refresh` (`:676`), `POST /:id/rotate-signing-secret` (`:770`) | `findByIdScoped(id, org)` (404 `TOOLPACK_NOT_FOUND`), then `check("resource.write", {type:"toolpack", id, createdBy})` |
| `DELETE /:id` (`:580`) | the same, with `resource.delete` |

The GET routes keep `requirePermission("resource.read", "toolpack")`.

### Field mappings (`routes/field-mapping.router.ts`)

| Route | Check |
|---|---|
| `POST /api/field-mappings` (`:353`) | The parent connector entity in org and `can("resource.read", {type:"entity", …})` (404 `CONNECTOR_ENTITY_NOT_FOUND`), then `check("resource.write", {type:"field_mapping", createdBy: userId})` |
| `PATCH /:id` (`:596`) | Mapping in org (404 `FIELD_MAPPING_NOT_FOUND`), then `check("resource.write", {type:"field_mapping", id, createdBy})` |
| `DELETE /:id` (`:981`) | **Adds the org check** (404), then `check("resource.delete", …)` |

The existing connector-capability 422 (`utils/resolve-capabilities.util.ts:49-79`) stays and runs after authorization.

### Entity-group members (`routes/entity-group-member.router.ts`, mounted under `/api/entity-groups/:entityGroupId/members`)

- **All three routes:** the group in org and `can("resource.read", group)` (404 `ENTITY_GROUP_NOT_FOUND`), then `check("resource.write", {type:"entity_group", id: group.id, createdBy: group.createdBy})`.
- **`PATCH /:memberId` (`:419`) and `DELETE /:memberId` (`:575`)** also require `member.organizationId === organizationId && member.entityGroupId === req.params.entityGroupId`, else 404 `ENTITY_GROUP_MEMBER_NOT_FOUND`. This runs **before** any write.
- `POST` (`:197`) keeps its existing org checks on the linked connector entity.

### Tag assignments (`routes/entity-tag-assignment.router.ts`, mounted under `/api/connector-entities/:connectorEntityId/tags`)

- **Both routes:** the connector entity in org and `can("resource.read", entity)` (404 `CONNECTOR_ENTITY_NOT_FOUND`), then `check("resource.write", {type:"entity", id, createdBy})`.
- **`POST` (`:187`)** also requires the tag in org and `can("resource.read", {type:"tag", id, createdBy})`, else 404 `ENTITY_TAG_NOT_FOUND`.
- **`DELETE /:assignmentId` (`:366`)** requires `assignment.organizationId === organizationId && assignment.connectorEntityId === req.params.connectorEntityId`, else 404 `ENTITY_TAG_ASSIGNMENT_NOT_FOUND`, before any write.

### Creates

| Route | Parent read (404) | Create check |
|---|---|---|
| `POST /api/connector-instances` (`connector-instance.router.ts:713`) | n/a | owned: `{type:"connector_instance", createdBy: userId}` |
| `POST /api/connector-instances/probe-endpoint-draft` (`:916`), `/preview-endpoint-page` (`:1000`), `/suggest-transform` (`:1096`) | n/a | the same owned `connector_instance` create |
| `POST /api/connector-entities` (`connector-entity.router.ts:508`) | connector instance (`CONNECTOR_INSTANCE_NOT_FOUND`) | owned: `{type:"entity", createdBy: userId}` |
| `POST /api/connector-entities/:connectorEntityId/records` (`entity-record.router.ts:725`) | connector entity (`CONNECTOR_ENTITY_NOT_FOUND`) | owned: `{type:"entity_record", createdBy: userId}` |
| `POST /api/column-definitions` (`column-definition.router.ts:387`) | n/a | class: `{type:"column_definition"}` |
| `POST /api/entity-groups` (`entity-group.router.ts:407`) | n/a | class: `{type:"entity_group"}` |
| `POST /api/entity-tags` (`entity-tag.router.ts:343`) | n/a | class: `{type:"tag"}` |

### Guard (new)

**`apps/api/src/__tests__/config/route-authorization.map.ts`** exports:

```ts
export type RouteAuthorization =
  | { kind: "authorized"; by: string }   // e.g. "PermissionService.check resource.write portal"
  | { kind: "exempt"; reason: string };  // e.g. "public webhook, HMAC-verified"
export const ROUTE_AUTHORIZATION: Record<string, RouteAuthorization>; // key = "METHOD /path/{param}"
```

**`apps/api/src/__tests__/config/route-authorization.test.ts`**, using `registeredRoutes(app)` (`express-route-inventory.util.ts:85`):
1. Every registered route whose method is POST/PATCH/PUT/DELETE, plus every `GET /api/sse/...` route, has a `ROUTE_AUTHORIZATION` entry ("unclassified route", listing the offenders).
2. Every entry is a registered route ("stale entry").
3. Every `exempt` entry carries a non-empty reason.
4. There are more than 100 mutation routes, so the guard can't pass vacuously (the same floor style as the inventory util).

The map classifies every mutation route that exists today. Routes this ticket guards are `authorized`. Already-guarded routes are `authorized`, naming their check. Genuinely public ones are `exempt` with a reason (health, Stripe webhook, invitation accept, public site-config and so on). The classification is backed by the integration tests below for every route this ticket touches.

## Migration

None. No schema change.

## Seed

None. The seeded policies are unchanged. Behaviour follows from the existing MemberAccess grants (read/write/delete `created_by_caller` on `DATA_RESOURCE_TYPES`; nothing on tag/entity_group/column_definition/toolpack).

## TDD test plan

Run from `apps/api`: `npm run test:unit -- --testPathPattern …` and `npm run test:integration -- --testPathPattern …`.

Identities follow `curated-view.router.integration.test.ts:28-47`:
- **owner**, `seedUserAndOrg`;
- **member**, role `member`;
- **other-org owner**, a second `createOrganization` plus `seedRbacForOrg`.

`jwtCheck` is mocked with a mutable `currentSub`; SSE requests carry `?token=x`.

### SSE: `__integration__/routes/portal-events.router.integration.test.ts` (new), `jobs.router.integration.test.ts` (extend)

1. Owner streams their own portal: 200, and the turn runs as the owner. Spy on `PortalService.streamResponse` and assert `userId` = the owner.
2. Member streams the owner's portal: 404 `PORTAL_NOT_FOUND`, and `streamResponse` isn't called.
3. Other-org user streams the portal: 404.
4. Member streams their own portal: the turn runs as the member.
5. Portal events, as cases 2 and 3: 404.
6. Job events, other org: 404 `JOB_NOT_FOUND`. Same org: unchanged 200.
7. `GET /api/sse/portal-sql/handle/:id/stream` is no longer registered (404 from Express).

Update `__tests__/routes/portal-events.router.test.ts`: mock `getApplicationMetadata` and `PermissionService`, and change the "streams as createdBy" expectation (`:148-162`) to "streams as the caller".

### SQL handle snapshot: `__integration__/services/portal-sql-handle.integration.test.ts` / router test

8. Same org and user: 200.
9. Other org: 404 `READ_HANDLE_EXPIRED`.
10. Same org, other user (handle with `_userId`): 404.
11. A handle without `_userId`, same org: 200.

### Portals: `__integration__/routes/portal.router.integration.test.ts` (new or extend)

12. List as member: only the member's own portals. List as owner: all.
13. Member GET, PATCH, DELETE, messages POST, messages DELETE and running-jobs on the owner's portal: each 404, and nothing written (rows unchanged).
14. Member does the same on their own portal: success.
15. Other-org caller: 404 on every route.
16. Create on a station the caller can't read: 404 `STATION_NOT_FOUND`. A member creating on a readable station: 200, with `createdBy` = the member.

### Toolpacks: `__integration__/routes/toolpacks.router.integration.test.ts`

17. Member PATCH, DELETE, refresh and rotate-signing-secret: 403 `INSUFFICIENT_ROLE`, and the toolpack and secret are unchanged.
18. Owner: success.
19. Other org: 404.
20. Member POST: 403, ahead of the entitlement check (even on an entitled tier).

### Field mappings: `__integration__/routes/field-mapping.router.integration.test.ts`

21. DELETE from another org: 404, and the row is still present (the cross-tenant fix).
22. Member PATCH/DELETE on a mapping they didn't create: 403. Their own: success.
23. POST under an unreadable connector entity: 404. A member creating under a readable one: 200.
24. The connector-capability 422 still fires for an authorized caller.

### Entity-group members: `__integration__/routes/entity-group-member.router.integration.test.ts`

25. PATCH/DELETE with a `memberId` from another group (same org): 404 `ENTITY_GROUP_MEMBER_NOT_FOUND`, and nothing changed.
26. PATCH/DELETE with a `memberId` from another org: 404, nothing changed.
27. Member POST, PATCH and DELETE (no write on the group): 403.
28. Owner: success.

### Tag assignments: `__integration__/routes/entity-tag-assignment.router.integration.test.ts`

29. DELETE with an `assignmentId` from another entity, or from another org: 404, and the row is still present.
30. Member POST/DELETE without write on the entity: 403.
31. POST with a tag from another org: 404 `ENTITY_TAG_NOT_FOUND`.
32. Owner: success.

### Creates: in each router's integration suite

33. Member POST column-definition, entity-group and tag: 403. Owner: 200.
34. Member POST connector-instance (and the three draft helpers): allowed (owned create). A role with no `write connector_instance` (a custom zero-grant role): 403.
35. Member POST connector-entity under an unreadable instance: 404. Entity-record under an unreadable entity: 404.

### Guard: `__tests__/config/route-authorization.test.ts`

36. No unclassified mutation or SSE route.
37. No stale entry.
38. Every exempt entry has a reason.
39. The floor holds.
40. Negative self-test: a stub router with an unclassified POST fails the "unclassified" check (proves the guard bites).

**Totals ≈ 40 cases** (around 34 integration, 6 unit/guard), plus updates to the existing SSE unit tests.

## Acceptance criteria

- [ ] No `/api/sse` route serves an object to a caller who can't read it via REST. A valid JWT alone gets 404.
- [ ] A portal turn always runs with the caller's grants. A member can't drive another member's or the owner's portal.
- [ ] Members see, read and mutate only their own portals. Owners and admins see all, and pinned results still share across users.
- [ ] The SQL-handle SSE stream route no longer exists, and the snapshot serves only the handle's own org (and user, when recorded).
- [ ] Toolpack edit, delete, refresh and secret rotation are refused to members (403) and to other orgs (404).
- [ ] Field-mapping, entity-group-member and tag-assignment mutations can't reach another org's rows, or rows outside the URL's parent.
- [ ] Each create route checks read on its parent and the create rule for its type. Members can't create tags, entity groups or column definitions.
- [ ] CI fails when a new mutation or SSE route isn't classified in `ROUTE_AUTHORIZATION`.

## Risks & rollback

- **Fail-closed by design.** The risk is over-refusal: a legitimate member flow newly 403/404s, most likely the connector create path and its draft helpers if a role lacks `write connector_instance`, or portals the UI expected to list. It's detected by the member-path integration cases (14, 16, 22, 34) and the smoke walk. Rollback is per route (each slice is its own commit). Revert the slice, don't loosen the check.
- **The SSE identity change** could break the portal stream for legitimate users if `getApplicationMetadata` fails on the query-token path. Covered by case 1 and the smoke walk. The metadata middleware already reads the header `sseAuth` sets.
- **Removing the handle stream** has no web caller (verified in discovery), so no client rollback is needed.
- **Multi-tenant:** every touched route gets a cross-org case. A miss would be a remaining cross-tenant path, so the guard plus the per-route tests are the control.

## Files touched

- **Edit, routes:** `routes/sse.router.ts`, `routes/portal-events.router.ts`, `routes/job-events.router.ts`, `routes/portal-sql-handle.router.ts`, `routes/portal.router.ts`, `routes/toolpacks.router.ts`, `routes/field-mapping.router.ts`, `routes/entity-group-member.router.ts`, `routes/entity-tag-assignment.router.ts`, `routes/connector-instance.router.ts`, `routes/connector-entity.router.ts`, `routes/entity-record.router.ts`, `routes/column-definition.router.ts`, `routes/entity-group.router.ts`, `routes/entity-tag.router.ts`.
- **Edit, services:** `services/portal.service.ts` (`addMessage` takes `userId`; streamResponse internals use the passed `userId`), `services/portal-sql-handle.service.ts` (drop the stream publish, `streamChannelKey`, `STREAM_CHANNEL_PREFIX`).
- **Edit, docs:** `@openapi` blocks on each touched route (403/404 responses; remove the deleted route), and `config/swagger.config.ts` if the deleted route's schema becomes orphaned.
- **New:** `__tests__/config/route-authorization.map.ts`, `__tests__/config/route-authorization.test.ts`, `__integration__/routes/portal-events.router.integration.test.ts`, plus new or extended integration suites for portals, toolpacks, field mappings, group members, tag assignments and creates.
- **Edit, tests:** `__tests__/routes/portal-events.router.test.ts`, `__tests__/routes/portal-sql-handle.router.test.ts`, `__integration__/routes/jobs.router.integration.test.ts`, `__integration__/services/portal-sql-handle.integration.test.ts`, `config/swagger.config.test.ts` (the deleted route).

## Next step

`docs/AUTHORIZATION_GAPS.plan.md` sequences this into about 7 TDD slices, each a commit on `fix/685-authorization-gaps`:

1. The SSE resolver, and turns running as the caller.
2. The SQL-handle snapshot scope, and deleting the dead stream.
3. Portals made per-user.
4. The three cross-tenant-by-id routes (field-mapping DELETE, group-member PATCH/DELETE, tag-assignment DELETE).
5. Toolpacks and the remaining field-mapping checks.
6. Child-row parent checks and the creates.
7. The guard map and test, last, once every route has its final classification.
