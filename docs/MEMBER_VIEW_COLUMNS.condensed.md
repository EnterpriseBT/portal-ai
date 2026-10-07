# Members get columns on views readable via created_by_system — Condensed design (#729)

**Issue:** [EnterpriseBT/portal-ai#729](https://github.com/EnterpriseBT/portal-ai/issues/729) · Bug · **small / condensed**.

**Why.** A member's `read field_mapping` comes from conditional grants (`created_by_caller`, `created_by_system` in `MemberAccess`), and a condition only matches with the object's `createdBy`. The per-view column check passed only the mapping id. So a member got **zero columns** on every view reached that way:
- The view page's records table spun forever, because it mounts only once columns arrive.
- A portal session built every member view with no columns, so the agent couldn't find field mappings.

It hit app-dev's `demo` org, which is system-provisioned. It has been live since #599. `apps/api` only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Column check | `services/portal-sql.service.ts` `resolveOneViewColumns` | serves `resolveViewColumnsById` (detail/records) and `resolveGrantedViewColumns` (session build); `can(read, {type, id})`, with no `createdBy` |
| Projection ids | `services/curated-view-payload.service.ts` `scopeFieldMappingIds` ← `routes/curated-view.router.ts` GET `/:id` | same omission |
| Condition semantics | `packages/core/src/models/permission.model.ts` | `created_by_system` ⇒ `createdBy === SystemUtilities.id.system` |

## Decision — pass the creator

The wide-table statement cache, which already loads the entity's mappings, carries each column's `fieldMappingCreatedBy` (`null` if the mapping is gone, which fails closed). The column check reads it with no extra query. The view GET and the create/update self-exposure guard (`assertFieldsReadable`, found in code review) look creators up only when they need them. There's no new grant and no policy change. The existing shares (`in_curated_view`, instance grants) keep working; they never needed `createdBy`.

**Tests encoded the bug.** In the integration suite `SYSTEM_ID` is `SYSTEM_TEST`, so the curated-view fixture's mappings were system-created. Three member tests "expected hidden" columns that a member may in fact read. Those tests mean "a mapping the member can't read", so the fixture's mappings are now owner-created. The new #729 test makes view, mappings and records system-created explicitly.

## Plan — 1 slice

- **Files:** `services/portal-sql.service.ts`, `services/curated-view-payload.service.ts`, `routes/curated-view.router.ts`.
- **Tests:** `__integration__/routes/curated-view.router.integration.test.ts`:
  - new: a member reads a system-created view's columns and rows with no shares;
  - fixture: mappings are owner-created.
- Run the related unit and integration suites (curated views, portal SQL, maps, dissolve, entity groups, read access).

## Smoke (app-dev, after deploy)

1. As Ben Turner (member) in `demo`, open any view detail page. The records table renders its columns and rows; there's no endless spinner.
2. In a demo portal, ask a data question. The agent queries the views; there's no "field mappings not found".
3. As the demo owner, the same pages are unchanged.

## Out of scope

- A guard so no `can()` on an owned type can omit `createdBy` again. That's a follow-up ticket.
