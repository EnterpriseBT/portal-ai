# Org switcher UI — Spec

Pins the contract for the header org switcher (#201): two new endpoints (`GET /api/organization/memberships`, `POST /api/organization/switch`) over the existing `organization_users` mechanism, their contracts + `@openapi` schemas + a membership-authz error code, the SDK additions, and the `OrgSwitcher` component. Discovery: `docs/ORG_SWITCHER.discovery.md` (reviewed; Decision 1 confirmed = implicit `last_login`). Issue: [#201](https://github.com/EnterpriseBT/portal-ai/issues/201). Builds on shipped #190 (`member switch`) and #200 (`NULLS LAST`).

## Key decisions (flag for review)

1. **Implicit `last_login`, no schema change** (confirmed): switching bumps `organization_users.last_login = now()` — the same mechanism as `portalai member switch`. `getCurrentOrganization` (already `DESC NULLS LAST`, #200) is unchanged.
2. **Switch is membership-gated** — `POST /switch` verifies the requester holds a **live** membership in the target org (`OrganizationUsersRepository.exists`, which already exists) before bumping; otherwise a typed `403 MEMBERSHIP_NOT_FOUND`. This is the multi-tenancy authz gate.
3. **Broad cache invalidation** on switch — the frontend calls `queryClient.invalidateQueries()` with no key (all cached data is org-scoped). Conscious broad invalidation, not per-key enumeration.
4. **Per-user active org** (not per-session) — inherent to server-side per-request resolution; switching moves the user's one active org across devices.
5. **No dedicated switch audit** — the `last_login` timestamp is the record; operator switches via `portalai` remain audited separately.

## Scope

### In scope
- `apps/api`: `GET /api/organization/memberships`, `POST /api/organization/switch`; a `switchOrganization` service method; `MEMBERSHIP_NOT_FOUND` code; swagger schema registration.
- `packages/core`: `UserMembershipsGetResponse` + `OrganizationSwitchRequest`/`Response` contracts.
- `apps/web`: `sdk.organizations.memberships()` + `.switch()`, two query keys, the `OrgSwitcher` component embedded in `HeaderMenu`.

### Out of scope
- Explicit `active_organization_id` column (Decision 1B — deferred). Per-org roles/RBAC. Org creation / join-request from the switcher. Per-session org context.

## Surface

### `packages/core/src/contracts/user-membership.contract.ts` (new)

```ts
import { z } from "zod";
import { OrganizationSchema } from "../models/organization.model.js";

/** One org the authed user belongs to, flagged if it's their current one. */
export const UserMembershipSchema = z.object({
  organization: OrganizationSchema,
  isCurrent: z.boolean(),
});
export type UserMembership = z.infer<typeof UserMembershipSchema>;

/** GET /api/organization/memberships */
export const UserMembershipsGetResponseSchema = z.object({
  memberships: z.array(UserMembershipSchema),
});
export type UserMembershipsGetResponse = z.infer<typeof UserMembershipsGetResponseSchema>;

/** POST /api/organization/switch */
export const OrganizationSwitchRequestSchema = z.object({
  organizationId: z.string().min(1),
});
export type OrganizationSwitchRequest = z.infer<typeof OrganizationSwitchRequestSchema>;
```

The switch response reuses the existing `OrganizationGetResponseSchema` (`{ organization }`) from `organization.contract.ts` — the new current org. Both new contracts re-exported from `packages/core/src/contracts/index.ts`.

### `apps/api/src/services/application.service.ts` — additions

`getCurrentOrganization` unchanged. Add:

```ts
/** The authed user's live memberships, each flagged if it's the current one.
 *  Joins organization_users → organizations, both deleted IS NULL. */
static async listUserMemberships(userId: string): Promise<
  { organization: Organization; isCurrent: boolean }[]
>
// current = the same row getCurrentOrganization would pick (max last_login,
// NULLS LAST); order the result created-desc for stable UI, current flagged.

/** Make `organizationId` the user's current org by bumping the membership's
 *  last_login to now(). Returns the new current organization. Throws a typed
 *  not-found if the user has no LIVE membership there (authz gate). */
static async switchOrganization(userId: string, organizationId: string): Promise<{ organization: Organization }>
// uses OrganizationUsersRepository.exists(organizationId, userId) for the gate,
// then organizationUsers.updateWhere(userId+orgId+live, { lastLogin: Date.now() }).
```

### `apps/api/src/routes/organization.router.ts` — two handlers

**`GET /api/organization/memberships`** — resolve user from `req.auth.payload.sub` (same as `/current`); `404 ORGANIZATION_USER_NOT_FOUND` if no user row; return `UserMembershipsGetResponse`. `@openapi`: tag Organization, bearer auth, `200` → `$ref UserMembershipsGetResponse`.

**`POST /api/organization/switch`** — body validated against `OrganizationSwitchRequestSchema` (request-validation middleware); resolve user; `ApplicationService.switchOrganization(user.id, body.organizationId)`; on the authz miss throw `403 MEMBERSHIP_NOT_FOUND` ("User is not a member of organization <id>"); return `OrganizationGetResponse` (the new current org). `@openapi`: `requestBody` → `$ref OrganizationSwitchRequest`, `200` → `$ref OrganizationGetResponse`, `403` → error.

### `apps/api/src/constants/api-codes.constants.ts`

Add `MEMBERSHIP_NOT_FOUND = "MEMBERSHIP_NOT_FOUND"` (near the `ORGANIZATION_*` block).

### `apps/api/src/config/swagger.config.ts`

Register under `components.schemas`: `UserMembershipsGetResponse: z.toJSONSchema(UserMembershipsGetResponseSchema, JSON_SCHEMA_OPTS)` and `OrganizationSwitchRequest: z.toJSONSchema(OrganizationSwitchRequestSchema, JSON_SCHEMA_OPTS)`. (`OrganizationGetResponse` — register if not already.)

### `apps/web/src/api/keys.ts` — organizations block

```ts
memberships: () => [...queryKeys.organizations.root, "memberships"] as const,
```

### `apps/web/src/api/organizations.api.ts` — additions

```ts
memberships: (options?: QueryOptions<UserMembershipsGetResponse>) =>
  useAuthQuery<UserMembershipsGetResponse>(
    queryKeys.organizations.memberships(),
    "/api/organization/memberships",
    undefined,
    options
  ),
switch: () =>
  useAuthMutation<OrganizationGetResponse, OrganizationSwitchRequest>({
    url: "/api/organization/switch",
    method: "POST",
    body: (vars) => vars,
  }),
```

### `apps/web/src/components/OrgSwitcher.component.tsx` (new)

Container + pure UI per the Component File Policy:

```ts
interface OrgSwitcherUIProps {
  memberships: UserMembership[];      // live memberships
  currentOrganizationId?: string;
  onSwitch: (organizationId: string) => void;
  isSwitching?: boolean;
}
// Renders NOTHING when memberships.length < 2 (no affordance to switch).
// Otherwise a labelled section of MenuItems (one per org), the current one
// with a check Icon; each disabled while isSwitching. Selecting a non-current
// org calls onSwitch. Uses the same MUI MenuItem/ListItemIcon/ListItemText
// vocabulary as HeaderMenu so it drops into the existing <Menu> children.

export const OrgSwitcher: React.FC     // container: memberships() query +
                                       // switch() mutation; onSuccess →
                                       // queryClient.invalidateQueries() (broad).
```

### `apps/web/src/components/HeaderMenu.component.tsx` — edit

Render `<OrgSwitcher />` + a `<Divider />` inside the `<Menu>` children, above the existing current-org subtitle / Settings-Help-Logout items. `HeaderMenuUI` is unchanged (still accepts `children`).

## Migration / Seed

**None.** No schema change — the feature rides the existing `organization_users.last_login`.

## TDD test plan

```bash
cd apps/api && npm run test:unit           # service + router unit
cd apps/api && npm run test:integration    # endpoint round-trips (real DB)
cd apps/web && npm run test:unit           # OrgSwitcherUI + SDK
cd packages/core && npm run test:unit      # contract parse (if pattern present)
```

### apps/api — service (`__tests__/services/application.service.test.ts` or integration)
`listUserMemberships` returns only live memberships (excludes soft-deleted membership + soft-deleted org), flags the max-`last_login` row as `isCurrent`; `switchOrganization` bumps `last_login` and returns the target as current; **switching into an org the user has no live membership in throws `MEMBERSHIP_NOT_FOUND`** (authz); switching into a soft-deleted membership throws too. ≈6 cases.

### apps/api — endpoints (`__tests__/__integration__/routes/organization.router.integration.test.ts`, real DB)
`GET /memberships` returns the user's orgs with `isCurrent`; `POST /switch` flips the current org (a subsequent `GET /current` reflects it); `POST /switch` to a non-member org → `403 MEMBERSHIP_NOT_FOUND`; unauthenticated → 401. ≈4 cases.

### apps/web — `__tests__/OrgSwitcher.test.tsx` (renders `OrgSwitcherUI`)
Renders nothing with <2 memberships; renders one item per org with the current one checked; clicking a non-current org calls `onSwitch(id)`; items disabled while `isSwitching`. ≈4 cases.

### apps/web — SDK/invalidation
`switch()` mutation `onSuccess` calls `queryClient.invalidateQueries()` (broad) — assert via `jest.spyOn(queryClient, "invalidateQueries")` per the dialog-test util. ≈1 case.

**Totals ≈ 15 cases.** No migration test (no schema change). Contract-parse test only if `packages/core` already pins contracts that way.

## Acceptance criteria
- [ ] A user in ≥2 orgs sees a switcher in the header account menu; a user in 1 org sees no switcher.
- [ ] Selecting an org makes it current (`GET /current` reflects it) and the UI refetches org-scoped data (stations/portals/connectors) under the new org.
- [ ] `POST /switch` into an org the user doesn't belong to is refused `403 MEMBERSHIP_NOT_FOUND` and changes nothing.
- [ ] The switcher agrees with `portalai member switch` — both bump `last_login`; an operator switch is reflected on the user's next load.
- [ ] Both endpoints carry `@openapi` blocks with `$ref`-registered schemas; `/api-docs` renders them.
- [ ] No schema/migration change.

## Risks & rollback
- **Cross-tenant switch** if the authz gate is missing — mitigated by the `exists` check in `switchOrganization` + the integration test for the `403`. **Fail-closed**: a switch that can't verify membership refuses.
- **Broad invalidation refetch cost** — one full cache refetch per switch; acceptable (switching is rare + deliberate). Revisit if metrics show pressure.
- **Multi-device**: switching moves the user's one active org everywhere (per-user model) — documented, not a bug.
- Rollback: additive (2 endpoints + 1 component + SDK); revert the commits, no data migration to unwind.

## Files touched
- New: `packages/core/src/contracts/user-membership.contract.ts`; Edit: `packages/core/src/contracts/index.ts`.
- Edit: `apps/api/src/services/application.service.ts`, `apps/api/src/routes/organization.router.ts`, `apps/api/src/constants/api-codes.constants.ts`, `apps/api/src/config/swagger.config.ts`.
- New: `apps/web/src/components/OrgSwitcher.component.tsx`, `apps/web/src/__tests__/OrgSwitcher.test.tsx`; Edit: `apps/web/src/api/organizations.api.ts`, `apps/web/src/api/keys.ts`, `apps/web/src/components/HeaderMenu.component.tsx`.
- Test edits: `apps/api` service + router integration tests.

## Next step
`docs/ORG_SWITCHER.plan.md` — **3 slices**: (1) backend (contracts + `MEMBERSHIP_NOT_FOUND` + service methods + 2 endpoints + swagger, with membership-authz tests); (2) SDK endpoints + query keys; (3) the `OrgSwitcher` component in the header + broad invalidation, unit-tested on the pure UI. All on `feat/org-switcher`, one PR (#204).
