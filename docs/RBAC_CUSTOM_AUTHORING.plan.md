# RBAC custom roles, policies & groups (authoring) — Plan

**Six TDD slices that build the custom RBAC layer bottom-up: schema + group resolution first, then the two write-path guards (boundary + entitlement), then the policy/role/group CRUD APIs, then the object-search picker, then the Access-tab UI — each behind a green suite.**

Spec: `docs/RBAC_CUSTOM_AUTHORING.spec.md`. Discovery: `docs/RBAC_CUSTOM_AUTHORING.discovery.md`. Issue: #622 (epic #578). Builds on the shipped #598 engine, #620 multi-role, #621 grants.

6 slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/622-rbac-custom-authoring`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
cd packages/core && npm run test:unit
cd apps/web && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — S1 lands the `group` principal + schema so the engine resolves group-attached policies with nothing user-facing (a clean, testable base). S2 lands the two leaf guards (boundary + entitlement) consumed by every write slice, using test stubs so it depends on nothing above it. S3→S5 build the CRUD services on S1's repos + S2's guards, one resource per slice (policy, then role which references policies, then group + the object-search that the UI needs). S6 is the whole FE, last because it consumes every endpoint below. No slice forward-references a later one; the dual-schema stays green because each schema change lands with both its Drizzle + core halves in the same slice.

---

## Slice 1 — `groups`/`user_group` schema + the `group` principal in `loadSet`

The engine resolves policies attached to a group the caller belongs to. No authoring, no UI — pure resolution.

**Files**

- Edit: `packages/core/src/models/permission.model.ts` — `POLICY_PRINCIPAL_TYPES` → `["user","role","group"]`; add `GroupSchema`/`GroupModel`/`Factory` + `UserGroupSchema`/Model/Factory.
- New: `apps/api/src/db/schema/groups.table.ts`, `user-group.table.ts` (partial-unique on name / `(userId,groupId)`, `WHERE deleted IS NULL`).
- Edit: `apps/api/src/db/schema/policy-attachments.table.ts` — CHECK `IN ('user','role','group')`.
- New: `apps/api/src/db/repositories/groups.repository.ts`, `user-groups.repository.ts` (incl. `findGroupIdsByUser`).
- Edit (6 dual-schema points): `schema/zod.ts`, `schema/type-checks.ts`, `schema/index.ts`, `repositories/index.ts`, `services/db.service.ts` for both tables.
- Edit: `apps/api/src/services/permission.service.ts` — `loadSet` gathers `userGroups.findGroupIdsByUser(ctx.userId, orgId)` and pushes `{principalType:"group"}` before `findByPrincipals`.
- New: `apps/api/drizzle/<n>_add_groups_and_user_group.sql` (+ journal + snapshot) — create both tables + the CHECK alter.

**Steps**

1. **Tests (spec: core `permission.model.test`/new schemas; `groups`/`user-groups` repo integration; `permission-loadset` group-union case; migration case).** Core: `POLICY_PRINCIPAL_TYPES` includes `group`, `Group`/`UserGroup` round-trip. Repo integration: create/find/soft-delete, `findGroupIdsByUser`, `(userId,groupId)` re-add no-op. loadSet integration: seed (direct inserts) a custom policy + statement + a **group**-principal `policy_attachment` + a `user_group` row → `loadSet` resolves the group's allow. Migration: a `group` attachment row inserts post-migration; `user`/`role` still insert. Run; fail.
2. **Implement** the schema, models, repos, CHECK alter, and the `loadSet` gather. Green.
3. Lint + type-check.

**Done when:** a member in a group with an attached custom policy resolves that policy's statements; the two tables + `group` principal exist; nothing above the engine references them.

**Risk:** dual-schema drift — add both Drizzle + core halves together; commit `.sql` + `_journal.json` + `_snapshot.json` (`project_drizzle_journal_must_be_committed`).

---

## Slice 2 — the two write-path guards: `assertStatementsWithinBoundary` + `customRbac` entitlement

Both leaf guards, consumed by S3–S5. Unit-tested in isolation with a stub object resolver.

**Files**

- Edit: `apps/api/src/services/permission-set.ts` — add `assertStatementsWithinBoundary(statements, resolveCreatedBy)` (class-level breadth probe + instance-level ownership probe; wildcard fan-out; deny-pass), reusing private `resolve`/`matches`.
- Edit: `packages/core/src/models/tier.model.ts` — `TierEntitlementsSchema.customRbac: boolean` + the raw core `TierSchema` row mirror gains `customRbac`.
- Edit: `apps/api/src/db/schema/tiers.table.ts` — `custom_rbac boolean NOT NULL DEFAULT false`; `schema/zod.ts` + `type-checks.ts` reflect it.
- Edit: `apps/api/src/services/tier.service.ts` — `resolveTier` copies `custom_rbac` → `entitlements.customRbac`; `entitlement.service.ts` — `customRbacEntitled(orgId)`.
- New: `apps/api/drizzle/<n>_add_tiers_custom_rbac.sql` (+ journal + snapshot).

**Steps**

1. **Tests (spec: `permission-set.test` ~14 cases; `entitlement.service` integration; `tier.model.test`).** Boundary unit (inject a stub `resolveCreatedBy`): owner `* *` authorizes all incl. `allow * *`; admin (`* *`∖`deny manage billing`) rejected for `* *`/`manage billing`, allowed for `read station` + admin bundle; member authorizes `read station created_by_caller`, rejects unconditional `read station`; **instance** — creator-of-X authors `read station:X` (stub returns X.createdBy = author), non-creator member rejected, class-allow covers any instance, absent object rejects; denies pass. Entitlement integration: `customRbacEntitled` true/false by tier; `tier.model` requires `customRbac`. Run; fail.
2. **Implement** the boundary method + the tier column/schema/reader. Green.
3. Lint + type-check.

**Done when:** the boundary correctly classifies every spec case against a stubbed resolver; `customRbacEntitled` reflects the tier. Neither is wired into a route yet.

**Risk:** the instance-vs-class `createdBy` probe is the security core — the unit matrix must cover the ownership + deny-override rows exactly.

---

## Slice 3 — custom **policy** CRUD API

`PolicyService` + `/api/policies`, wiring S2's boundary with a real per-type object resolver.

**Files**

- New: `packages/core/src/contracts/rbac-authoring.contract.ts` — `PolicyStatementInput`/`PolicyUpsertRequest`/`PolicyView` (+ list) — the role/group schemas land in S4/S5; export from `contracts/index.ts`.
- New: `apps/api/src/services/rbac-object-resolver.ts` (the per-`resourceType` → `{repo, findById→createdBy}` map the boundary injects; S5 extends it with search).
- New: `apps/api/src/services/policy.service.ts` (`GrantService` template) + `apps/api/src/routes/policy.router.ts` (`@openapi`), mounted in `protected.router.ts`.
- Edit: `permission-policies.repository.ts` (`create`/`update`/`softDelete`), `permission-statements.repository.ts` (`replaceForPolicy`), `policy-attachments.repository.ts` (`softDeleteByPolicyId`).
- Edit: `api-codes.constants.ts` (`RBAC_POLICY_EXCEEDS_BOUNDARY`, `RBAC_SYSTEM_IMMUTABLE`, `RBAC_CUSTOM_NOT_ENTITLED`, `POLICY_NOT_FOUND`, `RBAC_NAME_CONFLICT`); `audit-log.model.ts` (`policy.create/update/delete`); `swagger.config.ts`.

**Steps**

1. **Tests (spec: `policy.router` integration; `rbac-authoring.contract.test`).** create bounded → rows + `policy.create` audit; over-boundary → `RBAC_POLICY_EXCEEDS_BOUNDARY`; not-entitled → `RBAC_CUSTOM_NOT_ENTITLED`; non-admin → 403; system policy edit/delete → `RBAC_SYSTEM_IMMUTABLE`; duplicate name → `RBAC_NAME_CONFLICT`; update replaces statements; delete cascades attachments; **instance** create resolves the object's `createdBy` through the real resolver. Contract round-trips + rejects. Run; fail.
2. **Implement** the service (gate A + B1 + B2, tx, audit), router, repo methods, resolver. Green.
3. Lint + type-check.

**Done when:** a bounded custom policy round-trips through the API under all three gates; system policies are immutable; delete cascades.

**Risk:** the resolver must map every pickable `resourceType` (station/pin/portal/entity/connector_instance…); `view`/`entity_record` handled per spec (deferred / class-only).

---

## Slice 4 — custom **role** CRUD API

`RoleService` + `/api/roles` — a role bundles policies via attachments.

**Files**

- Edit: `rbac-authoring.contract.ts` — `RoleUpsertRequest`/`RoleView`; `swagger.config.ts`.
- New: `apps/api/src/services/role.service.ts` + `routes/role.router.ts`.
- Edit: `roles.repository.ts` (`create`/`update`/`softDelete`), `policy-attachments.repository.ts` (`setPoliciesForRole`, `softDeleteByPrincipal`), `user-roles.repository.ts` (cascade helper); `api-codes.constants.ts` (`ROLE_NOT_FOUND`); `audit-log.model.ts` (`role.create/update/delete`, `policy.attach/detach`).

**Steps**

1. **Tests (spec: `role.router` integration).** create bundles policyIds (attachments + `role.create` + `policy.attach` per diff); update re-sets policies (attach/detach diff audited); system role immutable; delete cascades `user_role` + role-principal attachments; assign the role to a member (#620 path) → effective access reflects it. Run; fail.
2. **Implement** service + router + repo methods. Green.
3. Lint + type-check.

**Done when:** a custom role bundling a custom policy assigns to a member and resolves; delete cascades cleanly.

**Risk:** none beyond the shared cascade pattern (reused in S5).

---

## Slice 5 — **group** CRUD + membership + the object-search picker endpoint

`GroupService` + `/api/groups` (+ group-centric members), member-centric `…/members/:id/groups`, and `/api/rbac/objects` for the instance picker.

**Files**

- Edit: `rbac-authoring.contract.ts` — `GroupUpsertRequest`/`GroupView`/`GroupMembersSetRequest`/`MemberGroupsSetRequest` (+ the `{objects:[{id,label}]}` search shape); `swagger.config.ts`.
- New: `apps/api/src/services/group.service.ts`, `routes/group.router.ts`, `routes/rbac-object-search.router.ts`.
- Edit: `user-groups.repository.ts` (`setGroupMembers`/`setUserGroups` diff, `softDeleteByGroup`), `policy-attachments.repository.ts` (group-principal cascade), `rbac-object-resolver.ts` (add per-type `search(label ILIKE, visibilityPredicate, limit)` incl. the derived `field_mapping` label); `organization.router.ts` (`PUT …/members/:userId/groups`); `api-codes.constants.ts` (`GROUP_NOT_FOUND`); `audit-log.model.ts` (`group.create/update/delete`, `group.member.add/remove`).

**Steps**

1. **Tests (spec: `group.router` integration; `rbac-object-search.router` integration ~6).** group CRUD; group-centric + member-centric membership set-the-set (idempotent, `group.member.*` audit); delete cascades `user_group` + attachments; a group's policy reaches every member (loadSet). Search: visibility-scoped by type (member sees own only), `ILIKE` match, `field_mapping` derived label, `entity_record`/pseudo/`*` empty, entitlement+capability gated. Run; fail.
2. **Implement** the two services, three routers, repo + resolver extensions. Green.
3. Lint + type-check.

**Done when:** groups are authored + assigned from both sides; the picker returns visibility-scoped named candidates.

**Risk:** two write paths to `user_group` (group- + member-centric) — both diff the same partial-unique join; assert idempotency on both.

---

## Slice 6 — the "Access" Settings tab + statement editor + Members group assignment

The whole FE: SDK domains, the entitlement hook, the tab, the authoring module (with the searchable-multiselect instance picker), and group assignment on Members.

**Files**

- New: web `api/policies.api.ts`, `roles.api.ts`, `groups.api.ts`, `rbac-objects.api.ts`; edit `api/sdk.ts` + `api/keys.ts`.
- New: `utils/use-custom-rbac-entitled.util.ts`; edit `utils/routes.util.ts` (`SettingsTab.Access = "access"`, index 5).
- New: `modules/AccessAuthoring/` (container + pure-UI list/dialogs per the Module Pattern; the statement-editor row with class/instance scope + `AsyncSearchableSelect` multi fan-out).
- Edit: `views/Settings.view.tsx` (Access tab, gated on capability + entitlement, locked state); the Members tab (group assignment, member-centric).
- Edit (doc-sync): `packages/core/src/content/glossary.util.ts` + `faq.util.ts` (custom role / policy / group terms), `apps/web/README.md` if a convention note is warranted.

**Steps**

1. **Tests (spec: web ~18).** statement editor — class row → one `PolicyStatementInput` with `condition`; instance row picking N objects → N instance inputs (`condition:null`); picker disabled for `entity_record`/pseudo; `FormAlert` on `RBAC_POLICY_EXCEEDS_BOUNDARY`; create dialogs per the Dialog & Form Test Checklist; system role/policy read-only; Access tab renders only with capability+entitlement, shows locked state otherwise; `useCustomRbacEntitled` fail-open→false. Run; fail.
2. **Implement** the SDK, hook, tab, module, Members assignment. Green.
3. Lint + type-check.

**Done when:** an admin authors a bounded policy/role/group and assigns them entirely through the UI, with instance objects chosen by search; the tab locks without the entitlement.

**Risk:** Component File Policy (≤2 components/file, container + `…UI`); the `AsyncSearchableSelect` label-map is the one sanctioned hand-rolled fetch (`utils/api.util.ts`).

---

## Sequence summary

| Slice | Lands | Gating check |
|---|---|---|
| 1 | `groups`/`user_group` + `group` principal in `loadSet` + migration | group-attached policy resolves; migration test |
| 2 | `assertStatementsWithinBoundary` + `customRbac` entitlement (+ tier migration) | boundary unit matrix + entitlement integration |
| 3 | policy CRUD API (3 gates, boundary, audit) | `policy.router` integration |
| 4 | role CRUD API (policy bundling, cascade) | `role.router` integration |
| 5 | group CRUD + membership + object-search endpoint | `group.router` + `rbac-object-search` integration |
| 6 | Access tab UI + statement editor + Members assignment | web unit (~18) |

## Cross-slice notes

- **Two migrations** (S1 tables+CHECK, S2 `tiers.custom_rbac`) — kept separate so each slice's dual-schema `type-checks` is green at its own boundary; each ships `.sql` + journal + snapshot.
- **`rbac-authoring.contract.ts` grows across S3–S5** (policy → role → group schemas), each slice adding only what it consumes — no forward reference.
- **Audit actions are added in the slice that first emits them** (S3 policy.*, S4 role.*/policy.attach·detach, S5 group.*/group.member.*), keeping the closed union honest per slice.
- **`rbac-object-resolver.ts`** is introduced in S3 (createdBy lookup for the boundary) and extended in S5 (search) — one module, two capabilities, no duplication.
- **Doc-sync (S6, same PR):** the Help glossary/FAQ gain custom-role/policy/group terms (`CLAUDE.md` → "Keeping Documentation in Sync"); the pinning tests (`glossary.util.test`, `faq.util.test`) catch structural drift.
- **`POLICY_PRINCIPAL_TYPES` also feeds `permission_grants.principalType`** — S1 makes `group` a valid grant principal too; harmless (nothing authors a group grant), but note it in the S1 commit.

## Next step

Implementation begins on `feat/622-rbac-custom-authoring`, slice 1 first (tests-first, one commit per slice), only after discovery + spec + plan are reviewed and confirmed.
