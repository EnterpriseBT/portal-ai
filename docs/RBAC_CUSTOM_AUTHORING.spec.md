# RBAC custom roles, policies & groups (authoring) — Spec

The contract for [#622](https://github.com/EnterpriseBT/portal-ai/issues/622): the org-defined **custom** RBAC layer over the #598 system roles — a `group` principal + `groups`/`user_group` tables, custom policy/role/group CRUD, a statement-level permissions boundary, an enterprise-tier `customRbac` entitlement, and the "Access" Settings tab. Builds on `docs/RBAC_CUSTOM_AUTHORING.discovery.md` (this branch) + the shipped #598 engine / #620 multi-role / #621 grants.

## Key decisions (confirmed in discovery)

1. **Groups are a first-class principal** resolved in `loadSet` (D1). `POLICY_PRINCIPAL_TYPES` grows `group`; the caller's groups are gathered from `user_group` and pushed as `{principalType:"group"}` principals — `policyAttachments.findByPrincipals` + `permissionGrants.findByPrincipals` already iterate an arbitrary principal list, so resolution needs no other change.
2. **Custom policies are structured statement bundles** over the **full** vocabulary — every `PermissionVerb` and `PermissionResourceType` incl. `*`, optional instance `resourceId`, optional `condition`, and (via the verb×type vocab) every caller-capability action. **No restriction on what a policy may govern** (OQ1/OQ2) — an author can reproduce the system owner/admin policies.
3. **The one guardrail is a statement-level permissions boundary** (`assertStatementsWithinBoundary`, net-new): each authored `allow` must be covered by the **author's own** resolved set (deny statements always in-boundary), throwing `RBAC_POLICY_EXCEEDS_BOUNDARY`. This is the ticket's AC; it is what stops an admin self-authoring an owner-equivalent `* *` policy.
4. **A custom role is a named policy bundle** (D4) — a `roles` row `kind:"custom"` + role-principal `policy_attachments`; assignment reuses #620's multi-role UI.
5. **Authoring is gated by BOTH an enterprise-tier `customRbac` entitlement AND the owner/admin capability**, server-enforced (D3). The FE reads the entitlement to lock the Access tab; it is never the gate.
6. **Delete = cascade-soft-delete** of the entity + its attachment/membership rows (D6). System roles/policies (`kind:"system"`) are immutable (`RBAC_SYSTEM_IMMUTABLE`).
7. **On tier downgrade, existing custom config persists and keeps applying** (OQ3) — only authoring locks.
8. **Gate layering (the separation to preserve).** Two **orthogonal write-path gates** guard authoring — Gate A (org **entitlement** `customRbacEntitled`, `RBAC_CUSTOM_NOT_ENTITLED`) and Gate B (user **RBAC permission**: B1 capability `member.role.assign` + B2 statement **boundary** `assertStatementsWithinBoundary`) — all three required. The **read-path resolver is tier-blind**: once written, a custom policy/role/group is ordinary data that `loadSet`→`resolve` consumes exactly like a system rule, with **no entitlement or boundary re-check** at request time. This is why the boundary is enforced at authoring (not enforcement) and why downgrade (decision 7) keeps existing config applying for free. All gates are **server-enforced**; the Access tab reads entitlement+capability only to hide/lock (never the gate).

## Scope

### In scope
`groups` + `user_group` tables + `group` principal (schema, model, repos, `loadSet` resolution, `policy_attachments` CHECK alter); `assertStatementsWithinBoundary`; `customRbac` tier entitlement (column + `TierEntitlements` + `resolveTier` + `EntitlementService.customRbacEntitled` + FE hook); custom **policy** CRUD, custom **role** CRUD, **group** CRUD + membership (group- and member-centric) — all boundary-checked, entitlement+capability-gated, audited; the "Access" Settings tab (Roles / Policies / Groups authoring) + group assignment on Members; SDK domains + query keys.

### Out of scope
ABAC / parameterized `condition` statements beyond the two seeded ones (issue); the `views` entity + data-plane RBAC (#599); group **nesting** (OQ4); `customRbac` as a shaped/count-limited entitlement (OQ5 — boolean now).

## Surface

### Core — `packages/core/src/models/permission.model.ts`
- `POLICY_PRINCIPAL_TYPES` (`:130`) → `["user", "role", "group"] as const`. (Flows to the `policy_attachments`/`permission_grants` Drizzle `enum` columns automatically; `PolicyPrincipalTypeSchema` gains `group`.)
- Add **`GroupSchema`** = `CoreSchema.extend({ organizationId: z.string(), name: z.string().min(1), description: z.string().nullable() })` + `GroupModel`/`GroupModelFactory` (copy the `PolicyModel` pair). No `kind` — groups are always org-defined.
- Add **`UserGroupSchema`** = `CoreSchema.extend({ organizationId: z.string(), userId: z.string(), groupId: z.string() })` + Model/Factory.

### Core — `packages/core/src/contracts/rbac-authoring.contract.ts` (new)
```ts
// Statement editor row — the full vocabulary, no restriction (OQ1/OQ2).
PolicyStatementInputSchema = z.object({
  effect: PermissionEffectSchema,           // allow | deny
  verb: PermissionVerbSchema,               // read|write|delete|share|manage|invite|*
  resourceType: PermissionResourceTypeSchema, // station|…|billing|org|member|audit|*
  resourceId: z.string().nullable(),        // null = class-level
  condition: PermissionConditionSchema.nullable(),
});
PolicyUpsertRequestSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  statements: z.array(PolicyStatementInputSchema).min(1),
});
PolicyViewSchema = z.object({ id, name, kind: RbacKindSchema, description: z.string().nullable(),
  statements: z.array(PolicyStatementInputSchema) });
RoleUpsertRequestSchema = z.object({ name: z.string().min(1), policyIds: z.array(z.string()) });
RoleViewSchema = z.object({ id, name, kind: RbacKindSchema, policyIds: z.array(z.string()) });
GroupUpsertRequestSchema = z.object({ name: z.string().min(1), description: z.string().nullable().optional() });
GroupViewSchema = z.object({ id, name, description: z.string().nullable(), memberCount: z.number().int() });
GroupMembersSetRequestSchema = z.object({ userIds: z.array(z.string()) }); // set-the-set (group-centric)
MemberGroupsSetRequestSchema = z.object({ groupIds: z.array(z.string()) }); // set-the-set (member-centric)
// List responses: { policies: PolicyView[] } / { roles: RoleView[] } / { groups: GroupView[] }.
```
Exported from `contracts/index.ts`; each request/response registered in `swagger.config.ts`.

### Core — `packages/core/src/models/audit-log.model.ts:23`
Add to `AUDIT_ACTIONS`: `"policy.create"`, `"policy.update"`, `"policy.delete"`, `"role.create"`, `"role.update"`, `"role.delete"`, `"group.create"`, `"group.update"`, `"group.delete"`, `"group.member.add"`, `"group.member.remove"`, `"policy.attach"`, `"policy.detach"`.

### Core — `packages/core/src/models/tier.model.ts:70`
`TierEntitlementsSchema` gains `customRbac: z.boolean()`. (Mirror `customToolpacks`; flows into `TierPolicy.entitlements`, the usage endpoint's `tier.entitlements`, and the `TierSchema`/`type-checks` row mirror.)

### API — `apps/api/src/db/schema/` (new + alters)
- **`groups.table.ts`** (new) — `pgTable("groups", { ...baseColumns, organizationId (FK organizations.id, notNull), name (notNull), description (text, nullable) }, …)` with `uniqueIndex("groups_org_name_unique").on(org, name).where(sql\`deleted IS NULL\`)` (mirror `roles.table.ts:24`).
- **`user-group.table.ts`** (new) — `pgTable("user_group", { ...baseColumns, organizationId (FK), userId (notNull), groupId (FK groups.id, notNull) }, …)` with `uniqueIndex("user_group_unique").on(userId, groupId).where(sql\`deleted IS NULL\`)` + `index` on `(organizationId, userId)` (the `loadSet` lookup).
- **`policy-attachments.table.ts:37`** — alter the CHECK to `IN ('user', 'role', 'group')` (migration; the `enum` column type updates from the core const).
- **`tiers.table.ts:62`** — add `customRbac: boolean("custom_rbac").notNull().default(false)` (mirror `custom_toolpacks`, fail-closed).
- **Register both new tables at all six points**: `zod.ts` (createSelect/Insert), `type-checks.ts` (bidirectional `IsAssignable` for Group/UserGroup + Tier row now carrying `custom_rbac`), `schema/index.ts`, `repositories/index.ts`, `db.service.ts`.

### API — repositories (`apps/api/src/db/repositories/`)
- **`groups.repository.ts`** (new) — `findByOrganizationId`, `findById`, `findByName`, `create`, `update`, `softDelete`.
- **`user-groups.repository.ts`** (new) — `findGroupIdsByUser(userId, orgId)` (the `loadSet` gather), `findUserIdsByGroup(groupId)`, `setGroupMembers(groupId, userIds, orgId, actor, tx)` + `setUserGroups(userId, groupIds, orgId, actor, tx)` (idempotent set-the-set diff → soft-delete removed + create added, unique-partial makes re-add a no-op), `hardDeleteByGroup`/`softDeleteByGroup`.
- Extend **`policy-attachments.repository.ts`** with `setPoliciesForRole(roleId, policyIds, …)` (set-the-set), `softDeleteByPolicyId`, `softDeleteByPrincipal(principalType, principalId)` (the group/role cascade).
- Extend **`permission-statements.repository.ts`** with `replaceForPolicy(policyId, statements, …)` (delete existing + insert new, in a tx).
- Extend **`roles.repository.ts`** / **`permission-policies.repository.ts`** with `create`/`update`/`softDelete` (guarded to `kind:"custom"` at the service).

### API — engine
- **`permission.service.ts` `loadSet` (`:88`)** — after the role-principal loop, gather the caller's group ids (`repo.userGroups.findGroupIdsByUser(ctx.userId, ctx.organizationId)`) and push a `{principalType:"group", principalId}` per group **before** the `findByPrincipals` call. No other change (grants + attachments both iterate `principals`).
- **`permission-set.ts`** — add net-new:
  ```ts
  assertStatementsWithinBoundary(
    statements: EffectiveStatement[],
    resolveCreatedBy: (resourceType: string, resourceId: string) => Promise<string | null>,
  ): void   // async — instance statements resolve the target object's createdBy
  ```
  For each `effect==="allow"` statement, expand `verb==="*"` → the six concrete verbs (and, class-level only, `resourceType==="*"` → the concrete resource types), then probe the author's own set via the private `resolve`/`matches`. **Two modes, keyed on `resourceId`:**
  - **Instance-level (`resourceId` set) — ownership-aware.** Look up the target object's real `createdBy` via `resolveCreatedBy(resourceType, resourceId)`; a `null` (object absent / type not resolvable yet, e.g. `view` pre-#599) **rejects**. For each concrete verb require `resolve({ verb, resourceType, resourceId, createdBy: <the object's real createdBy> })` === `"allow"`. This is the same probe #621 sharing uses, so an author who **created** the object (covered by `created_by_caller`) — or holds class-level access — can grant instance access to it. Instance statements carry **no `condition`** (the `resourceId` pins the object; ownership comes from the real row).
  - **Class-level (`resourceId` null) — breadth-aware.** `createdBy` = `ctx.userId` for `created_by_caller`, `SystemUtilities.id.system` for `created_by_system`, else a `SENTINEL_UID` (neither — so only an *unconditional* author allow covers an unconditional authored class allow, not an ownership-scoped one). Probe every `(verb, resourceType)` with a `SENTINEL_ID` resourceId.

  The first uncovered probe throws `ApiError(403, RBAC_POLICY_EXCEEDS_BOUNDARY, …)`. `deny` statements always pass (restricting is in-boundary). Deny-override is free from `resolve` (an author's `deny manage billing` correctly voids authoring `allow * *`). The `resolveCreatedBy` callback is supplied by `PolicyService` as a per-`resourceType` object lookup (`station`→`stations`, `pin`→`portalResults`, `portal`→`portals`, `entity`/`entity_record`/`field_mapping`/`connector_instance`→their repos; `view`→#599), mirroring `GrantService.resolveObject` — the engine stays free of repo imports.

### API — `apps/api/src/services/entitlement.service.ts:157`
Add `static async customRbacEntitled(organizationId): Promise<boolean>` → `(await resolvePolicy(organizationId)).entitlements.customRbac` (mirror `customPacksEntitled`). `TierService.resolveTier` (`tier.service.ts:60`) copies `custom_rbac` → `entitlements.customRbac` (fail-closed default false).

### API — `apps/api/src/constants/api-codes.constants.ts`
Add: `RBAC_POLICY_EXCEEDS_BOUNDARY` (403), `RBAC_SYSTEM_IMMUTABLE` (403, edit/delete a system role/policy), `RBAC_CUSTOM_NOT_ENTITLED` (403, org tier lacks `customRbac`), `POLICY_NOT_FOUND` (404), `ROLE_NOT_FOUND` (404), `GROUP_NOT_FOUND` (404), `RBAC_NAME_CONFLICT` (409, per-org name collision).

### API — services (`apps/api/src/services/`, new; `GrantService` is the template)
- **`PolicyService`** — `create/update/delete/list/get`. `create`/`update`: entitlement (`customRbacEntitled`) + capability (`member.role.assign`) gate → `loadSet(caller).assertStatementsWithinBoundary(statements)` → tx (upsert policy `kind:"custom"` + `statements.replaceForPolicy`) → `policy.create`/`policy.update` audit. `update`/`delete` reject `kind:"system"` (`RBAC_SYSTEM_IMMUTABLE`). `delete`: tx soft-delete policy + `policyAttachments.softDeleteByPolicyId` (cascade) → `policy.delete`.
- **`RoleService`** — `create/update/delete/list/get`. `create`/`update` set the role's attached policies (`policyAttachments.setPoliciesForRole`) + `policy.attach`/`policy.detach` audit per diff; `delete` cascades `user_role` + role-principal attachments soft-delete. System-role guard.
- **`GroupService`** — `create/update/delete/list/get` + `setMembers(groupId, userIds)` / `setGroups(userId, groupIds)`. `delete` cascades `user_group` + group-principal attachments. Membership writes emit `group.member.add`/`remove` per diff. All gated (entitlement + capability).

### API — routes (`apps/api/src/routes/`, new; mounted in `protected.router.ts`)
- **`policy.router.ts`** — `GET/POST /api/policies`, `GET/PUT/DELETE /api/policies/:id`.
- **`role.router.ts`** — `GET/POST /api/roles`, `GET/PUT/DELETE /api/roles/:id`.
- **`group.router.ts`** — `GET/POST /api/groups`, `GET/PUT/DELETE /api/groups/:id`, `GET/PUT /api/groups/:id/members` (group-centric set-the-set).
- **`organization.router.ts`** — add `PUT /api/organization/members/:userId/groups` (member-centric set-the-set, mirrors the #620 `…/roles` route at `:433`).
- **`rbac-object-search.router.ts`** (new) — `GET /api/rbac/objects?resourceType=&search=&limit=&offset=` → `{ objects: [{ id, label }] }`, powering the statement editor's instance picker (no hand-entered ids). Gated on the entitlement + capability. **Visibility-scoped:** for the given `resourceType` it queries that type's repo with a human-readable `label` column `ILIKE %search%` **AND** `set.visibilityPredicate(resourceType, …)` from `loadSet(caller)`, so an author only ever sees objects they can grant. **Every pickable type already carries a searchable label** (audited): `station`/`pin`(`portal_results`)/`portal`/`connector_instance` use `name`; `entity`(`connector_entities`) uses `label`; `field_mapping` has none, so its label is **derived** (`<sourceField> → <targetField>`, no new column); `view`→#599. Pseudo-resources (`billing`/`org`/`member`/`audit`) + `*` return no candidates (instance grants don't apply). **`entity_record` is intentionally not enumerated here** — naming/indexing individual data rows across a multi-million-row table is #599's data-plane concern (views + data-attribute slicing); in #622 `entity_record` statements are **class-level only** (e.g. `allow read entity_record created_by_caller`), never instance-picked. (General convention holds: every *management-plane* record has a searchable human-readable name today; the only gap, data rows, is deferred to #599 by design, not by omission.)
- Every handler: `@openapi` block, thin intake/validate/shape, all authz in the service. Each mutating route is behind the entitlement + owner/admin capability.

### Web — SDK + Access tab (`apps/web/src/`)
- **`api/policies.api.ts` / `roles.api.ts` / `groups.api.ts`** (new) — `list/get/create/update/remove` (+ groups `setMembers`, members `setGroups`) via `useAuthQuery`/`useAuthMutation` (template: `grants.api.ts`, `members.api.ts`). Registered in `sdk.ts`; keys in `keys.ts` (`policies`/`roles`/`groups` roots).
- **`api/rbac-objects.api.ts`** (new) — `search(resourceType, query)` for the instance picker, an async-search hook feeding an `AsyncSearchableSelect` (the one hand-rolled `useAuthFetch` label-map pattern the SDK reserves for search selects, per `utils/api.util.ts`). Returns `{id, label}[]`.
- **`utils/routes.util.ts:39`** — `SettingsTab.Access = "access"`; `SETTINGS_TAB_INDEX` appends `Access: 5` (0–4 unchanged for deep-link stability).
- **`utils/use-custom-rbac-entitled.util.ts`** (new) — `useCustomRbacEntitled(): boolean` reading `usageResult.data?.tier?.entitlements?.customRbac ?? false` (mirror `use-builtin-entitlements.util.ts:35`), fail-open→false.
- **`views/Settings.view.tsx`** — render the Access `<Tab>`/`<TabPanel>` only when `useCapabilities().can("member.role.assign") && useCustomRbacEntitled()`; when the capability holds but the entitlement doesn't, the tab shows a locked/upgrade state (not hidden).
- **Access-tab module** (`modules/AccessAuthoring/` per the Module Pattern) — Roles / Policies / Groups sub-nav, each a list + a create/edit dialog. The **policy statement editor** is a pure-UI row editor: `effect × verb × resourceType` selects over the core enums, then a **scope** choice — *class-level* (shows the `condition` select: none / created-by-caller / created-by-system) or *specific objects*. For *specific objects* the row renders an **`AsyncSearchableSelect` (multi)** sourced from `sdk.rbacObjects.search(resourceType, q)` — the author searches by **name/label and never types an id**; picking N objects **materializes N `PolicyStatementInput` rows** (one `resourceId` each, same effect/verb/type, `condition: null`). The picker is disabled for pseudo-resources + `entity_record` (class-level only) and empty until a `resourceType` is chosen. Server `RBAC_POLICY_EXCEEDS_BOUNDARY` surfaces via `FormAlert`. System roles/policies render read-only (no edit/delete affordance). Group assignment also added to the Members tab (member-centric).

## Migration + Seed

- **`npm run db:generate -- --name add_groups_and_user_group`** — creates `groups` + `user_group` (create-only), alters the `policy_attachments` principal-type CHECK to admit `group`, and adds `tiers.custom_rbac` (default false). All non-destructive; commit the `.sql` + `_journal.json` + snapshot together.
- **No data backfill** — no custom policies/roles/groups exist pre-feature; `custom_rbac` defaults false so every existing tier is fail-closed until the tier catalog (`portalops tier apply`) sets it. The `policy_attachments` CHECK alter is a no-op for existing `user`/`role` rows.
- **No seed change** — system policies are unchanged; `SEED_SYSTEM_POLICIES` stays the only system writer.

## TDD test plan

### Core — `packages/core/src/__tests__/{models/permission.model.test.ts, models/tier.model.test.ts, models/audit-log.model.test.ts, contracts/rbac-authoring.contract.test.ts}`
`POLICY_PRINCIPAL_TYPES` includes `group`; `GroupSchema`/`UserGroupSchema` round-trip; `TierEntitlementsSchema` requires `customRbac`; the 13 new `AUDIT_ACTIONS`; the authoring contracts accept valid + reject bad `effect`/`verb`/`resourceType`, and `PolicyUpsertRequest` requires ≥1 statement. ~14 cases.

### API unit — `apps/api/src/__tests__/services/permission-set.test.ts`
`assertStatementsWithinBoundary`: **class-level** — an owner set (`* *`) authorizes any statement incl. `allow * *`; an admin set (`* *` minus `deny manage billing`) is rejected for `allow * *` and `allow manage billing` but allowed for `allow read station` + an admin-equivalent bundle; a member set authorizes `allow read station created_by_caller` but rejects the unconditional `allow read station`; `deny` statements always pass. **Instance-level** (via the injected `resolveCreatedBy`) — an author who created object X can author `allow read station:X` (probe uses X's real `createdBy` = the author → `created_by_caller` covers); a member with only own-scoped access is **rejected** for an instance they didn't create; a class-level author-allow covers any instance; an unresolvable/absent object rejects. Wildcard expansion + condition→createdBy + instance-createdBy probes asserted. ~14 cases.

### API integration — `apps/api/src/__tests__/__integration__/{services/permission-loadset.integration.test.ts, db/repositories/{groups,user-groups}.repository.integration.test.ts, routes/{policy,role,group}.router.integration.test.ts, services/entitlement.service.integration.test.ts}`
`loadSet` unions a group principal's policies (a member in a group with an `allow read view:x` policy resolves it); repo set-the-set idempotency + soft-delete cascade; **policy API**: create bounded/rejected-over-boundary/system-immutable/name-conflict/not-entitled, update replaces statements, delete cascades attachments; **role API**: create bundles policies, delete cascades `user_role`; **group API**: CRUD + group-centric + member-centric membership set-the-set + delete cascades `user_group` + attachments, membership audit; **entitlement**: `customRbacEntitled` true/false by tier; every mutation writes its audit action. ~34 cases.

### API — migration
A migration integration test (mirror an existing schema test): after the migration a `group`-principal `policy_attachments` row inserts (CHECK admits it) and a `user`/`role` row still inserts; `tiers.custom_rbac` defaults false. ~2 cases.

### Web — `apps/web/src/__tests__/` + module `__tests__/`
Statement-editor UI: a *class-level* row emits one `PolicyStatementInput` with the chosen `condition`; a *specific-objects* row with the `AsyncSearchableSelect` (multi) picking N objects emits **N** instance `PolicyStatementInput`s (one `resourceId` each, `condition: null`); the picker is disabled for `entity_record`/pseudo-resources; server `RBAC_POLICY_EXCEEDS_BOUNDARY` shows via `FormAlert`. The policy/role/group create dialogs follow the Dialog & Form Test Checklist; a system role/policy renders read-only (no edit/delete); the Access tab renders only with capability + entitlement and shows the locked state when entitlement is absent; `useCustomRbacEntitled` reads the flag fail-open. ~18 cases.

### API integration — `apps/api/src/__tests__/__integration__/routes/rbac-object-search.router.integration.test.ts`
The instance picker's search: visibility-scoped candidates by `resourceType` (a member sees only their own stations; owner/admin see all) with `ILIKE` name/label match; `field_mapping` returns a derived `source → target` label; `entity_record` + pseudo-resources return no candidates; entitlement + capability gated. ~6 cases.

**Totals ≈ 88 cases** (core 14 · unit 14 · integration 40 · migration 2 · web 18). Run via `npm run test:unit` / `npm run test:integration` per package (never raw jest).

## Acceptance criteria

- An admin can create a **bounded** custom policy, a custom role bundling it, and a group, assign them, and a member's effective access reflects them (a group's `allow read view:<id>` reaches every current member).
- The boundary **rejects** a custom policy granting access the author lacks (`RBAC_POLICY_EXCEEDS_BOUNDARY`); an author who holds a permission (incl. an owner holding `* *`) can author it.
- System roles/policies cannot be modified or deleted (`RBAC_SYSTEM_IMMUTABLE`); they render read-only.
- A group's policies apply to every current member; removing a member (either endpoint) removes that inheritance on the next `loadSet`.
- Deleting a custom policy/role/group cascade-soft-deletes its attachment/membership rows — no dangling attachments, effective access recomputes.
- Authoring requires the `customRbac` entitlement **and** owner/admin; a downgraded org keeps its existing custom config applying but cannot author (the Access tab shows the locked state).
- Instance-level statements are authored by a **searchable multiselect of object names** (never a typed id), visibility-scoped to what the author can see; an author who created an object can grant on it, one statement per picked object.
- Every authoring + assignment mutation is audited.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| Boundary bug lets an admin self-escalate | `assertStatementsWithinBoundary` reuses the proven `resolve`/`matches` (deny-override free); dedicated unit cases for owner/admin/member author sets incl. wildcard + billing-deny. **Fail-closed** — an uncovered probe denies. |
| Group resolution N+1 in `loadSet` | one indexed `findGroupIdsByUser` read; principals batched into the existing `findByPrincipals`. |
| Entitlement mis-resolves and unlocks authoring | `customRbac` defaults **false** fail-closed; server-enforced on every mutation (not FE). |
| Downgrade strips access | Decided persist-and-apply (OQ3); only authoring gates — no effective-access change on a billing event. |
| CHECK alter blocks existing rows | The new CHECK is a superset (`+group`); every existing `user`/`role` row still satisfies it. |

**Rollback:** revert the routers/services/UI; `git revert` the migration is safe (the `groups`/`user_group` tables drop with no custom rows pre-feature; the `policy_attachments` CHECK narrows back with no `group` rows to violate it; `tiers.custom_rbac` is additive). No seed change to undo.

## Files touched

**New:** `groups.table.ts`, `user-group.table.ts`, `groups.repository.ts`, `user-groups.repository.ts`, `policy.router.ts`, `role.router.ts`, `group.router.ts`, `rbac-object-search.router.ts` (+ its per-type resolver, shared with the boundary's `resolveCreatedBy`), `PolicyService`/`RoleService`/`GroupService`, `packages/core/src/contracts/rbac-authoring.contract.ts`, web `api/{policies,roles,groups,rbac-objects}.api.ts` + `utils/use-custom-rbac-entitled.util.ts` + `modules/AccessAuthoring/`, the migration.
**Edit:** `permission.model.ts` (principal types + Group/UserGroup models), `tier.model.ts` (`customRbac`), `audit-log.model.ts`, `contracts/index.ts`, `policy-attachments.table.ts` (CHECK) + `.repository.ts`, `permission-statements.repository.ts`, `roles.repository.ts`, `permission-policies.repository.ts`, `tiers.table.ts`, `permission.service.ts` (`loadSet`), `permission-set.ts` (`assertStatementsWithinBoundary`), `entitlement.service.ts`, `tier.service.ts`, `api-codes.constants.ts`, `swagger.config.ts`, `protected.router.ts`, `organization.router.ts` (member groups), `db/schema/{index,zod,type-checks}.ts`, `repositories/index.ts`, `db.service.ts`, web `sdk.ts`/`keys.ts`, `utils/routes.util.ts`, `views/Settings.view.tsx` + Members tab.

## Next step

`/plan 622` slices this on this branch, roughly: (1) `groups`/`user_group` schema + `group` principal in `loadSet` + the CHECK/tier migration (engine sees groups, un-wired); (2) `assertStatementsWithinBoundary` + `customRbac` entitlement; (3) policy CRUD API (boundary + audit + gates); (4) role CRUD API; (5) group CRUD + membership API (both endpoints); (6) the Access-tab UI + statement editor + Members group assignment — each behind a green suite.

## Amendment — assignment surfaces (post-smoke, #622)

The #622 smoke walk found that the spec's "assignment reuses #620's multi-role UI" (key decision 4) was not actually wired, and the member-centric group surface (§ Frontend, spec above) had shipped no UI. Both were built in-branch; the contract landed as:

- **`roles.slug`** — a stable, per-org assignment key (migration `0109_add-roles-slug`, backfilled from `name`; system role slugs == their names). A role is **assigned by slug**, never by opaque id, so a rename never breaks an assignment. `RoleSchema`/`RoleView`/`RoleRef` carry `slug`.
- **`MemberRolesSetRequest` is `{ roleSlugs: string[] }`** (was `{ roles: OrgRole[] }`). `SeatService.setMemberRoles` resolves each slug → role, diffs by role id, and keeps the owner-only + last-owner guards on the **system** roles while treating custom roles as free additive grants; a member must retain **≥1 system role** (the `organization_users.role` enum mirror stays defined). The #620 Members multiselect lists custom roles alongside owner/admin/member.
- **`MemberListResponse.assignableRoles: RoleRef[]`** — the multiselect's options (system always; custom when authored), so it needs no entitlement-gated fetch. **`Member.roleSlugs`** is the member's complete role set; **`Member.groupIds`** + `sdk.members.setGroups` + a `customRbac`-gated **Groups column** provide the member-centric group assignment.

Slug validity is **not** gated at the Zod edge (any non-empty string parses); the service resolves it against the org's roles (400 on an unknown slug). All of the above is boundary/entitlement-gated on the same routes as before — the gate layering (decision 8) is unchanged.
