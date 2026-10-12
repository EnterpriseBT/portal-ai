# Batch revalidation's wide-table writes — Condensed design (#761)

**Issue:** [EnterpriseBT/portal-ai#761](https://github.com/EnterpriseBT/portal-ai/issues/761) · Task · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Revalidation writes the wide table one record at a time: one `UPDATE` per record and, since #757, one geometry audit per record whose patch carries a geometry. CLAUDE.md's #440 rule says a per-record statement in a hot loop goes through a chunked batch primitive, and `updatePartial` has none. This change is API only: one repository method and the revalidation processor.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Revalidation loop | `revalidation.processor.ts:57` | batches of 100; `entity_records` updates via `Promise.all`, then the wide table per record |
| Per-record wide write | `revalidation.processor.ts:113` | `updatePartial(…, { onRejectedGeometry: "skip" })`, awaited in a `for` loop |
| `updatePartial` | `wide-table.repository.ts:588` | one row: audit its geometry cells (`:621`), then one `UPDATE … WHERE entity_record_id = $1` |
| `auditGeometry` | `wide-table.repository.ts:430` | already batch-shaped: one SRID lookup and one `GeometryAuditService.auditBatch` for any number of rows |
| `upsertMany` | `wide-table.repository.ts:257` | the batch precedent: chunks of `WIDE_TABLE_CHUNK_SIZE` (500), one audit and one statement per chunk, per-type value encoding |
| Other callers | `record-write.service.ts:163`, `bulk-geocode.processor.ts:222` | one row per call |

## Measured (local devcontainer DB, 3 mapped columns: two strings and a point geometry)

| | records | revalidation | per record |
|---|---|---|---|
| before, 20K | 20,000 | 17.1 s | 0.856 ms |
| before, 397,960 (#460's layer size) | 397,960 | 336.8 s | 0.846 ms |
| after | 397,960 | _slice 1_ | |

Bulk geocode, per row: wide-table point write **0.415 ms**; geocode-cache Redis `GET` 0.066 ms; one HTTPS round trip to the Mapbox geocoding endpoint (unauthenticated, so a lower bound) **85–200 ms**.

## Decision — `updateMany`, with `updatePartial` as its one-row case

**`WideTableRepository.updateMany(connectorEntityId, rows, client, opts)`**, where each row is `{ entityRecordId, normalizedData, syncedAt?, isValid? }`, and the same `onRejectedGeometry: "throw" | "skip"` option. It returns the `WideTableRejection[]`. Rows are chunked at `WIDE_TABLE_CHUNK_SIZE`. For each chunk:
1. **One geometry audit** covers every non-null geometry cell in the chunk, through the existing `auditGeometry`. With `"skip"`, a refused row loses its geometry columns from its patch and keeps the rest. With `"throw"`, any refusal throws the 400 (`assertNoRejectedGeometry`, with `batch` when there is more than one row) and nothing in the call is written.
2. **One `UPDATE … FROM (VALUES …)` per distinct column set.** A row writes only the keys it carries (partial semantics are kept). So rows are grouped by their written columns, and each group is one statement: `UPDATE "er__<id>" AS w SET "c" = v."c", … FROM (VALUES (…), …) AS v("entity_record_id", "c", …) WHERE w."entity_record_id" = v."entity_record_id"`. Revalidation's rows all carry every mapped key, so a chunk is one statement, or two when the chunk has a refused geometry.
3. **Values are encoded as `upsertMany` encodes them.** Its per-type builder (text[] → `ARRAY[…]`, jsonb → `JSON.stringify`, Date → ISO, geometry → `geometryWriteExpr`) moves to one shared function used by both. A `VALUES` list has no target column to infer types from, so every value also carries an explicit `::<pgType>` cast taken from the statement cache.

**`updatePartial` delegates to `updateMany` with one row.** There is one write path, and the PATCH and #757 tests keep pinning it unchanged.

**Revalidation** calls `updateMany` once per batch of 100, with `"skip"`, inside the same transaction. A 397,960-record run goes from about 796K wide-table round trips (an `UPDATE` plus an audit per record) to about 8K (one audit and one `UPDATE` per batch).

**Bulk geocode keeps its per-row write.** In the billable (uncached) path each row waits on a provider round trip of at least 85 ms, and the write is under 0.5% of that. Batching would also make one row's DB error fail a whole chunk; today it fails only that row (`GEOCODE_WRITE_FAILED`, #719). A fully cached re-run is the one case where the write is a large share (about 0.4 of ~0.5 ms per row, or ~3 min at 397K). If that becomes a real workload, it is a follow-up.

## Plan — 1 slice

**Files**
- Edit: `apps/api/src/db/repositories/wide-table.repository.ts`: add `updateMany`; `updatePartial` delegates to it; extract the shared value encoder from `upsertMany`.
- Edit: `apps/api/src/queues/processors/revalidation.processor.ts`: one `updateMany` per batch.

**Tests** (`npm run test:unit` / `npm run test:integration` from `apps/api`, filtered to these files)
- `src/__tests__/__integration__/db/wide-table-geometry.integration.test.ts`, new `updateMany` cases:
  - several rows written in one call, each to its own values;
  - `"skip"` with one bad geometry among good ones: the bad row keeps its geometry and gets its `is_valid`, and the others are written in full;
  - `"throw"` with one bad row: a 400, and no row is changed;
  - rows with different key sets in one call: each keeps the columns it didn't send;
  - a chunk over `WIDE_TABLE_CHUNK_SIZE`.

  The existing `updatePartial` cases (#757) must stay green unchanged.
- `src/__tests__/__integration__/db/repositories/wide-table.repository.integration.test.ts`: `updateMany` round-trips a text, number, boolean, date, jsonb and text[] column, matching what `upsertMany` stores.
- `src/__tests__/queues/processors/revalidation.processor.test.ts`: one `updateMany` per batch (250 records → 3 calls), with `"skip"`; the refusal count is still summed and logged.
- `entity-record.router.integration.test.ts`: the #760 "edit survives Re-validate All" test must stay green (it runs the real processor).

## Smoke (manual, against your dev stack)

1. Take an entity with a geometry mapping and a required field, with some records blank in that field. Run **Re-validate All**. The job completes, the Valid column and `?isValid=false` show the same records as before, and the map shows the same features.
2. Edit one record's Name in the app, run **Re-validate All** again, and the edit is still there (#760).
3. Rerun the throwaway benchmark (a temporary integration test that seeds `BENCH_N` records with a point geometry, then times `revalidationProcessor`; not committed) at `BENCH_N=397960` on this branch, and record the "after" row in the table above.

## Out of scope

- Batching revalidation's `entity_records` updates (the `Promise.all` on one transaction): a different repository, and unmeasured.
- Revalidation loading every record into memory at once (`findByConnectorEntityId`): a separate concern.
- Bulk geocode's writes: see the decision above.
- Manual write paths (create, PATCH, agent tools): one record per request, so there is no loop to batch.
