# bulk_transform multi-column writes — Plan

**TDD-sequenced implementation of the contract in `docs/BULK_TRANSFORM_MULTI_COLUMN_WRITES.spec.md`. Six slices, each behind a green test suite, each landing as one commit. The §4 smoke C integration test stays green across every slice — migrated to a single-write fixture in slice 0 and used as the load-bearing regression net through slice 4.**

Spec: `docs/BULK_TRANSFORM_MULTI_COLUMN_WRITES.spec.md`. Discovery: `docs/BULK_TRANSFORM_MULTI_COLUMN_WRITES.discovery.md`.

Run tests with:

```bash
# core gates
npm run --workspace=packages/core test:unit

# api gates
npm run --workspace=apps/api test:unit
npm run --workspace=apps/api test:integration

# repo gates at slice boundaries
npm run lint
npm run type-check
```

Each slice loop:

1. Write failing tests for the slice's new behavior.
2. Implement the smallest change that makes them pass.
3. Run focused tests; confirm green.
4. **Run the full `bulk-transform.*` test surface** — every existing tool, processor, service, and smoke test must continue to pass. This is the slice's regression gate.
5. Lint + type-check at slice boundary.
6. Commit.

The slices are sequenced so the destructive cut (slice 0: `targetColumn` field removal) lands once, with every consumer mechanically updated to wrap into single-element `writes[]`. The substantive multi-write behavior fleshes out in slices 4–5.

---

## Slice 0 — Core schemas + mechanical consumer migration

**Why first.** The schemas are the contract everyone depends on. Land them once, sweep every consumer to compile against the new shape (each wrapping its existing single target into a one-element `writes[]`), and the rest of the work proceeds without re-touching every file.

**Files**

- Edit: `packages/core/src/models/job.model.ts` — add `BulkTransformWriteSchema` + `ValueFromSchema` discriminated union; reshape `BulkTransformExpressionSchema` (both variants gain `writes[]`, drop `targetColumn`); reshape `BulkTransformMetadataSchema` (drop `targetConnectorEntityId`, add `targetConnectorEntityIds: z.array().min(1)`); reshape `BulkTransformResultSchema` (`partialFailures[]` gains optional `{ targetConnectorEntityId, column }`, replace `droppedKeys` with `droppedByTarget`).
- Edit: `packages/core/src/__tests__/models/job.model.test.ts` — cases 0.1–0.5 below.
- Edit: `apps/api/src/tools/bulk-transform-entity-records.tool.ts` — mechanical translation: read `writes[0]` where `targetColumn` was; populate `writes` + `targetConnectorEntityIds` at enqueue. NO new validation behavior in this slice — pre-flight still only validates a single write.
- Edit: `apps/api/src/queues/processors/bulk-transform.processor.ts` — read `expression.writes[0].column` (and `writes[0].targetConnectorEntityId`) where `expression.targetColumn` was. Single-write path only.
- Edit: `apps/api/src/services/bulk-transform.service.ts` — no behavioral change; type-only updates if any (`upsertSuccesses` already keys per-target).
- Edit: `apps/api/src/services/job-lock.service.ts` — adapt `assertConnectorEntityUnlocked` callsite to extract the first element of `targetConnectorEntityIds` (still single-entity lock here; slice 3 generalizes).
- Edit: `apps/api/src/db/repositories/jobs.repository.ts` — `findRunningByTargetEntityId` queries `metadata->'targetConnectorEntityIds' ?| ARRAY[$1]` to pick up the new field name (still single-entity input).
- Edit: existing tool unit tests (`apps/api/src/__tests__/tools/bulk-transform-entity-records.tool.test.ts`) — fixtures swap `targetColumn` → `writes: [{...}]` mechanically.
- Edit: smoke C (`apps/api/src/__tests__/__integration__/queues/bulk-transform-smoke-c.integration.test.ts`) — same single-write fixture migration.

**Steps**

1. **Add new schemas.** `BulkTransformWriteSchema` + `ValueFromSchema`. Wire into `BulkTransformExpressionSchema` + `BulkTransformMetadataSchema`. Reshape `BulkTransformResultSchema`.

