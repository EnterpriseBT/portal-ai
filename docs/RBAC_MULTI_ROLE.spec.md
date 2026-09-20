# RBAC multi-role: user_role join + enum cutover — Spec

Pins the contract for replacing the single-role `organization_users.role` enum with a `user_role` many-to-many join, capability-based FE gating, and the role-set assignment API. **Discovery:** `docs/RBAC_MULTI_ROLE.discovery.md`. **Issue:** [#620](https://github.com/EnterpriseBT/portal-ai/issues/620) (epic #578). Builds on shipped **#598** (RBAC engine: `roles`/`policy_attachments` + `PermissionSet`/`loadSet`) and **#584/#585** (seats/members).

## Key decisions (from discovery — confirm captured)

1. **`user_role {userId, organizationId, roleId}`** (D1), unique `(userId, org, roleId) WHERE deleted IS NULL` (a role can't be assigned twice). Role `name` uniqueness is the existing `roles` `(org,name)` constraint (#598).
2. **`ctx.role` → `ctx.roles: OrgRole[]`** (D2); `loadSet` gathers one role principal per role (the engine already unions — deny-wins).
3. **FE gates on a server-computed `capabilities` map, not role names** (D2b) — `isOwner`/`isAdmin`/`primaryRole` are **deleted**. `roles[]` is display-only.
4. **Display** (D2c): Members role column → `roles[]` chips (render `name`/slug); Settings → Profile "Your roles" (groups deferred to #622).
5. **Guards:** ≥1 role (can't strip the last role); last-owner (can't remove the owner role from / remove the last owner).
6. **Enum kept as a vestigial "primary role" mirror** (D6), written app-side, never read for authz, dropped in a follow-up.

## Scope

### In scope
- `user_role` table + dual-schema + repository; the remap data migration (+ backfill marker).
- Reads cutover: middleware `ctx.roles`, `loadSet`, current-org selector, `listMembers`.
- Writes cutover: set-roles endpoint + guards, all membership-creation sites, the enum mirror, audit.
- Contract: `current()` → `roles[]` + `capabilities`; member list → `roles[]`; set-roles request.
- FE: `useCapabilities()`, Members multi-role column + editor, Settings → Profile roles.

### Out of scope
- **Groups + `user_group`, custom roles + authoring** → **#622** (incl. group/user_group uniqueness).
- **Dropping the `organization_users.role` column** → follow-up expand-only migration.
- Object grants / sharing → **#621**.

## Surface

### Core models & contracts — `packages/core`

**`models/permission.model.ts`** (extend) — the capability-action vocabulary the FE gates on:
```ts
export const CALLER_CAPABILITY_ACTIONS = [
  "billing.manage", "org.delete", "org.audit.read",
  "member.role.assign", "member.invite", "member.remove",
] as const;
export const CapabilityMapSchema = z.record(
  z.enum(CALLER_CAPABILITY_ACTIONS), z.boolean()
);
export type CapabilityMap = z.infer<typeof CapabilityMapSchema>;
```

**`models/user-role.model.ts`** (new) — `CoreSchema.extend({ userId: z.string(), organizationId: z.string(), roleId: z.string() })` + `UserRoleModel`/`Factory` (mirrors `organization-user.model.ts`).

**`contracts/organization.contract.ts`** (change) — `OrganizationGetResponseSchema`:
```ts
// was: role: OrgRoleSchema
roles: z.array(OrgRoleSchema),        // display; source = user_role
capabilities: CapabilityMapSchema,    // gating; server-computed via PermissionSet.can
```
`MemberRoleUpdateRequestSchema` → **`MemberRolesSetRequestSchema = z.object({ roles: z.array(OrgRoleSchema).min(1) })`** (`.min(1)` is the ≥1-role guard at the schema edge). Response `{ member: { userId, roles: OrgRoleSchema.array() } }`.

**Members list contract** (the #585 member item) — `role: OrgRoleSchema` → **`roles: z.array(OrgRoleSchema)`** per member.

**`models/audit-log.model.ts`** — add `member.role.add`, `member.role.remove` to `AUDIT_ACTIONS` (replacing sole reliance on `member.role.change`; keep the latter for compatibility of existing rows).

### Drizzle — `apps/api`

**`db/schema/user-role.table.ts`** (new, `baseColumns` + org FK; `entity-tags` template):
```
userId → users.id, organizationId → organizations.id, roleId → roles.id
uniqueIndex user_role_unique (userId, organizationId, roleId) WHERE deleted IS NULL
index user_role_user_org (userId, organizationId)
```
+ drizzle-zod in `zod.ts`, `IsAssignable` guards in `type-checks.ts`, `UserRolesRepository` (`findByUserOrg(userId,org)`, `findByUserOrgWithNames` (⋈ roles → names), `countByRole(org, roleName)`, insert/softDelete), registered on `DbService.repository`. Add to `teardownOrg` FK-cascade.

### Engine + context — `apps/api`

- **`permission.service.ts`:** `PermissionContext.role: OrgRole` → `roles: OrgRole[]`. `loadSet` (`:79`) pushes one `{principalType:"role", principalId: role.id}` per name in `ctx.roles` — add **`RolesRepository.findByNames(org, names[])`** (`roles.repository.ts`) to resolve them in one query. Empty roles ⇒ empty set ⇒ fail-closed (unchanged).
- **`middleware/metadata.middleware.ts` (`:93,:130`):** set `metadata.roles` from `userRoles.findByUserOrgWithNames(userId, org)` (was `organizationUser.role`). `types/express.d.ts:49` `role: OrgRole` → `roles: OrgRole[]`.
- **Capability computation** — a helper `PermissionService.capabilities(ctx): Promise<CapabilityMap>` = `{ [a]: (await loadSet(ctx)).can(a) for a in CALLER_CAPABILITY_ACTIONS }` (one `loadSet`, N in-memory `can`).

### Routes/services — `apps/api`

- **`current()`** (`organization.router` / `billing.router:57`, the current-org payload): return `roles` (from middleware) + `capabilities` (the helper).
- **`PUT /api/organization/members/:userId/roles`** (replaces `PATCH …/role` `:407-495`): validate `MemberRolesSetRequest`; `check(ctx,"member.role.assign")`; diff desired vs current `user_role`; **preserve the rules**: owner role add/remove requires `ctx.roles.includes("owner")` (was `ctx.role!=="owner"` `:460`), the target's own-owner immutability becomes "can't remove the last owner role" (last-owner guard, below); insert added / soft-delete removed rows in a tx; **≥1-role** (reject empty) + **last-owner** guards inside the tx; write the enum mirror (highest of the resulting set); audit `member.role.add`/`.remove` per change. `@openapi` updated.
- **`seat.service.ts`:** `removeMember` last-owner guard (`:413-427`) → `userRoles.countByRole(org,"owner")`; `listMembers` (`:161`) returns `roles[]` per member (⋈ user_role); `attachMembership`/accept paths insert a `user_role` row (+ enum mirror) instead of setting the enum.
- **`application.service.ts`:** org creation (`:548` owner) + member creation (`:469`) insert the `user_role` row in the same tx; `getCurrentOrganization`/`switchOrganization` derive `roles` from `user_role` (still selecting the membership by `lastLogin`).
- **`ApiCode`:** `MEMBER_MIN_ONE_ROLE` (reject removing the last role), `LAST_OWNER_ROLE_REMOVAL` (reject removing the owner role from the last owner). `LAST_OWNER_REMOVAL` stays for member removal.

### Frontend — `apps/web`

- **`utils/use-role.util.ts` → `useCapabilities()`**: `{ roles: OrgRole[], capabilities: CapabilityMap, can(a): boolean, rolesKnown }` — `can = (a) => capabilities?.[a] ?? false`. **Delete `isOwner`/`isAdmin`/`isAdminOrOwner`.**
- **Consumers:** `Settings.view.tsx` (Members/Activity tab gates → `can("member.role.assign")`/`can("org.audit.read")`; owner-only controls → `can("billing.manage")`/`can("org.delete")`), `SubscriptionBilling`/`TierCard` (`isOwner` → `can("billing.manage")`), `MembersTab` (`callerRole` → the capability + `roles`).
- **`MemberList.component.tsx`:** role column → `roles[]` chips (render name); the per-member editor → a **multi-select** of roles (gated by `can("member.role.assign")`; owner add/remove owner-only) → `sdk.members.setRoles(userId, roles)`.
- **Settings → Profile:** a "Your roles" section listing `roles` (a "Your groups" placeholder, populated by #622).
- **SDK:** `sdk.members.setRoles` (`PUT …/roles`) replacing `changeRole`; `current()` returns `roles`+`capabilities`; invalidate `queryKeys.members.root` + `organizations` on setRoles.

## Migration

`cd apps/api && npm run db:generate -- --name add_user_role` (the table). Then a **data migration** `NNNN_backfill-user-roles.sql`: for every live `organization_users` row, insert `user_role(id='sysur:'||user_id||':'||org||':'||role, user_id, org, role_id='sysrole:'||org||':'||role)` — `INSERT … SELECT … FROM organization_users WHERE deleted IS NULL … ON CONFLICT DO NOTHING`, deterministic ids matching the seed. Carries a **`-- backfill:user-role`** marker (the coverage guard). Forward-only, expand-only; the enum column is **not** dropped here.

## Seed

`seed.service.ts` `seedRbacSystemPolicies` (or the owner-membership creation in `application.service`) also inserts the owner's `user_role` row at provisioning, so a new org's owner resolves roles without the backfill. Idempotent (the unique index).

## TDD test plan

`cd packages/core && npm run test:unit`; `cd apps/api && npm run test:unit && npm run test:integration`; `cd apps/web && npm run test:unit`.

### Core
1. `UserRoleSchema` round-trips; `CapabilityMapSchema` accepts the known actions, rejects unknown; `MemberRolesSetRequestSchema` rejects empty `roles`.
2. `OrganizationGetResponseSchema` requires `roles[]` + `capabilities`.

### API — unit
3. `PermissionService.capabilities(ctx)` returns the map (each action = `PermissionSet.can`), mocked loadSet.

### API — integration
4. `user_role` repo round-trip + **unique `(userId,org,roleId)`** rejects a duplicate live row (re-assign no-op).
5. `loadSet` with **two roles** resolves the union of both roles' policies (a member+admin user gets admin capabilities); single-role users resolve **identically to pre-#620** (parity).
6. **Backfill:** seed a membership pre-migration, run it, assert a `user_role` row → the right seeded role.
7. `PUT …/roles` set-the-set: adds/removes to match; **≥1-role** rejects empty (`MEMBER_MIN_ONE_ROLE`); **last-owner** rejects removing the last owner's owner role (`LAST_OWNER_ROLE_REMOVAL`); owner add/remove owner-gated; audits `member.role.add/remove`.
8. `removeMember` last-owner guard via `user_role` count (still 409 on the last owner).
9. `current()` returns `roles[]` + a correct `capabilities` map for owner/admin/member; `listMembers` returns `roles[]`.
10. Provisioning: a new org's owner has a `user_role` row (owner) + resolves owner capabilities.

### Web
11. `useCapabilities()` maps `capabilities` → `can`; gates render on `can(...)` (mocked `current()`); no `isOwner` references remain.
12. `MemberList` renders `roles[]` chips + the multi-select set-roles flow (gated); Settings → Profile shows roles.

**Totals ≈ 2 core + 1 api-unit + 7 api-integration + 2 web ≈ 12 cases**, plus the migration probe (6).

## Acceptance criteria

- A user can hold ≥2 roles; effective permissions = the union (test 5); single-role users unchanged.
- Every existing membership is remapped to `user_role` with identical access (backfill, test 6); a new org's owner is provisioned with a `user_role` (test 10).
- The FE gates entirely on `capabilities` — **no `isOwner`/`isAdmin`/`primaryRole`**; custom roles (future) that grant an action flip the capability.
- Members role column + Profile show `roles[]` by name; set-roles enforces ≥1-role + last-owner + owner-gating.
- Role name unique per org; a role can't be assigned to a user twice.
- `npm run lint && type-check` clean; existing suites green.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| Cutover lockout — a membership resolves no roles → fail-closed denies. | Backfill remaps every row (test 6); provisioning seeds the owner (test 10); the ≥1-role guard prevents stripping. |
| Parity drift — a single-role user resolves differently. | Test 5 asserts single-role parity; `loadSet` union is additive. |
| Missed `role` reader still reads the (now-mirror) enum. | The enum is mirrored to the highest role, so a stray reader degrades gracefully; the discovery enumerates every reader — each migrated + a repo grep gate. |
| Set-roles race leaves 0 owners / 0 roles. | Guards re-checked **inside the tx** (owner count, non-empty); unique index blocks dup rows. |

**Rollback:** revert the migration (drop `user_role`) + `git revert`; the enum mirror still holds each membership's (primary) role, so the pre-#620 single-role path resolves. No data loss.

## Files touched

- **core:** new `models/user-role.model.ts`; edit `models/permission.model.ts` (+capability actions), `models/audit-log.model.ts` (+actions), `contracts/organization.contract.ts`, members contract, indexes.
- **api:** new `db/schema/user-role.table.ts` + repo + migration + backfill; edit `permission.service.ts` (roles[], capabilities, loadSet), `middleware/metadata.middleware.ts`, `types/express.d.ts`, `roles.repository.ts` (findByNames), `routes/organization.router.ts` (set-roles), `services/seat.service.ts`, `services/application.service.ts`, `routes/billing.router.ts`, `constants/api-codes.constants.ts`, `db/schema/{zod,type-checks,index}.ts`, `services/db.service.ts`, `seed.service.ts`, test utils; integration tests.
- **web:** `utils/use-role.util.ts` → `useCapabilities`; `api/{organizations,members}.api.ts` + `keys`; `components/MemberList.component.tsx`, `MembersTab.component.tsx`, `views/Settings.view.tsx` (+ Profile section), `SubscriptionBilling`/`TierCard`; tests.

## Next step

`docs/RBAC_MULTI_ROLE.plan.md` slices: **(1)** `user_role` table + model + repo + migration + remap backfill (+ owner at provisioning) — source of truth exists, unread; **(2)** reads cutover — `ctx.roles` + `loadSet` + capabilities helper + current-org + `listMembers` (single-role parity the gate); **(3)** writes cutover — set-roles endpoint + guards + membership-creation sites + enum mirror + audit; **(4)** FE — `useCapabilities` + Members multi-role + Profile. Each a green commit on `feat/620-rbac-multi-role`.
