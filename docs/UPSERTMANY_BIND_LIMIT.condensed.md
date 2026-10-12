# upsertMany bind-parameter limit — Condensed design (#766)

**Issue:** [EnterpriseBT/portal-ai#766](https://github.com/EnterpriseBT/portal-ai/issues/766) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `WideTableRepository.upsertMany` writes 500 rows per `INSERT`, and each element of a `text[]` (reference-array) cell binds as its own parameter. A chunk of rows with long reference arrays passes Postgres's 65,534-parameter limit, postgres-js throws `MAX_PARAMETERS_EXCEEDED`, and the sync, import or create that called it fails. Reproduced: 500 rows × 150 references fails with `Max number of parameters (65534) exceeded`. #761 gave `updateMany` a parameter budget; this gives `upsertMany` the same one. API only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| `upsertMany` chunk loop | `wide-table.repository.ts:444` | slices at `WIDE_TABLE_CHUNK_SIZE` rows, one `INSERT … ON CONFLICT` per slice |
| `WIDE_TABLE_CHUNK_SIZE` | `wide-table.repository.ts:205` | its comment assumes "500 rows × ~50 columns = 25k params worst-case", which ignores arrays |
| `bindCost` / `WIDE_TABLE_MAX_BIND_PARAMS` | `wide-table.repository.ts:184-187` | #761's per-cell upper bound and 30,000 budget |
| `updateMany`'s split | `wide-table.repository.ts:781` | flushes a statement before the next row would pass the budget |

## Decision — the same budget, inside the row chunk

`upsertMany` keeps its 500-row chunks (they bound the AST depth, #436, and the geometry audit). Inside a chunk it adds up each row's `bindCost` over the inserted columns, and flushes the `INSERT` before the next row would pass `WIDE_TABLE_MAX_BIND_PARAMS`. A row's cost is its cells plus the 5 metadata columns.

The flush loop moves to a shared helper that both write paths call, so the two can't drift: `budgetedStatements(rows, costOf, build)` yields one statement per run of rows that fits the budget. One budget sits under both paths. A single row over the budget on its own (about 30,000 references) still goes out alone, and Postgres refuses it as before. That row is pathological, and splitting it isn't possible.

The `WIDE_TABLE_CHUNK_SIZE` comment is corrected: rows per statement bounds the AST, and the bind budget bounds parameters.

## Plan — 1 slice

**Files**
- Edit: `apps/api/src/db/repositories/wide-table.repository.ts`: the shared budgeted-flush helper; `upsertMany` and `updateMany` use it; the comment fixed.

**Tests** (`npm run test:integration` from `apps/api`, filtered to the file)
- `src/__tests__/__integration__/db/repositories/wide-table.repository.integration.test.ts`:
  - **new:** `upsertMany` with 500 rows × 150 references writes every row (it fails today with `MAX_PARAMETERS_EXCEEDED`);
  - **existing:** the `updateMany` bind-limit test, the 1,200-row chunking test, and the jsonb/typed round-trips must stay green.
- `wide-table-geometry.integration.test.ts`: the `upsertMany` audit cases stay green.

## Smoke (manual, against your dev stack)

1. Create an entity with a `reference-array` mapping. Import (or `curl` `POST …/records/import`) 500 records whose reference array holds 150 ids each. Every record is written, and the list shows 500 records, each with 150 references.
2. Re-validate All on that entity. It completes (this goes through #761's `updateMany`, which already has the budget).

## Out of scope

- A single row with more than ~30,000 array elements: it can't be split, and Postgres refuses it as before.
- Other repositories' batch writes: only the wide table binds arrays element by element.