2. **Write the schema tests (cases 0.1–0.5).**
   - 0.1 — `BulkTransformWriteSchema` accepts all five `valueFrom` kinds with the right per-kind fields.
   - 0.2 — Rejects a write missing `targetConnectorEntityId` or `column`.
   - 0.3 — `BulkTransformMetadataSchema` requires `targetConnectorEntityIds.min(1)`; old `targetConnectorEntityId` field is unknown.
   - 0.4 — `BulkTransformExpressionSchema` (tool variant) rejects when `writes` is missing or empty.
   - 0.5 — `BulkTransformResultSchema` round-trips `partialFailures[]` with optional `{ targetConnectorEntityId, column }` and `droppedByTarget[]`.

3. **Sweep every consumer mechanically.** The type checker drives the work — `targetColumn` is gone from the type. At each callsite:
   - Where the code read `expression.targetColumn`, now reads `expression.writes[0].column`.
   - Where it read `metadata.targetConnectorEntityId`, now reads `metadata.targetConnectorEntityIds[0]`.
   - Where it constructed metadata at enqueue, wrap into a one-element `writes` array and a one-element `targetConnectorEntityIds` array.

4. **Migrate existing tests.** Every `targetColumn`-shaped fixture becomes:
   ```ts
   writes: [{
     targetConnectorEntityId: TARGET_CE_ID,
     column: PREVIOUS_TARGET_COLUMN,
     valueFrom: { kind: "tool_result" },
   }]
   ```
   No assertion changes — single-write behavior is preserved end-to-end.

5. **Run core unit tests.** Cases 0.1–0.5 green.

6. **Run the full `apps/api` unit + integration suite.** Every test passes — including §4 smoke C with the new fixture shape.

7. **Lint + type-check.** Clean.

**Done when:** `grep -rn "targetColumn" packages/core/src apps/api/src` returns zero matches outside docs / changelog; every consumer reads `writes[0]` for the single-write path; the §4 smoke continues to pass.

**Risk:** a callsite gets missed and stays broken. **Mitigation:** the type checker is exhaustive — removing the field from the type makes every read a compile error.

---

## Slice 1 — `shapeWritesForRecord` + `getByPath` util

**Why now.** Pure new code with no production consumers yet. Tested in isolation before the processor slice wires it in.

**Files**

- New: `apps/api/src/queues/processors/bulk-transform-writes.util.ts` — exports `shapeWritesForRecord(writes, toolResult, sourceRow, sqlAliasValues): Map<string, Record<string, unknown>>` and `getByPath(value, path): unknown`.
- New: `apps/api/src/__tests__/queues/processors/bulk-transform-writes.util.test.ts` — cases 1.1–1.10 below.

**Steps**

1. **Implement `getByPath` (~20 LOC).** Tokenize the path on `.` and `[N]`:
   - Empty path → return value as-is.
   - For each segment: walk `obj[key]` for dot-segments, `arr[index]` for bracket-segments.
   - Return `undefined` at any missing key.

2. **Implement `shapeWritesForRecord`.** Build `Map<targetConnectorEntityId, Record<column, value>>`:
   - For each write: resolve `valueFrom`:
     - `tool_result` — `toolResult` verbatim (throw `Error` if `toolResult` is `null` and the kind is `tool_result`).
     - `tool_path` — `getByPath(toolResult, valueFrom.path)`.
     - `sql_alias` — `sqlAliasValues?.[valueFrom.alias]` (throw if `sqlAliasValues` is `null`).
     - `source_column` — `sourceRow[valueFrom.column]`.
     - `constant` — `valueFrom.value` verbatim.
   - Append to the per-target record.

3. **Write the util tests (cases 1.1–1.10).**
   - 1.1 — `getByPath` empty path → returns the whole value.
   - 1.2 — `getByPath` dot-path through nested objects.
   - 1.3 — `getByPath` bracket-path through arrays (`a[0]`, `[0]`).
   - 1.4 — `getByPath` mixed (`a.b[0].c`).
   - 1.5 — `getByPath` missing key → `undefined`.
   - 1.6 — `shapeWritesForRecord` single write, `tool_result` kind.
   - 1.7 — `shapeWritesForRecord` two writes to the same target → one map entry with two columns.
   - 1.8 — `shapeWritesForRecord` two writes to different targets → two map entries.
   - 1.9 — `shapeWritesForRecord` mixes all five `valueFrom` kinds; each resolves to the expected value.
   - 1.10 — `shapeWritesForRecord` with `tool_result` kind and `toolResult === null` throws (defensive guard).

