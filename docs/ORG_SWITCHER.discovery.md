# Org switcher UI — Discovery

**Issue:** [EnterpriseBT/portal-ai#201](https://github.com/EnterpriseBT/portal-ai/issues/201)

**Why this exists.** A user can belong to more than one organization — their own signup org plus any an operator attaches them to (`portalai member add` / `seed org --member-email`, #190). But the app gives them no way to move between orgs: `ApplicationService.getCurrentOrganization` (`apps/api/src/services/application.service.ts:21-47`) just returns the membership with the highest `lastLogin`, and the only way to change that today is operator tooling — `portalai member switch <orgId> <email>` bumps the membership's `lastLogin` so it wins the selector (#190). This ticket makes that a first-class end-user affordance: a switcher in the header that lists the user's orgs and lets them pick the active one. This is the UI that turns the already-shipped server-side selection mechanism into something a customer can drive.

## The current shape

### Current-org resolution (server-side, implicit)

| Piece | Location | Behavior |
|---|---|---|
| Selector | `apps/api/src/services/application.service.ts:21-47` | `getCurrentOrganization(userId)` → `organization_users` where `deleted IS NULL`, `ORDER BY last_login DESC NULLS LAST`, first row. `NULLS LAST` added in #200. |
| Endpoint | `apps/api/src/routes/organization.router.ts:157-227` | `GET /api/organization/current` — resolves user from the Auth0 `sub`, returns `OrganizationGetResponse`. |
| PATCH precedent | `apps/api/src/routes/organization.router.ts:92-155` | `PATCH /api/organization/:id` updates `defaultStationId` — the validate→update→return pattern a switch endpoint mirrors. |
| Membership repo | `apps/api/src/db/repositories/organization-users.repository.ts:26-44` | `findByUserId(userId)` **exists** (lists a user's memberships) but is **not exposed as a REST endpoint**. `findByOrganizationId` is its mirror. |

Org context is **not in the JWT** — it's resolved from the DB per request (authorization middleware sets `req.application.metadata.organizationId`). So "which org am I in" is a pure server-side function of the `organization_users` rows; there is no client- or token-held org id to reconcile.

### `organization_users.lastLogin` semantics

`apps/api/src/db/schema/organization-users.table.ts:9-18` — `lastLogin: bigint` (nullable). It is **not** re-stamped on every login (the webhook stamps `users.lastLogin`, a different column). It's set at org creation and by `member switch`. So it already functions as **"selection recency"**, not a literal login time — `0` = attached-but-never-selected (the #190/#202 convention), a real timestamp = last time this org was made active. Bumping it on switch is consistent with what the column already means.

### Frontend consumption + where a switcher lives

| Piece | Location | Notes |
|---|---|---|
| Current-org query | `apps/web/src/api/organizations.api.ts:9-24` | `sdk.organizations.current()` on key `["organizations","current"]`. |
| Query keys | `apps/web/src/api/keys.ts:25-29` | `organizations.{root, current(), usage()}` — **no** membership-list key yet. |
| Header menu | `apps/web/src/components/HeaderMenu.component.tsx:87-127` | Already `HeaderMenu` (container) + `HeaderMenuUI`. Calls `sdk.organizations.current()`, **renders the current org name** as a subtitle above Settings/Help/Logout (MUI `Menu`/`MenuItem`). |
| Layout | `apps/web/src/layouts/Authorized.layout.tsx:16-72` | `AppBar`/`Toolbar`; right side `ButtonGroup` holds `ThemeSwitcher` + `HeaderMenu`. |
| Auth/session | `apps/web/src/api/auth.api.ts:7-45`, `Application.tsx` | `useAuth0()`; no org in token. React Query with a central `queryClient`. |
| Mutation precedent | `apps/web/src/workflows/SandboxConnector/SandboxConnectorWorkflow.component.tsx:154-179` | `useAuthMutation` + `onSuccess → queryClient.invalidateQueries({ queryKey: queryKeys.<x>.root })`. |
| Org-scoped keys | `apps/web/src/api/keys.ts:147-160` | `stations/portals/connectorInstances/jobs/connectorEntities/...` roots — all implicitly org-scoped (API filters by request metadata), so all go stale on switch. |

## The design space

### Decision 1 — How is "current org" represented?

**A. Keep it implicit** (`last_login DESC`); the switcher bumps `last_login = now()`, exactly like `member switch`. **B. Add an explicit `users.active_organization_id`** column that `getCurrentOrganization` reads directly. **C. Hybrid** — explicit column, `last_login` fallback.

| | A (implicit last_login) | B (explicit active_organization_id) | C (hybrid) |
|---|---|---|---|
| Schema change / migration | None | New column + backfill every user | Same as B |
| Reuses shipped mechanism | Yes — UI switch == `member switch` (both bump last_login) | No — `member switch` (#190, shipped) must ALSO write the column → admin-cli churn | Partial |
| Semantics | `last_login` already means "selection recency" (not literal login) | Cleanest: one column = active org | Two sources of truth to reconcile |
| Dangling-pointer risk | None (selector only sees live memberships) | Column can point at a soft-deleted membership/org → needs fallback | Same as B |
| #200 relevance | Directly builds on the just-hardened `NULLS LAST` selector | Makes #200 moot but adds new edge cases | — |

**Lean: A.** `organization_users.last_login` is already the de-facto selection field, #200 just hardened the selector, and the operator `member switch` shipped in #190 already *is* this exact mechanism — the UI switcher becomes its end-user twin with zero schema change and no cross-package churn. B's clean semantics don't justify a migration + backfill + admin-cli rework + a new dangling-pointer edge case. If a future need ever separates "literal last login" from "active selection", introduce `active_organization_id` then.

### Decision 2 — Listing the user's orgs for the dropdown

**A. New `GET /api/organization/memberships`** returning the authed user's live memberships (org + `isCurrent`). **B. Overload `GET /api/organization/current`** to also return the list. **C. Client derives it** from some existing payload.

**Lean: A.** `findByUserId` already exists — expose it behind a new endpoint returning `{ organization, isCurrent }[]` (join to `organizations`, filter `deleted IS NULL` on both sides). Keeps `current` single-purpose; C is a non-starter (no such payload exists).

### Decision 3 — The switch endpoint

**A. `POST /api/organization/switch` body `{ organizationId }`.** **B. `PATCH /api/organization/current`.** **C. reuse `PATCH /api/organization/:id`.**

Either A or B; both resolve the user from the token, **verify the user has a live membership in the target org** (authz — you cannot switch into an org you don't belong to), bump that membership's `last_login = now()`, and return the new current org.

**Lean: A** (`POST /api/organization/switch`, body-carried `organizationId` per the "accept from payload" convention). C is wrong — `:id` is the org being edited, not a per-user action.

### Decision 4 — Frontend placement & component shape

**A. A dedicated `OrgSwitcher.component.tsx`** (container + `OrgSwitcherUI`) embedded in the header menu. **B. Inline the list into `HeaderMenu`.**

**Lean: A.** The switcher owns real wiring — its own memberships query, the switch mutation, and a broad cache invalidation — which shouldn't bloat `HeaderMenu`. A dedicated container+UI pair (per the Component File Policy) rendered as a section inside the existing menu keeps `HeaderMenuUI` props-only. Render the section **only when the user has ≥2 live memberships** (no affordance when there's nothing to switch).

## Tradeoff comparison

| | D1 implicit last_login | D2 new memberships GET | D3 POST /switch | D4 dedicated OrgSwitcher |
|---|---|---|---|---|
| Schema change | No | No | No | No |
| New API surface | No | Yes (1 GET) | Yes (1 POST) | No |
| Reuses shipped mechanism | Yes (#190/#200) | Yes (`findByUserId`) | Yes (PATCH pattern) | Yes (HeaderMenu, Component File Policy) |
| Spread to spec | Yes | Yes | Yes | Yes |

## Recommendation

1. **Keep current-org implicit** on `organization_users.last_login`; the switcher sets it to `now()` — the same mechanism as `portalai member switch`. No schema change.
2. **New `GET /api/organization/memberships`** (over `findByUserId`) returning the authed user's live memberships as `{ organization, isCurrent }[]`, `@openapi`-documented with a registered response schema.
3. **New `POST /api/organization/switch`** (body `{ organizationId }`) that verifies the user holds a live membership in the target org (else `403`/typed code), bumps that membership's `last_login`, and returns the new current org.
4. **A dedicated `OrgSwitcher` component** (container + pure UI) rendered as a section in `HeaderMenu`, shown only when the user has ≥2 live memberships; selecting an org fires the switch mutation.
5. On switch success, **invalidate the entire React Query cache** (`queryClient.invalidateQueries()` with no key) — after an org change essentially all cached data is stale; this is the rare legitimate broad invalidation.
6. SDK: add `sdk.organizations.memberships()` (`useAuthQuery`, new `queryKeys.organizations.memberships()`) and `sdk.organizations.switch()` (`useAuthMutation`).

## Open questions

1. **Audit the switch server-side?** It changes user state, but it's a user re-viewing their own orgs — low stakes. **Lean: no dedicated audit;** the `last_login` timestamp is the record. (Operator switches via `portalai` are already audited.)
2. **Role/permission info in the memberships list?** There's no per-org role model yet. **Lean: return `{ organization, isCurrent }` only;** attach roles when RBAC lands.
3. **Broad vs. targeted cache invalidation on switch?** **Lean: broad** (`invalidateQueries()` no-key) — enumerating org-scoped keys is fragile and every one is stale anyway. Revisit only if a measured refetch storm shows up.
4. **Per-user vs. per-session active org?** Current-org is resolved server-side per request, so it's inherently **per-user** — switching on one device moves your active org everywhere. **Lean: keep per-user** (matches today's model; the issue implies it). Note it in the spec so it's a conscious choice, not a surprise.
5. **A user with many memberships (operator-attached to dozens)?** **Lean: paginate `GET /memberships`** (standard `limit`/`offset`) and have the switcher show the first N with a search box if the list is long — but default rendering is fine for the common handful.

## Enterprise-scale considerations

- **Concurrency & correctness** — two tabs/devices switching race on one `last_login`; last-writer-wins is correct for a single per-user active org. Server-side per-request resolution means no stale client org id. **Lean: accept last-writer-wins**, no locking.
- **Accuracy & auditability** — `Lean: N/A for a dedicated ledger` — the membership row's `last_login` is the record of the current selection; operator-side switches remain audited via `portalai`.
- **Failure modes** — a failed switch leaves the user in their current org (**fail-safe**); the UI keeps the affordance and surfaces the error via the standard mutation error path. No fail-open/closed cost dimension here.
- **Scale & unbounded growth** — the only unbounded axis is memberships-per-user (operator-attachable). **Lean: paginate the memberships endpoint** (OQ5); the switch itself is O(1).
- **Multi-tenancy** — critical: the switch endpoint **must verify the requester holds a live membership** in the target org before bumping — otherwise it's a cross-tenant escalation. Engaged in Decision 3.
- **Contract stability** — the `{ organization, isCurrent }[]` shape has room to grow a `role` field when RBAC arrives without re-plumbing callers; the switch endpoint is the stable seam a future explicit-active-org migration (Decision 1B) could swap behind.
- **Data lifecycle** — `N/A` — no windows/periods/retention; a switch is a point mutation.

## What this doesn't decide

- **Explicit `active_organization_id`** (Decision 1B) — deferred, not rejected; revisit if "literal last login" ever needs to be distinct from "active selection". Migration + backfill + admin-cli rework isn't justified now.
- **Per-org roles / RBAC** — out of scope; the memberships payload is shaped to accept it later.
- **An org-creation / "join org" flow from the switcher** — this ticket switches between orgs the user already belongs to; creating or requesting-to-join is separate.
- **Per-session (vs per-user) org context** — would require threading an org id through the session/token; explicitly not doing that (OQ4).

## Next step

`docs/ORG_SWITCHER.spec.md` pins the two endpoints (`GET /memberships`, `POST /switch`) with their `@openapi` schemas + a `MEMBERSHIP_*` authz error code, the `getCurrentOrganization` reuse, the SDK additions + query keys, and the `OrgSwitcher` component contract. Then `docs/ORG_SWITCHER.plan.md` — likely **3 slices**: (1) backend memberships + switch endpoints (repo finder already exists) with membership-authz tests; (2) SDK endpoints + query keys; (3) the `OrgSwitcher` component in the header + broad-invalidation-on-switch, with unit tests on the pure UI. All on `feat/org-switcher`, one PR.
