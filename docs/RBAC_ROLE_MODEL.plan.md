# Role model / RBAC beyond owner-member — Plan

**TDD-sequenced implementation of the role model + enforcement seam: the `OrgRole` column, `PermissionService` (`check` guard + `visibilityPredicate`), role in middleware, the three owner-check replacements, the `member.role.change` audit + assignment endpoint, web role gating, and the member list-scoping pattern + dormant-middleware removal.**

Spec: `docs/RBAC_ROLE_MODEL.spec.md`. Discovery: `docs/RBAC_ROLE_MODEL.discovery.md`. Issue: #576 (epic #578). Follow-on children #598 (grants) and #599 (curated views) extend the `resolveEffect`/predicate seam this ticket builds — nothing here provisions their schema (Key decision 1).

Five slices, each behind a green suite and each leaving the tree compilable. They land as **commits on `feat/rbac-role-model`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit && npm run test:integration
cd apps/web && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — schema first, then the resolver in isolation, then the wirings that consume it, cleanup last:

- **Slice 1** — the `role` column + model + migration/backfill. Pure data; nothing reads it yet.
- **Slice 2** — `PermissionService` (`check` + `visibilityPredicate`) unit-tested against mocked context, plus role onto `req.application.metadata`, plus removal of the dormant `authorization.middleware.ts` (the real service supersedes it). The decision logic exists and is fully tested before anything calls it; the predicate is wired into **no** list read (Key decision 5).
- **Slice 3** — swap the three hand-written owner checks to `check`. Consumes slice 2; no new surface.
- **Slice 4** — the `member.role.change` audit action + the assignment endpoint (with the OQ2 owner-only-mints-admins route refinement).
- **Slice 5** — `role` on `current()` + the web `useRole()` gating.

**No grant/view schema** (Key decision 1). **No list-read wiring** — the predicate ships unwired; member data-visibility scoping is #598 (Key decision 5). One migration (slice 1). `org.delete` is owner-only (Key decision 2).

---

## Slice 1 — `OrgRole` + `role` column + migration/backfill

The data foundation: the enum, the column, the owner backfill, and role set at membership creation. Nothing consumes `role` yet.

**Files**

- Edit: `packages/core/src/models/organization-user.model.ts` — `ORG_ROLES`, `OrgRoleSchema`, `role` on `OrganizationUserSchema`.
- Edit: `apps/api/src/db/schema/organization-users.table.ts` — `role` column + `organization_users_role_check`.
- New: the migration (`npm run db:generate -- --name add_organization_user_role`) + the hand-added owner-backfill `UPDATE` (spec → Migration).
- Edit: `apps/api/src/services/application.service.ts` — set the bootstrap owner membership's `role: "owner"`.
- Tests: `packages/core/__tests__/models/organization-user.model.test.ts` (cases 1, 2); `apps/api` integration for the column + CHECK + backfill (cases 5, 6, 7) and the owner-membership-role-on-provision assertion.

**Steps**

1. **Tests (spec cases 1, 2, 5, 6, 7).** `OrgRoleSchema` accepts `owner|admin|member`, rejects `viewer`; `OrganizationUserSchema` requires `role`. Integration: insert per-role round-trips, CHECK rejects invalid; dual-schema `type-check` holds; **backfill** — seed org + owner membership + a second member before migrate, assert owner→`owner`, other→`member`, none null; a freshly-provisioned org's owner membership is `owner`. Run; fail.
2. **Implement** the enum + schema field, the Drizzle column + CHECK, the migration with the ordered `ADD COLUMN` → owner `UPDATE … FROM organizations` → CHECK, and the `role: "owner"` at the bootstrap site. Green.
3. Lint + type-check.

**Done when:** cases 1, 2, 5, 6, 7 pass; every membership resolves a valid role; nothing reads `role` yet. Commit the migration `.sql` + `meta/_journal.json` + snapshot together (`project_drizzle_journal_must_be_committed`).

**Risk:** backfill ordering (default → owner `UPDATE` → CHECK). Test 7 asserts it on a pre-seeded DB.

---

## Slice 2 — `PermissionService` + role in middleware + `INSUFFICIENT_ROLE` + remove dormant middleware

The resolver, unit-tested in isolation, role attached to the request, and the dead Auth0-RBAC scaffolding deleted. Not yet consumed by any route.

**Files**

