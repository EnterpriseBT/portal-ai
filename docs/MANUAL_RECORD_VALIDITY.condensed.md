# Manual record validity — Condensed design (#760)

**Issue:** [EnterpriseBT/portal-ai#760](https://github.com/EnterpriseBT/portal-ai/issues/760) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** The REST record routes never run the normalizer. Create and import store `isValid: true, validationErrors: null` for every record, and PATCH never recomputes validity. So a record with a blank required field counts as valid until someone runs Re-validate All. Worse, PATCH writes the wide table but leaves the record's raw `data` as it was, and revalidation rebuilds records from `data`, so **Re-validate All undoes every in-app edit**. Both were confirmed live (see the issue). This change is API only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Create | `entity-record.router.ts:822` | hardcodes `validationErrors: null, isValid: true`; `data` = `normalizedData` |
| Import | `entity-record.router.ts:1036` | same hardcode per row; the wide row takes `isValid` from the model (`:1056`). No in-repo caller |
| PATCH | `entity-record.router.ts:1347` | updates `data` only when the body has `data`. The web edit dialog sends only `normalizedData`, so `data` goes stale |
| Revalidation | `revalidation.processor.ts:64` | re-normalizes from `record.data` and writes the result to the wide table, so a stale `data` overwrites the edit |
| Agent tools | `entity-record-update.tool.ts:126` | merge the patch over the existing `data`, run `normalizeMany`, and store `data`, `isValid` and `validationErrors`. This is the behaviour to match |
| Normalizer | `normalization.service.ts:72` | per field: required → coerce → enum/pattern. A failing field becomes `null` with an error; geometry goes through `coerceJson` |

## Decision — validate only, or store the normalizer's output

- **Store the normalizer's output** (the tools' behaviour). Values are coerced and canonicalized, and a failing field is stored as `null`. But a geometry that isn't JSON (`"nope"`) would become a NULL geometry on an invalid record instead of #757's 400, which would quietly undo that fix on the REST routes.
- **Validate only.** Run the normalizer to get `isValid` and `validationErrors`, and store exactly the values the routes store today.

**Decision: validate only.** It fixes the reported bug without changing a single stored value, and it keeps #757's 400 for a geometry that can't be stored. Values may still drift between the routes and revalidation (revalidation coerces), but that predates this bug, and closing it means changing what create stores. That's out of scope.

**Normalizer input.** Each route validates the same values it writes:
- **create:** the body's `normalizedData`, which is also its `data`;
- **import:** each changed row's `normalizedData`, run through one `normalizeMany` so the mappings load once;
- **PATCH:** the merged record (below).

**PATCH keeps `data` in step.** `merged = { ...existing.data, ...body.data, ...body.normalizedData }`, then `merged` is stored as `data`, with its validity on `entity_records` and `is_valid` on the wide row. The normalizer reads `normalizedKey` before `sourceField`, so for a synced record the edited key wins on every later revalidation. That holds until the next sync replaces `data`, the same as edits made through `entity_record_update`. A PATCH carrying only `data` still writes the wide row's `is_valid`. The wide-table write stays partial: only the keys the patch sent.

## Plan — 1 slice

**Files**
- Edit `apps/api/src/routes/entity-record.router.ts` to change the create, import and PATCH handlers as above, plus the OpenAPI descriptions of `isValid`/`validationErrors` on those three routes.

**Tests** (`npm run test:integration` from `apps/api`, filtered to the files; `AUTH_API_RATE_LIMIT_PER_MIN=1000000`)
- `src/__tests__/__integration__/routes/entity-record.router.integration.test.ts`:
  - **Create:** a required field left blank → `isValid: false` with `validationErrors` naming it, and the wide row's `is_valid` is false. A valid record → true.
  - **Import:** a valid row and an invalid row → each stored with its own validity.
  - **PATCH:** blank a required field → false; fill it in → true. A `normalizedData`-only patch → the stored `data` carries the new value.
  - **#757 unchanged:** a PATCH with geometry `"nope"` still answers 400.
- `src/__tests__/__integration__/routes/revalidation.integration.test.ts`: PATCH a value, run revalidation, and the record keeps the edited value. This is the revert regression.

## Smoke (manual, against your dev stack)

1. On an entity with a required `name` mapping, use **Create** with Name blank. The record shows as invalid in the list's **Valid** column, and the invalid filter finds it.
2. Edit it and fill in Name. It becomes valid without a re-validate.
3. Edit a valid record's Name from "Before" to "After", then run **Re-validate All** and wait for it to finish. The record still reads "After".
4. `curl` import of two rows, one with `name` blank. Both are written (201/200), and only the blank one has `isValid: false` with `validationErrors` naming `name`.
5. `curl` PATCH with `"location":"nope"` on an entity that has a geometry mapping. It still returns 400 `GEOMETRY_INVALID_ON_IMPORT` (#757).

## Out of scope

- Storing the normalizer's coerced values on the REST routes (the drift between route-written and revalidated values): it changes stored data and would undo #757's refusal; it needs a decision of its own.
- Import's `data` and `normalizedData` disagreeing: the client sends both, and revalidation trusts `data`. This predates the bug, and import has no in-repo caller.
- Batching revalidation's wide-table writes: #761.