4. **Run cases 1.1–1.10.** Green.

5. **Lint + type-check.** Clean.

**Done when:** the util is fully unit-tested with all five `valueFrom` kinds covered; no production caller yet.

**Risk:** `getByPath`'s tokenizer has an edge case. **Mitigation:** the test matrix covers the four supported shapes (object, array, mixed, missing) + empty path. If a real case surfaces, extend.

---

## Slice 2 — Tool pre-flight rewrite

**Why now.** Slice 0 made the schemas accept multi-write input; slice 1 made the value-shaping testable. This slice rewrites the pre-flight to validate every entry in `writes[]` against the union of target wide-columns.

**Files**

- Edit: `apps/api/src/tools/bulk-transform-entity-records.tool.ts` — replace the existing Step 3a (single `targetColumn`) with a per-target column-map loader + per-write validator. Replace the existing Step 2b (SQL alias-vs-target column check) with the new `sql_alias` reference + unreferenced-alias rejection.
- Edit: `apps/api/src/__tests__/tools/bulk-transform-entity-records.tool.test.ts` — cases 2.1–2.7 below.

**Steps**

1. **Implement the column-map loader.** At pre-flight entry:
   ```ts
   const uniqueTargetIds = Array.from(new Set(writes.map((w) => w.targetConnectorEntityId)));
   const columnMaps = new Map<string, Set<string>>();
   for (const id of uniqueTargetIds) {
     const stmt = await wideTableStatementCache.get(id);
     columnMaps.set(id, new Set(stmt.columns.map((c) => c.columnName)));
   }
   ```

2. **Per-write validation loop.** For each `write`:
   - **Column exists** — `columnMaps.get(write.targetConnectorEntityId)?.has(write.column)`. Reject with `BULK_JOB_EXPRESSION_INVALID` naming the bad `{ targetConnectorEntityId, column }`.
   - **`sql_alias`** — parse `expression.value` (SQL branch only); the named alias must be in the projection's `AS alias` list.
   - **`source_column`** — wide-column name exists on the source's wide table.
   - **`constant`** — PG cast check: `SELECT $value::<pgType>` returns successfully. Use the target column's `pgType` from the cache.