- New: `apps/api/src/services/permission.service.ts` — `PermissionContext`, `PermissionAction`, `PermissionObject`, `check`, `visibilityPredicate`, private `resolveEffect` (grant-ready seam).
- Edit: `apps/api/src/constants/api-codes.constants.ts` — `INSUFFICIENT_ROLE`.
- Edit: `apps/api/src/middleware/metadata.middleware.ts` — attach `role: orgResult.organizationUser.role`.
- Edit: `apps/api/src/types/express.d.ts` — `role: OrgRole` on `metadata`.
- Remove: `apps/api/src/middleware/authorization.middleware.ts` (dormant `requireScope`/`requirePermission`; the real service supersedes it) + any dead import.
- Export `SYSTEM_USER_ID` as a shared constant if not already.
- Tests: `apps/api/src/__tests__/services/permission.service.test.ts` (cases 8–12); a middleware/probe assertion (case 18).

**Steps**

1. **Unit tests (spec cases 8–12).** owner allows all; admin denied `billing.manage` + `org.delete`, allowed the rest; member `resource.*` only for own `createdBy` (and read for `SYSTEM_USER_ID`), all admin actions denied; `visibilityPredicate` → `undefined` for owner/admin, `createdBy = me OR SYSTEM_USER_ID` for member; `check` throws `ApiError(403, …)` with the mapped code. **Case 18:** `req.application.metadata.role` is populated. Run; fail.
2. **Implement** `PermissionService` per spec (role-only policy behind `resolveEffect`, both `check` and `visibilityPredicate` fully tested), add `INSUFFICIENT_ROLE`, wire role into the middleware + `express.d.ts`. Green.
3. **Remove** `authorization.middleware.ts` — grep first to confirm nothing imports it; delete; `type-check`/`lint` confirm.
4. Lint + type-check.

**Done when:** cases 8–12 + 18 pass; the gate is a pure, fully-tested function of its context; the dormant middleware is gone; **`visibilityPredicate` is implemented and unit-tested but wired into no list read** (Key decision 5) — nothing consumes it or `check` yet.

**Risk:** none — isolated logic; middleware change is one field; the removed middleware is confirmed-unused.

---

## Slice 3 — Replace the three hand-written owner checks

Swap org-delete, audit-log read, and billing to `PermissionService.check`. Behavior change: audit-log read widens owner→owner+admin.

**Files**

- Edit: `apps/api/src/routes/organization.router.ts` — org delete (`:294`, `check(ctx, "org.delete")`, keep `ORGANIZATION_NOT_OWNER`); audit-log read (`:925`, `check(ctx, "org.audit.read")`, `INSUFFICIENT_ROLE`).
- Edit: `apps/api/src/services/billing.service.ts` — `:348,:445` → `check(ctx, "billing.manage")`, keep `BILLING_NOT_OWNER`; thread `ctx` from the caller.
- Tests: route integration (cases 13, 14, 15).

**Steps**

1. **Integration tests (spec cases 13, 14, 15).** org delete: non-owner (incl. **admin**) → 403 `ORGANIZATION_NOT_OWNER`, owner → ok; audit read: member → 403 `INSUFFICIENT_ROLE`, **admin → 200**, owner → 200; billing: admin → 403 `BILLING_NOT_OWNER`, owner → 200. Run; fail.
2. **Implement** the three swaps, mapping `check` to the retained specific codes where applicable. Green.
3. Lint + type-check.

