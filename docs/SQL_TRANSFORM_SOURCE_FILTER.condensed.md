# SQL-kind transform honours sourceFilter — Condensed design (#671)

**Issue:** [EnterpriseBT/portal-ai#671](https://github.com/EnterpriseBT/portal-ai/issues/671) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `transform_entity_records` accepts `sourceFilter.whereSqlFragment` for both expression kinds and validates it in the pre-flight, but only the tool-kind loop uses it. A SQL-kind job counts, reads and writes **every** source row, so a "retry-failed-only" SQL transform silently rewrites the whole entity. The tool's `expectedRecords` (and its `MAX_BULK_RECORDS` guard and ETA) and the tool-kind loop's `totalRecords` are unfiltered too. Package: `apps/api` only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Fragment reaches tool kind only | `queues/processors/bulk-transform.processor.ts:75-91` | `runToolDispatchLoop` gets `whereSqlFragment`; `runSqlBatchLoop` (`:317`) doesn't |
| Unfiltered count | `services/bulk-transform.service.ts:156` (`countSourceRows`) | `WHERE org = …` only; used at processor `:182`, `:333` and tool `:679` |
| SQL-kind batch read | `services/bulk-transform.service.ts:197` (`runBatch`) | `WITH batch AS (SELECT * … WHERE org = … ORDER BY … LIMIT … OFFSET …)`; no filter |
| Filtered read + shape check | `services/bulk-transform.service.ts:247` (`fetchSourceBatch`) | `AND (fenceSql(f))`; `assertTransformSql` + #669 `assertAndOfTwo(…, isColumnEquality("organization_id"))` on the exact SQL |
| Metadata already carries it | `tools/transform-entity-records.tool.ts:727` | `sourceFilter` is in job metadata for both kinds |

## Decision — one filtered source SELECT, shared by every read

- **A. Patch the fragment into `runBatch` and `countSourceRows` separately.** Three hand-built WHEREs, each needing the #669 shape check, and the CTE's WHERE isn't the top-level `whereClause` that `assertAndOfTwo` inspects.
- **B. One builder for the filtered source SELECT, validated standalone, then reused.** It returns `SELECT * FROM <src> WHERE "organization_id" = <org>[ AND (<fenced f>)] ORDER BY "entity_record_id" LIMIT n OFFSET m` after running `assertTransformSql` + (with a fragment) `assertAndOfTwo` on **that exact text**. `fetchSourceBatch` runs it directly. `runBatch` splices the identical, already-validated text into its `batch` CTE: a fragment that could escape the CTE parens would have broken the standalone parse first. `countSourceRows` gets the same WHERE through a sibling builder, with the same two checks.

**Decision: B.** One WHERE, one check site, and the CTE gets the same guarantee as the direct read. `whereSqlFragment` is threaded:
- through `runSqlBatchLoop` (→ `countSourceRows`, `runBatch`);
- into the tool-kind loop's count (`:182`);
- into the tool's `expectedRecords` (`:679`).

So progress totals, the max-records guard and the "Importing N records" message all count what will actually be processed.

## Plan — 1 slice

**Files**
- Edit `apps/api/src/services/bulk-transform.service.ts`:
  - a private source-select builder (+ count variant) with the checks;
  - `countSourceRows(entityId, orgId, whereSqlFragment?)`;
  - `runBatch` and `fetchSourceBatch` use the builder (`BulkTransformBatchOptions.whereSqlFragment?`).
- Edit `apps/api/src/queues/processors/bulk-transform.processor.ts`: read `sourceFilter` once for both kinds; pass it to `runSqlBatchLoop` and to both counts.
- Edit `apps/api/src/tools/transform-entity-records.tool.ts`: `expectedRecords` counts with the fragment.

**Tests** (failing first)
- `__tests__/__integration__/services/bulk-transform-sql-gate.integration.test.ts`, against a real 4-row wide table (amounts 5, 20, 0, 50):
  - `countSourceRows` with `c_amount > 10 OR c_amount IS NULL` = 2;
  - `runBatch` with it returns exactly O2 and O4;
  - an escaping fragment is refused by both before any query;
  - no fragment still returns all 4.
- `__tests__/queues/processors/bulk-transform.processor.test.ts`: a SQL-kind job passes `whereSqlFragment` to `countSourceRows` and `runBatch`; the tool kind passes it to its count.
- `__tests__/tools/transform-entity-records.tool.test.ts`: `expectedRecords` is counted with the fragment.
- `npm run test:unit` and `npm run test:integration -- --testPathPattern "bulk-transform|transform-entity"`, `type-check`, `lint`.

## Smoke (manual, against your dev stack)

1. As a user with write on the target (owner in `e2e-fixture`), seed a 4-row source (amounts 5, 20, 0, 50), as in the #669 walk. Run an **SQL-kind** transform with `sourceFilter.whereSqlFragment: "c_amount > 10 OR c_amount IS NULL"`. The tool says "Importing **2** records". The job ends `recordsProcessed: 2`, and only O2 and O4 rows are written (`er__<target>` in `db:studio`).
2. The same transform **without** a filter: "Importing 4 records", `recordsProcessed: 4`.
3. A **tool-kind** transform with the same filter: still 2 processed, and its progress total is now 2, not 4.
4. An SQL-kind transform whose fragment closes the parenthesis and opens an `OR` branch. It's rejected before any job (`PORTAL_SQL_FORBIDDEN`, "single condition"), as since #669.

## Out of scope

- Changing what a filter may contain (the #660/#667/#669 gates are unchanged).
- Keyset pagination for the batch loop (`OFFSET` stays, as today).
