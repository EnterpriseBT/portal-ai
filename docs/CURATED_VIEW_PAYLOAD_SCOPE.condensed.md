# Curated view payloads scoped to the reader: Condensed design (#680)

**Issue:** [EnterpriseBT/portal-ai#680](https://github.com/EnterpriseBT/portal-ai/issues/680) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc). Security review **required** (data access).

**Why.** `GET /api/curated-views/:id` and `GET /api/curated-views` send every reader the raw `filter` tree (field names and literals, e.g. `salary > 100000`). `GET /:id` also sends the full projection's `fieldMappingIds`, including field mappings the reader can't read. That leaks the names of hidden columns, and thresholds on them: the value oracle the projection and field grants exist to prevent.

Readers get only *whether* the view is filtered and the field mappings they can read. Callers with write on the view (who need the definition for the editor) get it unchanged. Touches core (contract), api (router) and web (the two pages that render "Row filter" / "Columns").

## Current shape

| Piece | Location | Note |
|---|---|---|
| List | `apps/api/src/routes/curated-view.router.ts:199-219` | `findManyWithEntity` rows returned as-is (each includes `filter`) |
| Get | `curated-view.router.ts:251-292` | checks `resource.read`, then spreads the row plus every projection `fieldMappingId` |
| Contract | `packages/core/src/contracts/curated-view.contract.ts:15-17, 41-43, 58-60` | `CuratedViewWithProjection` (row + `fieldMappingIds`); `CuratedViewListItem` (row + `entity`) |
| Model | `packages/core/src/models/curated-view.model.ts:28-30` | `filter: FilterExpression \| null` |
| Field-read rule | `apps/api/src/services/portal-sql.service.ts:363-386` | `resolveOneViewColumns`: projection ∩ `set.can("resource.read", {type:"field_mapping", id})` |
| Write check | `curated-view.router.ts` PATCH (`PermissionService.check(…"resource.write"…)`) | per-view write, the rule for "may see the definition" |
| Web | `apps/web/src/views/CuratedViewDetail.view.tsx:160-169`, `CuratedViews.view.tsx:131-134` | render `view.filter ? "Filtered" : "All rows"` and `fieldMappingIds.length ? "N selected" : "All columns"`; the editor dialog (`CuratedViewEditorDialog.component.tsx:280-282`) seeds from `view.filter` / `view.fieldMappingIds` |

The other surfaces that serialize a view are already safe:
- the station `include` returns id/key/label/connectorEntityId;
- create/update return to the writer who sent the definition;
- attach returns ids only.

## Decision: redact per caller on read; add the two booleans the UI needs

- **Contract (additive).** Both `CuratedViewListItem` and `CuratedViewWithProjection` gain:
  - `filtered: boolean`: whether the view has a row filter;
  - `projected: boolean`: whether it has an explicit column selection, as opposed to all columns.
- **Redaction.** For a caller **without** `resource.write` on that view (checked per view, `{type:"curated_view", id, createdBy}`):
  - `filter` is `null`;
  - `fieldMappingIds` (GET) is trimmed to the projection ids the caller can read, under the same `set.can("resource.read", {type:"field_mapping", id})` test as `resolveOneViewColumns`.

  Writers get everything as today. One `loadSet` per request, with the per-row decisions in memory.
- **Web.**
  - "Row filter" reads `view.filtered`.
  - "Columns" reads `view.projected ? "<fieldMappingIds.length> selected" : "All columns"`. A reader therefore sees the count of columns *they* can read, and a restricted view never shows as "All columns".
  - The editor is unchanged. It's gated by write, and writers still receive the full definition. A save from a caller without instance write was already refused with a 403.

Rejected alternatives:
- Dropping `filter` from the shared schema and adding a separate reader schema: two shapes per endpoint, for a field that is simply null.
- Redacting by role name: framed by permissions, never roles.
- Sending a sanitized filter (operators without values): still leaks column names, and the user decided in #678 that readers don't need to know the filter.

## Plan: 2 slices

**Slice 1: contract + API redaction.**
- **Files:** `curated-view.contract.ts` (add `filtered`, `projected` to both shapes); `curated-view.router.ts` (GET and list: compute `filtered`/`projected`, redact for non-writers; `@openapi` notes); `swagger.config.ts` if the registered shapes need regenerating.
- **Tests:** `packages/core/src/__tests__/contracts/curated-view.contract.test.ts` (new fields required); `apps/api/src/__tests__/__integration__/routes/curated-view.router.integration.test.ts`:
  - a reader (read grant on the view, no read on one projected field mapping, no write) gets `filter: null`, `filtered: true`, `projected: true`, and `fieldMappingIds` without the unreadable id, on both GET and list;
  - the owner (write) gets the full `filter` and all ids;
  - an unfiltered, unprojected view reads `filtered: false`, `projected: false` for both.

**Slice 2: web reads the booleans.**
- **Files:** `CuratedViewDetail.view.tsx`, `CuratedViews.view.tsx`; fixtures and stories that build views.
- **Tests:** `apps/web/src/__tests__/CuratedViewDetailView.test.tsx`, the CuratedViews view test: "Filtered" with `filter: null, filtered: true`; "2 selected" for a projected view with 2 readable ids; "All columns" only when `projected: false`.

Runs: `npm run test:unit` / `npm run test:integration` per package; the root `npm run build` + `type-check` (a new required core field ripples into web fixtures).

## Smoke (manual, against your dev stack)

1. As the owner, give `Parity view` (filter `age >= 18`) a member read share. Leave the member's field grants default.
2. As the **member**, `GET /api/curated-views/<Parity view id>` → `filter: null`, `filtered: true`, `projected: true`, `fieldMappingIds` = the ids they can read. `GET /api/curated-views` shows the same `filter: null` / `filtered: true` on that row.
3. As the **owner**, the same requests → the full `filter` (`age gte 18`) and all 4 ids.
4. As the member, open the Views list and the view page: "Row filter: Filtered" and "Columns: 4 selected". As the owner, Edit opens with the filter and columns filled in.
5. An unfiltered view with no column selection (`Smoke view B`, or a new one) reads "All rows" / "All columns" for both identities.
6. Revoke the member share afterwards.

## Out of scope

- A per-view `canWrite` flag so the UI hides Edit for a caller with class-level but not instance write (today that caller can open the editor and gets a 403 on save). It's a UX gap, not an exposure.
- Instance-scoped `field_mapping` statements in RBAC authoring (seen in #678), which would let the smoke hide one specific column from the member. The integration test covers that case with direct grants.
