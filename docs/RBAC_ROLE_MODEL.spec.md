# Role model / RBAC beyond owner-member — Spec

**Issue:** [EnterpriseBT/portal-ai#576](https://github.com/EnterpriseBT/portal-ai/issues/576) · **Epic:** #578 · **Discovery:** `docs/RBAC_ROLE_MODEL.discovery.md`

This pins the contract for #576: a `role` enum on `organization_users`, a single `PermissionService` (a mutation **guard** + a list **visibility predicate**), role resolution in `metadata.middleware`, replacement of the three hand-written owner checks (org delete, audit-log read, billing), a `member.role.change` audit action, a minimal role-assignment endpoint, and `role` threaded to the web app for role-aware gating. It builds the **role model + enforcement seam only** — the composable-grant layer (#598) and curated views (#599) are out of scope, and the resolver is shaped so they plug into the same `check`/predicate without re-plumbing call sites.

## Key decisions (flag for review)

1. **#576 does NOT provision the grant/view schema. CONFIRMED — dropped.** The discovery's Recommendation #7 (and #576's body) said #576 would create the `permission_grants`/`views` tables "unused" so the children start from a live table. **Dropped** — an empty table with no reader/writer in #576 is exactly the speculative infra the standing "don't build infra without a concrete caller" rule warns against, and migrations are additive so #598/#599 each create their own schema when they land. `PermissionService` is instead built **grant-ready** (a single `resolveEffect` seam the grant layer extends). #576's body, the discovery, the roadmap, and the addendum are reconciled to drop the "provisions schema unused" language.
2. **`org.delete` is owner-only, alongside billing. CONFIRMED — owner-only.** So `admin` = everything except `billing.manage` and `org.delete`. Org deletion is the most destructive action there is; owner-only is the safer reading (and matches "owner retains billing **and org delete**").
3. **Coarse policy is role-only in #576** (no grant consultation yet): owner = all; admin = all − {billing, org.delete}; member = `createdBy`-scoped read/write (+ the `createdBy = SYSTEM_USER_ID ⇒ member read` rule from discovery OQ1, covering the default station and default sandbox instance). Grant resolution is the #598 seam.
4. **Role-assignment authority (OQ2):** owner + admin may assign the `member` role; **only the owner** may mint/remove `admin` or grant/revoke `owner`. Enforced in the assignment route, not just the coarse `check`.
5. **Wire zero list reads (CONFIRMED).** #576 does **not** scope any list read — a member still sees what they see today. `visibilityPredicate` (and the member `createdBy`/`SYSTEM_USER_ID` logic it encodes) ships implemented + unit-tested as the seam, but no domain route consumes it; wiring it in is #598's job, where the grant layer makes selective visibility restorable. This deliberately refines discovery Decision 4 ("the repo predicate ships now") to "the predicate ships **unwired** now" — building the wiring before sharing exists would strip members of cross-visibility with no way to grant it back.

## Scope

### In scope

1. **`OrgRole` core enum** + `role` on `OrganizationUserSchema` (dual-schema).
2. **`role` column** on `organization_users` (Drizzle) + migration with owner backfill + CHECK.
3. **`PermissionService`** — `check(ctx, action, object?)` (guard) + `visibilityPredicate(ctx, opts)` (list reads), role-only policy behind a grant-ready `resolveEffect` seam. **The predicate is implemented + unit-tested here but wired into no list read** — `check` is wired only for the privileged actions (org-delete, billing, audit-read, role-assign); member data-visibility list-scoping lands with #598 ("wire zero" — Key decision 5).
4. **Role resolution in `metadata.middleware`** — `role` onto `req.application.metadata` (+ `express.d.ts`).
5. **Replace the three hand-written owner checks** — org delete, audit-log read (`organization.router.ts`), billing (`billing.service.ts`) — with `PermissionService.check`.
6. **`INSUFFICIENT_ROLE`** `ApiCode`.
7. **`member.role.change`** audit action + emission on assignment.
8. **Minimal role-assignment endpoint** — `PATCH /api/organization/members/:userId/role`.
9. **Role on the wire** — `role` on `OrganizationGetResponse`, populated in `GET /api/organization/current`.
10. **Web role gating** — a `useRole()` hook fed by `sdk.organizations.current()`; replace the `isOwner`-only derivation in `Settings.view.tsx`; owner/admin-aware gating.
11. **Set `role` at membership-creation sites** — owner membership → `owner`, other adds → `member` (`application.service.ts`).

### Out of scope

- **Composable grants, policies, sharing, read-only override** — #598 (the `check`/predicate seam is built here; grant rows are not).
- **Wiring `visibilityPredicate` into list reads (member data-visibility scoping)** — #598. #576 builds + unit-tests the predicate but wires it into no route (Key decision 5).
- **Curated views, always-live pins, per-caller tool-authorization gate, governance toolpack, role-gated nav depth** — #599.
- **Custom org-defined roles** — later child (a policy attached as a role default).
- **Invitations, seats, full Members/Team UI** — #583/#584/#585 (this ships only the minimal assignment endpoint they build on).
- **Auth0-side RBAC** — rejected; roles are DB-side. The dormant `requireScope`/`requirePermission` middleware is **removed** here, not extended.

## Surface

### `OrgRole` enum + `role` on the model

**File: `packages/core/src/models/organization-user.model.ts`** — add:

```ts
export const ORG_ROLES = ["owner", "admin", "member"] as const;
export const OrgRoleSchema = z.enum(ORG_ROLES);
export type OrgRole = z.infer<typeof OrgRoleSchema>;

export const OrganizationUserSchema = CoreSchema.extend({
  organizationId: z.string(),
  userId: z.string(),
  role: OrgRoleSchema,              // NEW
  lastLogin: z.number().nullable(),
});
```

### `role` column

**File: `apps/api/src/db/schema/organization-users.table.ts`** — add to the table body and a CHECK:

```ts
role: text("role").notNull().default("member"),
// (t) => [ check("organization_users_role_check", sql`${t.role} IN ('owner','admin','member')`) ]
```

**Dual-schema:** no new assertion needed — the existing `OrganizationUser` block in `type-checks.ts:235-257` covers the added field (a mismatch fails `type-check`). drizzle-zod (`zod.ts`) `OrganizationUserSelect/Insert` pick it up automatically.

### `PermissionService`

**File: `apps/api/src/services/permission.service.ts`** (new)

```ts
export interface PermissionContext { userId: string; organizationId: string; role: OrgRole; }

export type PermissionAction =
  | "billing.manage"       // owner only
  | "org.delete"           // owner only
  | "org.audit.read"       // owner + admin
  | "member.role.assign"   // owner + admin (route further restricts admin↔admin/owner)
  | "resource.read"        // role default; member ⇒ createdBy-scoped
  | "resource.write";      // role default; member ⇒ createdBy-scoped

/** The object a resource action targets. `createdBy` is required for member scoping. */
export interface PermissionObject { type: string; id?: string; createdBy?: string; }

export class PermissionService {
  /** Mutation/guard path. Throws ApiError(403, INSUFFICIENT_ROLE) on deny. */
  static check(ctx: PermissionContext, action: PermissionAction, object?: PermissionObject): void;

  /** List path. Returns a SQL predicate to AND into a findMany `where`, or
   *  `undefined` when the caller may see all org rows (owner/admin). */
  static visibilityPredicate(
    ctx: PermissionContext,
    opts: { createdByCol: AnyColumn },
  ): SQL | undefined;

  /** Grant-ready seam (#598 extends this; role-only today). */
  private static resolveEffect(ctx, action, object?): "allow" | "deny";
}
```

Role-only policy (this ticket):

- **owner** → allow everything.
- **admin** → allow everything **except** `billing.manage` and `org.delete` (Key decision 2).
- **member** → `resource.read`/`resource.write` allowed only when `object.createdBy === ctx.userId` **or** `object.createdBy === SYSTEM_USER_ID` (read only, OQ1); all admin actions denied.
- `visibilityPredicate`: owner/admin → `undefined`; member → `or(eq(createdByCol, ctx.userId), eq(createdByCol, SYSTEM_USER_ID))`.

`SYSTEM_USER_ID` is the existing system sentinel (`application.service.ts` `systemId`); lift it to a shared constant if not already exported.

### Error code

**File: `apps/api/src/constants/api-codes.constants.ts`** — add `INSUFFICIENT_ROLE = "INSUFFICIENT_ROLE"`. Existing `ORGANIZATION_NOT_OWNER` / `AUDIT_LOG_NOT_AUTHORIZED` / `BILLING_NOT_OWNER` are **retained** (billing/org-delete stay owner-only, so their names still read true) — `check` throws `INSUFFICIENT_ROLE` for the generic role gate and the audit-read widen; billing/org-delete may keep their specific codes via `check` throwing the mapped code, or switch to `INSUFFICIENT_ROLE`. **Decision: keep the specific codes** for all three privileged actions (billing → `BILLING_NOT_OWNER`, org-delete → `ORGANIZATION_NOT_OWNER`, audit-read → `AUDIT_LOG_NOT_AUTHORIZED`); `INSUFFICIENT_ROLE` is the generic gate (role assignment + future gates).

### Role in middleware

**File: `apps/api/src/middleware/metadata.middleware.ts`** — `getCurrentOrganization` already returns `{ organization, organizationUser }` (`application.service.ts:50`); the membership row now carries `role`. Attach it:

```ts
req.application = { metadata: {
  userId: user.id,
  organizationId: orgResult.organization.id,
  role: orgResult.organizationUser.role,   // NEW
} };
```

**File: `apps/api/src/types/express.d.ts`** — add `role: OrgRole` to the `metadata` interface (`:43-63`).

### Replace the hand-written owner checks

- **Org delete** `organization.router.ts:294` — `if (ownerUserId !== userId) …ORGANIZATION_NOT_OWNER` → `PermissionService.check(ctx, "org.delete")` (owner-only; keep the `ORGANIZATION_NOT_OWNER` code via the mapped throw).
- **Audit-log read** `organization.router.ts:925` — → `PermissionService.check(ctx, "org.audit.read")` (owner **+ admin** now — the widen the `:912-913` comment anticipated; #596's Activity tab follows). Keeps `AUDIT_LOG_NOT_AUTHORIZED` (accurate for the owner+admin gate, and consistent with billing/org-delete keeping their specific codes); `INSUFFICIENT_ROLE` is reserved for the generic gate (role assignment).
- **Billing** `billing.service.ts:348,445` — `if (ownerUserId !== callerUserId) …BILLING_NOT_OWNER` → `PermissionService.check(ctx, "billing.manage")` (owner-only; keep `BILLING_NOT_OWNER`). `ctx` is threaded from the caller (the router already has `req.application.metadata`).

### Audit action

**File: `packages/core/src/models/audit-log.model.ts`** — add `"member.role.change"` to `AUDIT_ACTIONS` (`:23-36`). Emit on assignment with metadata `{ targetUserId, from, to }` (pattern: `organization.router.ts:544-551`).

### Role-assignment endpoint (minimal)

**`PATCH /api/organization/members/:userId/role`** — `organization.router.ts`

- Body `{ role: OrgRole }`; validated via `validateWithSchema`.
- `PermissionService.check(ctx, "member.role.assign")` (owner/admin), then the **OQ2 refinement in the route**: only `owner` may target a membership whose new-or-current role is `admin`/`owner`; an admin assigning `admin`/`owner` → `INSUFFICIENT_ROLE`. Owner cannot be demoted here (ownership transfer is out of scope).
- On success: update the membership `role`, emit `member.role.change`, return the updated membership.
- `@openapi` block referencing a registered `MemberRoleUpdateRequest` component.
- New codes as needed: reuse `INSUFFICIENT_ROLE`; `MEMBER_NOT_FOUND` if absent (add if missing).

### Role on the wire

**File: `packages/core/src/contracts/organization.contract.ts`** — add the caller's role to the current-org response:

```ts
export const OrganizationGetResponseSchema = z.object({
  organization: OrganizationSchema,
  role: OrgRoleSchema,             // NEW — the caller's role in this org
});
```

**File: `apps/api/src/routes/organization.router.ts:402`** — populate `role: result.organizationUser.role` in the `current` success payload (the handler already has `result` from `getCurrentOrganization`).

### Web role gating

- **`apps/web/src/utils/use-role.util.ts`** (new) — `useRole(): { role: OrgRole | null; isOwner: boolean; isAdmin: boolean; canManageMembers: boolean }`, derived from `sdk.organizations.current()`. Single source (OQ5).
- **`apps/web/src/views/Settings.view.tsx`** — replace the `ownerUserId`-vs-`currentUserId` derivation (`:108-112`) with `useRole()`; billing/danger-zone stay owner-only (`:370`), the Activity tab (`:146`) widens to owner **+ admin**.
- Pattern only — no new SDK write endpoint on the web side beyond what the assignment endpoint needs (Members UI is #585).

### Membership-creation sites

**File: `apps/api/src/services/application.service.ts`** — set `role` when creating memberships: the org-bootstrap owner membership → `owner`; any other `member.add` path → `member` (default covers it, but set explicitly at the owner site).

## Migration

`cd apps/api && npm run db:generate -- --name add_organization_user_role`, one migration:

1. `ALTER TABLE organization_users ADD COLUMN role text NOT NULL DEFAULT 'member';` — backfills every existing row to `member`.
2. **Owner backfill** (hand-added to the generated SQL):
   ```sql
   UPDATE organization_users ou SET role = 'owner'
   FROM organizations o
   WHERE ou.organization_id = o.id
     AND ou.user_id = o.owner_user_id
     AND ou.deleted IS NULL;
   ```
3. `ALTER TABLE organization_users ADD CONSTRAINT organization_users_role_check CHECK (role IN ('owner','admin','member'));`

**No lockout:** the org creator's membership becomes `owner`; everyone else `member`. Ordering: default-backfill (1) before the owner `UPDATE` (2) before the CHECK (3). Commit the generated `.sql` + `meta/_journal.json` + snapshot together.

## Seed

No seed change. Roles are set at membership creation (owner/member) and backfilled by the migration; there is no global seeded role catalog (the enum is code-side, enforced by the CHECK).

## TDD test plan

Run via npm scripts: `cd packages/core && npm run test:unit`; `cd apps/api && npm run test:unit && npm run test:integration`; `cd apps/web && npm run test:unit`.

### Layer 1 — `@portalai/core`

1. `OrgRoleSchema` accepts `owner|admin|member`; rejects `viewer`/unknown.
2. `OrganizationUserSchema` now requires `role`; round-trips via the factory with `role` set.
3. `OrganizationGetResponseSchema` accepts `{ organization, role }`; rejects a missing/invalid role.
4. `AUDIT_ACTIONS` includes `member.role.change`; `AuditActionSchema` accepts it.

### Layer 2 — Drizzle / migration / type-checks (integration)

5. `organization_users` insert with each role round-trips; the CHECK rejects an invalid role.
6. Dual-schema `type-check` passes for the extended `OrganizationUser` (a scratch mismatch fails it).
7. **Migration backfill:** seed an org + owner membership + a second member **before** migrate; after migrate, the owner's row is `owner`, the other is `member`, and no row is null.

### Layer 3 — `PermissionService` (unit)

8. owner → `check` allows every action (billing, org.delete, audit, assign, read/write).
9. admin → allowed for audit.read/assign/resource.*; **denied** (`INSUFFICIENT_ROLE`) for `billing.manage` and `org.delete`.
10. member → `resource.read`/`write` allowed when `object.createdBy === userId`; denied for another user's object; **read allowed** when `createdBy === SYSTEM_USER_ID`, write denied; all admin actions denied.
11. `visibilityPredicate`: owner/admin → `undefined`; member → predicate matching `createdBy = me OR createdBy = SYSTEM_USER_ID`.
12. `check` throws `ApiError` with status 403 and the mapped code (`INSUFFICIENT_ROLE`, or `BILLING_NOT_OWNER`/`ORGANIZATION_NOT_OWNER` where mapped).

### Layer 4 — route integration

13. `DELETE` org as non-owner → 403 `ORGANIZATION_NOT_OWNER`; owner succeeds. Admin → 403 (Key decision 2).
14. Audit-log read: member → 403 `AUDIT_LOG_NOT_AUTHORIZED`; **admin → 200** (the widen); owner → 200.
15. Billing action: admin → 403 `BILLING_NOT_OWNER`; owner → 200.
16. `PATCH …/members/:userId/role`: owner promotes member→admin (200, emits `member.role.change`); **admin** promoting someone to admin → 403; admin sets member→member (200); unknown member → 404.
17. `GET /api/organization/current` payload includes the caller's `role`.
18. `req.application.metadata.role` is populated (a probe route/asserting middleware output).

### Layer 5 — web

19. `useRole()` returns `{ isOwner, isAdmin }` from a mocked `sdk.organizations.current()` (owner / admin / member cases).
20. Settings: billing + danger-zone hidden/disabled for non-owner; Activity tab visible for owner **and** admin, hidden for member.

**Totals:** ~4 core, ~3 migration/integration, ~5 service, ~6 route, ~2 web ≈ **20 cases**.

## Acceptance criteria

- [ ] All new cases pass; existing suites green; `npm run lint && npm run type-check` clean at repo root.
- [ ] `npm run db:migrate` on a DB with existing orgs backfills the creator's membership to `owner`, all others `member`, no null role.
- [ ] A member is denied the privileged actions **server-side** (org delete, billing, audit read, role assignment). Member data-visibility list-scoping is **deferred to #598** — `visibilityPredicate` is implemented + unit-tested here but wired into no list read, so a member's visible data is unchanged by #576.
- [ ] Owner has full control; admin can do everything **except** billing and org delete; admin can read the audit log.
- [ ] Only the owner may mint/remove `admin` or grant/revoke `owner`; role changes emit `member.role.change`.
- [ ] `GET /api/organization/current` returns the caller's `role`; the web app gates owner/admin surfaces from `useRole()`, not a recomputed `ownerUserId` compare.
- [ ] The dormant `requireScope`/`requirePermission` middleware is removed; no route depends on it.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| **Fail-open authz** — a route that forgets `check` silently allows a member. | Authz is **fail-closed** by policy: `check` denies unknown/unresolved role; the coarse default for `resource.*` requires an explicit `createdBy` match. Route-integration tests assert the deny path per gated route. |
| Backfill misses an owner (org with no matching membership) → owner locked out of owner-only actions. | The `UPDATE … FROM organizations` keys on `owner_user_id`; test 7 asserts the owner row flips. An org whose owner has no membership row is pre-existing data corruption, surfaced by the test, not caused here. |
| Reading org-delete as owner-only diverges from a literal "admin = owner − billing." | Flagged as Key decision 2 for confirmation; trivially widened to admin by removing `org.delete` from the owner-only set if you decide otherwise. |
| Dropping the grant/view provisioning diverges from the discovery/#576 body. | Flagged as Key decision 1; `PermissionService.resolveEffect` is the single seam #598 extends, so adding grants later touches one method + the predicate, not call sites. |
| Removing the dormant middleware breaks an import. | Grep confirms it's unused scaffolding; removal is covered by `type-check`/`lint`. |

**Rollback:** revert the migration (drop the CHECK + `role` column) + `git revert`. Data-lossless (no production data; project memory).

## Files touched

**`packages/core`** — edit: `models/organization-user.model.ts` (+`OrgRole`, `role`), `models/audit-log.model.ts` (+action), `contracts/organization.contract.ts` (+`role`); new `__tests__` for the enum/contract/action.

**`apps/api`** — new: `services/permission.service.ts`, the migration, `permission.service` unit tests + route-integration tests; edit: `db/schema/organization-users.table.ts`, `middleware/metadata.middleware.ts`, `types/express.d.ts`, `constants/api-codes.constants.ts`, `routes/organization.router.ts` (org-delete + audit checks, current payload, role-assignment endpoint), `services/billing.service.ts` (checks), `services/application.service.ts` (set role at creation), and **remove** `middleware/authorization.middleware.ts`.

**`apps/web`** — new: `utils/use-role.util.ts` + test; edit: `views/Settings.view.tsx`, `api/organizations.api.ts`/`sdk.ts` if the current() type needs the `role` field surfaced.

No new dependency. No env-var or infra change.

## Next step

`docs/RBAC_ROLE_MODEL.plan.md` — TDD slices, each a testable commit on this branch: (1) `OrgRole` + `role` column + migration/backfill + dual-schema; (2) `PermissionService` (`check` + `visibilityPredicate`, unit-tested; predicate wired nowhere) + role in `metadata.middleware` + `INSUFFICIENT_ROLE` + **remove the dormant `authorization.middleware.ts`**; (3) replace the three owner checks (org-delete, audit-read widen, billing) via `check`; (4) `member.role.change` + the role-assignment endpoint (with the OQ2 route refinement); (5) `role` on `current()` + web `useRole()` gating. **5 slices** — no list-read wiring in #576 (Key decision 5; that lands with #598).
