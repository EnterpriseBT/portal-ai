# Edit Field Mapping sends only what changed — Condensed design (#1061)

**Issue:** [EnterpriseBT/portal-ai#1061](https://github.com/EnterpriseBT/portal-ai/issues/1061) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Edit Field Mapping's `buildBody` sends every field the form holds on every save. When two editors have the same mapping open, the second save puts back the first editor's change to a field the second never touched: required, default value, format, enum values, primary key, or the reference keys. The fix is in `apps/web` only: the dialog sends the fields that differ from the mapping it opened on, as Edit Column Definition already does. The contract and API are unchanged.

## Current shape

| Piece | Location | Note |
|---|---|---|
| `buildBody` | `apps/web/src/components/EditFieldMappingDialog.component.tsx:170-195` | Whole form every time; only `normalizedKey` is conditional (#801) |
| `needsRevalidation` | `EditFieldMappingDialog.component.tsx:197-213` | Compares the body with `fm`. Under a partial body an omitted `required` reads as `undefined !== false` (changed) |
| Enum field | `EditFieldMappingDialog.component.tsx:358` | Rendered only for an `enum` column; `buildBody` sends `enumValues: null` for every other type |
| Compare base | `views/ColumnDefinitionDetail.view.tsx:91`, `:392`, `:422-450` | `editingFieldMapping` is set from the row when Edit is clicked and doesn't refetch while open, so `fm` is the mapping as opened |
| Reference pattern | `components/EditColumnDefinitionDialog.component.tsx:164-182` | Starts from `{}` and adds each field whose trimmed value differs from the original |
| Contract | `packages/core/src/contracts/field-mapping.contract.ts:144-157` | `sourceField` and `columnDefinitionId` required; everything else optional |
| Route | `apps/api/src/routes/field-mapping.router.ts:691` (PATCH), `:825` | Writes `...parsed.data`, so only the keys sent |

## Decision: diff against the opened mapping; keep the contract

Options:
- (a) Diff every optional field in the web and keep the contract as it is. `sourceField` and `columnDefinitionId` are still sent, as the values the dialog opened on.
- (b) Also make `sourceField` and `columnDefinitionId` optional, which changes core and the API route (`columnDefinitionId` drives the route's re-point and format checks).

**Chosen: (a).**
- `columnDefinitionId` can't be changed from this dialog, and the value sent is the one the row already had.
- `sourceField` keeps a narrow form of the race: a rename by another editor is put back by a save that didn't touch it. Closing that means a contract change across three packages, which the ticket sized as `full`. It's out of scope here.

`buildBody` therefore:
- starts from `{ sourceField: form.sourceField.trim(), columnDefinitionId: fm.columnDefinitionId }`;
- adds `normalizedKey`, `required`, `defaultValue`, `format`, `isPrimaryKey`, `refNormalizedKey` and `refEntityKey` only when they differ from `fm`, comparing trimmed text and treating empty as `null`, as it does today;
- adds `enumValues` only for an `enum` column whose parsed list differs from `fm.enumValues`. A non-enum mapping no longer sends `enumValues: null`.

`needsRevalidation` becomes "the body carries one of `REVALIDATION_FIELDS`", since the body now holds only changes. That matches Edit Column Definition (`:186-189`).

## Plan: 1 slice

**Files**
- Edit `apps/web/src/components/EditFieldMappingDialog.component.tsx` (`buildBody`, `needsRevalidation`).
- Edit `apps/web/src/__tests__/EditFieldMappingDialog.test.tsx`.

**Tests** (test first; run `npm run test:unit -- --testPathPattern EditFieldMappingDialog` from `apps/web`)
- **Unchanged save:** sends exactly `{ sourceField, columnDefinitionId }` and shows no revalidation prompt.
- **One field changed (format):** sends only `format` plus the two required fields. `required`, `isPrimaryKey`, `defaultValue` and the reference keys are absent.
- **Toggling Required:** sends `required: true` and prompts for revalidation.
- **Trimmed format:** a format changed only by surrounding whitespace counts as unchanged.
- **Enum column:** editing the enum list sends the parsed array. A non-enum mapping never sends `enumValues`.
- **Existing tests:** "should include new fields in submit payload" asserts the old send-everything shape. It changes to the unchanged-save case above. The trim and revalidation cases keep passing.
- **Wiring:** `__tests__/dialog-single-flight.integration.test.tsx` still passes.

## Smoke (manual, against your dev stack)

1. Open a column definition that has a field mapping. Open **Edit** on the mapping in two browser windows (A and B).
2. In B, turn on **Required**, confirm the revalidation, and save.
3. In A, which still shows Required off, change only **Format** and save.
4. Reload the column definition. The mapping is **Required** and has A's format.
5. In the Network tab, the PATCH from A carries only `sourceField`, `columnDefinitionId` and `format`.
6. Open Edit and save without changing anything. Saving still works, the PATCH carries only the two required fields, and no revalidation prompt appears.
7. Put the mapping back as it was.

## Out of scope

- Making `sourceField` / `columnDefinitionId` optional in the contract, which closes the rename race above. This changes core and the API and would be its own ticket.
- Detecting or warning about a concurrent edit (version or ETag checks).
