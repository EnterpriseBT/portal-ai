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

**Decided: (b)**, renamed `assertProjection`, which runs in this order:
1. **Duplicates:** a repeated id → 400 `CURATED_VIEW_INVALID_PAYLOAD` "Duplicate field mapping in projection". This fixes the latent 500.
2. **Membership:** any id that isn't a live mapping of the view's entity → 400 `CURATED_VIEW_INVALID_PAYLOAD` "Field mapping is not a column of this entity". It's bad input, not a refusal, so it's a 400, and it runs **before** the read check. The answer is the same for a foreign-org id, a same-org other-entity id, a deleted mapping and a made-up id, so it reveals nothing about ids elsewhere (#713 spirit).
3. **Readability:** unchanged. Each creator now comes from the map with no fallback (`createdBy` narrowed by the step-2 check), so the `?? null` and its #729 comment go away.

The response keeps the existing code, so the contract doesn't change. The web editor only offers the entity's own mappings, so users never see this; it guards the API, agent tools and stale clients. Existing rows aren't backfilled: read paths already ignore a foreign id (`/records` builds columns from the entity; `scopeFieldMappingIds` and `portal-sql` filter by the entity's statement). The smoke includes a SQL check for leftovers.

## Plan — one slice

**Files**
- Edit: `apps/api/src/routes/curated-view.router.ts`: `assertFieldsReadable` → `assertProjection` (duplicates → membership → read). Both call sites are updated. The `@openapi` 400 description on POST and PATCH names the projection case.

**Tests** (`apps/api/src/__tests__/__integration__/routes/curated-view.router.integration.test.ts`)
- Owner POST with a mapping from **another entity in the org** → 400 `CURATED_VIEW_INVALID_PAYLOAD`, and no view row.
- Owner POST with a mapping from **another org** → 400, and no view row.
- Owner POST with a **duplicate** id → 400 (was 500).
- Owner PATCH an existing view's projection with another entity's mapping → 400, and the old projection is unchanged.
- A member who can create views and sends a foreign id → 400, not 403: membership runs first.
- The existing #729/#678 projection tests stay green, so valid projections are unaffected.
- `npm run type-check`, `lint`; `npm run test:integration -- --testPathPattern curated-view`.

## Smoke (manual, against your dev stack)

1. As the e2e **owner**, `POST /api/curated-views` on "Smoke Polygons" with an Org B mapping id → 400 `CURATED_VIEW_INVALID_PAYLOAD`; `select count(*) from curated_views where key = '<key>'` → 0.
2. Same with a mapping from "Smoke Contours" (same org) → 400.
3. Same with a valid id listed twice → 400, not 500.
4. Create "Smoke Polygons" with 2 of its own mappings → 201; the view page shows those 2 columns.
5. Leftovers: `select p.id from curated_view_field_mappings p join curated_views v on v.id = p.curated_view_id join field_mappings f on f.id = p.field_mapping_id where p.deleted is null and f.connector_entity_id <> v.connector_entity_id` → 0 rows locally (and run once on app-dev after deploy).

## Out of scope

- Backfilling or deleting existing cross-entity rows: read paths already ignore them, and step 5 checks whether any exist.
- A new API code. `CURATED_VIEW_INVALID_PAYLOAD` already covers "Unknown connector entity" on the same route.
- The deleted-mapping id still listed in a view's `fieldMappingIds` (noted in the #731 walk). It's cosmetic, and a different path.
