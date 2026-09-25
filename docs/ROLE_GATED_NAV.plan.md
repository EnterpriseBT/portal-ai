# Permission-gated navigation & object access — Plan

**TDD-sequenced implementation of the two composable permission surfaces: the `page`+`view` / object-type vocabulary, the `MemberAccess` grants + per-org backfill, the server enforcement boundary (middleware + `visibilityPredicate` + per-object checks) on the seven plumbing routers, the `pagePermissions`/`resourcePermissions` payload, and the FE nav/sub-tab gating.**

Spec: `docs/ROLE_GATED_NAV.spec.md`. Discovery: `docs/ROLE_GATED_NAV.discovery.md`. Issue: #630 (epic #578). Builds on **shipped RBAC** (#598/#620/#622/#629) — `PermissionService.check`/`loadSet`, `PermissionSet.normalize`/`visibilityPredicate`, the seed default policies — all live on `main`.

Five slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/630-role-gated-nav`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
cd apps/web && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — the vocabulary and grants are the foundation everything reads; the server boundary is the security core and is proven before the FE convenience layer feeds off it:

- **Slice 1** — the vocabulary (`view` verb, 6 resource types, `resource.view`) + the `MemberAccess` grants + the per-org backfill. Pure additions to core + seed; `normalize` already handles `resource.view` generically, so no engine change. Everything downstream reads this.
- **Slice 2** — the enforcement boundary: `requirePermission` middleware + `visibilityPredicate` list-filtering + per-object `check` on the seven routers. Integration-tested; this is the security core, and nav-hiding is only convenience over it.
- **Slice 3** — the `pagePermissions`/`resourcePermissions` maps on the current-org payload, computed from the caller's `PermissionSet`. The FE's data feed.
- **Slice 4** — the FE: `NAV_ITEMS` + `SidebarNav` gating + `use-capabilities` exposure + `beforeLoad` redirect + `ForbiddenView` + the Connectors sub-tab filtering. Unit-tested through pure UI.
- **Slice 5** — doc-sync: developer-facing permission-model docs; confirm no user-facing copy drifts (RBAC/view Help content is a separate #578 child, not duplicated here).

**No schema migration** — `resource_type`/`verb` are `text` columns with no CHECK (spec "Migration / Seed"); slice 1's only DDL is the **data** backfill.

---

## Slice 1 — Vocabulary + `MemberAccess` grants + per-org backfill

The `view` verb, 6 resource types, `resource.view` action, the `SeedStatement.resourceId` field, the new member grants, and the backfill that reaches existing orgs. Nothing enforces or renders yet.

**Files**

- Edit: `packages/core/src/models/permission.model.ts` — `PERMISSION_VERBS` += `view`; `PERMISSION_RESOURCE_TYPES` += `entity_group, tag, column_definition, job, toolpack, page`; add `NAV_PAGE_IDS`, `PagePermissionMapSchema`, `ResourcePermissionMapSchema` + their types.
- Edit: `apps/api/src/db/schema/zod.ts` + `apps/api/src/db/schema/type-checks.ts` — regenerate drizzle-zod against the widened enums; bidirectional `IsAssignable` still holds (no column change).
- Edit: `apps/api/src/services/permission.service.ts` — `PermissionAction` += `resource.view`.
- Edit: `apps/api/src/services/seed.service.ts` — `SeedStatement.resourceId?: string | null`; thread it through the statement insert (id key includes `${resourceId ?? "*"}`); `MemberAccess` gains `read job` (unconditional) + `view page:{stations,pinned,jobs}` (**A**: no connectors/catalog grant).
- New: `apps/api/drizzle/<n>_backfill-nav-permission-grants.sql` (+ `meta/_journal.json` + `<n>_snapshot.json` — commit all three, `project_drizzle_journal_must_be_committed`) — per-org insert of the four new member statements, cross-join `organizations WHERE deleted IS NULL`, `ON CONFLICT` restating the partial-unique predicate (`project_backfill_must_mirror_seed_deleted_filter`), `-- backfill:` marker.
- Tests: `packages/core/src/__tests__/models/permission.model.test.ts` (verbs/types/map schemas); `apps/api/src/__tests__/services/permission-set.test.ts` (`can("resource.view", {type:"page",id})`); `apps/api` integration seed test (member grant set) + a backfill test (pre-migration org gets grants, idempotent).

**Steps**

1. **Tests (spec: core model + permission-set + seed cases).** Core: the new verbs/types parse, the two map schemas shape correctly. `permission-set`: `can("resource.view",{type:"page",id:"stations"})` true on a member set, `…id:"connectors"` false; a `deny read connector_instance` (class) beats an `allow read connector_instance` object grant. Seed integration: a freshly-provisioned member org holds `read job` (unconditional) + `view page:{stations,pinned,jobs}` and **not** `view page:connectors`/`connector_catalog`; admin/owner pass every page via `* *`. Backfill: an org seeded from the pre-#630 baseline gains exactly the four statements after the migration; a second run is a no-op. Run; fail.
2. **Implement** the model enums + map schemas → regenerate `zod.ts`/`type-checks.ts` → `PermissionAction` += `resource.view` → `SeedStatement.resourceId` + insert threading + `MemberAccess` grants → the backfill migration. Green.
3. Lint + type-check (core + api).

**Done when:** the vocabulary parses, a member set answers `resource.view`/`read job` correctly, new + backfilled orgs carry identical member grants. Nothing reads the grants for enforcement or display yet.

**Risk:** the backfill is the multi-tenant hazard — it **must** mirror the seed's `deleted IS NULL` org filter and restate the partial-unique predicate in `ON CONFLICT`, or it 23503/23505s on a tombstoned membership (#627). The backfill test asserts idempotency; a manual check against a seeded local org confirms the predicate. If the `seed-backfill-coverage` guard generalizes beyond `SYSTEM_COLUMN_DEFINITIONS` to policy grants, extend it; otherwise the dedicated backfill integration test is the coverage.

---

## Slice 2 — Server enforcement boundary (middleware + `visibilityPredicate` + per-object checks)

The security core. Every plumbing LIST filters to readable rows; every detail/mutation `check`s per object. Independent of the FE.

**Files**

- New: `apps/api/src/middleware/require-permission.middleware.ts` — `requirePermission(action, resourceType)` → `PermissionService.check(req.application!.metadata, action, {type})` → `next()` | `ApiError(403)`.
- Edit: the six management routers — `connector-instance`, `entity-group`, `entity-tag`, `column-definition`, `jobs`, `toolpacks` (`apps/api/src/routes/…`). LIST: apply `set.visibilityPredicate(resourceType, {createdByCol, idCol})` (pattern: `station.router.ts`); detail/mutation: per-object `PermissionService.check`. Toolpacks: class-level `requirePermission("resource.read","toolpack")` only (builtin packs aren't DB rows). **`entity_record` is excluded** — it is the data plane (#599 curated views); its `createdBy` is the syncing actor, so a naive ownership filter would hide shared records. Create-gating omitted (no-op for all roles); `connector-instance`/`jobs` detail also gain `getApplicationMetadata` + org-scoping (closing a pre-existing cross-tenant gap).
- Tests: per-router integration tests under `apps/api`'s integration suite — member-filtered list, `403` on another member's detail, admin sees all, jobs unconditional-read for members, toolpacks class-gate.

**Steps**

1. **Integration tests (spec: router cases).** For a fixture org with an admin + two members: member A `GET /api/connector-instances` returns only A's rows; A's `GET /api/connector-instances/:bId` (B's) → `403`; admin sees all. `GET /api/jobs` returns all jobs for a member (unconditional `read job`). Member `GET /api/toolpacks` → `403` (no `read toolpack`); admin `200`. Repeat the own-vs-other shape for entity-group/tag/column-definition/entity-record. Run; fail.
2. **Implement** the middleware; wire `visibilityPredicate` into each LIST query and the per-object `check` into each detail/mutation handler. Green.
3. Lint + type-check.

**Done when:** the router cases pass; a hand-crafted member request is filtered/`403`'d server-side regardless of the FE. This is the boundary AC.

**Risk:** a router whose LIST doesn't map cleanly to a single `(createdByCol, idCol)` table (toolpacks — builtin registry + org rows) is gated class-level only, per spec; confirm each of the other six exposes a `createdBy` + `id` column for the predicate. Entity-record already has partial gating elsewhere — confirm the new predicate composes with it rather than double-filtering.

---

## Slice 3 — `pagePermissions` + `resourcePermissions` on the current-org payload

The FE's data feed, computed once from the caller's already-loaded `PermissionSet`.

**Files**

- Edit: `apps/api/src/services/permission.service.ts` — `pagePermissions(ctx, client?) → PagePermissionMap` (`NAV_PAGE_IDS.map(id => [id, set.can("resource.view",{type:"page",id})])`); `resourcePermissions(ctx, client?) → ResourcePermissionMap` (per gated type: `{read,write,delete}` via `set.can`).
- Edit: `packages/core/src/contracts/organization.contract.ts` — `OrganizationGetResponseSchema` += `pagePermissions` + `resourcePermissions`.
- Edit: `apps/api/src/routes/organization.router.ts` — the `current` handler computes both alongside `capabilities` (one `loadSet`); `@openapi` refs updated + registered in `swagger.config.ts`.
- Tests: `apps/api` unit for the two methods (member vs admin vs a custom role set); an integration assertion that `GET /api/organization/current` returns the maps with the right booleans.

**Steps**

1. **Tests (spec: payload cases).** `pagePermissions` for a member has `stations/pinned/jobs` true, `connectors/connector_catalog/entities/…` false; admin all true. `resourcePermissions` per type matches the set. `GET /api/organization/current` (integration) returns both maps. Run; fail.
2. **Implement** the two service methods + contract fields + router wiring + swagger registration. Green.
3. Lint + type-check (core + api).

**Done when:** the current-org payload carries both maps, computed generically from the set — a new page/type auto-populates.

**Risk:** none structural — read-only compute over the loaded set. Confirm the handler reuses the existing `loadSet`/`capabilities` path rather than issuing a second load.

---

## Slice 4 — FE nav + sub-tab gating (`NAV_ITEMS`, `SidebarNav`, `beforeLoad`, `ForbiddenView`, Connectors tabs)

The convenience layer over slice 2's boundary. Pure-UI, unit-tested through props.

**Files**

- Edit: `apps/web/src/utils/routes.util.ts` — the `NAV_ITEMS` table (each item: single `pageId?` **or** `tabs: {label,pageId}[]`; Dashboard neither) + `navItemPageIds(item)` helper.
- Edit: `apps/web/src/utils/use-capabilities.util.ts` — expose `pagePermissions`/`resourcePermissions` from `sdk.organizations.current()`; add `canViewPage(id)` (fail-closed on unknown).
- Edit: `apps/web/src/components/SidebarNav.component.tsx` — render an item when `navItemPageIds(item).some(canViewPage)`.
- Edit: `apps/web/src/views/Connector.view.tsx` — filter the tab strip (`:189-192`) to viewable sub-tabs; default to the first viewable.
- Edit: the seven admin route files (`apps/web/src/routes/…`) — shared `beforeLoad` guard → `redirect({to:"/"})` when no page id of the route is viewable (Connectors: only when **neither** sub-tab is); wire `ForbiddenView` (`Forbidden.view.tsx`) as the detail-route `403` render.
- Tests: `apps/web` unit for `SidebarNavUI` (member vs admin item sets; Connectors shows on either sub-tab, hides on neither); `use-capabilities` (`canViewPage` fail-closed); `ConnectorViewUI` tab-set under `connectors`-only / `connector_catalog`-only / both / neither; the `beforeLoad` guard unit.

**Steps**

1. **Tests (spec: web cases).** `SidebarNavUI` given a member `pagePermissions` prop renders Dashboard/Stations/Pinned/Jobs and not the admin items; given admin renders all; Connectors item shows when either `connectors` or `connector_catalog` is true, hidden when both false. `canViewPage` false on an unknown id. `ConnectorViewUI` renders the right tab set + defaults correctly across the four grants. `beforeLoad` redirects a member off `/connectors` (neither tab) and off `/entities`. Run; fail.
2. **Implement** `NAV_ITEMS` + `navItemPageIds` → `use-capabilities` exposure → `SidebarNav` gating → Connectors tab filtering → the `beforeLoad` guards + `ForbiddenView`. Green.
3. Lint + type-check (web).

**Done when:** the web cases pass; nav + sub-tabs + route guards derive entirely from `pagePermissions`, no role-name comparison (AC3).

**Risk:** `beforeLoad` reads permissions before the current-org query resolves — gate on the query's loaded state (fail-closed: no data ⇒ redirect, never flash-then-bounce). The pure-UI split (Component File Policy) keeps `SidebarNavUI`/`ConnectorViewUI` props-only so tests need no router/SDK mocks; the container wires `useCapabilities`.

---

## Slice 5 — Doc-sync

Developer-facing docs for the new permission vocabulary; confirm no user-facing copy drifts.

**Files**

- Edit: `apps/api/README.md` (or the permission reference it points to) — the page/object composable model, the 6 new resource types + `view` verb, that new resource types/verbs need **no** migration (text columns), and the per-org backfill obligation for new member grants.
- Verify (edit only if drifted): `packages/core/src/content/glossary.util.ts` / `faq.util.ts` — the user-facing RBAC/view Help content is a **separate #578 child**; #630 does not add it here. Note the non-duplication.
- Edit: `CLAUDE.md` (+ `.github/copilot-instructions.md` mirror) only if the routing/permission convention section needs the new page-gate pattern recorded.

**Steps**

1. Update the developer permission-model doc; confirm glossary/faq need no change for this ticket (record why).
2. Lint + type-check; run the pinning tests (`glossary.util.test.ts`/`faq.util.test.ts`) to prove no drift.

**Done when:** the next contributor reads the composable page/object model and the no-migration/backfill rules; user-facing Help is untouched (owned by the separate child).

**Risk:** none — docs only.

---

## Sequence summary

| Slice | Lands | Tests |
|---|---|---|
| 1 | `view` verb + 6 types + `resource.view` + `MemberAccess` grants + backfill | core unit + api unit + api integration |
| 2 | `requirePermission` + `visibilityPredicate` + per-object checks on 7 routers | api integration |
| 3 | `pagePermissions`/`resourcePermissions` on current-org payload | api unit + integration |
| 4 | `NAV_ITEMS` + `SidebarNav` + `beforeLoad` + `ForbiddenView` + Connectors sub-tabs | web unit |
| 5 | developer doc-sync | core unit (pin) |

Total ≈ **34 cases**, no schema migration (one data backfill in slice 1).

## Cross-slice notes

- **No engine change.** `PermissionSet.normalize` decomposes `resource.view` generically (`verb = action.slice("resource.".length)`, type/id from the object), so slice 1 adds only the union member + vocabulary — nothing in `permission-set.ts` resolution changes.
- **No schema migration; the one DDL is a data backfill.** `resource_type`/`verb` are `text` + drizzle-enum with no CHECK, so the widened enums need no `ALTER`. Slice 1's `<n>_backfill-nav-permission-grants.sql` inserts member grants for existing orgs — commit its journal + snapshot (`project_drizzle_journal_must_be_committed`).
- **Decision A is encoded, not deferred.** Connectors/Catalog carry no member grant; a role that needs self-serve connectors is an **admin-authored policy** (`view page:connector_catalog` + `view page:connectors`), which composes with zero code change — the sub-tab ids already exist. Revisit as an adversarial probe, not a grid change.
- **Server boundary is independent of the FE.** Slice 2's filtering/`403` is the real AC; slices 3–4 are the nav convenience. A regression in the FE gate never widens access — the router still filters.
- **Fail-closed throughout** — `can()` false on unknown, middleware denies on an unresolved set, `beforeLoad` redirects when the current-org query hasn't loaded. A payload/capabilities failure hides admin nav (safe), never exposes.
- **Doc-sync boundary:** #630 owns the *developer* permission-model docs; the *user-facing* RBAC + view Help content (glossary/faq/marketing) is a separate #578 child — slice 5 confirms non-duplication rather than writing it.

## Next step

Implement slice 1 (core + seed + backfill). Before coding, re-read the spec's *Surface* skeletons against the shipped `permission.model.ts`, `seed.service.ts` `MemberAccess` block, and `permission-set.ts` `normalize` — lift the real shapes, don't reinvent. Implementation begins only after discovery/spec/plan are confirmed.
