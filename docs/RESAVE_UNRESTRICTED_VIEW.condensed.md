# Re-saving an unchanged projection isn't a projection change — Condensed design (#738)

**Issue:** [EnterpriseBT/portal-ai#738](https://github.com/EnterpriseBT/portal-ai/issues/738) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `CuratedViewEditorDialog` sends `fieldMappingIds` on every save, including a label-only edit. PATCH treats any sent projection as a change and runs `assertProjection`, whose self-exposure guard requires read on every column in the *effective* projection. For an unrestricted view (`[]`) that's every live column of the entity. So when someone adds a column the view's owner can't read, the owner's own all-columns view can no longer be renamed (403 `CURATED_VIEW_FIELD_NOT_READABLE`, naming nothing). The guard is right for a projection that **changes**. Resending the stored one changes nothing and exposes nothing new. The same shape also blocks a label-only save on a view whose every projected column was deleted (#736's "never widen" 400). Only `apps/api` changes.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Editor update body | `apps/web/src/components/CuratedViewEditorDialog.component.tsx:376-381` | always sends `fieldMappingIds: selectedFieldMappingIds`, seeded from `view.fieldMappingIds` (:281) |
| PATCH projection check | `apps/api/src/routes/curated-view.router.ts` (PATCH, `const projection = body.fieldMappingIds ? await assertProjection(…) : undefined`) | runs whenever the field is sent |
| `assertProjection` | `curated-view.router.ts:131` | duplicates → membership → drop dead → never widen → read every effective id (all live columns when `[]`) |
| Stored projection | `curatedViewFieldMappings.findByCuratedViewId` | already read inside the PATCH transaction for the replace |
| What a writer's editor receives | `CuratedViewPayloadService.scopeFieldMappingIds` | every stored id, dead ones included, for a caller who can see the definition (write) |

## Decision — an unchanged projection is treated as not sent

Options: (a) the editor omits `fieldMappingIds` when unchanged. That's client-only, so other clients and stale tabs still hit the 403. (b) **PATCH compares the requested ids with the stored ones as a set and, when they're equal, treats the field as absent**: no check and no replace. (c) Keep the check but skip only the read step when unchanged. That still 400s the all-dead case and still rewrites rows for nothing.

**Decided: (b)**, widened by code review on #739 to fix the cause rather than one symptom. The self-exposure guard exists so a view editor can't expose a column they can't read. Re-checking columns the view **already** shows doesn't serve that purpose, and it's what blocked the save. So:

1. **Unchanged = not sent.** PATCH compares the requested ids with the view's live projection rows as a set (`[]` matches no rows). If they're equal, there's nothing to check and nothing to rewrite. Duplicates are refused first, so `[a, b, a]` against stored `[a, b]` is still a 400. A label-only save therefore no longer drops a dead id from the projection (#736); read paths ignore it, and the next real change drops it.
2. **A change is checked only on what it newly exposes.** That means the added ids, or for a widen to all columns, every live column not already projected. Narrowing exposes nothing, so it's never refused: removing a column, all columns → a list, or dropping a dead id. Creating a view counts every column it will show as new. One consequence is deliberate: a writer may keep a column they can't read while editing the others. Someone who could read it exposed it, and the writer gains no new access.
3. **One snapshot.** The stored projection is read inside the PATCH transaction, after the view-row update takes its lock, so the comparison, the check and the replace all see the same rows and a concurrent save can't slip in between. `assertProjection`'s reads run on that transaction's client.

The 403 also gets clearer. When the new projection is "all columns", the message says so: "An all-columns view needs read access to every column of its entity". An explicit list keeps the existing message. Neither names the unreadable column, because naming it would reveal something the caller can't read. The code stays `CURATED_VIEW_FIELD_NOT_READABLE`, and the PATCH `@openapi` 403 description now spells out the rule.

## Plan — one slice

**Files**
- Edit: `apps/api/src/routes/curated-view.router.ts`: `assertProjection(set, entity, ids, stored?, client?)` checks read only on newly exposed columns (`stored` undefined on create). PATCH refuses duplicates, then, inside the transaction, compares with the stored rows and only runs the check and the replace on a real change. The all-columns 403 message is added, and the `@openapi` 403 is updated.

**Tests** (`apps/api/src/__tests__/__integration__/routes/curated-view.router.integration.test.ts`)
- Member-owned unrestricted view; an owner-created column is added; member PATCHes `{ label, fieldMappingIds: [] }` → 200 and the label is saved. Fails today with 403.
- Same view, member PATCHes `{ fieldMappingIds: [<a column they can read>] }` (a real change) → 200; the guard still passes on a readable explicit list.
- Member PATCHes an explicit view to `[]` (a real change, widening to all columns) with an unreadable column present → 403 with the all-columns message.
- View whose every projected column was deleted; PATCH `{ label, fieldMappingIds: <stored ids> }` → 200, projection untouched.
- Same stored ids in a different order → treated as unchanged (200), and no rows are rewritten.
- The view keeps a column the member can't read: removing another column → 200; adding a readable one → 200. A view that doesn't show it yet: adding it → 403.
- All columns → a list that includes an unreadable column (narrowing) → 200.
- A duplicate id in a set that otherwise matches the stored one → 400.
- The #736 test "a save whose every projected mapping is deleted is refused" resends its one stored id, which is now unchanged and gets 200 (covered above). It's rewritten to the changed case that still has to refuse: a view on [email, age] with age deleted, PATCHed to `[age]` → 400, and the projection is untouched. #736's "saves after a deletion and drops it" now asserts that the resend keeps the projection and that the next real change (adding `tags`) drops the dead id.
- `npm run type-check`, `lint`; `npm run test:integration -- --testPathPattern curated-view`.

## Smoke (manual, against your dev stack)

1. As the e2e **member**, own an all-columns view on "Smoke Polygons" (create it as the owner, then `update curated_views set created_by = '<member id>'`). Add an owner-created mapping to the entity in SQL. In the editor, rename the view → saves; the label changes.
2. As the member, set that view's columns to just `parcel_id` → saves. Then back to all columns ("Leave empty") → refused with "An all-columns view needs read access to every column of its entity".
3. As the owner, rename a view whose projected columns were all soft-deleted (in SQL) → saves; the columns still read "N selected".
3b. As the owner, put the member-unreadable mapping into the member's view alongside `parcel_id` and `zone` (SQL projection row). As the member, remove `zone` → saves, and the view now shows `parcel_id` plus the unreadable column.
4. Clean up: remove the extra mapping and the views, and restore any soft-deleted mappings.

## Out of scope

- Omitting unchanged fields in the editor (option a). The server rule covers every client.
- Naming the unreadable column in the 403: it would disclose an unreadable column's name.
- Cleaning dead ids out of projections on label-only saves; they're harmless and drop on the next real change.
