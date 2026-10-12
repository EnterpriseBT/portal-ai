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
| Agent tools | `entity-record-update.tool.ts:126` | merged and normalized their own way (read outside the transaction, and keys merged as given), a second copy of the PATCH logic |
| Normalizer | `normalization.service.ts:72` | per field: required → coerce → enum/pattern. A failing field becomes `null` with an error; geometry goes through `coerceJson` |

## Decision — store the normalizer's output, through one write model

The first cut validated only, storing values as sent. Code review (PR #762) showed why that's wrong: the normalizer fills in defaults and converts types *before* it judges a record. So a required `status` with a default of `open`, patched to `""`, came out valid while `""` was stored, and Re-validate All later changed the value anyway.

**Decision: every manual write stores the normalizer's output**, the same values a revalidation would store, through a new `RecordWriteService` (`services/record-write.service.ts`). The REST create, import and PATCH routes and both agent record tools use it, so the UI and the agent can no longer disagree.
- **`normalize(mappings, rows, opts)`.** It runs `normalizeWithMappings` and refuses a geometry the normalizer couldn't parse (`""`, `"nope"`: a value was sent, but the result is `null`) with #757's 400 `GEOMETRY_INVALID_ON_IMPORT`, before anything is written. A parseable value that isn't a geometry is still refused by the wide-table audit. So #757's contract is unchanged.
- **`mergePatch(mappings, data, patch)`.** A `normalizedData` key is written under the key the record already holds. A synced record holds its source field (`"Full Name"`), so a later sync of that field still wins. A raw `data` patch merges as given.
- **`patchRecord(tx, …)`.** In this order:
  1. lock the row (`findByIdForUpdate`, `SELECT … FOR UPDATE`) so a concurrent edit can't be lost;
  2. read the mappings in the same transaction;
  3. merge, normalize, and write `data`, `isValid` and `validationErrors` to `entity_records`;
  4. write every mapped column and `is_valid` to the wide row, which is skipped before the reconciler has run.
- **Import** normalizes only the rows whose checksum changed, with one load of the mappings.

`data` keeps what the caller sent (create: the body; import: each row's `data`; PATCH: the merged record), so revalidation rebuilds the same record.

## Plan — 1 slice (+ review fixes)

**Files**
- New: `apps/api/src/services/record-write.service.ts`.
- Edit:
  - `normalization.service.ts`: `loadMappings(id, client)`, and the mapping type exported;
  - `entity-records.repository.ts`: `findByIdForUpdate`;
  - `entity-record.router.ts`: create, import and PATCH, plus their OpenAPI text;
  - `tools/entity-record-create.tool.ts` and `tools/entity-record-update.tool.ts`.

**Tests** (`npm run test:unit` / `npm run test:integration` from `apps/api`, filtered to the files; `AUTH_API_RATE_LIMIT_PER_MIN=1000000`)
- `src/__tests__/services/record-write.service.test.ts`:
  - defaults applied, and validity taken from the output;
  - a blank required field makes the record invalid, not refused;
  - `""` and `"nope"` geometries are refused with the 400, and a batch refusal names the rows;
  - merge rules: an existing key, a synced source field, and a raw `data` patch.
- `entity-record.router.integration.test.ts` (#760 suite):
  - validity on create, import and PATCH, both ways, computed on the whole record;
  - create stores the normalized values;
  - PATCH keeps `data` in step;
  - **the row lock**: with transaction A holding the lock, B waits, and both edits survive. This test fails without the lock;
  - **the edit survives a real `revalidationProcessor` run**;
  - a refused PATCH leaves `data` and validity unchanged.

  The #757 geometry suite still passes.
- Tool unit tests mock `RecordWriteService`; the merge and normalize behaviour lives in the service tests.

## Smoke (manual, against your dev stack)

1. On an entity with a required `name` mapping, use **Create** with Name blank. The record shows as invalid in the list's **Valid** column, and the invalid filter finds it.
2. On a required field with a default value (set one on the field mapping), create a record with that field blank. It stores the default and is valid.
3. Edit the step-1 record and fill in Name. It becomes valid without a re-validate.
4. Edit a valid record's Name from "Before" to "After", then run **Re-validate All** and wait for it to finish. The record still reads "After".
5. `curl` import of two rows, one with `name` blank. Both are written (201/200), and only the blank one has `isValid: false` with `validationErrors` naming `name`.
6. `curl` PATCH with `"location":"nope"` on an entity that has a geometry mapping. It still returns 400 `GEOMETRY_INVALID_ON_IMPORT` (#757).

## Out of scope

- Records whose `data` already drifted from the wide table before this fix (an in-app edit made before it): the next edit merges onto the old `data`. Any Re-validate All since then already reverted those edits, and there is no production data that needs a backfill.
- Import's `data` and `normalizedData` disagreeing: the client sends both, and revalidation trusts `data`. This predates the bug, and import has no in-repo caller.
- Batching revalidation's wide-table writes: #761.
