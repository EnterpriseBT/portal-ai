# Batch revalidation's entity_records writes — Condensed design (#764)

**Issue:** [EnterpriseBT/portal-ai#764](https://github.com/EnterpriseBT/portal-ai/issues/764) · Task · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** #761 batched revalidation's wide-table writes. The other half of each batch is still one `UPDATE … RETURNING *` per record, through `Promise.all` on a single transaction connection, so the 100 statements run one after another. At 397,960 records, revalidation took 211.9 s after #761, and most of that is this loop. CLAUDE.md's #440 rule: a per-record statement in a hot loop goes through a chunked batch primitive. API only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Per-record write | `revalidation.processor.ts:97` | `entityRecords.update(id, { normalizedData, validationErrors, isValid } as never, tx)` per record |
| `Repository.update` | `base.repository.ts:277` | `UPDATE … WHERE id = $1 AND deleted IS NULL RETURNING *`: every call returns the whole row, `data` included, and the result is discarded |
| `normalizedData` in that patch | — | **no such column**: `entity_records.normalized_data` was dropped (`entity-records.table.ts:40`); the `as never` hid it, and Drizzle ignores the key. Only `validation_errors` and `is_valid` are written |
| Batch precedents | `entity-records.repository.ts:171`, `:218` | `upsertManyBySourceId`, `bulkUpdateSyncedAt`: chunked at `BULK_CHUNK_SIZE` (1000) |

## Measured (local devcontainer DB, 397,960 records, 3 mapped columns incl. a point geometry)

| | revalidation | per record |
|---|---|---|
| before #761 | 336.8 s | 0.846 ms |
| after #761 (= before #764), re-measured on main | 207.4 s | 0.521 ms |
| after #764 | 55.4 s (−73%) | 0.139 ms |

Same valid/invalid counts in every run (358,164 / 39,796). From before #761, revalidation is 6× faster (336.8 s → 55.4 s).

## Decision — `bulkUpdateValidity`, one statement per batch

**`EntityRecordsRepository.bulkUpdateValidity(rows, client)`**, where each row is `{ id, validationErrors, isValid }`. It returns the number of rows updated. Chunked at `BULK_CHUNK_SIZE`, one statement per chunk:

`UPDATE entity_records AS r SET validation_errors = v.ve, is_valid = v.iv FROM (VALUES ($id, CAST($ve AS jsonb), CAST($iv AS boolean)), …) AS v(id, ve, iv) WHERE r.id = v.id AND r.deleted IS NULL`

- `validationErrors` binds as JSON text cast to `jsonb`, and null writes SQL NULL, as the column holds today.
- It returns no rows; the processor never read them.
- `deleted IS NULL` keeps `update`'s soft-delete guard: a record deleted mid-run isn't touched.

**Revalidation** makes one `bulkUpdateValidity` call per batch, inside the same transaction as the wide-table `updateMany`, so the two stores stay consistent per batch. The dead `normalizedData` key goes away.

## Plan — 1 slice

**Files**
- Edit: `apps/api/src/db/repositories/entity-records.repository.ts`: `bulkUpdateValidity`.
- Edit: `apps/api/src/queues/processors/revalidation.processor.ts`: use it per batch.

**Tests** (`npm run test:unit` / `npm run test:integration` from `apps/api`, filtered to the files)
- `src/__tests__/__integration__/db/repositories/entity-records.repository.integration.test.ts` (or the nearest existing suite for it): `bulkUpdateValidity` writes each row's own errors and flag; null errors write NULL; a soft-deleted record is left alone and isn't counted; more than one chunk (over 1000 rows); an empty call is a no-op.
- `src/__tests__/queues/processors/revalidation.processor.test.ts`: one `bulkUpdateValidity` per batch of 100 (250 records → 3 calls), with each record's errors and flag; no per-record `update`.
- `revalidation.integration.test.ts` and the entity-record router's #760/#761 revalidation tests stay green (they run the real processor).

## Smoke (manual, against your dev stack)

1. Take an entity with a required field, with some records blank in it. Run **Re-validate All**. The job completes, the Valid column and `?isValid=false` show the blank ones, and each one's detail shows the "Required field is missing" error.
2. Fill in one blank record's field in the app, then run **Re-validate All** again. That record is valid, and the rest are unchanged.
3. Rerun the throwaway 397,960-record benchmark on this branch, and record the "after" row above.

## Out of scope

- Revalidation loading every record into memory at once (`findByConnectorEntityId`): a separate concern.
- Other callers of the per-record `update`: one record per request, so there is no loop to batch.
