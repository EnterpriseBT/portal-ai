# Permission-gated navigation & object access (composable, server-authoritative) — Discovery

**Issue:** [EnterpriseBT/portal-ai#630](https://github.com/EnterpriseBT/portal-ai/issues/630)

**Why this exists.** The sidebar renders a flat hardcoded list to every member (`apps/web/src/components/SidebarNav.component.tsx:206-265`), and the plumbing-page APIs enforce **auth + org-membership only** (`apps/api/src/routes/protected.router.ts:40-51`). This ticket makes nav, detail-page access, and interactability **governed uniformly by the existing permission engine** — everything **explicitly granted, no heuristics, no inheritance, no "data vs admin" classification.**

**The reframe (set in review): two composable permission surfaces.**
- **Page/tab access** — a `page` resource type + a `view` verb (`allow view page:connectors`). Governs whether a nav item + page shell renders.
- **Object access** — object resource types (`connector_instance`, `entity`, `field_mapping`, + new `entity_group`, `tag`, `column_definition`, `job`, `toolpack`) × `read`/`write`/`delete`. Governs table rows (filtered by `read`), detail-page access (`403`), and interactability.

They compose (AWS-console style): a caller may **view a page** whose table is **filtered/empty/unauthorized** by object permissions. Crucially, page-view and object-read are **different resources**, so a `deny read <class>` never collides with an `allow read <object>` in that class — which a single conflated permission *would* (deny → allow → implicit-deny is the engine's resolution). This split is why the surface stays purely composable.

## The current shape

| Piece | Location | Note |
|---|---|---|
| The gate | `apps/api/src/services/permission.service.ts:126-131` | `PermissionService.check(ctx, action, object)` — the one gate; `loadSet` = roles ∪ grants ∪ groups (`:72`) |
| Resolution | `permission-set.ts` (`resolve`) | **deny → allow → implicit-deny**, fail-closed; class-level `can(v,{type})` passes only on an *unconditional* allow |
| Resource types | `packages/core/src/models/permission.model.ts:36-50` | `station, pin, view, portal, entity, entity_record, field_mapping, connector_instance, billing, org, member, audit, *` — **`field_mapping` already present**; **missing** `entity_group, tag, column_definition, job, toolpack, page` |
| Default policies | `apps/api/src/services/seed.service.ts:719-778` | `FullAccess` = `allow * *`; `AdminAccess` = `allow * *` **minus** `deny manage billing` (`:730`) + `deny delete org` (`:735`); `MemberAccess` = for each `DATA_RESOURCE_TYPE` `allow read/write WHERE created_by_caller` (`:744-756`), for each `SHAREABLE` `allow delete/share WHERE created_by_caller` (`:767-778`) — **conditional allow, never `deny`** |
| FE signal | `use-capabilities.util.ts:30`, `permission.service.ts:135-147` | coarse 6-action map only ("FE gates on this instead of role") — must be extended with page + class-level object permissions |
| Enforcement gap | 7 routers (`connector-instance`, `entity-group`, `entity-tag`, `column-definition`, `jobs`, `toolpacks`, `entity-record`) | none call `PermissionService`; every LIST/detail open to any member. Pattern to copy: `station.router.ts:318-327,:462` |
| Denied UX | `Forbidden.view.tsx` (unwired), `Authorized.component.tsx:63` (login redirect), Settings clamp | `ForbiddenView` ready to wire |

**Answering the review question directly:** `MemberAccess` is **not** `deny` on `connector_instance` — it's `allow read/write WHERE created_by_caller` (`connector_instance` ∈ `DATA_RESOURCE_TYPES`). So members already get their *own* connectors/entities/field-mappings; class-level access is *implicit*-deny, not an explicit deny. The page/object split keeps it that way — we never introduce a class `deny` that would nuke own-object access.

## The design space

### Decision 1 — New resource types + the `view` verb *(decided in review)*

Add object types `entity_group`, `tag`, `column_definition`, `job`, `toolpack`; add a nav type `page`; add a `view` verb (or reuse `read` on `page` — Lean: a distinct `view` verb, clearer in authored policies: `allow view page:connectors`). `field_mapping` already exists. Dual-schema (`zod.ts`, `type-checks.ts`) + additive enum.

### Decision 2 — The default-grant grid *(refined in review — near-final)*

`FullAccess`/`AdminAccess` **unchanged** — `* *` already covers every new type + `view` (owner-only carve-outs stay `billing.manage`/`org.delete`). Only `MemberAccess` grows:

| Grant | Detail |
|---|---|
| **Objects — data types** (unchanged) | `read/write WHERE created_by_caller` on `station, pin, portal, entity, entity_record, field_mapping, connector_instance` (field-mappings follow the same created_by rule as connectors) |
| **Objects — `job`** (new) | `allow read job` **unconditional** — jobs are readable by everyone (indirectly triggered, not directly editable) |
| **Objects — `entity_group`/`tag`/`column_definition`/`toolpack`** (new) | **no member grant** — admin-managed config; members reach their own entity's columns via the entity detail, not the catalog page |
| **Pages** (new) | `allow view page:<X>` for `stations`, `portals`, `pinned`, `jobs`; **Dashboard un-gated** (the safe redirect landing); **no** `view` on `connectors`/`entities`/`entity_groups`/`tags`/`column_definitions`/`toolpacks` |

Consequence, all from the grid (no code heuristic): a member sees Dashboard/Stations/Portals/Pinned/Jobs in the nav; the plumbing pages are hidden; a member who owns a connector can still open *that* connector's detail (per-object `read`), and their own rows show in any table they can view. **O1 confirms this grid.**

### Decision 3 — Expose permissions to the FE (page map + class-level object map)

Add to `GET /api/organization/current`, computed from the caller's already-loaded `PermissionSet`: **(a) a `pagePermissions` map** (`{ [page]: view: bool }` via `can("view",{type:"page",id})`) for nav/redirect; **(b) a class-level `resourcePermissions` map** (`{ [type]: {read,write,delete} }`) for coarse table/section affordances. Detail pages **don't pre-check** — they load the object and handle `403`. **Lean: both maps, computed generically** — a new page/type auto-populates them, the composability payoff.

### Decision 4 — Server-authoritative object enforcement (the boundary)

A shared **`requirePermission(action, resourceType)` middleware** for coarse gating, plus the real work in each of the seven routers: **LIST endpoints apply a `visibilityPredicate`** (rows the caller can `read`, exactly the `station.router` list pattern) so a member's table is *filtered*, not merely hidden; **detail/mutation** call `PermissionService.check` per object → `403`. **Lean: visibilityPredicate on lists + per-object check on detail/mutation.** This is the security core; nav-hide is convenience, this is the boundary.

### Decision 5 — Per-org backfill (existing orgs)

New `MemberAccess` grants (page views, `read job`) reach only new orgs (per-org seed). **Lean: one per-org backfill migration** (the `0080` cross-join template, `ON CONFLICT` restating the partial-unique predicate, **mirroring the seed's org-deleted filter** to avoid the #627 FK-on-tombstone class of bug) + the seed-backfill coverage test.

### Decision 6 — Denied UX

**Lean:** nav hidden via `pagePermissions`; a direct URL to a page the caller lacks → shared route `beforeLoad` `redirect()` to `/`; a table the caller can view but whose rows they can't read renders an **inline unauthorized/empty state** (AWS-style); a detail page that `403`s → `ForbiddenView`. The API filtering/`403` is the boundary regardless.

## Recommendation

1. Add `entity_group, tag, column_definition, job, toolpack, page` resource types + a `view` verb.
2. Grow `MemberAccess` per the D2 grid (**O1**); `FullAccess`/`AdminAccess` unchanged; one per-org backfill + coverage test.
3. Expose `pagePermissions` + class-level `resourcePermissions` on the current-org payload from the caller's `PermissionSet`.
4. Enforce server-side: `visibilityPredicate` on the seven LIST endpoints + per-object `check` on detail/mutation, behind a `requirePermission` middleware.
5. FE: `SidebarNav` gates on `pagePermissions`; tables filter by object `read`; `beforeLoad` redirect + `ForbiddenView` for denials. No role-name comparison (AC3).

## Open questions

1. **O1 — the D2 grant grid.** Confirm: members get `view page` on Stations/Portals/Pinned/Jobs (Dashboard un-gated); `read job` unconditional; **no** page-view or object grant on connectors/entities/entity-groups/tags/column-definitions/toolpacks (their own connector/entity *objects* stay reachable via per-object read). **Lean: as tabled.** *(Blocking for spec.)*
2. **O2 — `view` verb vs `read` on `page`.** A dedicated `view` verb reads clearer in authored policies but is one more verb in the vocabulary. **Lean: add `view`.** *(Spec-level; low stakes.)*
3. **O3 — should Entities be member-visible?** Members *own* entities (via the agent) but the PRD hides the Entities *management* nav. The split resolves it (no `view page:entities`, but per-object entity read works). Confirm the Entities page is admin-only nav. **Lean: yes, admin-only page; member entity objects reachable per-object.**

## Enterprise-scale considerations

- **Concurrency & correctness** — N/A: read-time checks over a per-request `PermissionSet`.
- **Accuracy & auditability** — Lean: guards return `403 ApiError`; denied reads need no audit.
- **Failure modes** — Lean: **fail-closed** both surfaces — unknown `can()` → false, unresolved set → deny; a payload failure hides admin nav, never exposes.
- **Scale & unbounded growth** — Lean: the two maps are O(pages + types×verbs) — small, fixed; one `can` loop over the already-loaded set.
- **Multi-tenancy** — Lean: **the backfill (D5) is the risk** — must mirror the seed's org-deleted filter (#627); middleware keys on the request org context.
- **Contract stability** — Lean: **the payoff** — a new surface (e.g. #599's `view`) becomes gateable by adding a resource type + default grants + a page/map key; `SidebarNav`, the maps, and `requirePermission`/`visibilityPredicate` all generalize with zero re-plumbing.
- **Data lifecycle** — N/A.

## What this doesn't decide

- **Per-object interactability in responses** (button-level gating) — deferred; probed in adversarial.
- **Field-mapping read scoped to particular entities** — an object-grant edge, revisit in adversarial / curated views.
- The **Views** admin page — #599 (its `view` type already exists; it slots in).
- Migrating the existing **Settings tabs** from the capability map to the `page`/`view` model — the pattern generalizes to tabs, but this ticket scopes the top-level nav.

## Next step

`docs/ROLE_GATED_NAV.spec.md` pins, once O1 lands: the six new resource types + the `view` verb (with dual-schema/type-check entries), the exact `MemberAccess` grant additions + the backfill migration, the `pagePermissions`/`resourcePermissions` payload shapes, the `requirePermission` signature + `visibilityPredicate` list-filtering + per-object checks on the seven routers, and the `beforeLoad`/`ForbiddenView` wiring. `docs/ROLE_GATED_NAV.plan.md` slices ~5 ways: (1) resource types + verb + `MemberAccess` grants + backfill + coverage test; (2) `requirePermission` + `visibilityPredicate` list-filtering + per-object checks on the seven routers (server boundary + integration tests — security core); (3) the payload maps + current-org wiring; (4) `SidebarNav` gating + table filtering + `beforeLoad` + `ForbiddenView`; (5) doc-sync. Merge runs the formal review-chain: code-review → security → smoke → adversarial.
