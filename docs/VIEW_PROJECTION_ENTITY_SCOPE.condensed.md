# View projection must stay on its entity — Condensed design (#736)

**Issue:** [EnterpriseBT/portal-ai#736](https://github.com/EnterpriseBT/portal-ai/issues/736) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** A curated view's projection (`fieldMappingIds`) is meant to be a subset of its own entity's columns. Nothing enforces that. `assertFieldsReadable` only asks "may the caller read this id?", and it gives an id that isn't on the entity `createdBy: null`. A member's ownership-scoped read refuses that, but an owner's or admin's unconditional `* *` grant matches it. So the owner gets `201`, and the projection row stores a mapping from another entity or another org (found by the #731 adversarial walk). Nothing leaks, because columns are built from the view's own entity, but the stored row crosses tenants and the view shows no columns. Only `apps/api` changes.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Field check | `apps/api/src/routes/curated-view.router.ts:104` `assertFieldsReadable` | loads this entity's live mappings (`fieldMappingCreators`, :85), then runs `can(read)` per requested id; an id not in the map gets `null` |
| Create | `curated-view.router.ts:449` (check) → `:497` `createMany` | entity is already verified in-org (:433, 400 `CURATED_VIEW_INVALID_PAYLOAD`) |
| PATCH | `curated-view.router.ts:579` (check, only when `fieldMappingIds` sent) → `:625` `createMany` | projection replace: soft-delete old rows, insert the new set |
| Uniqueness | `db/schema/curated-view-field-mappings.table.ts:29` `curated_view_field_mappings_view_fm_unique` | a duplicate id in the request hits this index → **500** today |
| Analogue | `validateFilter` (:60) | the existing per-entity body validation; answers 400 |
| Other writers | none | the only `curatedViewFieldMappings.createMany` callers are :497 and :625 |

## Decision — validate membership before permission, as bad input (400)

Options: (a) a separate `assertProjectionOnEntity` helper called before `assertFieldsReadable`; (b) **fold the membership check into the same function**, which already loads the entity's mapping map; (c) a DB-level constraint, which a join table can't express, because the mapping's entity isn't on the row.

**Decided: (b)**, renamed `assertProjection`. It returns the ids to store and runs in this order:
1. **Duplicates:** a repeated id → 400 `CURATED_VIEW_INVALID_PAYLOAD` "Duplicate field mapping in projection". This fixes the latent 500.
2. **Membership:** any id that isn't a mapping of the view's entity, live or deleted, → 400 `CURATED_VIEW_INVALID_PAYLOAD` "Field mapping is not a column of this entity". It's bad input, not a refusal, so it's a 400, and it runs **before** the read check. The answer is the same for a foreign-org id, a same-org other-entity id and a made-up id, so it reveals nothing about ids elsewhere (#713 spirit).
3. **A deleted column of this entity is dropped, not refused** (code review on #737). Deleting a field mapping doesn't touch the projections that name it, and `CuratedViewEditorDialog` sends a view's stored ids back on every save. Refusing a dead id would leave the view uneditable, with no way to deselect it in the UI. Dropping it cleans the row up on the next save. This also covers a mapping deleted between the check and the insert: it's just a dead id that a later save drops.
4. **Never widen by dropping.** An empty projection means "all columns" (`portal-sql`, and the `in_curated_view` expansion in `permission.service.ts`). So a non-empty request left with nothing is refused with a 400 "None of the selected columns exist any more", never stored as `[]`. For the same reason, mapping deletes **don't** cascade into projections and GET keeps returning dead ids: either would quietly turn a view whose columns were all deleted into an all-columns view.
5. **Readability:** unchanged. Each creator now comes from the live map, so the `?? null` and its #729 comment go away. PATCH loads the permission set once and only checks the projection when `fieldMappingIds` is sent.

The response keeps the existing code, so the contract doesn't change. The web editor only offers the entity's own mappings, so users never see these 400s for a normal save; they guard the API, agent tools and stale clients. Existing rows aren't backfilled: read paths already ignore a foreign id, and a dead id is dropped on the next save. A cross-entity row from before this fix would still refuse saves, so smoke step 6 runs the leftover check on app-dev **before merge**, and a forward migration follows only if it finds rows.

## Plan — one slice

**Files**
- Edit: `apps/api/src/routes/curated-view.router.ts`: `assertFieldsReadable` → `assertProjection` (duplicates → membership → drop dead → never widen → read), returning the ids to store. Both call sites store what it returns. The `@openapi` 400 description on POST and PATCH names the projection case.

**Tests** (`apps/api/src/__tests__/__integration__/routes/curated-view.router.integration.test.ts`)
- Owner POST with a mapping from **another entity in the org** → 400 `CURATED_VIEW_INVALID_PAYLOAD`, and no view row.
- Owner POST with a mapping from **another org** → 400, and no view row.
- Owner POST with a **duplicate** id → 400 (was 500).
- Owner PATCH an existing view's projection with another entity's mapping → 400, and the old projection is unchanged.
- A member who can create views and sends a foreign id → 400, not 403: membership runs first.
- An unknown id → 400.
- A view saved again after one of its projected mappings is soft-deleted, sending its stored ids back as the editor does → 200, and the dead id is gone.
- A save whose every projected mapping is deleted → 400, with the view unchanged (not widened).
- A label-only PATCH on a view with a dead projected mapping → 200.
- The existing #729/#678 projection tests stay green, so valid projections are unaffected.
- `npm run type-check`, `lint`; `npm run test:integration -- --testPathPattern curated-view`.

## Smoke (manual, against your dev stack)

1. As the e2e **owner**, `POST /api/curated-views` on "Smoke Polygons" with an Org B mapping id → 400 `CURATED_VIEW_INVALID_PAYLOAD`; `select count(*) from curated_views where key = '<key>'` → 0.
2. Same with a mapping from "Smoke Contours" (same org) → 400.
3. Same with a valid id listed twice → 400, not 500.
4. Create "Smoke Polygons" with 2 of its own mappings → 201; the view page shows those 2 columns.
5. In the view editor, change that view's label and save after soft-deleting one of its two mappings in SQL (`update field_mappings set deleted = …`; deleting through the API drops the wide-table column) → saved; the view now lists one column. Restore the mapping afterwards.
6. Leftovers: `select p.id from curated_view_field_mappings p join curated_views v on v.id = p.curated_view_id join field_mappings f on f.id = p.field_mapping_id where p.deleted is null and f.connector_entity_id <> v.connector_entity_id` → 0 rows locally. Run it on app-dev **before merge** with `portalops db psql --env app-dev -- -tAc "<query>"`. Any rows mean a forward migration lands in this PR.

## Out of scope

- Backfilling or deleting existing cross-entity rows: read paths already ignore them, and step 5 checks whether any exist.
- A new API code. `CURATED_VIEW_INVALID_PAYLOAD` already covers "Unknown connector entity" on the same route.
- The deleted-mapping id still listed in a view's `fieldMappingIds` (noted in the #731 walk). It's cosmetic, and a different path.