**Done when:** cases 13–15 pass; the three checks route through `PermissionService`; admins can now read the audit log (the #596 widen).

**Risk:** billing `ctx` threading — `billing.service` methods must receive `{ userId, organizationId, role }`; confirm each caller has `req.application.metadata` and passes it.

---

## Slice 4 — `member.role.change` audit + role-assignment endpoint

The minimal write surface #584/#585 build on, with the OQ2 refinement enforced in the route.

**Files**

- Edit: `packages/core/src/models/audit-log.model.ts` — `"member.role.change"` in `AUDIT_ACTIONS`.
- Edit: `apps/api/src/routes/organization.router.ts` — `PATCH /api/organization/members/:userId/role`; register `MemberRoleUpdateRequest` in `swagger.config.ts`; `MEMBER_NOT_FOUND` if missing.
- Tests: core (case 4); route integration (case 16).

**Steps**

1. **Tests (spec cases 4, 16).** `AUDIT_ACTIONS` includes `member.role.change`. Endpoint: owner promotes member→admin (200, emits `member.role.change` with `{targetUserId, from, to}`); **admin** promoting to admin/owner → 403 `INSUFFICIENT_ROLE`; admin sets member→member → 200; unknown member → 404. Run; fail.
2. **Implement** the action, the endpoint (`check(ctx, "member.role.assign")` then the OQ2 route rule: only `owner` may target/produce `admin`/`owner`), the update + audit emit, the `@openapi` block. Green.
3. Lint + type-check.

**Done when:** cases 4, 16 pass; roles are assignable within the OQ2 bounds and audited.

**Risk:** the OQ2 rule lives in the route, not the coarse `check` — the test must cover the admin-cannot-mint-admin path explicitly (it does).

---

## Slice 5 — `role` on `current()` + web `useRole()` gating

Thread the caller's role to the FE and drive Settings gating from it.

**Files**

- Edit: `packages/core/src/contracts/organization.contract.ts` — `role: OrgRoleSchema` on `OrganizationGetResponseSchema`.
- Edit: `apps/api/src/routes/organization.router.ts:402` — populate `role: result.organizationUser.role`.
- New: `apps/web/src/utils/use-role.util.ts` — `useRole()` from `sdk.organizations.current()`.
- Edit: `apps/web/src/views/Settings.view.tsx` — replace the `ownerUserId` derivation (`:108-112`) with `useRole()`; billing/danger-zone owner-only; Activity tab owner **+ admin**.
- Tests: core (case 3); route integration (case 17); web (cases 19, 20).

**Steps**

1. **Tests (spec cases 3, 17, 19, 20).** `OrganizationGetResponseSchema` accepts `{organization, role}`; `GET /api/organization/current` returns the caller's role; `useRole()` yields `{isOwner,isAdmin}` for owner/admin/member mocks; Settings hides billing/danger-zone for non-owner, shows Activity for owner+admin, hides for member. Run; fail.
2. **Implement** the contract field, the `current()` payload, `useRole()`, and the Settings swap. Green.
3. Lint + type-check.

**Done when:** cases 3, 17, 19, 20 pass; the web app gates from `useRole()`, not a recomputed `ownerUserId` compare.

**Risk:** the `current()` handler already holds `result` — just add the field; no new query.

---

## Sequence summary

| Slice | Lands | Spec cases | Tests |
|---|---|---|---|
| 1 | `OrgRole` + `role` column + migration/backfill + creation site | 1, 2, 5, 6, 7 | core unit + api integration |
| 2 | `PermissionService` (`check` + unwired `visibilityPredicate`) + role in middleware + `INSUFFICIENT_ROLE` + remove dormant middleware | 8–12, 18 | api unit |
| 3 | replace org-delete / audit-read / billing checks | 13, 14, 15 | api integration |
| 4 | `member.role.change` + assignment endpoint (OQ2) | 4, 16 | core + api integration |
| 5 | `role` on `current()` + web `useRole()` gating | 3, 17, 19, 20 | core + api + web |

Total ≈ **20 enumerated cases**. One migration (slice 1). Commits on `feat/rbac-role-model`.

## Cross-slice notes

- **Migration hygiene:** slice 1 commits the `.sql` + `meta/_journal.json` + snapshot together, and after merge run `cd apps/api && npm run db:migrate` on any dev DB (`project_dev_seeds_not_migrates`).
- **Fail-closed** is the whole posture — `check` denies on unresolved role; the member `resource.*` default requires an explicit `createdBy` match. No route may skip `check` on a privileged mutation.
- **`ctx` plumbing:** every gated call needs `{ userId, organizationId, role }` from `req.application.metadata` — available after slice 2. Service-layer callers (billing) take it as a parameter, not by reaching into `req`.
- **Grant-ready seam:** `resolveEffect` + `visibilityPredicate` are the two points #598 extends (add grant lookup) — no call-site churn there later, by design.
- **List-scoping deferred (Key decision 5):** #576 wires the predicate into **no** list read, so a member's visible data is unchanged by this ticket. #598 wires `visibilityPredicate` into the list repositories when the grant layer makes selective visibility restorable — shipping `createdBy`-scoping before sharing exists would strip cross-visibility with no grant to restore it.
- **Doc reconciliation owed (from Key decision 1):** the "provisions the grant/view schema (unused)" line must be dropped from **#576's body**, the **discovery** (Recommendation #7 / Next step), the **Developer Roadmap** artifact (#576 + #598 rows), and the **RBAC addendum** (delivery table). This is a docs-in-sync task tied to this PR, not code — do it alongside slice 1.
- **No user-facing doc surface** (Help/glossary/README) describes owner-vs-member today, so no user-facing copy changes; the phase docs are the record.

## Next step

Implementation begins on `feat/rbac-role-model`, slice 1 first (tests-first), one commit per slice — only after discovery + spec + plan are reviewed and confirmed.
