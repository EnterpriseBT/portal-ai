# RBAC IAM engine + system policies — Spec (#598)

Pins the contract for the **engine foundation**: the data-driven authorization engine that replaces #576's hardcoded role switch, seeded as the three system policies and provisioned for new **and** existing orgs, retiring the switch **behavior-preservingly**. **Discovery:** `docs/RBAC_IAM_ENGINE.discovery.md` (the whole-engine design record — this spec is the #598 slice of it). **Issue:** [#598](https://github.com/EnterpriseBT/portal-ai/issues/598) (epic #578). Builds on shipped **#576** (`permission.service.ts` seam).

**Scope boundary:** this ticket is the foundation. `permission_grants` + object-enforcement wiring + `assertWithinBoundary` → **#621**; `user_role`/multi-role → **#620**; `groups`/custom-authoring → **#622**; views/data-plane → **#599**. #598 adds **no HTTP endpoint, no frontend change** — it is a backend refactor of the authorization decision path + provisioning.

## Key decisions (from discovery — confirm captured)

1. **AWS-IAM model** (D1): policies = statements over `(verb, resourceType, resourceId?)`; roles are policy-attachment principals via one polymorphic `policy_attachments` (principal `user`|`role` in #598; `group` added in #622).
2. **Pure-AWS resolution** (D2/D7): explicit deny → explicit allow → implicit deny; no specificity ranking.
3. **Ownership = a bounded, SQL-translatable condition** (D6): `condition ∈ {created_by_caller, created_by_system}` — not resolver code. System roles become pure data; no per-object ownership rows/backfill.
4. **Normalized statements** (D5), not JSONB — so `visibilityPredicate` is pure SQL.
5. **Behavior-preserving:** the engine reproduces the switch exactly (switch-parity is the gate); `visibilityPredicate` + object `resource.*` are the tested engine API but are **not wired into routes** here (that tightens member visibility, so it lands in #621 with grants).
6. **Both provisioning paths** (the #316/#414 rule): `seedRbacSystemPolicies` for new orgs **and** a backfill migration for existing orgs, enforced by the backfill-coverage guard.
7. **Fail-closed**, **resolve-once-per-request** (confirmed OQs).

## Surface

### Core models — `packages/core/src/models/permission.model.ts` (new)

```ts
export const PERMISSION_EFFECTS = ["allow", "deny"] as const;              // PermissionEffect
export const PERMISSION_VERBS   = ["read","write","delete","share","manage","invite","*"] as const;
export const PERMISSION_RESOURCE_TYPES = [
  "station","pin","view","portal","entity","entity_record","field_mapping",
  "connector_instance","billing","org","member","audit","*",
] as const;                                                                 // PermissionResourceType
export const PERMISSION_CONDITIONS = ["created_by_caller","created_by_system"] as const;

export const PermissionStatementSchema = z.object({
  effect: z.enum(PERMISSION_EFFECTS),
  verb: z.enum(PERMISSION_VERBS),
  resourceType: z.enum(PERMISSION_RESOURCE_TYPES),
  resourceId: z.string().nullable(),                 // null = class (type:*)
  condition: z.enum(PERMISSION_CONDITIONS).nullable(),
});
```

Plus `CoreSchema.extend` models with the standard Model/Factory pattern (mirroring `organization-user.model.ts`):
- **`PolicySchema`**: `{ organizationId, name, kind: "system"|"custom", immutable: boolean, description: string|null }`.
- **`RoleSchema`**: `{ organizationId, name, kind: "system"|"custom", immutable: boolean }`.

(`PermissionGrant`/`Group` models are #621/#622.)

### Drizzle tables — `apps/api/src/db/schema/*.table.ts` (4 new, `baseColumns` + org FK; entity-tags is the template)

| Table | Columns (beyond `baseColumns` + `organizationId`) | Indexes / constraints |
|---|---|---|
| `permission_policies` | `name`, `kind`, `immutable`, `description?` | unique `(organizationId, name)` WHERE deleted IS NULL; CHECK kind ∈ enum |
| `permission_statements` | `policyId`→policies, `effect`, `verb`, `resource_type`, `resource_id?`, `condition?` | idx `(policyId)`, idx `(organizationId, resource_type, resource_id)`; CHECK effect/verb/condition ∈ enums |
| `policy_attachments` | `policyId`→policies, `principal_type` (`user`\|`role`), `principal_id` | idx `(principal_type, principal_id)`; unique `(policyId, principal_type, principal_id)` WHERE deleted IS NULL |
| `roles` | `name`, `kind`, `immutable` | unique `(organizationId, name)` WHERE deleted IS NULL |

`organization_users.role` (enum) **stays** the single role assignment for #598; `loadSet` maps it → the org's seeded role by name → that role's attached policy. (`user_role` is #620.) Each table adds drizzle-zod in `zod.ts`, `IsAssignable` guards in `type-checks.ts`, and a `Repository` subclass.

### Engine — `apps/api/src/services/permission.service.ts` (extend) + `permission-set.ts` (new)

```ts
// permission.service.ts
static async loadSet(ctx: PermissionContext): Promise<PermissionSet>;
// gathers: the org's seeded role matching ctx.role → its attached policy's statements,
// plus any direct policy_attachments (principalType "user", principalId = ctx.userId).

// permission-set.ts — in-memory, sync evaluation over the loaded statements
class PermissionSet {
  check(action: PermissionAction, object?: PermissionObject): void;   // throws ApiError(403) on deny
  can(action: PermissionAction, object?: PermissionObject): boolean;  // non-throwing
  visibilityPredicate(resourceType, cols: { createdByCol; idCol }): SQL | undefined; // tested; wired in #621
}
```

- `check`/`can` **normalize** the dotted `PermissionAction` + `object.type` → canonical `(verb, resourceType, resourceId, createdBy)` and evaluate **deny → allow → implicit-deny**; a statement's `condition` is checked against `object.createdBy` (`created_by_caller` ⇒ `=== ctx.userId`; `created_by_system` ⇒ `=== SystemUtilities.id.system`).
- `visibilityPredicate`: `undefined` for an unconditional class allow; else `OR(createdByCol = caller` (owner-conditional allow)`, idCol IN (instance-allow ids))` `AND idCol NOT IN (instance-deny ids)`; **fail-closed** (no allow ⇒ matches-nothing). Built + unit-tested here; **route wiring is #621**.
- **Middleware** (`metadata.middleware.ts`): after resolving ctx (`:90,:127`), attach `req.application.permissions = await PermissionService.loadSet(ctx)`; on load failure attach an **empty set** (fail-closed).
- **Call-site migration:** the `PermissionService.check(ctx, …)` sites — `organization.router.ts:304,428,1436`, `billing.service.ts:226,320`, `seat.service.ts:65,145,155,187,212,235,397` — move to `req.application.permissions.check(…)`; **delete the `resolveEffect` switch.** Behavior is byte-identical (switch-parity test).

`PermissionContext`/`PermissionAction`/`PermissionObject` (`permission.service.ts:13-46`) are unchanged. `assertWithinBoundary` is **not** in #598 (its only caller is grant/policy authoring — #621/#622).

## Migration

`cd apps/api && npm run db:generate -- --name add_rbac_engine` — the 4 tables. Then a **data migration** `NNNN_backfill-rbac-system-policies.sql` that, for **every existing org** (cross-join `organizations`), inserts roles `owner/admin/member`, policies `FullAccess/AdminAccess/MemberAccess` + their statements, and the role→policy attachments — `ON CONFLICT` restating the partial-unique predicate (the `0080` template). Forward-only, expand-only; no destructive DDL.

## Seed

`seed.service.ts`: new `seedRbacSystemPolicies(organizationId, db)` (mirroring `seedSystemColumnDefinitions:571`), called from `application.service.ts:585` (`provisionOrganizationWorkspace`, also ResetService). Idempotent (upsert on `(organizationId, name)`). Statements (D6):

```
FullAccess  = [ allow * *:* ]
AdminAccess = [ allow read,write,delete,share  station,pin,view,portal,entity,entity_record,
                field_mapping,connector_instance :*;  allow read audit:*;  allow invite,manage member:* ]
              # omits billing:manage + org:delete (implicit deny)
MemberAccess = [ allow read,write resource:* IF created_by_caller ;  allow read resource:* IF created_by_system ]
```

The org creator's `owner` membership already exists (`application.service.ts:524`); resolution maps its `role='owner'` → the seeded owner role → FullAccess.

## TDD test plan

Run via npm scripts (`feedback_use_npm_test_scripts`): `cd packages/core && npm run test:unit`; `cd apps/api && npm run test:unit && npm run test:integration`.

### Core (`packages/core`)
1. `PermissionStatementSchema` parses allow/deny; rejects unknown verb/resourceType/condition.
2. `PolicySchema`/`RoleSchema` round-trip via factory (immutable + kind).

### Engine — unit (`apps/api`, mocked repos)
3. deny beats allow (equal + unequal specificity) (D2/D7).
4. ownership condition: `created_by_caller` allows only when `object.createdBy === userId`; `created_by_system` read allowed, write denied for member.
5. explicit deny overrides an ownership allow (D7).
6. `can` matches `check` (boolean vs throw).
7. `visibilityPredicate`: unconditional class allow → `undefined`; owner-conditional → `createdBy = caller`; instance allow → `IN`; instance deny → `NOT IN`; nothing → matches-nothing (fail-closed).
8. **Switch parity:** owner/admin/member resolve identically to the pre-#598 `resolveEffect` for every existing action (billing/org/member/audit) — a table test over every `(role, action)` pair.

### Engine — integration (`apps/api`, real DB)
9. `loadSet` gathers the system policy via `ctx.role` → seeded role → attachment; a direct user policy_attachment unions in.
10. Seed idempotency: after `seedRbacSystemPolicies`, an org has 3 roles/policies + attachments; a second call doesn't duplicate.
11. **Backfill:** seed a pre-migration org row, run the migration, assert it resolves `owner → FullAccess` (existing-org provisioning proven — the #316/#414 guard).
12. Fail-closed: a `loadSet` failure → empty set → `check` denies.

### Routes — integration
13. Existing role guards still pass through the migrated `req.application.permissions.check` path: owner can delete-org/manage-billing; admin denied both; member denied member.role.assign — identical to pre-#598.

**Totals ≈ 2 core + 6 engine-unit + 4 engine-integration + 1 route ≈ 13 cases**, plus the migration probe (11). No web tests (backend-only).

## Acceptance criteria

- Owner/admin/member behavior is **identical to #576** but computed from seeded system policies (switch parity, test 8); the `resolveEffect` switch is **deleted**.
- New **and** existing orgs resolve a valid system-policy set (backfill proven, test 11).
- A resolution/load error **fails closed** (test 12).
- `PermissionSet.visibilityPredicate`/object `check` are implemented + unit-tested but **not wired into any route** (that's #621).
- `npm run lint && type-check` clean; existing suites green; no HTTP/FE surface changed.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| Switch→data drift changes an existing decision. | Switch-parity table test (8) over every `(role, action)`; the migrated guards' existing tests (13). If parity fails, **stop** — do not delete the switch. |
| Backfill strands existing orgs (#316/#414). | Data migration cross-joins `organizations`; integration test 11 seeds a pre-migration org and asserts resolution. |
| Fail-open regression. | `loadSet` failure → empty set → deny (test 12); the opposite of the cost gate, by design. |
| Call-site migration misses a guard. | The `check` callers are enumerated (Surface); test 13 exercises each; a repo grep for `PermissionService.check(` must return zero after the cutover. |
| Per-request `loadSet` cost. | One/two indexed queries on routes that mount `getApplicationMetadata`; no cross-request cache (staleness = security bug). |

**Rollback:** revert the migration (drop the 4 tables) + `git revert`; the switch returns with the code. No production data at risk (all rows are new + reproducible from the seed).

## Files touched

- **`packages/core`** — new `models/permission.model.ts`; edit `models/index.ts`; model tests.
- **`apps/api`** — new: `db/schema/{permission-policies,permission-statements,policy-attachments,roles}.table.ts` + their repositories, `services/permission-set.ts`, the migration + backfill; edit: `services/permission.service.ts` (add `loadSet`, delete switch), `middleware/metadata.middleware.ts` (attach set), `db/schema/{zod,type-checks,index}.ts`, `db/repositories/index.ts`, `services/db.service.ts`, `services/seed.service.ts` (+`seedRbacSystemPolicies`), `services/application.service.ts` (call seed), `services/billing.service.ts` + `routes/organization.router.ts` + `services/seat.service.ts` (migrate `check` calls); integration tests.
- **No frontend, no API endpoint, no new `ApiCode`/`AUDIT_ACTIONS`** (those land with #621/#622).

## Next step

`docs/RBAC_IAM_ENGINE.plan.md` — TDD slices on `feat/598-rbac-iam-engine`: **(1)** the 4 tables + core models + repos + `seedRbacSystemPolicies` + backfill migration (engine dormant; core + seed/backfill tests 1–2, 9–11); **(2)** the `PermissionSet` engine + `loadSet` + middleware attach + migrate the `check` call sites + **delete the switch** (the risky slice, behind switch-parity test 8 + route test 13 + fail-closed 12). Two commits; each green.
