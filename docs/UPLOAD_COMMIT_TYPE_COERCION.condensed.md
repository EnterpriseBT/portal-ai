# File-upload commit type coercion — Condensed design (#968)

**Issue:** [EnterpriseBT/portal-ai#968](https://github.com/EnterpriseBT/portal-ai/issues/968) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** A layout-plan commit writes raw cell text into the typed wide-table columns, so one cell that doesn't parse as its column's type (`Academy` in a `datetime` column) fails the whole job with `22P02`, on every retry. Commit should do what REST sync and revalidation do: coerce each value, store null where coercion fails, and mark the record invalid with a per-field error. Two adjacent defects ride along: `coerceNumber` silently accepts trailing text (`10 HP` → 10), and a failed commit can leave its new connector instance on `pending`. `apps/api` only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Record writer | `layout-plan-commit.service.ts:793` `writeRecords` | builds `normalizedData` from raw `record.fields` (L888–897), keyed by `normalizedKey`; stamps `isValid: true` / `validationErrors: null` on upsert (L949–951) and resurrect (L922–924); `invalid` count is always 0 |
| Per-target transaction | `layout-plan-commit.service.ts:293` | each target reconciles mappings, then calls `writeRecords` in its own transaction; earlier targets stay committed if a later one fails |
| Normalizer | `normalization.service.ts:42` `loadMappings(entityId, client)`, `:84` `normalizeWithMappings` | reads `normalizedKey` first, then `sourceField`; coerce → null + error on failure; used by `rest-api.adapter.ts:983`, `revalidation.processor.ts:72`, `record-import.util.ts:174` |
| Number coercion | `coercion.util.ts` `coerceNumber` | strips currency/commas, then `parseFloat`, which ignores trailing text |
| Final-failure rollback | `layout-plan-draft.service.ts:400` `rollbackFailedDraftCommit`, called from `layout-plan-commit.processor.ts:123` | existing instance → `error`; fresh instance → hard-delete plan, then instance, each `.catch(() => undefined)` |
| FKs onto `connector_instances` | `connector-entities.table.ts:26`, `connector-instance-layout-plans.table.ts:26`, `station-instances.table.ts:20` | an entity committed by an earlier target blocks the instance's hard delete |

**Why the instance stayed `pending`.** In the fresh-create case the rollback hard-deletes the plan, then the instance. If an earlier target committed (the prod upload had two files, so two targets), its `connector_entities` row holds an FK on the instance. The delete fails, the error is swallowed, and nothing flips the status. Slice 2 reproduces this before fixing it.

## Decision — coerce in the writer; rollback that can't delete marks the instance failed

- **Coercion.** `writeRecords` loads the entity's mappings once, in its transaction (`loadMappings(connectorEntityId, tx)`, after reconcile has written them). It runs `normalizeWithMappings` over the `normalizedData` it already builds; that data is keyed by `normalizedKey`, which is what the normalizer reads first. It writes the result's `normalizedData`, `isValid` and `validationErrors` on both the upsert and resurrect branches, and counts invalid records into `recordCounts.invalid`. `entity_records.data` keeps the raw fields. Unchanged rows (same checksum) are still skipped. Same pattern as REST sync, with no new helper.
- **Strict numbers.** After stripping currency, separators and whitespace, the remainder must be a whole numeric literal (`/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i`), else `Expected a number`. `10 HP`, `25 + 1/s` and `10%` become invalid. Existing cases (`$99`, `1,234.56`, EU format, precision, currency) keep passing. This also tightens REST sync and revalidation, which is intended: today they lose data silently.
- **Rollback.** For a fresh instance, delete the plan and the instance **in one transaction**. If that fails (an earlier target committed), keep both rows and flip the instance to `status: "error"` with `lastErrorMessage`, as the existing-instance branch does. The user sees the failed connector and deletes it. A clean single-target failure still leaves no orphan, which keeps #887's dialog behaviour.

## Plan — 2 slices

**Slice 1 — coerce on commit, strict numbers.**
- Edit: `apps/api/src/utils/coercion.util.ts`, `apps/api/src/services/layout-plan-commit.service.ts`.
- Tests:
  - `__tests__/utils/coercion.util.test.ts`: trailing text, an expression, a percent and a unit are invalid; existing cases still pass.
  - `__integration__/routes/layout-plans.router.integration.test.ts`, the issue's three rows with `researched_at` → datetime and `energy_cost` → number:
    - the commit completes;
    - those cells are null in `er__<id>`;
    - the records are `is_valid = false`, with `validationErrors` naming the fields;
    - `recordCounts.invalid` = 3;
    - a re-commit of a resurrected row is covered too.
  - This test fails with 22P02 before the fix.

**Slice 2 — rollback marks a stranded instance failed.**
- Edit: `apps/api/src/services/layout-plan-draft.service.ts`.
- Tests:
  - `__tests__/queues/processors/layout-plan-commit.processor.test.ts`: a fresh instance whose delete throws is flipped to `error` with the reason, and its plan is kept.
  - Integration: a two-target commit whose second target fails leaves the instance `error`, not `pending` (red before the fix). A single-target failure still deletes both rows.
- Run with `npm run test:unit` and `npm run test:integration -- --testPathPattern <file>` in `apps/api`, plus `lint` and `type-check`.

## Smoke (manual, against your dev stack)

1. Upload a CSV with the issue's three rows. In the review step, bind `researched_at` to a datetime column and `energy_cost` to a number column, then commit. Expected: the import completes and the connector is `active`.
2. Open the entity's records. Expected: three records marked invalid. `researched_at` and `energy_cost` are empty, and each carries a validation error naming its field (`Expected a number` on `10 HP` and `25 + 1/s`). `100` in Lockdown's `energy_cost` is stored as 100.
3. Revalidate the entity. Expected: the same three records stay invalid with the same errors.
4. Force a commit failure after a first target has written (`— backend`: two-file upload, with the second target made to fail, e.g. the `apps/api` integration fixture). Expected: the connector shows `error` with the reason, not `pending`, and the user can delete it.
5. A single-file upload that fails at commit (`— backend`). Expected: the dialog shows the job's error with the input intact, and no connector is left behind.

## Out of scope

- Naming the failing column in a database error's message (#540 keeps database errors redacted). After this fix, a coercion failure becomes a field error, not a database error.
- Making the interpreter better at guessing types (`_at` headers → datetime).
- Rolling back targets that committed before a later one failed (a partial commit stays visible as an `error` connector).
