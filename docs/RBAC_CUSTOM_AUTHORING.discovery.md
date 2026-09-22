# RBAC custom roles, policies & groups (authoring) — Discovery

**Issue:** [EnterpriseBT/portal-ai#622](https://github.com/EnterpriseBT/portal-ai/issues/622)

**Why this exists.** #598 shipped the RBAC engine with three **immutable system** roles/policies (FullAccess/AdminAccess/MemberAccess); #620 added multi-role assignment; #621 added object grants + sharing. The `custom` policy/role `kind` and the `group` principal were reserved by those tickets but **never written to** — `SEED_SYSTEM_POLICIES` is the only writer today, and `POLICY_PRINCIPAL_TYPES` is `["user","role"]`. This child turns those reserved branches into real features: org-defined **custom policies**, **custom roles**, and **groups**, plus the authoring UI to create and assign them, gated behind an enterprise-tier entitlement. This is the layer that lets an enterprise model its own structure (an "Analyst" role, a "West region" group) and — once #599 ships `views` — completes the region pattern (a group + an `allow read view:<id>` policy).

## The current shape

### RBAC engine + resolution
`PermissionService.loadSet` (`apps/api/src/services/permission.service.ts:66`) is the single resolution entry point. It seeds `principals` with the caller user (`:73`), resolves role names → role rows and pushes a `{principalType:"role"}` per role (`:80-84`), loads `policy_attachments` for those principals via `repo.policyAttachments.findByPrincipals` (`:86`), gathers the attached policies' statements (`:90`), unions ad-hoc `permission_grants` (`:97`), and returns `new PermissionSet(ctx, [...statements, ...grants])`. `findByPrincipals` (both attachments and grants) already iterates an **arbitrary principal list** — so a `group` principal extends it without touching the loader. `PermissionContext` = `{userId, organizationId, roles}` (`:34`), built in `metadata.middleware.ts:94,134` via `userRole.findEffectiveRoleNames`.

`PermissionSet` (`apps/api/src/services/permission-set.ts`): `EffectiveStatement` (`:16`) is the shared 5-field shape; `resolve` (`:196`) is deny→allow→implicit-deny, fail-closed; `assertWithinBoundary(object, verbs)` (`:104`) is the **permissions boundary** (throws `RBAC_GRANT_EXCEEDS_BOUNDARY`) — exactly what #622 authoring must enforce; `visibilityPredicate` (`:127`) scopes list reads.

### Roles / policies / statements / attachments + seed
Tables (`apps/api/src/db/schema/`): `roles.table.ts`, `permission-policies.table.ts`, `permission-statements.table.ts`, `policy-attachments.table.ts`, `user-role.table.ts`, `permission-grants.table.ts`. `roles` + `permission_policies` carry `kind` ∈ `RBAC_KINDS`=`["system","custom"]` (`permission.model.ts:118`) with a CHECK (`roles.table.ts:27`, `permission-policies.table.ts:28`). `policy_attachments` is the polymorphic edge: `principalType` ∈ `POLICY_PRINCIPAL_TYPES`=`["user","role"]` (`permission.model.ts:123`) + CHECK (`policy-attachments.table.ts:44`) — **both grow `group`**. Repos: `roles.repository.ts` (`findByName(s)`), `policy-attachments.repository.ts` (`findByPrincipals`/`findByPrincipalId`), `permission-policies.repository.ts`, `user-roles.repository.ts`. `SeedService.seedRbacSystemPolicies` (`seed.service.ts:619`) is idempotent, uses deterministic ids `sysrole:/syspol:/sysstmt:/sysatt:`; `SEED_SYSTEM_POLICIES` (`:703`) is the only source of `kind:"system"`. **Nothing writes `kind:"custom"` today.** Core Zod: `PolicySchema:130`, `PermissionStatementSchema:158`, `PolicyAttachmentSchema:230`, `RoleSchema:270`; `group` flagged "added in #622" (`permission.model.ts:122`).

### Tier entitlements
`tiers.table.ts` is hybrid (scalar grid + JSONB). #214 added `builtinToolpacks` (jsonb, fail-closed `[]`) + `customToolpacks` (boolean); #584 added `maxSeats`. `TierPolicy` (`packages/core/src/models/tier.model.ts:81`), `TierEntitlementsSchema` (`:70`). `TierService.resolveTier` (`tier.service.ts:73`) maps row→policy (entitlements copied at `:60`, cached). `EntitlementService.customPacksEntitled` (`entitlement.service.ts:162`) is the **exact template** for a `customRbac` gate.

### Settings + Members / assignment UI
`Settings.view.tsx` uses `useTabs` seeded from `settingsTabIndexFromSearch` (`:55`) — the #284 read-once pattern; tab enum + index in `utils/routes.util.ts:39-56`. Elevated tabs gate on `useCapabilities()` (`can("member.invite")`, `can("org.audit.read")`, `:111-124,157-158`). Members: `MembersTab.component.tsx`, `MemberList.component.tsx`; #620 multi-role assignment PUTs via `sdk.members.setRoles()` → `PUT /api/organization/members/:userId/roles` (`members.api.ts:33-43`). SDK pattern: a `*.api.ts` object of `useAuthQuery`/`useAuthMutation`, spread into `sdk.ts`, keys in `keys.ts` — `grants.api.ts` is the recent template.

### Audit + dual-schema checklist + routes
`AUDIT_ACTIONS` (`audit-log.model.ts:23-45`) closed union (#620/#621 added `member.role.*`/`grant.*`); emit via fail-open `void AuditService.record(...)` post-commit (`audit.service.ts:45`, pattern at `seat.service.ts:625`). New-table six touch points (worked example: `permission_grants` #621): `zod.ts`, `type-checks.ts`, `schema/index.ts`, `repositories/index.ts`, `db.service.ts`, the table file; migration via `npm run db:generate`. Routes gate through `PermissionService.check(ctx, action, obj?)` (`permission.service.ts:112`); `member.role.assign` ∈ `CALLER_CAPABILITY_ACTIONS` (`permission.model.ts:97`); `grant.router.ts`+`GrantService` is the authoring-endpoint template (thin router + `@openapi`, service holds authz: `check` → `assertWithinBoundary`).

## The design space

### Decision 1 — Where groups resolve
**A. Resolve in `loadSet`** — gather the caller's `user_group` rows, push `{principalType:"group", principalId}` into `principals` before the attachment/grant load. **B. Flatten** groups to their roles at assignment time (a group just bulk-assigns roles). **C. Materialize** a per-user effective-policy cache.

| | A (resolve in loadSet) | B (flatten to roles) | C (materialize) |
|---|---|---|---|
| Engine change | one `user_group` gather + push | none (reuse roles) | cache layer + invalidation |
| Group-scoped policy | native (policies attach to group) | impossible (no group principal) | native |
| Correctness on membership change | immediate (next loadSet) | immediate | needs invalidation |

**Lean: A.** The loader already iterates an arbitrary principal list; groups are a first-class principal exactly like roles. B can't attach a policy *to a group* (the issue's core deliverable); C adds cache-coherence risk for no measured need.

### Decision 2 — Custom-policy statement authoring shape
**A. Structured row editor** — each statement is `effect × verb × resourceType × resourceId?` chosen from the closed vocabularies (`PERMISSION_VERBS`, `DATA_RESOURCE_TYPES` + capability actions), written as `permission_statements` rows. **B. Freeform JSON** blob validated server-side.

| | A (structured) | B (JSON) |
|---|---|---|
| Boundary-checkable | per-row via `assertWithinBoundary` | after parse |
| UX | dropdowns, discoverable | expert-only, error-prone |
| Vocabulary drift | closed enums enforce | free text |

**Lean: A.** The vocabularies are already closed Zod enums; a structured editor is boundary-checkable row-by-row and can't express an unrepresentable statement. JSON is an authoring footgun for a security surface.

### Decision 3 — Entitlement placement + composition with owner/admin
**A. Tier flag + server check, composed with the capability.** New `customRbac` boolean on `tiers` (fail-closed false) → `TierEntitlementsSchema` → `resolveTier` → `EntitlementService.customRbacEntitled`. Every authoring route requires **both** the owner/admin capability **and** the entitlement; the FE reads the entitlement to hide/lock the Access tab. **B. Capability-only** (no tier gate). **C. FE-only hide.**

**Lean: A.** Mirrors #214 toolpack gating and the standing "entitlement is server-enforced, not prompt/FE" rule ([[feedback_no_prompt_safety_gates]]). The two gates are orthogonal: entitlement = "this org bought it", capability = "this user may author". FE hiding is UX only, never the gate.

### Decision 4 — What a custom role *is*
**A. A named principal that policies attach to** (identical to system roles — each system role has one policy attached via `policy_attachments`). Custom role = a `roles` row (`kind:"custom"`) + N `policy_attachments{principalType:"role"}`. **B. A role owns its statements directly** (a role *is* a policy).

**Lean: A.** It's exactly the system-role shape, so resolution, attachment loading, and the assignment UI (#620) all work unchanged. A custom role is a reusable bundle: attach one or more custom (or system) policies to it, assign the role to members/groups. B would fork the model and break the "policies attach to principals" invariant.

## Tradeoff comparison

| | D1: groups in loadSet | D2: structured editor | D3: tier+capability gate | D4: role = policy bundle |
|---|---|---|---|---|
| New schema | `groups` + `user_group` + `group` principal | none (reuse statements) | `customRbac` column | none |
| Reuses existing engine | yes (arbitrary principals) | yes (`assertWithinBoundary`) | yes (#214 pattern) | yes (system-role shape) |
| Spread to spec | Yes | Yes | Yes | Yes |

## Recommendation

1. **Groups are a first-class principal.** Add `groups` + `user_group` tables (dual-schema, 6 touch points), grow `POLICY_PRINCIPAL_TYPES` + the `policy_attachments` CHECK to admit `group`, and resolve the caller's groups in `loadSet` (push `group` principals before the attachment/grant load). Uniqueness: group `name` unique per org `WHERE deleted IS NULL` (mirror `roles`); `user_group` unique `(userId, groupId) WHERE deleted IS NULL` (re-add is a no-op).
2. **Custom policies are structured statement bundles**, authored via an `effect × verb × resourceType × resourceId?` row editor over the **full** vocabulary — every verb and resourceType including wildcard `*`, every caller-capability action, and an optional instance `resourceId`, with **no restriction on what a policy may govern** (an author can reproduce the system owner/admin policies). The **only** guardrail is the permissions boundary: each new `allow` is `assertWithinBoundary`-checked against the author's own set (denies always in-boundary), so you can author anything within your allow-set and nothing beyond it. `kind:"custom"`.
3. **Custom roles are named policy bundles** (`roles` row `kind:"custom"` + role-principal `policy_attachments`); assignment reuses the #620 multi-role UI.
4. **Groups: CRUD + membership**; a member inherits every policy attached to every group they're in.
5. **Authoring is gated by an enterprise-tier `customRbac` entitlement AND the owner/admin capability**, both server-enforced; the FE reads the entitlement to lock the Access tab. System roles/policies are read-only (their `kind:"system"` blocks edit/delete).
6. **Delete = cascade-soft-delete**: deleting a policy soft-deletes its `policy_attachments` everywhere; a role soft-deletes its `user_role` + role-principal attachments; a group soft-deletes its `user_group` + group-principal attachments. Effective access recomputes on the next `loadSet`; no dangling rows, no 409-block.
7. **New audit actions**: `policy.create/update/delete`, `role.create/update/delete`, `group.create/update/delete`, `group.member.add/remove`, `policy.attach/detach` — fail-open, post-commit.
8. **UI: a new "Access" Settings tab** (Roles / Policies / Groups sub-nav) for authoring; per-member role/group **assignment** stays on the Members tab. Both gated on capability + entitlement.

## Open questions

1. **What can a custom policy govern / express? — RESOLVED: everything, bounded only by the author's own allow-set.** The editor imposes **no restriction on shape or governed resource**: any `effect`, any `verb` (including wildcard `*`), any `resourceType` (including `*`), an optional instance `resourceId`, and any caller-capability action are all constructible — a user can reproduce the system owner/admin policies exactly. The **one** guardrail is the permissions boundary (the ticket's own AC): every `allow` an author writes must satisfy `assertWithinBoundary` against *their own* set, so you can author anything you could yourself do but nothing beyond it (an admin can't self-author an owner-equivalent `* *` policy because the billing deny puts it out of their boundary). Instance-scoped statements are allowed and simply overlap with what #621 grants also express — no artificial "type-level only" limit.
2. **Does the editor expose caller-capability actions (`member.invite`, `org.audit.read`, …) or only `resource.*` verbs? — RESOLVED: expose the full action vocabulary.** Both caller-capability actions and `resource.*` verbs, so an org can build an "Admin-lite" role — all boundary-checked (an author who lacks `member.invite` can't grant it). Spec must confirm capability actions resolve through the same statement machinery `assertWithinBoundary` reads.
3. **What happens to existing custom roles/policies/groups if an org downgrades below the `customRbac` tier? — RESOLVED: they persist and keep applying; only *authoring* (create/edit/delete/assign) locks.** No effective-access change on downgrade — suspending permissions on a billing event would silently strip access mid-operation, a worse enterprise surprise than an over-provisioned-but-frozen config.
4. **Group nesting (a group containing a group)?** **Lean: no** — flat `user_group` only in #622; nesting is a cardinality/cycle risk with no stated need. Out of scope.
5. **Is `customRbac` a boolean or a shaped entitlement (e.g. max custom roles/groups)?** **Lean: boolean for #622**, shaped later if a tier needs caps — keep the column additive so a count limit can layer on without re-plumbing ([[project_tier_two_axes]]).

## Enterprise-scale considerations

- **Concurrency & correctness.** Name-uniqueness partial unique indexes (per-org, `WHERE deleted IS NULL`) prevent duplicate roles/groups under concurrent create. The boundary check-then-act race (author's own perms change mid-author) is the same low-stakes race #621 accepted — recorded, transactional write.
- **Accuracy & auditability.** Every authoring mutation audited (rec. 7); `policy_attachments` is the durable record of who-has-what, reconstructable.
- **Failure modes.** Resolution stays **fail-closed** (implicit deny); the `customRbac` entitlement defaults **false** fail-closed (an unresolvable tier can't accidentally unlock authoring); audit is fail-open (never blocks the mutation).
- **Multi-tenancy.** Every new table is org-scoped; groups/policies/roles never cross orgs; deterministic-id collision is impossible (custom ids are uuids, not `sys*`).
- **Contract stability.** `group` slots into the existing arbitrary-principal loader; `customRbac` layers onto the #214 entitlement shape; a future count-cap or ABAC `condition` extends without re-plumbing call sites.
- **Scale & unbounded growth.** Custom roles/policies/groups per org are admin-authored (low cardinality, human-bounded); `user_group` fan-out is members × groups, bounded by seat count. No runaway path.
- **Data lifecycle.** Soft-delete + cascade (rec. 6); downgrade persists config (OQ3). N/A: billing-period windows.

## What this doesn't decide

- **ABAC / parameterized `condition` statements** — out per the issue; views (#599) cover data-attribute slicing.
- **The `views` entity + data-plane RBAC** — #599. The region pattern only completes once views exist.
- **Group nesting / dynamic (rule-based) membership** — OQ4; flat explicit membership only.
- **`customRbac` as a shaped count-limited entitlement** — OQ5; boolean now, additive later.

## Next step

Write `docs/RBAC_CUSTOM_AUTHORING.spec.md` (contract: the `groups`/`user_group` tables + `group` principal, the custom policy/role/group Zod + endpoints, `customRbac` entitlement, audit actions, Access-tab surface) and `.plan.md`. The plan slices roughly: (1) `groups`/`user_group` schema + `group` principal in `loadSet` (+ backfill of the `policy_attachments` CHECK) — engine sees groups, no UI; (2) `customRbac` entitlement (tier column + `EntitlementService` + resolveTier); (3) custom policy + role CRUD API (boundary + audit + entitlement-gated); (4) group CRUD + membership API; (5) the "Access" Settings tab UI (roles/policies/groups authoring) + assignment wiring on Members — each behind a green suite.
