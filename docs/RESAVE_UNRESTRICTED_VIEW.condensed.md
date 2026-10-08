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

**Decided: (b).** It holds for every client and is one comparison against a read PATCH already makes. "Unchanged" means the same set of ids as the view's live projection rows (`[]` matches a view with no rows). Order is ignored, and so are duplicates: nothing is written, so they can't reach the unique index. Any actual change, including adding or removing one id or switching between `[]` and a list, still runs the full `assertProjection`. That's the only way to change exposure. One consequence: a label-only save no longer drops a dead id from the projection (#736). That's harmless, because read paths already ignore it and the next real projection change drops it.

The 403 also gets clearer. When the effective projection is "all columns", the message says so: "An all-columns view needs read access to every column of its entity". An explicit list keeps the existing message. Neither names the unreadable column, because naming it would reveal something the caller can't read. The code stays `CURATED_VIEW_FIELD_NOT_READABLE`.

## Plan — one slice

**Files**
- Edit: `apps/api/src/routes/curated-view.router.ts`: PATCH loads the stored projection ids before the check and compares sets; if they're equal, the projection is `undefined`. `assertProjection` picks the all-columns message when the effective projection came from `[]`.

**Tests** (`apps/api/src/__tests__/__integration__/routes/curated-view.router.integration.test.ts`)
- Member-owned unrestricted view; an owner-created column is added; member PATCHes `{ label, fieldMappingIds: [] }` → 200 and the label is saved. Fails today with 403.
- Same view, member PATCHes `{ fieldMappingIds: [<a column they can read>] }` (a real change) → 200; the guard still passes on a readable explicit list.
- Member PATCHes an explicit view to `[]` (a real change, widening to all columns) with an unreadable column present → 403 with the all-columns message.
- View whose every projected column was deleted; PATCH `{ label, fieldMappingIds: <stored ids> }` → 200, projection untouched.
- Same stored ids in a different order → treated as unchanged (200).
- The #736 test "a save whose every projected mapping is deleted is refused" resends its one stored id, which is now unchanged and gets 200 (covered above). It's rewritten to the changed case that still has to refuse: a view on [email, age] with age deleted, PATCHed to `[age]` → 400, and the projection is untouched. The other #736 tests stay green.
- `npm run type-check`, `lint`; `npm run test:integration -- --testPathPattern curated-view`.

## Smoke (manual, against your dev stack)

1. As the e2e **member**, own an all-columns view on "Smoke Polygons" (create it as the owner, then `update curated_views set created_by = '<member id>'`). Add an owner-created mapping to the entity in SQL. In the editor, rename the view → saves; the label changes.
2. As the member, set that view's columns to just `parcel_id` → saves. Then back to all columns ("Leave empty") → refused with "An all-columns view needs read access to every column of its entity".
3. As the owner, rename a view whose projected columns were all soft-deleted (in SQL) → saves; the columns still read "N selected".
4. Clean up: remove the extra mapping and the views, and restore any soft-deleted mappings.

## Out of scope

- Omitting unchanged fields in the editor (option a). The server rule covers every client.
- Naming the unreadable column in the 403: it would disclose an unreadable column's name.
- Cleaning dead ids out of projections on label-only saves; they're harmless and drop on the next real change.
