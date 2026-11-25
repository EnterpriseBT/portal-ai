# Own portals by default — Spec

This spec pins the permission-engine rule behind [#1127](https://github.com/EnterpriseBT/portal-ai/issues/1127): a wildcard resource covers a *personal* type (`portal`) only for the caller's own objects, while explicit statements and the authoring boundary keep working. The decisions come from `docs/OWN_PORTALS_BY_DEFAULT.discovery.md`.

## Key decisions (flag for review)

1. **An engine rule, not a data change.** `SEED_SYSTEM_POLICIES`, the stored statements and every org's roles are unchanged. There's no migration and no backfill.
2. **Personal types.** `PERSONAL_RESOURCE_TYPES = ["portal"]` in core is the single list.
3. **Allows only.** The narrowing applies to **allow** statements whose `resourceType` is `*`. A wildcard **deny** still denies personal types in full, because restricting is safe.
4. **Narrowed to the caller's own.** An unconditional wildcard allow on a personal type covers the caller's own objects and system-created ones (refined in implementation: covering system-created ones matches what MemberAccess already grants, so an owner never reaches less than a member). Other users' objects stay out. A wildcard allow carrying `created_by_caller` or `created_by_system` is unchanged.
5. **Explicit statements apply as written.** That covers `allow read portal` (class-level, unconditional), `allow read portal:<id>` and conditioned portal statements. This is how an admin grants access to others' portals.
6. **Delegation keeps the wildcard.** The authoring boundary (`assertStatementsWithinBoundary`) resolves *without* the narrowing. An author holding `* *` (owner, admin, or a custom wildcard policy) may author portal statements beyond their own access, including granting themselves.
7. **The share-flow boundary is unchanged.** `assertWithinBoundary` keeps its access check, and portals aren't shareable (`grant.service.ts:156`) anyway.
8. **Fail closed.** A portal check with an unknown creator (`createdBy` absent or `null`) is not covered by a wildcard allow.

## Scope

### In scope
- **Core:** the constant.
- **API:** `PermissionSet`'s matching, `visibilityPredicate` and boundary.
- **Tests:** unit and integration tests for both.
- **Copy:** stale comments, and one Help glossary line.

### Out of scope
- **Portal sharing** as a feature.
- **Pin rules:** unchanged.
- **The RBAC authoring UI:** the instance picker stays visibility-scoped and isn't changed.
- **Seed and migration** changes.

## Surface

### `packages/core/src/models/permission.model.ts`

```ts
/**
 * #1127: types a wildcard resource (`*`) covers only for the caller's own
 * objects. A role's `allow * *` reaches the caller's own portals, not
 * everyone's; a statement that names the type applies as written, so access
 * to others' is an explicit grant. Delegation (the authoring boundary) still
 * treats the wildcard as covering them.
 */
export const PERSONAL_RESOURCE_TYPES = [
  "portal",
] as const satisfies readonly PermissionResourceType[];
```

It's exported from the models barrel beside `OWNERSHIPLESS_RESOURCE_TYPES` (`:254`).

### `apps/api/src/services/permission-set.ts`

**A new private helper**, the statement's effective condition for a concrete type:

```ts
/** #1127: a wildcard **allow** on a personal type reaches only the caller's
 *  own objects, unless the check is a delegation (the authoring boundary). */
private effectiveCondition(
  s: EffectiveStatement,
  resourceType: string,
  mode: "access" | "delegation"
): EffectiveStatement["condition"]
// returns "created_by_caller" when
//   mode === "access" && s.effect === "allow" && s.resourceType === "*"
//   && s.condition === null && s.resourceId === null
//   && PERSONAL_RESOURCE_TYPES.includes(resourceType)
// else s.condition
```

**`matches(s, norm, mode = "access")`**: `condOk` evaluates against `this.effectiveCondition(s, norm.resourceType, mode)` instead of `s.condition`. Everything else is unchanged.

**`resolve(norm, mode = "access")`**: it passes `mode` to `matches`. `can`, `check`, `isDenied` and `assertWithinBoundary` call it with the default (`"access"`).

**`assertStatementsWithinBoundary`**: every `this.resolve(…)` call passes `"delegation"`. The class-level, instance-level and ownershipless branches keep their current logic.

**`visibilityPredicate(resourceType, cols, verb)`**: the allows are mapped to their effective condition first:

```ts
const allows = reads
  .filter((s) => s.effect === "allow")
  .map((s) => ({ ...s, condition: this.effectiveCondition(s, resourceType, "access") }));
```

So for `portal`, an owner's `* *` contributes `createdBy = caller`, not "unrestricted". An explicit unconditional `allow read portal` still returns `undefined` (see all). Denies are untouched.

**`canPerformAny(verb, resourceType)`** is unchanged. A narrowed wildcard is still a matching allow, so an owner can perform `read portal` on *some* portal, their own. Nothing about the class-level affordance changes.

### Behaviour by caller (the contract the tests assert)

| Caller's statements | `can(resource.read, portal by caller)` | `can(…, portal by other)` | `visibilityPredicate("portal")` | Author `allow read portal` |
|---|---|---|---|---|
| FullAccess `allow * *` | allow | **deny** (404 at routes) | `createdBy = caller OR = system` | in boundary |
| AdminAccess `allow * *` + 2 denies | allow | **deny** | `createdBy = caller OR = system` | in boundary |
| MemberAccess (portal `created_by_caller`) | allow | deny | `createdBy = caller` | rejected (unchanged) |
| + custom `allow read portal` | allow | **allow** | `undefined` (all) | — |
| + `allow read portal:<id>` (other's) | allow | allow for `<id>` only | `createdBy = caller OR id IN (<id>)` | — |
| `deny * *` (custom) | deny | deny | `false` | — |

For every non-personal type (`station`, `entity`, …), owners and admins behave exactly as before. A switch-parity test pins this.

### Routes

There are no route code changes. `PortalAccessService.load` (`portal-access.service.ts:29-45`), the list's `visibilityPredicate` (`portal.router.ts:260-265`), the events, map, SQL-handle and pin-create checks, and `ObjectCapabilitiesService` all go through the engine. Their effect for owners and admins: someone else's portal is **404** on get, message, rename, delete, reset, events, map tiles and widget refresh; it's absent from the list; and pin create from it is 404.

### Copy

- **Comments:** they now say owners and admins reach their own portals, and others' only through an explicit grant.
  - `portal-access.service.ts:5-7`
  - `portal.router.ts:258-259`
  - `portal-events.router.ts:153-158`
  - `apps/web/src/views/Portal.view.tsx:57`
  - `permission-set.ts:291`
- **Help glossary:** the "Portal" entry (`packages/core/src/content/glossary.util.ts:351`) gains: "A portal is private to the person who started it. Others, owners and admins included, see it only if they've been granted access to portals."

## Migration

None. No schema or data change.

## Seed

None. `SEED_SYSTEM_POLICIES` is unchanged, so `rbac-seed.integration.test.ts`'s statement counts hold.

## TDD test plan

Run from each package: `cd apps/api && npm run test:unit -- --testPathPattern <names>` and `npm run test:integration -- --testPathPattern <names>`; `cd packages/core && npm run test:unit -- --testPathPattern <names>`.

### Core (`packages/core/src/__tests__/models/permission.model.test.ts`)
1. `PERSONAL_RESOURCE_TYPES` is `["portal"]`, and each entry is a `DATA_RESOURCE_TYPES` member.

### API unit (`apps/api/src/__tests__/services/permission-set.test.ts`)
2. FullAccess: allowed on its own portal, denied on another's.
3. AdminAccess: the same.
4. Owner `visibilityPredicate("portal")` is `createdBy = caller`; for `station` it's still `undefined`.
5. An explicit `allow read portal` added to the owner gives `undefined` and allows another's portal.
6. An instance `allow read portal:<id>` covers that portal only.
7. A wildcard `allow * * created_by_system` on a portal is unchanged (it covers system portals).
8. A wildcard **deny** still denies a portal in full.
9. A portal with an unknown creator (`createdBy` `null`) is denied under `* *`.
10. `canPerformAny("read", "portal")` is true for the owner.
11. The switch-parity matrix is updated: owner and admin read, write and delete on *others'* portals are now deny; every other row is unchanged.
12. Boundary: the owner may author `allow read portal`.
13. Boundary: the admin may author `allow read portal` and `allow * portal`.
14. Boundary: the owner may author `allow read portal:<other's id>` (instance probe against the other creator).
15. Boundary: a member is still rejected for `allow read portal`.
16. Boundary: the owner may still author `allow * *` (unchanged).

### API integration (`apps/api/src/__tests__/__integration__/routes/portal.router.authorization.integration.test.ts`)
17. The owner's list shows only the owner's portals, not a member's (replaces "the owner's shows all").
18. The admin's list is the same.
19. An owner's GET of a member's portal is 404.
20. An owner's message post into a member's portal is 404 (replaces the "owner posts into member's portal" case).
21. An owner's delete of a member's portal is 404.
22. A custom policy with `allow read portal`, attached to the admin's role (or as a direct grant), lists and reads the member's portal; a post into it stays 404/403 without write.
23. The member's own access is unchanged.

### API integration (`…/object-capabilities.agreement.integration.test.ts`)
24. Capabilities on a member-created portal for the owner are absent (the row isn't readable). Other types are unchanged.

### API integration (`…/routes/portal-results.router.integration.test.ts`)
25. An owner pinning from a member's portal is 404. A pin the member shared stays readable by its own rules.

### API integration (`…/routes/policy.router.integration.test.ts`)
26. An admin creating a custom policy with `allow read portal` is 201, not `RBAC_POLICY_EXCEEDS_BOUNDARY`.

### Core content (`packages/core/src/__tests__/content/glossary.util.test.ts`)
27. The existing tests pass with the Portal entry's new sentence; the permission-copy guard passes (it names access, not a role framing).

**Totals ≈ 27 cases** (about 15 unit, 10 integration and 2 core).

## Acceptance criteria

- [ ] An owner or admin sees only their own portals in every list: the dashboard's Recent portals, a station's Portals, and `GET /api/portals`.
- [ ] Opening, messaging, renaming, deleting or streaming someone else's portal as an owner or admin answers 404, the same as for a member.
- [ ] A custom policy or direct grant naming `portal` (class-level, instance or conditioned) gives exactly the access it states, owners and admins included.
- [ ] An owner or admin can author a portal grant, including for themselves; a member can't author one beyond their own.
- [ ] Every non-portal type behaves exactly as before for every role.
- [ ] Existing orgs get the behaviour on deploy, with no migration.
- [ ] Help's Portal entry says portals are private unless access is granted.

## Risks & rollback

- **Risk: an owner or admin workflow that relied on reading others' sessions** (support, debugging). It's detected by the release notes and user reports. Mitigation: an explicit `allow read portal` policy restores it per org. Rollback: revert the engine change, which is a single commit with no data to restore.
- **Risk: the narrowing leaks to other types.** It's guarded by the switch-parity test (case 11) and the capability agreement test (case 24).
- **Fail mode: closed.** An unknown creator is denied (case 9). The worst case is an owner losing access to an edge-case portal, never gaining access to others'.
- **Prod:** a normal release. Its release notes say that owners and admins now see only their own portals unless granted, and that a custom `* *` policy no longer covers others' portals.

## Files touched

- **Edit:**
  - `packages/core/src/models/permission.model.ts` (and its barrel export if separate)
  - `apps/api/src/services/permission-set.ts`
  - `apps/api/src/services/portal-access.service.ts`, `routes/portal.router.ts`, `routes/portal-events.router.ts` (comments)
  - `apps/web/src/views/Portal.view.tsx` (comment)
  - `packages/core/src/content/glossary.util.ts`
- **Tests (edit):**
  - `apps/api/src/__tests__/services/permission-set.test.ts`
  - `…/__integration__/routes/portal.router.authorization.integration.test.ts`
  - `…/object-capabilities.agreement.integration.test.ts`
  - `…/routes/portal-results.router.integration.test.ts`
  - `…/routes/policy.router.integration.test.ts`
  - `packages/core/src/__tests__/models/permission.model.test.ts`

## Next step

`docs/OWN_PORTALS_BY_DEFAULT.plan.md` slices this into two TDD commits on this branch:
1. **The core constant and the engine rule**, with the unit cases (1–16).
2. **The integration cases** (17–26), the comments and the Help glossary line (27).