3. **Unreferenced-alias rejection.** After validating every `sql_alias` write, compute the set of declared aliases in `expression.value` minus the set referenced by `writes[]`. If non-empty, reject with `BULK_JOB_EXPRESSION_INVALID` naming the unreferenced aliases (open question 1's lean).

4. **Write the pre-flight tests (cases 2.1–2.7).**
   - 2.1 — Valid single-write tool input → succeeds (regression net for existing happy path).
   - 2.2 — Valid multi-write across two targets, both columns valid → succeeds; `targetConnectorEntityIds` denormalizes to a sorted unique array of two.
   - 2.3 — Unknown column on target B → 400 `BULK_JOB_EXPRESSION_INVALID` naming target B + the bad column.
   - 2.4 — `sql_alias` references an alias not declared in `expression.value` → 400 naming the alias.
   - 2.5 — Declared SQL alias not referenced by any `writes[]` → 400 naming the unreferenced alias.
   - 2.6 — `constant` with `value: "hello"` against a `bigint` column → 400 (PG cast fails).
   - 2.7 — `source_column` references a non-existent column on the source wide table → 400.

5. **Run cases 2.1–2.7.** Green.

6. **Run the full `apps/api` unit suite.** Existing tool tests adapt (slice 0 already migrated the single-write happy path; slice 2 keeps it passing and adds the rejection matrix).

7. **Run `apps/api` integration suite** — §4 smoke C still passes (single-write fixture, no rejection path exercised).

8. **Lint + type-check.** Clean.

**Done when:** the pre-flight rejects every shape called out in the spec's "In scope #4"; the happy paths still succeed.

**Risk:** the PG cast check (2.6) needs to round-trip an actual `SELECT` to the DB or use a local type-coercion library. **Mitigation:** use `postgres.js` parameterized `SELECT $1::<pgType>` against the existing connection — cheap (no rows fetched, no plan needed). If a real implementation is fiddly, defer to slice 2.5 as a follow-up commit.

---

## Slice 3 — Lock query generalization

**Why now.** The new `targetConnectorEntityIds[]` field is in the metadata schema after slice 0, but the lock query still treats it as single-entity. This slice flips the query to a JSONB array-overlap and updates the public surface to take arrays.

**Files**

- Edit: `apps/api/src/db/repositories/jobs.repository.ts` — `findRunningByTargetEntityId(orgId, id)` → `findRunningByTargetEntityIds(orgId, ids: string[])`; SQL uses `metadata->'targetConnectorEntityIds' ?| $::text[]`.
- Edit: `apps/api/src/services/job-lock.service.ts` — `assertConnectorEntityUnlocked(entityIds: string[], orgId)`; the `BULK_JOB_TARGET_LOCKED` response details enumerate every locked entity in the set.
- Edit: `apps/api/src/tools/bulk-transform-entity-records.tool.ts` — pass the union `targetConnectorEntityIds` into the lock assertion.
- Edit: `apps/api/src/__tests__/services/job-lock.service.test.ts` — cases 3.1–3.3 below.
- Edit: `apps/api/src/__tests__/__integration__/db/repositories/jobs.repository.integration.test.ts` (or new test file if no integration coverage today) — case 3.4 below.

**Steps**

1. **Generalize `findRunningByTargetEntityIds`.** SQL switches to:
   ```sql
   ... AND metadata->'targetConnectorEntityIds' ?| $3::text[]
   ```
   The repo method takes `entityIds: string[]` and binds via the postgres.js array parameter.

2. **Generalize `assertConnectorEntityUnlocked`.** Takes `entityIds: string[]`. The returned `BULK_JOB_TARGET_LOCKED` error's `details.lockingJobs` enumerates every locking job and includes the specific blocked entity ids that overlap.

3. **Update the single existing caller** (the bulk_transform tool's pre-flight) to pass the full union.

4. **Write the unit tests (cases 3.1–3.3).**
   - 3.1 — `assertConnectorEntityUnlocked(["a", "b"], org)` succeeds when neither is locked.
   - 3.2 — `assertConnectorEntityUnlocked(["a", "b"], org)` rejects when `b` is locked by a running job; details name `b` (and the locking job).
   - 3.3 — `assertConnectorEntityUnlocked(["a", "b"], org)` rejects when BOTH are locked by different running jobs; details enumerate both blocked entities + both locking jobs.

5. **Write the integration test (case 3.4).** Seed a running `bulk_transform` job with `metadata.targetConnectorEntityIds: ["a", "b"]`. Query `findRunningByTargetEntityIds(org, ["b", "c"])`. Assert: returns the seeded job (overlap match on `b`). Query `findRunningByTargetEntityIds(org, ["c", "d"])`. Assert: empty (no overlap).

6. **Run cases 3.1–3.4.** Green.

7. **Run the full `apps/api` unit + integration suite.** §4 smoke C still passes — its single-entity job still gets locked correctly via the array path.

8. **Lint + type-check.** Clean.

**Done when:** the lock query uses the JSONB array-overlap predicate; `grep -rn "metadata->>'targetConnectorEntityId'" apps/api/src` returns zero matches.

**Risk:** the `?|` operator's index behavior is different from the old `->>` equality. **Mitigation:** the volume per-org of running bulk_transform jobs is small (single-digit at peak); even without an index the scan is cheap. A follow-up GIN index on `(metadata->'targetConnectorEntityIds')` is cited in spec Risks.

---

## Slice 4 — Processor fan-out (multi-target UPSERTs in a batch transaction)

**Why now.** Schemas, util, pre-flight, and locking are in place. This slice flips the actual write behavior to honor multiple targets per record.

**Files**

- Edit: `apps/api/src/queues/processors/bulk-transform.processor.ts` — `runToolDispatchLoop` uses `shapeWritesForRecord` per record, groups by `targetConnectorEntityId`, fans out to per-target `upsertSuccesses` inside one transaction per batch. SQL-branch main loop does the same after `runBatch` returns rows.
- Edit: `apps/api/src/services/bulk-transform.service.ts` — `runBatch` returns the SQL-projected rows (no inline wide-table write). The wide-table UPSERT moves to the processor's fan-out. `upsertSuccesses` signature unchanged.
- Edit: `apps/api/src/__tests__/queues/processors/bulk-transform.processor.test.ts` — case 4.1 + 4.2 below.

**Steps**

1. **Add a batch-transaction wrapper.** A helper `runBatchTransaction(client, fn)` opens a transaction, executes `fn` with the txn-scoped client, commits on success, rolls back on throw. The processor wraps the per-target UPSERT calls in this.

2. **Tool branch — group + fan-out:**
   ```ts
   const grouped = new Map<string, Array<{ sourceKey, value }>>();
   for (const success of dispatched.successes) {
     const sourceRow = sourceRowsByKey.get(success.sourceKey)!;
     const shaped = shapeWritesForRecord(opts.writes, success.value, sourceRow, null);
     for (const [targetId, colValues] of shaped) {
       const arr = grouped.get(targetId) ?? [];
       arr.push({ sourceKey: success.sourceKey, value: colValues });
       grouped.set(targetId, arr);
     }
   }
   await runBatchTransaction(db, async (tx) => {
     for (const [targetId, successes] of grouped) {
       const result = await BulkTransformService.upsertSuccesses({
         targetConnectorEntityId: targetId,
         organizationId: opts.organizationId,
         jobId: opts.jobId,
         successes,
         userId,
       }, tx);
       // accumulate per-target failures / dropped columns
     }
   });
   ```

3. **SQL branch.** `runBatch` returns `{ rows: Array<{ sourceKey, aliasValues }>, rowsCommitted }` instead of writing inline. The processor's main loop does the same `shapeWritesForRecord` + group + fan-out, passing `sqlAliasValues` into the shaper.

4. **Per-target failure isolation.** If `upsertSuccesses` for target B fails for a record, the processor catches the per-row error and accumulates a `partialFailures` entry with `targetConnectorEntityId` + `column`. Successful targets in the same batch are unaffected (separate UPSERT statements; the per-statement failure rolls back only that statement). Cross-target atomicity within one record is NOT a goal; the spec calls per-record-per-target atomicity, which is what the per-statement UPSERT already provides.

5. **Write the processor tests (cases 4.1–4.2).**
   - 4.1 — Tool branch: two writes against the same target, one tool call returns `{ km: 5, miles: 3 }` per record. Both columns populate via two `tool_path` writes. `upsertSuccesses` called once with the shaped batch containing both columns.
   - 4.2 — Tool branch: two writes against two different targets. Single `upsertSuccesses` mock is called twice (once per target) with the right per-target subset of columns; both calls happen inside one batch's transaction.
   - 4.3 — Tool branch: target B's `upsertSuccesses` rejects for one record; target A's call still succeeds; `partialFailures` entry includes `{ targetConnectorEntityId: "B", column: "..." }` for that record.

6. **Run cases 4.1–4.3.** Green.

7. **Run §4 smoke C** (single-write integration) — still green. The fan-out collapses to a single target / single write; the new code path covers the trivial case.

8. **Run the full `apps/api` unit + integration suite.** Green.

9. **Lint + type-check.** Clean.

**Done when:** per-record per-target writes happen via the new fan-out; per-target failure isolation works; existing smoke C continues to pass.

**Risk:** moving `runBatch`'s write responsibility out is the slice's biggest refactor. **Mitigation:** the SQL-branch tests in `bulk-transform.service.test.ts` continue to exercise the (now smaller) `runBatch` against its new contract (returns rows, doesn't write). The new write path is covered by the processor tests.

---

## Slice 5 — Multi-write integration smoke + acceptance criteria

**Why now.** All the pieces are in place; this slice walks an end-to-end multi-write through the worker against a real PG.

**Files**

- New: `apps/api/src/__tests__/__integration__/queues/bulk-transform-multi-write.integration.test.ts` — cases 5.1–5.3 below.
- Maybe-edit: `apps/api/src/__tests__/__integration__/queues/bulk-transform-smoke-c.integration.test.ts` — keep as the single-write regression net.

**Steps**

1. **Write the multi-write integration test (cases 5.1–5.3).**
   - 5.1 — 10 source records, one tool that returns `{ km: number, miles: number }` per record, two `tool_path` writes against the same target (`c_distance_km`, `c_distance_miles`). Assert both columns populate on each upserted row; `recordsProcessed === 10`, `partialFailures` absent.
   - 5.2 — Same fixture, but a third write targets a side entity (`{ targetConnectorEntityId: SIDE_CE_ID, column: "c_distance_avg", valueFrom: { kind: "tool_path", path: "km" } }`). Assert: both wide tables receive rows; `metadata.targetConnectorEntityIds` is sorted union of two ids; the lock query during the run sees both as locked (assert via a concurrent `findRunningByTargetEntityIds([SIDE_CE_ID])` call mid-job — gated by an injected delay in the dispatcher's executor).
   - 5.3 — Inject a per-target UPSERT failure for one record on target B (e.g., a constraint violation via a fixture row). Assert: target A's writes commit for that record; target B's failure appears in `partialFailures` with `{ targetConnectorEntityId, column }`; the other 9 records succeed against both targets.

2. **Run cases 5.1–5.3.** Green.

3. **Verify every acceptance criterion** from `docs/BULK_TRANSFORM_MULTI_COLUMN_WRITES.spec.md#acceptance-criteria`. Each must be satisfied at this point:
   - All existing tests still pass — including §4 smoke C against the single-write fixture.
   - Five new test buckets pass.
   - `npm run type-check` clean across the repo.
   - `grep -rn "targetColumn" packages/core/src apps/api/src` returns zero matches outside docs / changelog.
   - `grep -rn "metadata->>'targetConnectorEntityId'" apps/api/src` returns zero matches.

4. **Manual smoke run-book.**
   - `npm run dev` in `apps/api` + `apps/web`.
   - Open a portal session against a station with the NASA NEO connector attached and a tool that returns a `{ km, miles }` object per record.
   - Ask the agent: "for every NEO, compute diameter midpoint in km and miles and write them to `c_diameter_km` and `c_diameter_miles`."
   - Watch the bulk-job progress widget: one job runs (not three), both columns populate, the connector-instance view shows the NEO entity locked once during the run.
   - Cross-target variant: ask the agent to also stamp a "computed_via: bulk_transform" constant into `c_provenance` on a side entity. Confirm both targets show locked during the run, both populate after.

5. **Lint + type-check.** Clean.

6. **Commit.**

**Done when:** every acceptance-criteria checkbox is satisfied; multi-write smoke is green; the manual NEO walk works end-to-end.

**Risk:** test 5.2's "lock visible mid-job" assertion is timing-sensitive. **Mitigation:** inject a 200 ms delay in the dispatcher's executor (per the existing test pattern in smoke C) so the lock query fires while the job is still active. If the timing is flaky, gate behind `RUN_SLOW_TESTS=1`.

---

## Cross-slice gates

After every slice:

1. `npm run --workspace=packages/core test:unit` is green.
2. `npm run --workspace=apps/api test:unit` is green.
3. `npm run --workspace=apps/api test:integration` is green. **§4 smoke C is the load-bearing regression net through slices 0–4** — every commit must keep it green.
4. `npm run type-check` from repo root is clean.
5. `git diff --stat` matches the slice's "Files" list.

After slice 0:

- `grep -rn "targetColumn" packages/core/src apps/api/src` returns zero matches outside docs / changelog. (The contract cut landed cleanly.)

After slice 3:

- `grep -rn "metadata->>'targetConnectorEntityId'" apps/api/src` returns zero matches. (The lock query migrated.)

After slice 5 (feature end):

- All cases 0.1–0.5, 1.1–1.10, 2.1–2.7, 3.1–3.4, 4.1–4.3, 5.1–5.3 pass.
- Every acceptance-criteria checkbox in the spec is satisfied.
- Manual NEO multi-write smoke reproduces.

---

## What this plan does *not* attempt

- **The other four primitives** (`bulk_query`, `bulk_aggregate`, `bulk_delete`, `bulk_apply`). Each has its own ticket (#100–#102). This work is `bulk_transform` only.
- **Backfill or migration of existing `targetColumn`-shaped jobs.** Per `project_no_production_data_yet`: clean cut, no shim.
- **`tool_path` array operations** (e.g., `_.sumBy`, JSONPath filters). `getByPath` is single-value semantics only.
- **GIN index on `metadata->'targetConnectorEntityIds'`.** Follow-up if profiling shows lock-query latency.
- **Re-running failed records.** "Retry failed only" still requires the agent to enqueue a new job.
- **Cross-batch atomicity.** Each batch is one transaction; a failed batch leaves successful prior batches committed (current behavior).
