# Recommit revalidation — Condensed design (#973)

**Issue:** [EnterpriseBT/portal-ai#973](https://github.com/EnterpriseBT/portal-ai/issues/973) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Since #968 a commit coerces and validates each row it writes, but `writeRecords` skips rows whose checksum didn't change and only bumps their `synced_at`. When a plan edit changes the rules a column is checked against (required, format, enum values, default) and the same file is recommitted, or a Google Sheets / Excel sync runs after the edit, those unchanged rows keep their old `isValid`, `validationErrors` and normalized values, and `recordCounts.invalid` misses them. The fix touches `apps/api` only.

**Correction to the issue's repro.** Rebinding a populated column from a string column to a number column on an existing entity is refused before any record is written (`422 WIDE_TABLE_TYPE_CHANGE_UNSUPPORTED`, from the wide-table reconciler), so that exact repro can't happen. A rebind between two columns of the same type still counts as a rule change. The rules that reach records through a plan edit are required, format, enum values (checked only on `enum`-typed columns) and default.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Per-target commit loop | `services/layout-plan-commit.service.ts:293-381` | one transaction per target: upsert entity → `reconcileFieldMappings` → wide-table reconcile → `writeRecords` |
| Unchanged-row skip | `layout-plan-commit.service.ts:894` | `prev.checksum === record.checksum && prev.deleted === null` → `unchangedIds`, then `bulkUpdateSyncedAt` (`:1058`) |
| Checksum input | `layout-plan-commit.service.ts:836` | computed over the extracted `record.fields`, keyed by source field, so a rule change that keeps the same bound columns leaves it unchanged |
| Mapping reconcile | `services/field-mappings/reconcile.ts:113` | reads `existing` (`:244`), soft-deletes stale keys, upserts each desired mapping (`:265`); returns the upserted rows and reports nothing about what changed |
| Edit-route trigger | `routes/field-mapping.router.ts:838-890` | `REVALIDATION_FIELDS` = format, required, enumValues, defaultValue, normalizedKey → `RevalidationService.enqueueAfterEdit` |
| Commit callers | `layout-plan-draft.service.ts:307,571`; `google-sheets.adapter.ts:137`; `microsoft-excel.adapter.ts:140` | all run inside a `layout_plan_commit` or `connector_sync` job |
| Lock scopes | `packages/core/src/models/job.model.ts:871-874` | commit and sync lock the **instance**; revalidation locks its entity, which resolves into that instance |

## Decision — revalidate inside the commit, only when rules changed

- **A. Queue revalidation after reconcile (the issue's direction).** This can't work. The commit runs inside a job that holds the connector instance, so `enqueueExclusive` refuses the revalidation with `409 ENTITY_LOCKED_BY_JOB`. `enqueueAfterEdit` logs that refusal and moves on, so nothing is ever queued. Queuing it from the job's terminal hook would work, but it adds a second job and a window where the stale flags are visible, and its counts never reach `recordCounts`.
- **B. Re-normalize every row on every commit.** Correct, but it gives up the unchanged-row skip that keeps large re-syncs cheap.
- **C. Turn off the skip for an entity whose rules changed in this commit (chosen).** `reconcileFieldMappings` already loads the existing mappings. It now also reports whether this reconcile changed anything a row's validation depends on: a mapping created, a mapping soft-deleted, or one of `columnDefinitionId`, `required`, `defaultValue`, `format`, `enumValues`, `normalizedKey`, `refEntityKey` or `refNormalizedKey` changed by value (compared with `JSON.stringify`, as the route does). When it reports a change, `writeRecords` sends every row through the normal write path for that entity, so the new rules apply to all of them and their invalid rows count in `recordCounts.invalid`. Rows the run doesn't touch are reaped by the existing watermark, so every surviving row is checked against the new rules. Commits and syncs that change no rules keep the skip.

**Return shape.** `reconcileFieldMappings` returns `{ mappings, rulesChanged }` instead of the bare array. It has one production caller, and the integration test updates with it. No compatibility alias is kept, since this is an internal rename.

**Counting.** A forced rewrite of a row whose checksum matched counts as `updated`, not `unchanged`, because its stored normalized values and validity were rewritten. The commit result's contract doesn't change.

## Plan — 1 slice

**Files**
- Edit: `apps/api/src/services/field-mappings/reconcile.ts`: compute `rulesChanged` from `existing` (live rows only) against `desired`, plus `staleIds.length > 0`, and return `{ mappings, rulesChanged }`. Export the compared field list as `VALIDATION_RULE_FIELDS`.
- Edit: `apps/api/src/services/layout-plan-commit.service.ts`: pass `rulesChanged` into `writeRecords` as `revalidateUnchanged`. When it's true, a matching checksum doesn't skip the row. Add a `commit.rules_changed` log line naming the entity.

**Tests**
- `apps/api/src/__tests__/__integration__/services/field-mappings/reconcile.integration.test.ts`: `rulesChanged` is false on an identical re-reconcile; true when a type, required, format or enumValues value changes, when a mapping is added and when one is dropped. A first reconcile reports true too. That's harmless, because a new entity has no rows to skip.
- `apps/api/src/__tests__/__integration__/routes/layout-plans.router.integration.test.ts` (next to the #968 typed-commit test): commit the 4-row upgrades workbook with `energy_cost` bound to an `enum` column with no values allowed, so all rows are valid. Add `enumValues: ["100", "150"]` to the binding in the stored plan and recommit the same workbook. Expect `updated: 4, unchanged: 0, invalid: 2`, with `Stim Packs` and `Personnel Cloaking` invalid. A third recommit with no plan change reports `unchanged: 4`, and the two rows stay invalid. With the fix disabled the second commit reports `unchanged: 4, invalid: 0`, which is the bug.
- Run `npm run test:unit` and `npm run test:integration` for those paths only, plus `type-check` and `lint` in `apps/api`.

## Smoke (manual, against your dev stack)

1. Create an **enum** column definition (no values) and connect a Google Sheet with a `size` column holding `S`, `M` and `XL`. Bind `size` to the enum column and commit. On the entity's records, all 3 rows are valid.
2. Edit the connector's layout plan, set the `size` binding's allowed values to `S, M`, and save so it recommits the same sheet. When the job finishes, the `XL` record shows as invalid, the other two are valid, and the job result counts 1 invalid.
3. Sync again without changing anything. The job result shows all rows `unchanged`, and the `XL` row is still invalid.
4. Edit the plan to mark another field **required** on a column where one row's cell is blank, then recommit. That row turns invalid without a manual Re-validate All.

## Out of scope

- REST sync: its rules change only through the field-mapping and column-definition routes, which already queue revalidation.
- Changes to a column definition's own `validationPattern` or `canonicalFormat`: these are already covered by `column-definition.router.ts:830`.
- Revalidating entities a commit doesn't target, such as another entity whose reference mapping points at this one.
