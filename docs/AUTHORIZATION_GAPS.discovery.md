# Authorization gaps (SSE + unguarded mutations) — Discovery

**Issue:** [EnterpriseBT/portal-ai#685](https://github.com/EnterpriseBT/portal-ai/issues/685)

**Why this exists.** The #684 affordance audit found routes where the server never asks whether the caller may act. Two classes:

- **(A) SSE.** The `/api/sse/*` streams check only that the JWT is valid. The portal stream runs a turn **as the portal's creator**, so a member can drive an owner's portal and get the owner's data.
- **(B) Unguarded REST mutations.** A set of mutation routes check org scope or nothing. A few of them don't even check org scope, so they reach other tenants by id.

Everything else in the app is checked per object (stations, pins, curated views, shares, the PATCH/DELETE paths of most data types). These routes are the exception.

This is the fix that makes the server the boundary everywhere, plus a CI guard that keeps it that way.

## The current shape

### SSE (class A)

| Piece | Location | Note |
|---|---|---|
| Mount | `apps/api/src/app.ts:85-87`, `routes/sse.router.ts:16-18` | `/api/sse` is mounted before `protectedRouter`; it aggregates `/jobs`, `/portals`, `/portal-sql` |
| Gate | `middleware/sse-auth.middleware.ts:13-22` | `?token=` → `Authorization` header → `jwtCheck`. No user, org or membership is resolved |
| Portal stream | `routes/portal-events.router.ts:77`, `:145-161` | `PortalService.getPortal(portalId)` (no org parameter, `services/portal.service.ts:418-427`). Replays the last answer, or runs the turn with `userId: portal.createdBy` |
| Portal events | `portal-events.router.ts:250` | `portals.findById`, then subscribes; no org check |
| Job events | `routes/job-events.router.ts:54-137` | `JobsService.findById` is unscoped (`services/jobs.service.ts:112-118`) |
| SQL handle stream | `routes/portal-sql-handle.router.ts:253-307` | Subscribes with no lookup. **No web caller** opens it |
| SQL handle REST | `portal-sql-handle.router.ts:82-108` → `getSnapshot` (service `:504-530`) | Has metadata, but **never compares the handle's `_organizationId`** to the caller's |
| Handle owner info | `services/portal-sql-handle.service.ts:74-84` | `StoredHandleMeta` has `_organizationId`, `_stationId`, optional `_userId`; no portalId |
| Reusable resolver | `middleware/metadata.middleware.ts:36-155` | `getApplicationMetadata` reads `req.auth.payload.sub` and sets `{userId, organizationId, roles}`; works after `sseAuth` unchanged |
| Web SSE factory | `apps/web/src/api/sse.api.ts:13-28` | Appends `token`. Callers: `utils/portal-stream.util.ts:140`, `utils/portal-chat-lock.util.ts:42`, `utils/job-stream.util.ts:118,297`, `components/BulkJobProgressBlock.component.tsx:269`, plus job streams in ConnectorInstance/EntityDetail views and the upload/Sheets/Excel workflows |

The turn's data scope follows the `userId` it's given: `buildStationContext` (`portal.service.ts:1193-1199`) and `PortalSqlService.resolveViewsForSession(stationId, orgId, userId)` (`portal-sql.service.ts:751-773`) build the session from that user's grants. Passing `portal.createdBy` is the escalation.

### Portals have no permission checks at all

| Piece | Location | Note |
|---|---|---|
| Table | `db/schema/portals.table.ts:10-20` | `organizationId`, `stationId`, `name`, `lastOpened`, plus `createdBy` (base columns) |
| Vocabulary | `packages/core/src/models/permission.model.ts:49, 82, 277, 306` | `portal` is a data resource type with read/write/delete. **Not shareable** (`:95-100`) |
| Seeded grants | `services/seed.service.ts:718-830` | FullAccess/AdminAccess `allow * *`; **MemberAccess = read/write/delete `created_by_caller`** over the data types, portal included. So the policy already says a member owns only their portals |
| Routes | `routes/portal.router.ts:206, 323, 417, 584, 667, 727, 829` | Org scope only. No `PermissionService` import; the list filters by org (+ station) |
| UI | `apps/web/src/views/Dashboard.view.tsx:71-74` → `RecentPortalsList.component.tsx:96-104`; `views/StationDetail.view.tsx:349-364` | Lists every portal in the org, each with an unconditional Delete |

### Unguarded REST mutations (class B)

| Resource | Routes | Today | Cross-tenant? |
|---|---|---|---|
| portal | list/get/create/PATCH/DELETE/messages/reset (`portal.router.ts`) | org only | no |
| toolpack | PATCH `:449`, DELETE `:580`, refresh `:676`, rotate-secret `:770`; POST `:301` entitlement-only | org only | no |
| field mapping | POST `:353`, PATCH `:596`, DELETE `:981` (`field-mapping.router.ts`) | connector capability flag only; **DELETE has no org check** (`:981-1000`) | **DELETE yes** |
| entity-group member | POST `:197`, PATCH `:419`, DELETE `:575` | none; **PATCH/DELETE `findById(memberId)`, no org check, no `:entityGroupId` match** | **yes** |
| tag assignment | POST `:187`, DELETE `:366` | none; **DELETE no org check, no `:connectorEntityId` match** | **yes** |
| creates | connector instance `POST :713` (+ `probe-endpoint-draft :916`, `preview-endpoint-page :1000`, `suggest-transform :1096`), connector entity `:508`, entity record `:725`, column definition `:387`, entity group `:407`, tag `:343` | none | no (they set org from the caller) |

### Existing patterns to mirror

- **Per-object:** org-scope 404, then `PermissionService.check(ctx, "resource.<verb>", {type, id, createdBy: existing.createdBy})`. Precedents:
  - `entity-tag.router.ts:498-537, 667`
  - `entity-group.router.ts:562-600, 836`
  - `column-definition.router.ts:610, 1018`
  - `connector-entity.router.ts:728, 991` (type `"entity"`)
  - `connector-instance.router.ts:1360, 1541, 1840`
  - `entity-record.router.ts:898, 1077, 1256, 1425`
- **Creates, two flavors:**
  - *Owned*: `{type, createdBy: userId}`, which members pass via `created_by_caller`. Precedents: `station.router.ts:477-482`, `portal-results.router.ts:125-131`.
  - *Admin-only*: `{type}`, no createdBy. Precedent: `curated-view.router.ts:368-372`.
- **Jobs REST** (`routes/jobs.router.ts:327-362`): another org → 404, and `can("resource.read", {type:"job", id, createdBy})`. MemberAccess holds unconditional `read job` (`seed.service.ts:800`).
- **Vocabulary gaps:**
  - No `entity_group_member` or `tag_assignment` type.
  - `entity_group`, `tag`, `column_definition` and `toolpack` are not data resource types, and **MemberAccess holds nothing on them**. So a member can already edit no tag or group, despite the comment at `entity-tag.router.ts:528`.

### Guard and test infrastructure

| Piece | Location |
|---|---|
| Route inventory | `apps/api/src/__tests__/config/express-route-inventory.util.ts:27-90` (walks `app._router.stack`; drops handler identity; asserts a >100 floor); used by `config/swagger.config.test.ts:612-640` |
| Tool guards | `services/tools.service.test.ts:964-1023` (every tool wrapped), `:1025-1045` (#629: two-way descriptor map), `:1049+` (classification map with a reason per entry) |
| Source-scan guards | `__tests__/tools/no-open-coded-sink.test.ts:14-30`, `seed-backfill-coverage.test.ts:82` |
| Owner vs member | `curated-view.router.integration.test.ts:28-47, 66-79` (mocked `jwtCheck` with a mutable `currentSub`). The mock also covers `sseAuth`, which imports the same `jwtCheck` |
| SSE tests that change | `__tests__/routes/portal-events.router.test.ts` (mocks `sseAuth` and `DbService`; expects "streams as createdBy" at `:148-162`); `__integration__/routes/jobs.router.integration.test.ts:262-340` |

## The design space

### Decision 1 — Whose identity does a portal turn run as?

- **A. The caller.** The turn resolves views and grants for the requesting user. Combined with portals being per-user (Decision 2), caller and creator are the same person, so this only bites if sharing is added later.
- **B. The creator (today).** That is the escalation.
- **C. The creator, but only if the caller is the creator.** Equivalent to A once Decision 2 holds, but brittle if sharing arrives.

| | A caller | B creator | C creator-if-caller |
|---|---|---|---|
| Closes the escalation | yes | no | yes |
| Survives future portal sharing | yes (each viewer sees their own scope) | no | no (silently breaks) |

**Lean: A.** A session's data scope must be the human asking. Identity comes from the request, never the object.

### Decision 2 — Portal ownership semantics

- **A. Per-user (creator-owned).** Enforce what MemberAccess already says: read/write/delete `created_by_caller`. Admins (`* *`) see all. The list uses `visibilityPredicate("portal")`.
- **B. Org-wide readable, creator-writable.** Members read everyone's portals (transcripts) but only write their own.
- **C. Shareable** (add to `SHAREABLE_RESOURCE_TYPES`). That's a feature, not a fix.

| | A per-user | B org-readable | C shareable |
|---|---|---|---|
| Matches seeded policy | yes | no (needs a policy change) | needs authoring |
| Transcript confidentiality | yes | no: a transcript can carry data from views others can't read | per share |
| Scope | fix | policy change | feature |

**Decided: A.** The seeded policy already encodes it, and a transcript is data shaped by its creator's grants, so org-wide reading would leak the creator's data scope. Pinned results are the sharing mechanism (open question 2).

### Decision 3 — SSE authorization shape

- **A.** Chain `getApplicationMetadata` after `sseAuth` on every SSE route. Each handler then authorizes exactly like its REST sibling (load, org-scope 404, `can()`), and unreadable == absent (404).
- **B.** A bespoke SSE-only check (org compare only).
- **C.** Move SSE under `protectedRouter` with header auth. EventSource can't send headers, so this needs a token-exchange redesign.

**Lean: A.** One resolver for REST and SSE, so the same rules hold. It works as-is because `sseAuth` already sets the header (`metadata.middleware.ts:72, 115`).

### Decision 4 — Gates for the unguarded mutations

- **Per-object PATCH/DELETE:** `resource.write` / `resource.delete` on the object (portal, toolpack, field mapping).
- **Child rows** (no type of their own) are gated by their parent:
  - group member → `write entity_group` on `:entityGroupId`;
  - tag assignment → `write entity` on `:connectorEntityId`, plus `read tag` on the tag being assigned.
  - Both also assert the child belongs to the URL's parent and to the org, before any write.
- **Creates:** mirror each type's existing PATCH semantics.
  - **Owned create** (`createdBy: userId`) for data types members already own via `created_by_caller`: portal, entity, entity_record, connector_instance, field mapping.
  - **Class create** (`{type}`) for types members hold nothing on: tag, entity_group, column_definition, toolpack.
- **Draft helpers** (`probe-endpoint-draft`, `preview-endpoint-page`, `suggest-transform`): gate like a connector-instance create, since they exist only to build one.

**Lean:** as above. Class create for tags, groups and column definitions is confirmed (open question 1).

### Decision 5 — Keeping it fixed: the guard

- **A. Route-stack guard.** Extend `express-route-inventory.util.ts` to keep handler identity. Fail CI when a mutation route (POST/PATCH/PUT/DELETE, plus every `/api/sse` route) isn't in a two-way classification map (`AUTHORIZED` / `EXEMPT: <reason>`), like #629's descriptor guard.
- **B. Source-scan guard.** Regex each router for a `PermissionService` call in each mutation handler. Brittle with helpers.
- **C. Behavioural guard.** For every mutation route, call it as a zero-grant member and expect 403/404. Strongest, but heavy fixtures per route.

| | A map | B scan | C behavioural |
|---|---|---|---|
| Catches a new unguarded route | yes (unclassified fails) | mostly | yes |
| False confidence | the map can lie, so integration tests back each entry | high | low |
| Cost | low | low | high |

**Lean: A, backed by C for every route this ticket touches.** The map forces a decision per route. The per-route integration tests prove the classification is true.

## Tradeoff comparison

|  | D1 caller | D2 per-user | D3 metadata on SSE | D4 per-object + parent gates | D5 map guard |
|---|---|---|---|---|---|
| Changes behaviour members see | no (their own portals) | yes: others' portals disappear | no | yes: may block member creates | no |
| Contract change | no | list shrinks for members | none | 403s where 200s were | none |
| Spread to spec | yes | yes | yes | yes | yes |

## Recommendation

1. Every SSE route runs `sseAuth, getApplicationMetadata`, then authorizes like its REST sibling. Unreadable or other-org is a 404:
   - portal stream and events: `read portal`; running a turn also requires `write portal`;
   - job events: org scope plus `read job` (mirror `jobs.router.ts:327-362`);
   - SQL handle REST snapshot: the handle's `_organizationId` (and `_userId` when present) must match the caller, or 404. **The SSE handle stream route is deleted** (no caller, can't deliver rows; open question 3).
2. A portal turn runs as the **caller** (`req.application.metadata.userId`), never `portal.createdBy`: in `buildStationContext`, `streamResponse` and the dissolve-precompute enqueue.
3. Portals are per-user, and pinned results are how portal output is shared. Every portal route checks `resource.<verb>` on `{type:"portal", id, createdBy}`, and the list applies `visibilityPredicate("portal")`. Admins still see everything through their grants.
4. Toolpack PATCH/DELETE/refresh/rotate-secret check `resource.write`/`resource.delete` on the toolpack, and toolpack create checks class `write toolpack` as well as the entitlement.
5. Field-mapping writes check org scope and `resource.<verb>` on the field mapping (create: owned create), keeping the connector capability flag as an additional 422.
6. Child rows check their parent, and that the child belongs to the URL's parent and the caller's org:
   - entity-group members require `write entity_group` on the group;
   - tag assignments require `write entity` on the connector entity, plus `read tag`.
7. Creates check as Decision 4 describes: owned create for portal, entity, entity_record, connector_instance and field mapping (plus the connector-instance draft helpers); class create for tag, entity_group, column_definition and toolpack.
8. A guard test fails CI when a mutation or SSE route is missing from a two-way classification map, and each new check has an owner-vs-member (and cross-org) integration case.
9. The web: the Dashboard and StationDetail portal lists show only what the API returns (no code change beyond tests). Affordance work stays with #684.

## Open questions

All resolved.

1. **Should members be able to create tags, entity groups and column definitions?** **Resolved: no.** Creating them needs owner/admin-level permission (class create), the same as editing or deleting them under the seeded policy. Members lose the unchecked create path they have today.
2. **Members can no longer see others' portals: is anything relying on that?** **Resolved: portals are per-user.** **Pinned results are the intended way to share portal output** with other users. They're already shareable (`pin` is in `SHAREABLE_RESOURCE_TYPES`) and checked per object.
3. **The SQL-handle SSE stream has no web caller, and can't deliver rows as designed.** `stage()` publishes every batch at production time, before the UI can know the handle id, so a subscriber only ever sees `complete`. **Resolved: delete the SSE stream route and guard the REST snapshot.**
   - The snapshot matches the handle's stored `_organizationId`, and `_userId` when present, to the caller. Another org's handle, or another user's, is a 404.
   - A future live stream would need a redesign anyway (subscribe first, then produce).
4. **Draft helpers (`probe`, `preview`, `suggest`) make outbound calls.** Should they also be charged or rate-limited? Lean: **out of scope.** Authorization only here; egress and cost policy for them is a separate question.

## Enterprise-scale considerations

- **Concurrency & correctness.** Lean: check-then-write in one handler, the same as the siblings. The child-belongs-to-parent assertion runs before the write, so a mismatched id can't touch another group's member.
- **Accuracy & auditability.** Lean: refused mutations aren't audited today (consistent across the app). Successful toolpack secret rotations already audit (`toolpacks.router.ts:770`). No new audit surface.
- **Failure modes.** Lean: fail closed. Unreadable == absent (404) for reads and SSE; 403 for a visible-but-forbidden mutation, matching the siblings. An unresolvable SSE caller gets 401/404, never an open stream.
- **Scale & unbounded growth.** Lean: one `loadSet` per request. List visibility goes through `visibilityPredicate` (SQL), not a per-row loop. SSE adds one metadata resolution per connection, the same cost as a REST call.
- **Multi-tenancy.** Lean: this ticket *is* the multi-tenancy fix. Every touched route gets an org-scope 404 plus a cross-org integration case. The three cross-tenant-by-id routes (field-mapping DELETE, group-member PATCH/DELETE, tag-assignment DELETE) are the highest priority.
- **Contract stability.** Lean: no payload shapes change. Some routes newly return 403/404. The classification map gives future routes (and #684's per-object capabilities) one place to read authorization intent from.
- **Data lifecycle.** N/A because no data is created, moved or retained differently. Existing portals keep their creator, which becomes their owner.

## What this doesn't decide

- **UI affordances** (hiding or disabling the now-refused actions). That's #684, which depends on this.
- **Portal sharing.** A feature, if wanted later (add to `SHAREABLE_RESOURCE_TYPES`).
- **Changing MemberAccess** to grant members their own tags, groups or column definitions (open question 1's follow-up).
- **A working live SQL-handle stream.** The dead route is deleted here; building one would be a redesign (open question 3).
- **Cost or egress policy** for the connector draft helpers (open question 4).

## Next step

`docs/AUTHORIZATION_GAPS.spec.md` pins the per-route check table (route → verb → object → status codes), the SSE resolver chain and the guard's classification map. `docs/AUTHORIZATION_GAPS.plan.md` slices the work so each slice is tests-first and leaves CI green:

1. The SSE resolver, and turns running as the caller.
2. Portals made per-user.
3. The three cross-tenant-by-id routes (field-mapping DELETE, group-member PATCH/DELETE, tag-assignment DELETE).
4. Toolpacks and field mappings.
5. Child rows and creates.
6. The guard test.

That's about 6 slices, possibly an epic if the spec shows the create changes need product sign-off first.
