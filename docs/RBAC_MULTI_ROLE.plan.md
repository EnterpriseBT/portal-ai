# RBAC multi-role: user_role join + enum cutover — Plan

**TDD-sequenced cutover from the single-role enum to the `user_role` join: source-of-truth first (unread), then reads (parity-gated), then writes, then the FE + the clean-cut removals — additive throughout so every slice is green.**

Spec: `docs/RBAC_MULTI_ROLE.spec.md`. Discovery: `docs/RBAC_MULTI_ROLE.discovery.md`. Issue: #620 (epic #578). Builds on shipped **#598** (RBAC engine; `PermissionSet` already unions multiple roles) and **#584/#585** (seats/members).

Four slices, each behind a green suite and each leaving the repo compilable. Commits on `feat/620-rbac-multi-role` (PR #624). Tests via npm scripts (`feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit && npm run test:integration
cd apps/web && npm run test:unit
```

Each slice: (1) failing tests; (2) smallest change to green; (3) focused run; (4) `npm run lint && npm run type-check`; (5) next.

Sequencing rationale — **additive until the last slice, so nothing breaks mid-cutover:**
- **Slice 1** builds `user_role` + remaps every membership. It's the new source of truth but **nothing reads it yet** — the enum still governs.
- **Slice 2** flips *reads* to `user_role` (`ctx.roles`, `loadSet` union) and makes `current()`/`listMembers` **additive** — they gain `roles[]` + `capabilities` but **keep the scalar `role`** so the un-migrated FE stays green. Single-role parity is the gate.
- **Slice 3** flips *writes* to `user_role` (the `PUT …/roles` set-the-set + guards), and **shims the old `PATCH …/role`** to write `user_role` so the un-migrated FE's role change still works.
- **Slice 4** cuts the FE over to `capabilities` + multi-role, then removes the now-dead scalar `role` + `PATCH …/role` (the clean cut lands last, after nothing reads them).

The enum column stays (vestigial mirror, D6); its drop is a follow-up ticket.

---

## Slice 1 — `user_role` table + remap backfill (source of truth, unread)

**Files**

- New: `packages/core/src/models/user-role.model.ts` (+ `models/index.ts`); `apps/api/src/db/schema/user-role.table.ts` + `db/repositories/user-roles.repository.ts` (register in `zod.ts`, `type-checks.ts`, `schema/index.ts`, `repositories/index.ts`, `db.service.ts`, `teardownOrg`); the `add_user_role` migration + the `NNNN_backfill-user-roles.sql` data migration (`-- backfill:user-role` marker).
- Edit: `services/seed.service.ts` / `application.service.ts` — insert the owner's `user_role` row at provisioning (same tx as the owner membership).

**Steps**

1. **Tests (spec cases 1 core, 4/6/10 integration).** `UserRoleSchema` round-trips; repo insert + **unique `(userId,org,roleId)`** rejects a duplicate; backfill remaps a pre-migration membership → the right seeded role; a new org's owner has a `user_role` row. Run; fail.
2. **Implement** the table + dual-schema + repo + migrations + provisioning insert. Green.
3. Lint + type-check; **commit migration + journal + snapshot together** (`project_drizzle_journal_must_be_committed`).

**Done when:** cases 1,4,6,10 pass; every membership has a `user_role` row; nothing reads it yet (the enum still governs).

**Risk:** the backfill (the #316/#414 failure mode) — test 6 is the guard. No behavior change.

---

## Slice 2 — Reads cutover (additive contract; single-role parity the gate)

**Files**

- Edit: `packages/core/src/{models/permission.model.ts (+CALLER_CAPABILITY_ACTIONS,CapabilityMap), contracts/organization.contract.ts}` — add `roles[]` + `capabilities`, **keep `role`** (transitional). `apps/api/src/{services/permission.service.ts (ctx.roles + loadSet union + capabilities()), middleware/metadata.middleware.ts, types/express.d.ts, db/repositories/roles.repository.ts (findByNames)}`; `routes/organization.router.ts` + `billing.router.ts` (`current()` returns `roles`+`capabilities`+`role`); `services/{seat.service.ts (listMembers +roles[]), application.service.ts (getCurrentOrganization/switch derive roles)}`.

**Steps**

1. **Tests (spec cases 2 core, 3 api-unit, 5/9 integration).** contract requires `roles[]`+`capabilities`; `capabilities()` maps each action to `can`; `loadSet` with two roles = union, **single-role users resolve identically to pre-#620** (parity); `current()` returns correct `roles`+`capabilities` per role, `listMembers` returns `roles[]`. Run; fail.
2. **Implement** `ctx.roles` (middleware from `user_role⋈roles`), `loadSet` per-role principals, the `capabilities()` helper, additive `current()`/`listMembers`. Keep `role` = highest (transitional). Green — **web stays green** (still reads `role`).
3. Lint + type-check.

**Done when:** cases 2,3,5,9 pass; authz + display read from `user_role`; **single-role parity holds**; the contract is additive (FE untouched, still green).

**Risk:** parity drift — test 5 asserts single-role users are unchanged. `PermissionSet` union is additive so multi-role is safe.

---

## Slice 3 — Writes cutover (`PUT …/roles` + guards; `PATCH …/role` shimmed)

**Files**

- Edit: `packages/core/src/contracts/organization.contract.ts` (`MemberRolesSetRequestSchema`), `models/audit-log.model.ts` (+`member.role.add`/`.remove`). `apps/api/src/routes/organization.router.ts` (new `PUT /members/:userId/roles` set-the-set diff + guards + audit; `PATCH …/role` shimmed to `setRoles([role])`), `services/{seat.service.ts (removeMember last-owner via user_role count; attachMembership/accept → user_role + enum mirror), application.service.ts (creation → user_role + mirror)}`, `constants/api-codes.constants.ts` (`MEMBER_MIN_ONE_ROLE`, `LAST_OWNER_ROLE_REMOVAL`).

**Steps**

1. **Tests (spec cases 1 (min), 7/8 integration).** `MemberRolesSetRequest` rejects empty; `PUT …/roles` adds/removes to match, **≥1-role** + **last-owner-role** guards (409s), owner add/remove owner-gated, audits add/remove; `removeMember` last-owner guard via `user_role` count. Run; fail.
2. **Implement** the set-roles service (tx diff + in-tx guard re-checks), the membership-creation → `user_role` writes + enum mirror, the `PATCH` shim. Green — **web stays green** (still calls `PATCH …/role`, now writing `user_role`).
3. Lint + type-check.

**Done when:** cases 7,8 (+min) pass; all role writes flow to `user_role`; guards enforced; the old `PATCH` still works via the shim.

**Risk:** a set-roles race leaving 0 owners/roles — guards re-checked inside the tx; unique index blocks dups.

---

## Slice 4 — FE capability cutover + clean-cut removals

**Files**

- Edit: `apps/web/src/utils/use-role.util.ts` → `useCapabilities()`; `api/{organizations,members}.api.ts` + `keys` (`current()` `roles`+`capabilities`; `setRoles` replacing `changeRole`); `components/{MemberList,MembersTab}.component.tsx`, `views/Settings.view.tsx` (+ Profile "Your roles"), `SubscriptionBilling`/`TierCard` — gate on `can(...)`, role column → `roles[]` chips, editor → multi-select.
- **Remove (clean cut):** the scalar `role` from `OrganizationGetResponseSchema` + `ApplicationMetadata`; `PATCH …/role` + `MemberRoleUpdateRequestSchema`; `isOwner`/`isAdmin`/`isAdminOrOwner`.

**Steps**

1. **Tests (spec cases 11,12 web).** `useCapabilities()` → `can`; gates render on `can(...)`, **no `isOwner` refs remain** (a grep-style assertion or updated snapshots); `MemberList` renders `roles[]` chips + the multi-select set-roles; Profile shows roles. Run; fail.
2. **Implement** the FE cutover; then remove the scalar `role`, `PATCH …/role`, and the `isOwner` helpers (nothing reads them now). Green (web + api).
3. Lint + type-check; full `apps/web` + `apps/api` suites (shared contract touched).

**Done when:** cases 11,12 pass; FE gates entirely on `capabilities`; `role`/`PATCH …/role`/`isOwner` are gone; existing suites green.

**Risk:** a missed `data.role` / `isOwner` consumer — the removal makes it a compile error (type-check catches it).

---

## Sequence summary

| Slice | Lands | Spec cases | Gate |
|---|---|---|---|
| 1 | `user_role` + remap backfill (unread) | 1,4,6,10 | backfill remaps every membership |
| 2 | reads → `user_role`; additive `roles[]`+`capabilities` | 2,3,5,9 | **single-role parity** |
| 3 | writes → `user_role`; `PUT …/roles` + guards; `PATCH` shim | 1(min),7,8 | guards enforced, old path still works |
| 4 | FE `useCapabilities` + multi-role; remove `role`/`PATCH`/`isOwner` | 11,12 | no `isOwner`/`role` refs; suites green |

≈ **12 cases** + the migration probe. Commits on `feat/620-rbac-multi-role`; PR #624 grows commit-by-commit.

## Cross-slice notes

- **Additive-then-cut is the whole trick.** The contract keeps `role` + the `PATCH …/role` route working through slices 2–3 (writing/reading `user_role` underneath) so the un-migrated FE never breaks; slice 4 removes them once the FE reads `capabilities`. No cross-slice red.
- **Drizzle discipline:** slice 1's two migrations commit with journal + snapshot (`project_drizzle_journal_must_be_committed`); rebuild `@portalai/core` before api type-check after the model/contract edits (`project_stale_core_dist_after_branch_switch`).
- **Test-org setup:** `seedUserAndOrg`/manual org setups already seed RBAC (from #598's `seedRbacForOrg`); they now also need an owner `user_role` row — fold into `seedRbacForOrg` (or provisioning) so guard/route suites resolve roles.
- **Enum mirror (D6):** written app-side to the highest role on every `user_role` change (slice 3); unread after slice 2; dropped in a follow-up ticket.
- **Capability-action list** is revisited during the smoke walk (per the ticket owner) — `CALLER_CAPABILITY_ACTIONS` is the one list to eyeball there.
- **Doc-sync:** the auth/gating model changes; re-check `apps/web/README.md` / `CLAUDE.md` mentions of `useRole`/role gating and update in this PR (per "Keeping Documentation in Sync").

## Next step

Implement slice 1 on `feat/620-rbac-multi-role` — `user_role` table + model + repo + remap backfill, tests-first — only after discovery/spec/plan are confirmed. Re-read the spec's *Surface* (the `user_role` shape, `capabilities` map, set-roles contract) before coding; lift, don't reinvent.
