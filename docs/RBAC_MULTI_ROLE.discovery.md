# RBAC multi-role: user_role join + enum cutover — Discovery

**Issue:** [EnterpriseBT/portal-ai#620](https://github.com/EnterpriseBT/portal-ai/issues/620)

**Why this exists.** #598 shipped the data-driven RBAC engine but kept `organization_users.role` as a **single-role enum** — one role per membership, mapped to one seeded `roles` row by `loadSet`. Enterprises need a user to hold **multiple roles** (a base role + a custom role, or admin of one function + member scope elsewhere). This replaces the enum with a many-to-many **`user_role`** join, remaps every existing membership onto it with identical effective access, and makes `loadSet` gather policies across **all** a user's roles. This is the ticket that turns "the role" into "the roles" without changing anyone's access at cutover.

**The key simplifier (from the survey):** `PermissionSet` keys only off `ctx.userId` and evaluates the *union* of statements with deny-wins (`permission-set.ts:134,200`), so multiple roles are **already** handled at the engine layer — `loadSet` just pushes one `{principalType:"role"}` principal per role instead of one. #620 is overwhelmingly the *assignment, representation, and migration* cutover, not an authorization-logic change. Part of the RBAC engine family (`docs/RBAC_IAM_ENGINE.discovery.md`).

## The current shape

### Every reader/writer of the `organization_users.role` enum (the cutover surface)

| Site | Location | Role: read/write |
|---|---|---|
| Enum column + CHECK | `db/schema/organization-users.table.ts:27,31-35`; model `packages/core/src/models/organization-user.model.ts:17,33` | the enum + `ORG_ROLES` |
| Metadata middleware | `middleware/metadata.middleware.ts:93,130` | **reads** → sets `req.application.metadata.role` (single) |
| `loadSet` role→role map | `services/permission.service.ts:73-78` | **reads** `ctx.role` → `roles.findByName` → one principal (the core "gather all" change) |
| `RolesRepository.findByName` | `db/repositories/roles.repository.ts:23-40` | single-name; needs a by-names variant |
| Current-org selector | `services/application.service.ts:48` (max `lastLogin`), `switchOrganization:130` | role rides on the returned `orgUser` |
| seat.service | `seat.service.ts` `listMembers:161`, `attachMembership:479,494-500`, accept paths `:302,313,317,362,373`, **last-owner guard `:413-427`** | reads + writes |
| Member-role PATCH | `routes/organization.router.ts:407-495` (gate `:428`, single-enum update `:477-482`, owner-immutable `:447`, owner-mints-admin `:458-461`, audit `:490`) | **writes** (set one enum) |
| Org/member creation | `application.service.ts:548` (owner), `:469` (member) | **writes** `role` |
| Contract/type surface | `contracts/organization.contract.ts:15` (`current()` `role`), `:53` (`MemberRoleUpdateRequest`); `types/express.d.ts:49` (`ApplicationMetadata.role`); `routes/billing.router.ts:57` | the `role` field |

*(Chat-message `role` in portal-messages/portal.service is unrelated — ignore.)*

### The engine + schema this builds on (#598)

`roles` (`db/schema/roles.table.ts`, org-scoped, unique `(org,name)`; its header already flags "#620 the `user_role` multi-role join"). `seedRbacSystemPolicies` (`seed.service.ts:618-681`) mints deterministic `sysrole:<org>:<name>` roles + `sysatt:` role→policy attachments; `loadSet` resolves a role → its attachments → statements via `policyAttachments.findByPrincipals`. **So a `user_role` row → `roles.id` → the existing `sysatt` attachment → statements: no policy re-plumbing, just N role principals.**

### Frontend + migration mechanics

`useRole()` (`apps/web/src/utils/use-role.util.ts:22-32`) reads `sdk.organizations.current()` → a single `role` + `isOwner`/`isAdmin`/`isAdminOrOwner`. Consumers: `Settings.view.tsx:110,145-146,358,386,395`, `MembersTab.component.tsx:311` (`callerRole`), `SubscriptionBilling`/`TierCard` (`isOwner`). Per-member role UI: `MemberList.component.tsx:58-72` (a Select shown only for `callerRole==="owner" && member.role!=="owner"`, last-owner count `:48,89`) → `sdk.members.changeRole`. Migration pattern: the `0102` backfill (`INSERT … SELECT … CROSS JOIN … ON CONFLICT DO NOTHING`, deterministic ids) is the exact template; the **backfill-coverage guard** (`__tests__/services/seed-backfill-coverage.test.ts`) requires a `-- backfill:` marker for anything seeded at provisioning.

## The design decisions

### D1 — `user_role` table shape

| | A: `{userId, organizationId, roleId}` | B: `{organizationUserId, roleId}` |
|---|---|---|
| Org scoping | denormalized `organizationId` (direct `(userId, org)` query) | via the membership row (extra join) |
| loadSet gather | `WHERE userId=? AND organizationId=?` | join `organization_users` |
| Ties to membership | logical (userId+org = the membership) | physical FK |

**Lean: A** — `user_role {…baseColumns, userId → users, organizationId → organizations, roleId → roles}`, **unique `(userId, organizationId, roleId) WHERE deleted IS NULL`** (the same role can't be assigned to a user twice — a re-assign is a no-op), indexed `(userId, organizationId)`. Deterministic id `sysur:<userId>:<org>:<roleName>` (mirrors the seed/backfill id scheme). `loadSet` reads it by `(userId, org)` directly; the current-org selector still keys on `organization_users` (org switching unchanged), roles derived from `user_role`.

**Role name uniqueness is already enforced** by the `roles` table (#598): unique `(organizationId, name) WHERE deleted IS NULL` (`roles.table.ts`). The role `name` is the slug — no separate slug/display column; #620 relies on that existing constraint (a spec assertion pins it).

### D2 — Backend context: `ctx.role` → `ctx.roles`

`PermissionContext.role: OrgRole` → **`ctx.roles: OrgRole[]`** (the role names for the current org, resolved by the middleware from `user_role ⋈ roles`). `loadSet` pushes one role principal per name. The `ctx.role !== "owner"` admin-mint guard (`organization.router.ts:460`) becomes `!ctx.roles.includes("owner")` (a role-membership check, not a heuristic — minting the *owner role* is legitimately owner-gated).

**Lean: role *names* (`OrgRole[]`), not ids, in the context** — keeps the middleware/engine boundary the same shape as #598; custom roles (#622) widen `OrgRole` to `string`.

### D2b — Frontend gates on **capabilities**, not role names (no `isOwner`/`primaryRole`)

Once access is governed by *policies* (and custom roles overlap them, #622), a role *name* tells the FE nothing about what a user can do — `isOwner`/`isAdmin`/`primaryRole` are heuristics that muddle the moment roles compose arbitrary policies. So the FE gates on **capabilities**, computed server-side:

- **`current()` returns `capabilities: Record<PermissionAction, boolean>`** — the server evaluates the caller's `PermissionSet.can(action)` for the app-level gating actions (`billing.manage`, `org.delete`, `org.audit.read`, `member.role.assign`, `member.invite`, `member.remove`) and returns the booleans. Authoritative (same engine as the guard), no FE re-implementation, and custom roles "just work" — a custom role granting `billing.manage` flips the capability regardless of its name.
- **`roles: string[]`** rides alongside for **display only** (profile + members), never gating.
- `useRole()` → **`useCapabilities()`** returning `{ roles, capabilities, can(action) }`; every `isOwner`/`isAdmin(OrOwner)` gate becomes `can("billing.manage")` / `can("member.role.assign")` / etc.

**Lean: server-computed capability map; drop `isOwner`/`isAdmin`/`primaryRole` entirely.** No name heuristic, no privilege hierarchy. Object-level gates (`resource.read/write` on a specific object) stay per-object → **#621**; #620's map covers the coarse app-level gates the UI uses today. Not speculative — it directly replaces the `isOwner` heuristic being removed.

### D2c — Display surfaces: profile roles + members role column

- **Settings → Members**: the role column shows each member's **`roles[]`** (chips), not one role. **Each chip renders the role's `name`/slug directly** — no separate display-name heuristic (the name is the identifier the user sees and, for custom roles #622, authors).
- **Settings → Profile**: a "Your roles" section lists the caller's roles for the current org. **Groups** (`user_group`, #622) don't exist yet — the section is built to accommodate a "Your groups" list, populated when #622 lands (flagged, not silently dropped).

### D3 — Assignment API: set-the-set (PUT `roles[]`)

The member-role PATCH (set one enum) becomes **set the desired role set**: `PUT /api/organization/members/:userId/roles` with `{ roles: OrgRole[] }`; the service diffs against current `user_role` rows (insert added, soft-delete removed) in a transaction, enforcing the guards (D4/D5). One round-trip, matches a multi-select UI.

**Lean: set-the-set** over add/remove-one endpoints — the diff is where the ≥1-role + last-owner + owner-mint rules live in one place. Preserves the existing rules: owner role only mintable/removable by an owner (`:458-461`); no-op when unchanged.

### D4 — Guards become cross-table counts

- **Last-owner** (removeMember `:413-427` + the new PRD rule): "last owner" = the last *user holding the owner role*, a `count(user_role ⋈ roles WHERE name='owner' AND org=?)`. Refuse removing the member, **and** refuse removing the owner *role* from the last owner (409).
- **≥1 role** (PRD): refuse a set-roles that would leave a member with zero roles (409) — revoke access by removing the member, not by stripping roles.

**Lean: both enforced in the set-roles service + `removeMember`, as `user_role` counts.**

### D5 — Write cutover + provisioning

Every `role` write moves to `user_role` inserts: org creation (owner), member creation/`attachMembership`, invite-accept, set-roles. `seedRbacSystemPolicies` (or the owner-membership creation) also inserts the owner's `user_role` row at provisioning — with a paired **backfill marker** so the coverage guard passes.

**Lean: create the owner `user_role` in the same tx as the owner membership** (`provisionOrganizationInTx`), and add the `-- backfill:user-role` marker to the data migration.

### D6 — Enum deprecation (expand-only)

Keep `organization_users.role` (NOT NULL DEFAULT 'member') as a **vestigial denormalized "primary role" mirror** — written to the user's highest role on every `user_role` change, but **never read** by authz after the cutover. This is a conscious dual-write for rollback safety + a cheap single-label value; the **column drop is a follow-up migration** (expand-only; no prod-risky drop in this ticket).

**Lean: keep + mirror, drop later** over stop-writing-cold (which would leave the column saying 'member' for owners — misleading if ever read) — the mirror is a few lines and de-risks rollback while prod data exists.

## Tradeoff comparison

| | D1 denormalized join | D2 roles[] clean cut | D3 set-the-set | D6 vestigial mirror |
|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes |
| Engine change | none (union already works) | middleware/loadSet/useRole | service diff | write path only |
| Rollback safety | — | — | — | Yes (enum still valid) |

## Recommendation

1. **`user_role` table** `{…baseColumns, userId, organizationId, roleId}` + dual-schema (model/table/zod/type-checks) + `UserRoleRepository` (find by `(userId, org)`, by role, insert/soft-delete). Unique `(userId, org, roleId) WHERE deleted IS NULL`.
2. **Migration:** create `user_role`; **data migration** remapping every live `organization_users` row → `user_role(userId, org, roleId='sysrole:<org>:<enum>')` (`0102` pattern, deterministic id, `ON CONFLICT DO NOTHING`, `-- backfill:user-role` marker).
3. **Reads → `user_role`:** middleware resolves `ctx.roles: OrgRole[]`; `loadSet` gathers a principal per role (add `roles.findByNames`); current-org selector keeps keying on `organization_users`, derives roles from `user_role`; `listMembers` returns `roles[]`; last-owner guard = owner-role count.
4. **Writes → `user_role`:** all membership-creation sites insert the owner/member `user_role`; the set-roles service diffs; the enum is mirrored to the primary role (D6).
5. **Contract/API:** `current()` → `roles: OrgRole[]` (display) **+ `capabilities: Record<PermissionAction, boolean>`** (gating, server-computed via `PermissionSet.can`); `PUT …/members/:userId/roles {roles}` replacing the single-enum PATCH; `MemberRoleUpdateRequest` → a roles-set request; `express.d.ts` `role` → `roles`. Members list returns `roles[]` per member.
6. **FE:** `useRole()` → **`useCapabilities()`** = `{ roles, capabilities, can(action) }`; **drop `isOwner`/`isAdmin`/`primaryRole`** — every gate becomes `can(<action>)`; `MemberList` per-member Select → a multi-select of roles (gated by `can("member.role.assign")`, owner-role add/remove still owner-gated); **Settings → Members** role column → `roles[]` chips; **Settings → Profile** "Your roles" section (groups list deferred to #622); update all `useRole` consumers (`Settings`, `SubscriptionBilling`, `TierCard`, `MembersTab`).
7. **Guards:** ≥1-role + last-owner-role, enforced as `user_role` counts (D4).

## Open questions

1. **~~Does `current()` keep a scalar `primaryRole`?~~ Resolved (D2b): no.** No `primaryRole`, no `isOwner`/`isAdmin` — the FE gates on the server-computed `capabilities` map; `roles[]` is display-only. A name heuristic + privilege hierarchy adds complexity without benefit and breaks under custom roles.
2. **Which actions go in the `capabilities` map?** The app-level (non-object) gating actions the UI uses: `billing.manage`, `org.delete`, `org.audit.read`, `member.role.assign`, `member.invite`, `member.remove`. **Lean: a fixed `CALLER_CAPABILITY_ACTIONS` list evaluated in `current()`**; object-level (`resource.*`) stays per-object (#621). Extend the list as new app-level gates appear.
3. **Where does the enum "primary-role" mirror (D6) get written — DB trigger or app?** **Lean: app (in the set-roles/attach service), same tx** — no trigger; the one place role changes flow through. (The mirror is vestigial/unread; it exists only for rollback safety until the column drop.)
4. **`OrgRole` type: stays the 3-value enum in #620, widened to `string` in #622?** **Lean: keep `OrgRole` as the system-role enum for #620; #622 introduces custom role names as strings** — #620 ships only multi-*assignment* of the existing system roles.

## Enterprise-scale considerations

- **Concurrency & correctness.** Set-roles is a read-diff-write; concurrent set-roles on the same member could race. **Lean: run the diff in a transaction and re-check the last-owner/≥1-role invariants inside it** (SELECT … the owner count within the tx); the unique index prevents duplicate role rows.
- **Accuracy & auditability.** Role add/remove must audit (extend `member.role.change` to `member.role.add`/`member.role.remove`, or one "roles set" event with before/after). **Lean: emit an audit row per role added/removed** via `AuditService`, mirroring #575.
- **Failure modes.** Authz stays **fail-closed** (a user with no resolvable roles → empty set → deny) — the ≥1-role guard keeps that from happening accidentally, but the engine still denies safely if it does. **Lean: fail-closed unchanged.**
- **Scale.** A user has a handful of roles per org; `loadSet` gathers N (small) role principals → a couple of extra indexed reads. **Lean: fine; index `(userId, org)`.**
- **Multi-tenancy.** `user_role` is org-scoped (`organizationId` + roleId→org-scoped role); a role from another org is unreachable. **Lean: org-scope every row + validate role∈org on assign.**
- **Contract stability.** `roles[]` + the role principal shape is what #622 (custom roles) and #621 (grants) extend without re-plumbing. **Lean: roles[] is the forward-compatible contract.**
- **Data lifecycle.** `user_role` rows soft-delete on role removal + on member removal (cascade, the #598 ordered-cascade pattern in `seat.removeMember`). No time window. **Lean: lifecycle-bound to membership.**

## What this doesn't decide

- **Custom/org-defined roles + authoring UI, and groups** — **#622** (this ships multi-assignment of the *system* roles only; the `roles` table already supports custom rows). #622 carries the analogous constraints: **group name unique per org**, and **`user_group` unique `(userId, groupId)`** (a user can't be added to a group twice) — noted here, enforced there.
- **Dropping the `organization_users.role` column** — a follow-up expand-only migration once nothing reads the mirror.
- **Object grants + sharing** — **#621**.

## Next step

`docs/RBAC_MULTI_ROLE.spec.md` pins the `user_role` table + dual-schema, the remap data migration (+ marker), the `ctx.roles`/`loadSet`/`findByNames` changes, the `current()` → `roles[]`+`primaryRole` contract, the `PUT …/roles` set-the-set endpoint + the ≥1-role/last-owner guards, the audit actions, and the FE `useRole`/`MemberList` changes. `docs/RBAC_MULTI_ROLE.plan.md` slices it: (1) `user_role` table + model + repo + migration + remap backfill (source of truth exists, unread); (2) reads cutover — middleware `ctx.roles` + `loadSet` + current-org + `listMembers` (switch-equivalent parity: single-role users resolve identically); (3) writes cutover — set-roles endpoint + guards + provisioning + the enum mirror + audit; (4) FE `useRole`/`MemberList` multi-role. Each a green commit on `feat/620-rbac-multi-role`.
