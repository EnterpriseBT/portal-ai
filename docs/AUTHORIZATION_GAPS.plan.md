# Authorization gaps (SSE + unguarded mutations) — Plan

**This plan closes every authorization gap named in the spec, one route family per slice, tests first. A guard test then keeps new routes from shipping unclassified.**

Spec: `docs/AUTHORIZATION_GAPS.spec.md`. Discovery: `docs/AUTHORIZATION_GAPS.discovery.md`. Issue: #685 (blocks #684).

7 slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `fix/685-authorization-gaps`**, one PR (#686).

Run tests from `apps/api` (never invoke jest directly):

```bash
cd apps/api && npm run test:unit -- --testPathPattern <pattern>
cd apps/api && npm run test:integration -- --testPathPattern <pattern>
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale:
1. **SSE + caller identity first.** It's the highest-severity gap (an in-org privilege escalation), and it stands alone.
2. **SQL-handle snapshot and stream removal.** Also a read path, and small. Deleting the route early shrinks what the guard must classify.
3. **Portals made per-user.** It builds on slice 1's caller identity (the turn and the portal now agree on one owner).
4. **The three cross-tenant-by-id routes.** Org checks plus parent-match only, so the cross-tenant hole closes before the finer permission work.
5. **Toolpacks and field-mapping permission checks.** Per-object write/delete on two independent routers.
6. **Child-row parent permissions and every create route.** It needs slice 4's parent-match in place.
7. **The guard map and test last**, once every route has its final classification. Written earlier, it would churn every slice.

---

## Slice 1 — SSE resolves the caller; portal turns run as the caller

Every `/api/sse` route resolves the caller and authorizes like REST. The portal stream runs the turn, station context, SQL session and dissolve precompute as the caller.

**Files**

- Edit: `apps/api/src/routes/portal-events.router.ts`: `getApplicationMetadata` after `sseAuth` on `/:portalId/stream` and `/:portalId/events`. Org + `read portal` (404 `PORTAL_NOT_FOUND`); running a turn needs `write`. Pass `req.application.metadata.userId` to `buildStationContext` and `streamResponse`.
- Edit: `apps/api/src/routes/job-events.router.ts`: `getApplicationMetadata`; org + `read job` (404 `JOB_NOT_FOUND`), mirroring `jobs.router.ts:327-362`.
- Edit: `apps/api/src/services/portal.service.ts`: the `streamResponse` internals (persisted assistant `createdBy`, dissolve-precompute `userId` at `:593, :820`) use the passed `userId`, not `portal.createdBy`.
- New: `apps/api/src/__tests__/__integration__/routes/portal-events.router.integration.test.ts`.
- Edit: `apps/api/src/__tests__/routes/portal-events.router.test.ts`: mock `getApplicationMetadata` and `PermissionService`; "streams as createdBy" becomes "streams as the caller".
- Edit: `apps/api/src/__tests__/__integration__/routes/jobs.router.integration.test.ts`: the cross-org job-events case.
- Edit: the `@openapi` blocks on the three routes (404 for unreadable).

**Steps**

1. **Tests (spec cases 1–6).** In the new portal-events integration suite:
   - the owner's own stream runs as the owner, with a spy on `PortalService.streamResponse` capturing `userId`;
   - a member gets 404 on the owner's portal, and `streamResponse` isn't called;
   - another org gets 404;
   - a member's own portal runs as the member;
   - the events route gets 404 for the member and for another org.

   In `jobs.router.integration.test.ts`: job events from another org give 404, and the same org stays 200. Update the unit test's expectation. Run; fail.
2. **Implement** the middleware chain and checks, and switch the identity source. Green.
3. Lint + type-check.

**Done when:** cases 1–6 pass, and no SSE handler reads `portal.createdBy` as an identity.

**Risk:** `getApplicationMetadata` on the query-token path. It reads the header `sseAuth` sets (`metadata.middleware.ts:72, 115`); case 1 proves it.

---

## Slice 2 — SQL-handle snapshot scoped; the dead SSE stream deleted

**Files**

- Edit: `apps/api/src/routes/portal-sql-handle.router.ts`:
  - `GET /handle/:handleId` calls `getMeta`, then requires the meta's `_organizationId` (and `_userId` when set) to match, else 404 `READ_HANDLE_EXPIRED`;
  - **delete** `GET /handle/:handleId/stream` (and its `@openapi`).
- Edit: `apps/api/src/services/portal-sql-handle.service.ts`: `stage()` stops publishing to the channel; remove `streamChannelKey` and `STREAM_CHANNEL_PREFIX`.
- Edit: `apps/api/src/routes/sse.router.ts` if the `/portal-sql` mount is left empty.
- Edit: `apps/api/src/__tests__/routes/portal-sql-handle.router.test.ts`, `__integration__/services/portal-sql-handle.integration.test.ts`, `config/swagger.config.test.ts` (the removed path).

**Steps**

1. **Tests (spec cases 7–11).**
   - Snapshot: same org and user gives 200; another org gives 404; same org but another user gives 404; a handle without `_userId`, same org, gives 200.
   - The stream route is gone: it's absent from `registeredRoutes(app)`, and a request gets an Express 404.

   Run; fail.
2. **Implement** the meta check; delete the route and the publish. Green. Also re-run any test that subscribed to the channel and remove those assertions.
3. Lint + type-check.

**Done when:** cases 7–11 pass, and no code references `streamChannelKey`.

**Risk:** a test that relied on the Pub/Sub publish. Grep the tests for `portal-sql:stream:` before deleting.

---

## Slice 3 — Portals are per-user

**Files**

- Edit: `apps/api/src/routes/portal.router.ts`, every route per the spec's Portals table:
  - the list uses `visibilityPredicate("portal")`;
  - create checks read on the station and the owned create;
  - get, running-jobs, patch, messages POST/DELETE and delete check read (404), then write or delete.
- Edit: `apps/api/src/services/portal.service.ts`: `addMessage(portalId, {role, content}, userId)` records the caller as `createdBy`. Update its callers.
- New or edit: `apps/api/src/__tests__/__integration__/routes/portal.router.integration.test.ts`.
- Edit: the `@openapi` blocks on the portal routes (403/404).

**Steps**

1. **Tests (spec cases 12–16).**
   - The member's list shows their own portals; the owner's shows all.
   - On the owner's portal, a member gets 404 on every route, and nothing is written (assert the rows are unchanged).
   - A member's own portal: success.
   - Another org: 404 everywhere.
   - Create on an unreadable station gives 404. A member creating on a readable station gives 200, with `createdBy` set to the member.

   Run; fail.
2. **Implement.** Green.
3. Lint + type-check.

**Done when:** cases 12–16 pass.

**Risk:** web unit tests that assume org-wide portal lists are unaffected, since the API shape doesn't change. The Dashboard and StationDetail just receive fewer rows for members (smoke covers this).

---

## Slice 4 — Close the three cross-tenant-by-id routes

Org checks, plus the child-belongs-to-parent check, before any write.

**Files**

- Edit: `apps/api/src/routes/field-mapping.router.ts`: `DELETE /:id` adds the org check (404 `FIELD_MAPPING_NOT_FOUND`).
- Edit: `apps/api/src/routes/entity-group-member.router.ts`: `PATCH`/`DELETE /:memberId` require `member.organizationId === org && member.entityGroupId === :entityGroupId`, else 404 `ENTITY_GROUP_MEMBER_NOT_FOUND`.
- Edit: `apps/api/src/routes/entity-tag-assignment.router.ts`: `DELETE /:assignmentId` requires `assignment.organizationId === org && assignment.connectorEntityId === :connectorEntityId`, else 404 `ENTITY_TAG_ASSIGNMENT_NOT_FOUND`.
- New or edit: the integration suites for field-mapping, entity-group-member and entity-tag-assignment.

**Steps**

1. **Tests (spec cases 21, 25, 26, 29).**
   - Field-mapping DELETE from another org gives 404, and the row is still there.
   - Group-member PATCH/DELETE with a member id from another group, or another org, gives 404, and nothing changes.
   - Tag-assignment DELETE with an id from another entity, or another org, gives 404, and the row is still there.

   Run; fail.
2. **Implement.** Green.
3. Lint + type-check.

**Done when:** those cases pass. No mutation in these three routers resolves an object without an org match.

**Risk:** none. Pure narrowing.

---

## Slice 5 — Toolpack and field-mapping permission checks

**Files**

- Edit: `apps/api/src/routes/toolpacks.router.ts`:
  - `POST` gets the class `write toolpack` check, run **before** the entitlement check;
  - `PATCH`/`refresh`/`rotate-signing-secret` check `resource.write`, and `DELETE` checks `resource.delete`, on `{type:"toolpack", id, createdBy}`, after `findByIdScoped`.
- Edit: `apps/api/src/routes/field-mapping.router.ts`:
  - `POST` checks read on the parent connector entity (404), then the owned `write field_mapping`;
  - `PATCH`/`DELETE` check the per-object write/delete;
  - the connector-capability 422 stays, after authorization.
- Integration suites: toolpacks, field-mapping.
- `@openapi` 403 on each.

**Steps**

1. **Tests (spec cases 17–20, 22–24).**
   - Toolpacks: a member's PATCH/DELETE/refresh/rotate gives 403, and the toolpack and secret are unchanged. The owner succeeds. Another org gets 404. A member's POST gives 403 even on an entitled tier.
   - Field mappings: a member's PATCH/DELETE on a mapping someone else made gives 403, and their own succeeds. POST under an unreadable entity gives 404; a member's POST under a readable one gives 200. The 422 still fires for an authorized caller.

   Run; fail.
2. **Implement.** Green.
3. Lint + type-check.

**Done when:** those cases pass.

**Risk:** the toolpack POST order change alters which error a non-entitled **owner** sees: still the entitlement error, because the owner passes the class check. The test covers both.

---

## Slice 6 — Child-row parent permissions, the creates, and the two body-org routes

(Amended during implementation: two routes trusted an `organizationId` from the request body. `POST /api/connector-instances` is fixed here, and `POST /api/jobs` is deleted here. See the spec.)

**Files**

- Edit: `apps/api/src/routes/entity-group-member.router.ts`: all three routes check read on the group (404), then `write entity_group`.
- Edit: `apps/api/src/routes/entity-tag-assignment.router.ts`: both check read on the entity (404), then `write entity`; POST also checks read on the tag (404 `ENTITY_TAG_NOT_FOUND`).
- Edit, the creates per the spec's Creates table:
  - `connector-instance.router.ts`: POST gets `getApplicationMetadata`, the caller's org (a differing body org is 403) and the owned create; the three draft helpers get the owned create;
  - `jobs.router.ts`: **delete** `POST /` and its `@openapi`; `apps/web/src/api/jobs.api.ts`: delete the unused `create`;
  - `connector-entity.router.ts`: POST checks read on the instance, then the owned create;
  - `entity-record.router.ts`: POST checks read on the entity, then the owned create;
  - `column-definition.router.ts`, `entity-group.router.ts`, `entity-tag.router.ts`: POST class create.
- Integration suites for each.
- `@openapi` 403/404 on each.

**Steps**

1. **Tests (spec cases 27, 28, 30–35).**
   - Group-member routes: a member without write on the group gets 403; the owner succeeds.
   - Tag-assignment: a member without write on the entity gets 403. A tag from another org gives 404. The owner succeeds.
   - A member creating a column definition, entity group or tag gets 403; the owner gets 200.
   - A member's connector-instance create and draft helpers are allowed, while a zero-grant custom role gets 403.
   - Creating an entity under an unreadable instance gives 404; a record under an unreadable entity gives 404.

   Run; fail.
2. **Implement.** Green.
3. Lint + type-check.

**Done when:** those cases pass.

**Risk:** the connector create workflows for members (FileUpload, Sheets, Excel, REST, Sandbox) must still work. Case 34, plus a smoke walk of one workflow as a member.

---

## Slice 6b — Cross-tenant gaps found by the inventory (amended)

**Files**
- **Delete** `routes/admin.router.ts`, its mount and its tests, the `MaintenanceStatusResponse` swagger component and the core `maintenance.contract`. Update the `CLAUDE.md`, copilot mirror and `apps/api/README.md` lines that cite `GET /api/admin/maintenance`.
- `routes/connector-entity.router.ts`: PATCH/DELETE get the org check (404 `CONNECTOR_ENTITY_NOT_FOUND`).
- `routes/api-endpoints.router.ts`: PATCH/DELETE require the endpoint's entity to be in the caller's org and on `:instanceId` (404).

**Tests:** connector-entity PATCH/DELETE of another org's entity by an owner gives 404 and it's unchanged; api-endpoint PATCH/DELETE with another org's entity id gives 404; `/api/admin/*` is no longer registered.

## Slice 6c — Same-org gaps: a member acting on another member's objects (amended)

**Files**
- A shared "the caller may write this connector instance" check (org + read → 404, write → 403), applied to:
  - API-endpoint create and discover-columns;
  - layout-plan interpret, PATCH and commit (per-instance router) and draft commit with an existing instance (`layout-plans.router.ts`);
  - Sheets/Excel authorize and select-sheet/workbook.
- File-upload confirm and parse: the upload must be the caller's.
- `PATCH /api/organization/:id`: `defaultStationId` needs an org-level permission, plus read on the station.
- Widget refresh: the message's portal must be accessible (`PortalAccessService`).
- Pin create: the source portal must be accessible.

**Tests:** for each route, a member acting on another member's object gets 404/403 and nothing is written; the owner and the member's own object succeed.

## Slice 7 — The route-authorization guard

**Files**

- New: `apps/api/src/__tests__/config/route-authorization.map.ts`: `ROUTE_AUTHORIZATION`, classifying **every** current mutation and SSE route:
  - `authorized`, naming its check;
  - `exempt`, with a reason (health, the Stripe webhook, public site-config, invitation accept, and so on).
- New: `apps/api/src/__tests__/config/route-authorization.test.ts`: the four checks plus a negative self-test (a stub app with an unclassified POST fails).
- Edit: `CLAUDE.md` → API Style Guide: a bullet saying every mutation and SSE route must authorize server-side and be classified in `ROUTE_AUTHORIZATION`. Mirror it in `.github/copilot-instructions.md`.

**Steps**

1. **Tests (spec cases 36–40).** Write the test with an empty map first. It fails, listing every unclassified route, and that output is the inventory.
2. **Classify** each route. Any route that turns out unguarded and isn't in #685's list gets fixed in this slice if trivial (with an integration case), or filed and marked `exempt: "tracked in #<n>"` and called out in the PR. It is never silently marked `authorized`. Green.
3. Lint + type-check.

**Done when:** cases 36–40 pass, and CLAUDE.md and its mirror carry the rule.

**Risk:** the inventory may surface more unguarded routes than discovery found. Step 2's rule keeps the guard honest without letting scope balloon unannounced.

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 | SSE caller resolution; turns run as the caller | spec 1–6 |
| 2 | Handle snapshot scoped; stream deleted | spec 7–11 |
| 3 | Portals per-user | spec 12–16 |
| 4 | Cross-tenant-by-id closed | spec 21, 25, 26, 29 |
| 5 | Toolpacks and field-mapping permission checks | spec 17–20, 22–24 |
| 6 | Child-row parents and creates | spec 27, 28, 30–35 |
| 7 | Route-authorization guard; CLAUDE.md rule | spec 36–40 |

## Cross-slice notes

- **Identities:** every new integration suite uses the `currentSub` pattern from `curated-view.router.integration.test.ts:28-47`: an owner (`seedUserAndOrg`), a member, and an other-org owner (`createOrganization` + `seedRbacForOrg`). Consider a shared helper in `__integration__/utils/application.util.ts` in slice 1, reused afterwards.
- **One `loadSet` per handler:** when a route checks read then write, load once and call `can` / `check` on the set. Don't call `PermissionService.check` twice.
- **Swagger:** `config/swagger.config.test.ts` route parity fails if a route is deleted without its `@openapi` (slice 2), or a new response is documented on a missing route. Update the docs in the same slice as the route.
- **No web change** is required by any slice: the response shapes are unchanged, and lists just shrink. Affordances are #684's job.
- **Doc sync:**
  - Slice 7 updates CLAUDE.md and its mirror.
  - Check `packages/core/src/content/faq.util.ts` and `glossary.util.ts` for any claim that portals are visible across the team, and update them in slice 3 if found (pinned results are the sharing path).
  - The egress surface (`docs/DEPLOYMENT_SECURITY_REVIEW.md`) is unchanged.

## Next step

Implementation begins on `fix/685-authorization-gaps` with slice 1, tests first, once discovery, spec and this plan are confirmed.
