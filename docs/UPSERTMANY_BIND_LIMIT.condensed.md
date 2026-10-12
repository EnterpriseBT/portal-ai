# upsertMany bind-parameter limit — Condensed design (#766)

**Issue:** [EnterpriseBT/portal-ai#766](https://github.com/EnterpriseBT/portal-ai/issues/766) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `WideTableRepository.upsertMany` writes 500 rows per `INSERT`, and each element of a `text[]` (reference-array) cell binds as its own parameter. A chunk of rows with long reference arrays passes Postgres's 65,534-parameter limit, postgres-js throws `MAX_PARAMETERS_EXCEEDED`, and the sync, import or create that called it fails. Reproduced: 500 rows × 150 references fails with `Max number of parameters (65534) exceeded`. The fix binds each array as one parameter, at the encoder both write paths share. API only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| `upsertMany` chunk loop | `wide-table.repository.ts:444` | slices at `WIDE_TABLE_CHUNK_SIZE` rows, one `INSERT … ON CONFLICT` per slice |
| `WIDE_TABLE_CHUNK_SIZE` | `wide-table.repository.ts:205` | its comment assumes "500 rows × ~50 columns = 25k params worst-case", which ignores arrays |
| `wideValueExpr`, text[] branch | `wide-table.repository.ts:108` | the encoder `upsertMany` and `updateMany` share; `ARRAY[$1, $2, …]::text[]`, one parameter per element |
| `bindCost` / `budgetedRuns` / `WIDE_TABLE_MAX_BIND_PARAMS` | `wide-table.repository.ts:184-215` | #761's budget on `updateMany`, which this branch first extended to `upsertMany` |

## Decision — one parameter per array

The first cut gave `upsertMany` #761's parameter budget, splitting a chunk into statements of at most 30,000 parameters. Code review (PR #767) pointed at the cause instead: the encoder binds every element on its own. Splitting around that left the following:
- one row with more than 65,534 elements still failed the whole call;
- a chunk became several statements, so a caller with no transaction (the REST adapter's `upsertMany`) could commit part of a chunk;
- every sync paid an extra pass over every cell to cost it;
- every future write path would have had to remember to budget.

**Decision: a text[] cell binds as one parameter**, the elements as a JSON array unpacked in order on the server: `ARRAY(SELECT e FROM jsonb_array_elements_text($1::jsonb) WITH ORDINALITY AS t(e, n) ORDER BY n)`. postgres-js won't bind a JS array as a Postgres array, which is why the JSON form is used. Elements are stringified as before (`String`, a Date as ISO). Null still writes `NULL::text[]`, and an empty or non-array value still writes `ARRAY[]::text[]`.

Every cell now binds at most two parameters (a geometry's GeoJSON and SRID), so the 500-row chunk bounds parameters again. The budget machinery is removed (`bindCost`, `budgetedRuns`, `WIDE_TABLE_MAX_BIND_PARAMS`, and their use in `updateMany`), and `WIDE_TABLE_CHUNK_SIZE`'s comment says why 500 is safe.

## Plan — 1 slice

**Files**
- Edit: `apps/api/src/db/repositories/wide-table.repository.ts`: the text[] encoder; remove the budget; the chunk-size comment.

**Tests** (`npm run test:integration` from `apps/api`, filtered to the files)
- `src/__tests__/__integration__/db/repositories/wide-table.repository.integration.test.ts`:
  - **new:** `upsertMany` with 500 rows × 150 distinct references writes each row's array exactly (it failed with `MAX_PARAMETERS_EXCEEDED`);
  - **new:** awkward elements (quotes, a comma, braces, a backslash, unicode, `""`, `"null"`, spaces) round-trip exactly through both paths;
  - **new:** one row of 70,000 elements is written, past the old limit on its own;
  - **existing:** #761's `updateMany` 500 × 150 test now compares contents, not length.
- The suites that reach `upsertMany` (sync, connectors, revalidation, map, record routes) stay green.

## Smoke (manual, against your dev stack)

1. Create an entity with a `reference-array` mapping. Import (or `curl` `POST …/records/import`) 500 records whose reference array holds 150 ids each. Every record is written, and the list shows 500 records, each with 150 references.
2. Re-validate All on that entity. It completes, and the references are unchanged (this goes through `updateMany`, which uses the same encoder).

## Out of scope

- Reading text[] columns: reads and filters are unchanged.
- Other repositories' batch writes: only the wide table binds arrays.
