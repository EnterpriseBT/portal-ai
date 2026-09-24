# Permission-gated navigation & object access — Spec

Pins the contract for [#630](https://github.com/EnterpriseBT/portal-ai/issues/630), from `docs/ROLE_GATED_NAV.discovery.md`. Two composable permission surfaces — **`page` × `view`** (nav/section visibility) and **object types × `read`/`write`/`delete`** (rows, detail, interactability) — gated uniformly by the existing `PermissionService`/`PermissionSet` engine, server-authoritative, no heuristics.

## Key decisions (confirmed in review)

1. **Page ≠ object** — a `page` resource type + a `view` verb govern nav; object resource types govern data. Different resources ⇒ a `deny read <class>` never collides with an `allow read <object>` (engine resolution: deny → allow → implicit-deny).
2. **New vocabulary, not new engine** — add resource types + a verb; `PermissionSet.normalize` already handles `resource.<verb>` generically, so `resource.view` needs no engine change. No pg migration (`resource_type`/`verb` are `text` columns with drizzle-enum typing, no CHECK).
3. **Only `MemberAccess` grows** — `FullAccess` (`* *`) / `AdminAccess` (`* *` − `billing.manage`/`org.delete`) wildcards already cover the new types + `view`.
4. **Server-authoritative on objects** — LIST endpoints filter by `visibilityPredicate`; detail/mutation `check` per object. Page-view is the client nav/redirect layer over that boundary.
5. **Per-org backfill** for the new `MemberAccess` grants (existing orgs), mirroring the seed's org-deleted filter (#627).

## Scope

### In scope
- 6 new resource types + `view` verb; `MemberAccess` grants + backfill; `pagePermissions`/`resourcePermissions` on the current-org payload; `requirePermission` middleware + `visibilityPredicate` list-filtering + per-object checks on the seven plumbing routers; `SidebarNav` gating + `beforeLoad` redirect + `ForbiddenView`.

### Out of scope
- Per-object interactability in list/detail responses (button-level gating) — probed in adversarial.
- Field-mapping read scoped per-entity; the #599 Views page (its `view` type already exists); Settings-tab migration to the `page` model.

## Surface

### `packages/core/src/models/permission.model.ts`

```ts
export const PERMISSION_VERBS = [ "read","write","delete","share","manage","invite","view", "*" ] as const;   // + "view"
export const PERMISSION_RESOURCE_TYPES = [
  "station","pin","view","portal","entity","entity_record","field_mapping","connector_instance",
  "entity_group","tag","column_definition","job","toolpack","page",   // + these 6
  "billing","org","member","audit","*",
] as const;
// DATA_RESOURCE_TYPES + SHAREABLE_RESOURCE_TYPES unchanged (the new object types are admin-managed, not member-owned data).

/** The gateable nav pages (page-resource instance ids). Dashboard is un-gated.
 *  A page with sub-tabs backed by *different* resources gets one id per tab
 *  (Connectors → `connectors` = the org's instances tab, `connector_catalog`
 *  = the system connector-definition registry tab). Every other nav page is a
 *  single id — its view is a single tab or a single resource. */
export const NAV_PAGE_IDS = [
  "stations","pinned","jobs",                                    // member pages (view granted)
  "connectors","connector_catalog",                             // Connectors page — two sub-tabs
  "entities","entity_groups","tags","column_definitions","toolpacks",  // admin pages
] as const;
export type NavPageId = (typeof NAV_PAGE_IDS)[number];

export const PagePermissionMapSchema = z.record(z.enum(NAV_PAGE_IDS), z.boolean());
export type PagePermissionMap = z.infer<typeof PagePermissionMapSchema>;

/** Class-level object permissions the FE reads for coarse affordances. */
export const ResourcePermissionMapSchema = z.record(
  PermissionResourceTypeSchema,
  z.object({ read: z.boolean(), write: z.boolean(), delete: z.boolean() })
);
export type ResourcePermissionMap = z.infer<typeof ResourcePermissionMapSchema>;
```
Drizzle-zod (`createSelectSchema`/`createInsertSchema` in `apps/api/src/db/schema/zod.ts`) + `type-checks.ts` regenerate against the widened enums; **no schema migration** (text columns). `CALLER_CAPABILITY_ACTIONS` unchanged.

### `apps/api/src/services/permission.service.ts`

```ts
export type PermissionAction = /* …existing… */ | "resource.read" | "resource.write" | "resource.delete" | "resource.share" | "resource.view";  // + resource.view

/** Per-page `view` map, computed from one loadSet — the FE nav gate. */
static async pagePermissions(ctx, client?): Promise<PagePermissionMap>;
//   = NAV_PAGE_IDS.map(id => [id, set.can("resource.view", { type: "page", id })])

/** Class-level object permissions for the FE. */
static async resourcePermissions(ctx, client?): Promise<ResourcePermissionMap>;
//   per gated resourceType: { read: set.can("resource.read",{type}), write, delete }
```
`PermissionSet.normalize` handles `resource.view` with **no change** (verb = suffix, type/id from object). `visibilityPredicate(resourceType, { createdByCol, idCol })` is reused as-is.

### `apps/api/src/services/seed.service.ts`

```ts
interface SeedStatement { effect; verb; resourceType; condition; resourceId?: string | null; }   // + resourceId
// insert: resourceId: s.resourceId ?? null, and the id key includes `${s.resourceId ?? "*"}` (dedupe page grants)
```
`MemberAccess.statements` gains:
- `{ effect:"allow", verb:"read", resourceType:"job", condition:null }` — jobs readable by everyone.
- `{ effect:"allow", verb:"view", resourceType:"page", resourceId:<id>, condition:null }` for `id ∈ {"stations","pinned","jobs"}` — member pages (Dashboard un-gated; admin pages ungranted ⇒ hidden).

### Migration / Seed

**No schema migration.** Two **data backfill** migrations for existing orgs' `MemberAccess`, cross-joining `organizations` (`WHERE deleted IS NULL`, mirroring the seed, #627), `ON CONFLICT DO NOTHING`, `-- backfill:` marked, journal committed (`project_drizzle_journal_must_be_committed`):
- `0110_backfill-nav-permission-grants.sql` — the `read job` + three `view page:*` rows.
- `0111_backfill-member-data-delete.sql` — `delete created_by_caller` on the non-shareable data types (`view, portal, entity, entity_record, field_mapping, connector_instance`); station/pin already carry delete from 0106. **A member fully controls the data objects they create — read + write + delete their own** (user-approved amendment). Delete moves from the shareable subset into the full data-type loop in the seed; the deterministic id keeps station/pin's rows identical.

### `packages/core/src/contracts/organization.contract.ts` + `apps/api/src/routes/organization.router.ts`

`OrganizationGetResponseSchema` gains `pagePermissions: PagePermissionMapSchema` + `resourcePermissions: ResourcePermissionMapSchema`. The `GET /api/organization/current` handler computes both from the caller's `PermissionSet` (one `loadSet`, alongside the existing `capabilities`). `@openapi` refs updated.

### `apps/api/src/middleware/require-permission.middleware.ts` (new)

```ts
export function requirePermission(action: PermissionAction, resourceType: string):
  (req, res, next) => void;
//  await PermissionService.check(req.application!.metadata, action, { type: resourceType }); next() | ApiError(403)
```
Mounted for the **class-level** gate on each plumbing sub-router's list.

### The six management routers (`connector-instance`, `entity-group`, `entity-tag`, `column-definition`, `jobs`, `toolpacks`)

| Router | resourceType | LIST | detail / mutation |
|---|---|---|---|
| connector-instance | `connector_instance` | `visibilityPredicate` filter (member: own + system) | per-object `check("resource.read"/"write"/"delete", {type,id,createdBy})` on detail/PATCH/DELETE |
| entity-group | `entity_group` | filter (member: none — admin-managed) | per-object check on detail/PATCH/DELETE |
| entity-tag | `tag` | filter (member: none) | per-object check on detail/PATCH/DELETE |
| column-definition | `column_definition` | filter (member: none; system rows via `created_by_system`) | per-object check on detail/PATCH/DELETE |
| jobs | `job` | filter (member: all — unconditional read) | per-object read check on detail |
| toolpacks | `toolpack` | class-level `requirePermission("resource.read","toolpack")` (builtin packs aren't DB rows → no per-row predicate) | — |

Pattern copied from `station.router.ts` (list `visibilityPredicate`, per-object `check`). `connector-instance` detail + `jobs` detail lacked `getApplicationMetadata` and org-scoping — both are **added here** (metadata mw + `organizationId` guard), closing a pre-existing cross-tenant read gap in the same edit.

**`entity_record` is excluded — it is the data plane, governed by #599 (curated views), not #630.** Its `createdBy` is the *syncing actor* (`wide-table-reconciler.service.ts`), so a naive ownership filter would hide records legitimately shared across members; row-level `entity_record` governance is #599's view model. `entity_record` keeps its existing capability + job-lock gates. Its parent `connector-entity` is not a gated management router either.

**Deferred (defense-in-depth follow-ups, not gaps in the access boundary):**
- **Create gating** is omitted — every role holds `write <type> created_by_caller`, so a create check is a no-op for all authenticated org members (already behind auth + `requireOrgWritable`).
- **Secondary reads** (`/:id/impact`, `/:id/resolve`, `/count`) are not individually object-checked; they require an out-of-band id that the filtered list never surfaces.
- **`jobs` `/:id/cancel`** keeps its existing behavior (jobs are read-only in RBAC terms; cancel is the user escape hatch).

### Frontend (`apps/web`)

- `apps/web/src/utils/routes.util.ts` — a `NAV_ITEMS` table (co-located with `ApplicationRoute`). Each item declares **either** a single `pageId?: NavPageId` **or** `tabs: { label: string; pageId: NavPageId }[]` for a page with sub-tabs; items with neither (Dashboard) are always visible. A helper `navItemPageIds(item): NavPageId[]` returns the item's ids (its `pageId`, or every tab's `pageId`).
- `apps/web/src/utils/use-capabilities.util.ts` — expose `pagePermissions` + `resourcePermissions` from `sdk.organizations.current()`; add `canViewPage(id): boolean`.
- `apps/web/src/components/SidebarNav.component.tsx` — map over `NAV_ITEMS`, render an item when **any** of its `navItemPageIds` is viewable (`ids.some(canViewPage)`) — so a role granted only `connector_catalog` still sees the Connectors item.
- **Sub-tab gating (`Connector.view.tsx`, the one page with tabs).** The tab strip (`:189-192`) filters to the tabs whose `pageId` is viewable; the initial tab is the first viewable one. A role with catalog-only view lands on Catalog and never sees the Connected tab, and vice versa.
- **`beforeLoad` guard.** For a single-`pageId` route → `redirect({ to: "/" })` when `!canViewPage(pageId)`. For the Connectors route → redirect only when **neither** sub-tab id is viewable (`!navItemPageIds(item).some(canViewPage)`), so a partial grant is never bounced off a page it can partly see. Wire `ForbiddenView` as the detail-route error render for a `403`.

## TDD test plan

### `packages/core` unit — `permission.model` / registries
- New verbs/types parse; `NAV_PAGE_IDS`, `PagePermissionMapSchema`, `ResourcePermissionMapSchema` shape; drizzle-zod + `type-checks` compile.

### `apps/api` unit — `permission-set` / `permission.service`
- `can("resource.view", {type:"page", id:"connectors"})`: allow when a matching `view page:connectors` statement is present, deny otherwise (class-level implicit-deny).
- **deny-over-allow**: a `deny read connector_instance` (class) overrides an `allow read connector_instance` object grant; page-view unaffected.
- `pagePermissions`/`resourcePermissions` shape over a seeded member vs admin vs a custom-role set.

### `apps/api` integration — seed + backfill + routers
- `seed-rbac`: a fresh member org has `read job` + `view page:{stations,pinned,jobs}` and **not** `view page:connectors`; admin/owner pass every page via `* *`.
- backfill: an org seeded pre-migration gains the new grants; idempotent re-run; the seed-backfill coverage test (if it covers policy grants) is green.
- `require-permission` + the seven routers: a **member** `GET /api/connector-instances` returns only own rows (filtered) and `403` on another's detail; **admin** sees all; `GET /api/organization/current` returns the two maps with the right booleans per role.

### `apps/web` unit — `SidebarNav` / `use-capabilities` / Connector tabs
- `SidebarNavUI` renders member vs admin item sets from a `pagePermissions` prop; a Connectors item shows when **either** sub-tab id is viewable and hides only when neither; `canViewPage` fail-closed on unknown; the `beforeLoad` redirect fires when a single page bit is false, and for Connectors only when both sub-tab bits are false (guard unit).
- `ConnectorViewUI` (or the tab-strip): given `connectors`-only, `connector_catalog`-only, both, and neither, renders the right tab set and defaults to the first viewable tab.

**Totals ≈ 34 cases.** `cd apps/api && npm run test:unit`/`test:integration`; `cd packages/core && npm run test:unit`; `cd apps/web && npm run test:unit`.

## Acceptance criteria

- A member's nav shows Dashboard/Stations/Pinned/Jobs; an owner/admin additionally sees Connectors/Entities/Entity Groups/Tags/Column Definitions/Toolpacks — driven by `can("resource.view",{type:"page",id})`, no role-name comparison.
- A member hand-crafting a request to a plumbing LIST gets **only rows they can read** (filtered), and `403` on a detail they can't read — server-authoritative; a member who owns a connector opens *that* connector's detail.
- `GET /api/organization/current` returns `pagePermissions` + `resourcePermissions` computed from the caller's `PermissionSet`.
- A `deny read <class>` overrides an `allow read <object>` in that class; page-view is unaffected by object denies.
- The Connectors page's two sub-tabs gate independently: a role granted `view page:connector_catalog` but not `view page:connectors` sees the Connectors nav item and only the Catalog tab; the reverse shows only Connected; neither hides the nav item and redirects the route.
- A custom role granted `view page:X` / `read <type>` sees the corresponding nav/rows (composes with grants/groups).
- Existing orgs get the new member grants via the backfill (verified on a pre-migration org).

## Risks & rollback

- **Fail policy: fail-closed** both surfaces — `can()` false on unknown, middleware denies on unresolved set; a payload/capabilities failure hides admin nav (safe), never exposes. Rollback: the middleware/predicate are additive per-router (remove to revert to today's open access); the resource-type/verb additions are inert without the grants; the backfill is forward-only (a mistaken grant is removed by a new backfill).
- **Backfill is the multi-tenant risk** — must mirror the seed's `deleted IS NULL` org filter and restate the partial-unique predicate in `ON CONFLICT`, or it 23503/23505s on a tombstoned membership (#627).
- **Toolpacks** has no per-row predicate (builtin packs aren't rows) — gated class-level only; noted so a later `toolpack` object model can tighten it.

## Files touched

**New:** `apps/api/src/middleware/require-permission.middleware.ts`, `apps/api/drizzle/<n>_backfill-nav-permission-grants.sql` (+ journal/snapshot), `apps/web` `NAV_ITEMS` (in `routes.util.ts`), the `beforeLoad` guard + `ForbiddenView` wiring, test files per the plan.
**Edit:** `permission.model.ts`, `permission.service.ts` (`PermissionAction` + two map methods), `seed.service.ts` (`SeedStatement.resourceId` + insert + `MemberAccess`), `zod.ts`/`type-checks.ts`, `organization.contract.ts` + `organization.router.ts`, the seven plumbing routers, `SidebarNav.component.tsx`, `use-capabilities.util.ts`, `Connector.view.tsx` (sub-tab filtering).

## Next step

`docs/ROLE_GATED_NAV.plan.md` slices this ~5 ways, each green-testable on this branch: (1) resource types + `view` verb + `resource.view` + `MemberAccess` grants + backfill + coverage; (2) `requirePermission` + `visibilityPredicate` list-filtering + per-object checks on the seven routers (the server boundary — integration-tested, the security core); (3) `pagePermissions`/`resourcePermissions` on the current-org payload; (4) `NAV_ITEMS` + `SidebarNav` gating + `beforeLoad` + `ForbiddenView` (web, unit-tested); (5) doc-sync. Merge runs the formal review-chain: code-review → security → smoke → adversarial.
