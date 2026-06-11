# bulk_transform multi-column writes — Spec

**A `bulk_transform` job carries an explicit `writes: Array<{ targetConnectorEntityId, column, valueFrom }>` mapping. `valueFrom` is a discriminated union of `tool_result | tool_path | sql_alias | source_column | constant`. The same shape governs both the tool-kind and SQL-kind branches. The lock set is the union of `writes[].targetConnectorEntityId`. After this work, `expression.tool.targetColumn` is gone, the SQL branch no longer treats `AS alias` as an implicit target-column map, and one job can land per-record values into N columns spanning K wide tables.**

Discovery: `docs/BULK_TRANSFORM_MULTI_COLUMN_WRITES.discovery.md`. The recommendations + open-question leans below are lifted verbatim.

## Scope

### In scope

1. **`BulkTransformWriteSchema` Zod type** added to `packages/core/src/models/job.model.ts`. Discriminated union on `valueFrom.kind`; five variants (`tool_result`, `tool_path`, `sql_alias`, `source_column`, `constant`). Every variant carries `targetConnectorEntityId: string` and `column: string`. `tool_path` carries `path: string`; `sql_alias` carries `alias: string`; `source_column` carries `column: string` (the source column to read); `constant` carries `value: z.unknown()`. `tool_result` carries no extra fields.

2. **`BulkTransformExpressionSchema` reshaping**. Both `kind: "tool"` and `kind: "sql"` variants drop `targetColumn` / implicit alias semantics. Both branches grow `writes: z.array(BulkTransformWriteSchema).min(1)`. The SQL branch's `value: z.string()` (the projection text) stays — its `AS aliases` become reference names that `sql_alias`-kind writes target.

3. **`BulkTransformMetadataSchema` reshaping**. `targetConnectorEntityId` (single) is removed. New `targetConnectorEntityIds: z.array(z.string()).min(1)` is the denormalized union of `writes[].targetConnectorEntityId`, computed at enqueue time. Lock queries match against this field.

4. **Tool-side pre-flight (`bulk-transform-entity-records.tool.ts`)**:
   - Loads each unique `writes[].targetConnectorEntityId`'s wide columns from `wideTableStatementCache` once at the start of pre-flight; builds `Map<entityId, Set<columnName>>`.
   - For each write: validates the column exists in the matching target's column set. Unknown column → `BULK_JOB_EXPRESSION_INVALID` (400) naming the bad `{ targetConnectorEntityId, column }`.
   - For `sql_alias` writes: validates the alias is declared in `expression.value`. Unreferenced declared aliases → also `BULK_JOB_EXPRESSION_INVALID` (400) (open question 1's lean).
   - For `constant` writes: PG-type cast check (`SELECT $value::<pgType>` returns row) against the target column's `pgType`. Fail → `BULK_JOB_EXPRESSION_INVALID` (400) (open question 2's lean — lenient: only reject if PG can't cast).
   - For `source_column` writes: validates the named source column exists on the source entity's wide table.
   - The cost-acknowledgement gate (`acknowledgeCost`) keeps its current shape.

5. **Locking generalization**:
   - `JobLockService.assertConnectorEntityUnlocked(entityIds: string[], orgId)` — was singular; now plural. The current single-entity callsite passes `[entityId]` for backwards behavior; the bulk_transform enqueue site passes the full set.
   - `JobsRepository.findRunningByTargetEntityIds(orgId, entityIds: string[])` — generalization of `findRunningByTargetEntityId`. SQL changes from `metadata->>'targetConnectorEntityId' = $1` to `metadata->'targetConnectorEntityIds' ?| $1::text[]` (PG JSON array-overlap).
   - `BULK_JOB_TARGET_LOCKED` error response (`details.lockingJobs`) lists every locked entity in the requested set, not just the first one (open question 3's lean).

6. **Processor + per-batch SQL (`bulk-transform.processor.ts` + `bulk-transform.service.ts`)**:
   - `runToolDispatchLoop` shapes each per-record success once per record, then groups the value-objects by `targetConnectorEntityId`. For each target group, calls `BulkTransformService.upsertSuccesses({ targetConnectorEntityId, organizationId, jobId, successes, userId })`. All per-target UPSERTs for the batch wrapped in a single transaction.
   - `BulkTransformService.upsertSuccesses` signature unchanged from today (still per-target); the multi-target fan-out lives in the processor. Inside, the existing three-CTE pattern (`input_rows` → `upserted_records` → wide-table INSERT) handles a single target.
   - Per-record per-target atomicity: a failed UPSERT row for record `p-3` against target B does not roll back its sibling write into target A (open question 5's lean — the dispatcher already accumulates per-record failures; this extends the failure entry shape).

7. **Value-shaping per write** — new helper `shapeWritesForRecord` in `apps/api/src/queues/processors/bulk-transform-writes.util.ts`. Takes `(writes, toolResult | null, sourceRow, sqlAliasValues | null)` and returns `Map<targetConnectorEntityId, Record<column, value>>`. Per `valueFrom.kind`:
   - `tool_result`: the whole tool output.
   - `tool_path`: `_get(toolResult, valueFrom.path)` with Lodash semantics (`a.b[0].c`). Empty/absent `path` resolves to the whole tool result.
   - `sql_alias`: the value at `sqlAliasValues[valueFrom.alias]` (set by the SQL projection per row in `runBatch`).
   - `source_column`: `sourceRow[valueFrom.column]` (always source row, never SQL-projected — open question 4's lean).
   - `constant`: `valueFrom.value` verbatim.

8. **`BulkTransformResultSchema` reshaping**:
   - `partialFailures[].error` keeps the same shape.
   - `partialFailures[]` entries gain optional `{ targetConnectorEntityId: string, column: string }` for per-target write failures. Tool-dispatch failures (the tool itself throws for a record) keep both fields absent.
   - `droppedRecords` + `droppedKeys` stay as defence-in-depth, now scoped per target. New `droppedByTarget?: Array<{ targetConnectorEntityId, droppedColumns: string[] }>` replaces the flat `droppedKeys`.

9. **Tests** (see Tests section): unit + integration covering schema migration, pre-flight rejection of every error path, multi-target locking, shaping for each `valueFrom.kind`, per-record-per-target atomicity, and a two-write tool-dispatch smoke.

### Out of scope

- **The other four primitives** (`bulk_query`, `bulk_aggregate`, `bulk_delete`, `bulk_apply`). Each has its own ticket (#100–#102). This work is `bulk_transform` only.
- **Migration of existing `targetColumn`-shaped jobs**. Per `project_no_production_data_yet` + `feedback_no_compat_aliases`: clean cut, no shim. Existing fixtures + integration tests change in lock-step.
- **`tool_path` array operations** (e.g., `_.sumBy`, JSONPath filters). `_get` semantics only — one deterministic value per call. Aggregation across array elements is a future `bulk_apply` concern.
- **Cross-batch transactions**. Each batch is one transaction; consecutive batches are independent. A failed batch leaves successful prior batches committed (current behavior).
- **Re-running failed records**. The "retry failed only" affordance still requires the agent to enqueue a new job; not auto-retried by the worker.

## Concept changes

### `BulkTransformWriteSchema`

```ts
// packages/core/src/models/job.model.ts

const ValueFromToolResultSchema = z.object({
  kind: z.literal("tool_result"),
});

const ValueFromToolPathSchema = z.object({
  kind: z.literal("tool_path"),
  path: z.string(), // Lodash-style: "a.b[0].c"; "" resolves to the whole result
});

const ValueFromSqlAliasSchema = z.object({
  kind: z.literal("sql_alias"),
  alias: z.string(),
});

const ValueFromSourceColumnSchema = z.object({
  kind: z.literal("source_column"),
  column: z.string(), // wide-column name on the SOURCE entity
});

const ValueFromConstantSchema = z.object({
  kind: z.literal("constant"),
  value: z.unknown(),
});

const ValueFromSchema = z.discriminatedUnion("kind", [
  ValueFromToolResultSchema,
  ValueFromToolPathSchema,
  ValueFromSqlAliasSchema,
  ValueFromSourceColumnSchema,
  ValueFromConstantSchema,
]);

export const BulkTransformWriteSchema = z.object({
  targetConnectorEntityId: z.string(),
  column: z.string(), // wide-column name on the target entity
  valueFrom: ValueFromSchema,
});
```

### `BulkTransformExpressionSchema` (reshaped)

```ts
// tool variant — `targetColumn` removed, `writes` added
const BulkTransformExpressionToolSchema = z.object({
  kind: z.literal("tool"),
  ref: z.string(),
  args: z.record(z.unknown()).optional(),
  writes: z.array(BulkTransformWriteSchema).min(1),
});

// sql variant — `value` (projection) stays, `writes` added
const BulkTransformExpressionSqlSchema = z.object({
  kind: z.literal("sql"),
  value: z.string(), // SQL projection text with `AS aliases`
  writes: z.array(BulkTransformWriteSchema).min(1),
});

export const BulkTransformExpressionSchema = z.discriminatedUnion("kind", [
  BulkTransformExpressionToolSchema,
  BulkTransformExpressionSqlSchema,
]);
```

### `BulkTransformMetadataSchema` (reshaped)

```ts
export const BulkTransformMetadataSchema = z.object({
  portalId: z.string(),
  organizationId: z.string(),
  stationId: z.string(),
  sourceConnectorEntityId: z.string(),
  // targetConnectorEntityId: REMOVED
  targetConnectorEntityIds: z.array(z.string()).min(1),
  expression: BulkTransformExpressionSchema,
  keyField: z.string(),
  batchSize: z.number().int().positive().default(DEFAULT_BULK_BATCH),
  acknowledgeCost: z.boolean().optional(),
  sourceFilter: z.object({ whereSqlFragment: z.string() }).optional(),
  userId: z.string().optional(),
});
```

`targetConnectorEntityIds` is computed at enqueue time inside the tool handler:

```ts
const targetConnectorEntityIds = Array.from(
  new Set(writes.map((w) => w.targetConnectorEntityId))
).sort();
```

### Lock-query SQL

Generalization of `JobsRepository.findRunningByTargetEntityId` to operate over the array:

```sql
SELECT id, type, status, metadata
  FROM jobs
 WHERE organization_id = $1
   AND type = 'bulk_transform'
   AND status = ANY($2::job_status[])  -- NON_TERMINAL_JOB_STATUSES
   AND metadata->'targetConnectorEntityIds' ?| $3::text[]
   AND deleted IS NULL
```

`?|` is the PG JSONB "any-key-exists" array operator: rows match when the JSON array on the left intersects the text array on the right. Index strategy is unchanged — `jobs(organization_id, type, status) WHERE deleted IS NULL` is already there; per-row JSONB lookup is small for the bounded array. If volume becomes a concern, a GIN index on `(metadata->'targetConnectorEntityIds')` is a follow-up.

### `BulkTransformResultSchema` (reshaped)

```ts
export const BulkTransformResultSchema = z.object({
  recordsProcessed: z.number().int().nonnegative(),
  recordsFailed: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  partialFailures: z.array(
    z.object({
      sourceKey: z.string(),
      // Present for per-write failures (a single target's UPSERT
      // throws for one record); absent for tool-dispatch failures
      // (the tool itself threw for the record).
      targetConnectorEntityId: z.string().optional(),
      column: z.string().optional(),
      error: BulkErrorEnvelopeSchema,
    })
  ).optional(),
  // Replaces the flat `droppedKeys`. Defence-in-depth surfacing of
  // wide-columns that disappeared between pre-flight and execution.
  droppedByTarget: z.array(
    z.object({
      targetConnectorEntityId: z.string(),
      droppedColumns: z.array(z.string()),
    })
  ).optional(),
  droppedRecords: z.number().int().nonnegative().optional(),
});
```

### Per-batch processor flow (tool branch)

```
for each batch:
  fetch source batch
  dispatch tool calls (returns successes[] + failures[])
  for each success { sourceKey, toolResult }:
    sourceRow = source row matching sourceKey
    shaped = shapeWritesForRecord(writes, toolResult, sourceRow, null)
    // shaped is Map<targetConnectorEntityId, Record<column, value>>
    for [targetId, columnValues] in shaped:
      perTargetGroups[targetId].push({ sourceKey, value: columnValues })
  begin transaction:
    for [targetId, successes] in perTargetGroups:
      upsertSuccesses({ targetConnectorEntityId: targetId, organizationId, jobId, successes, userId })
  emit SSE batch event
  accumulate partialFailures (dispatch failures + any UPSERT-level errors)
```

### Per-batch processor flow (SQL branch)

```
for each batch:
  runBatch(...) returns { rowsCommitted, rows: Array<Record<alias, value>> }
  for each row { sourceKey, aliasValues }:
    sourceRow = source row matching sourceKey
    shaped = shapeWritesForRecord(writes, null, sourceRow, aliasValues)
    // shaped is Map<targetConnectorEntityId, Record<column, value>>
    for [targetId, columnValues] in shaped:
      perTargetGroups[targetId].push({ sourceKey, value: columnValues })
  begin transaction:
    for [targetId, successes] in perTargetGroups:
      upsertSuccesses({ targetConnectorEntityId: targetId, ... })
  emit SSE batch event
```

This unifies the post-projection write path. `BulkTransformService.runBatch` stops doing the wide-table write itself — it returns the SQL row results (already does for SSE payloads), and the new `writes`-aware fan-out in the processor handles the multi-target UPSERT.

## Surface

### `packages/core/src/models/job.model.ts` (edit)

Add `BulkTransformWriteSchema`, reshape `BulkTransformExpressionSchema`, reshape `BulkTransformMetadataSchema`, reshape `BulkTransformResultSchema`. Update the type-checks file with the new types.

### `apps/api/src/tools/bulk-transform-entity-records.tool.ts` (edit)

- `InputSchema.expression` now requires `writes[]` on both variants. `targetColumn` removed.
- Pre-flight loads the union of target wide-tables once, validates each `writes[]` entry, and rejects unknown columns / sql-aliases / source-columns / un-castable constants.
- Computes `targetConnectorEntityIds` and passes it into the job metadata at enqueue.
- The tool's agent-facing description swaps `targetColumn` examples for `writes` examples (one tool, two writes from the same result — diameter in km + miles).

### `apps/api/src/queues/processors/bulk-transform.processor.ts` (edit)

- `runToolDispatchLoop` reads `expression.writes` instead of `expression.targetColumn`.
- Calls `shapeWritesForRecord` per record, groups by target, fans out to per-target `upsertSuccesses` inside a single transaction.
- The SQL branch (`bulk-transform.processor.ts` main loop) does the same fan-out after `runBatch` returns rows.

### `apps/api/src/queues/processors/bulk-transform-writes.util.ts` (new)

```ts
export function shapeWritesForRecord(
  writes: BulkTransformWrite[],
  toolResult: unknown | null,
  sourceRow: Record<string, unknown>,
  sqlAliasValues: Record<string, unknown> | null
): Map<string, Record<string, unknown>>;

// Lodash-style path get. Empty path → whole value. Supports
// `a.b.c`, `a[0]`, `a.b[0].c`. ~20 LOC of tokenization.
export function getByPath(value: unknown, path: string): unknown;
```

### `apps/api/src/services/bulk-transform.service.ts` (edit)

- `upsertSuccesses` signature unchanged (still per-target). Internals unchanged.
- `runBatch` returns rows but no longer writes them to the wide table itself — the processor's fan-out handles that. (Today `runBatch` writes inline; that path moves out.)

### `apps/api/src/services/job-lock.service.ts` (edit)

`assertConnectorEntityUnlocked(entityIds: string[], orgId)` — plural. Existing callers update to pass `[entityId]`; bulk_transform pre-flight passes the union.

### `apps/api/src/db/repositories/jobs.repository.ts` (edit)

`findRunningByTargetEntityIds(orgId, entityIds: string[])` — replaces `findRunningByTargetEntityId`. SQL switches to the `?|` array overlap predicate.

### `apps/api/src/constants/api-codes.constants.ts` (edit)

No new codes — `BULK_JOB_EXPRESSION_INVALID` and `BULK_JOB_TARGET_LOCKED` cover the cases. The error messages get extended to name the bad write / locked entities.

## Tests

### Core unit tests

1. **`packages/core/src/__tests__/models/job.model.test.ts` (edit)**:
   - `BulkTransformWriteSchema` accepts all five `valueFrom` kinds with the right per-kind fields.
   - Rejects a write missing `targetConnectorEntityId` / `column`.
   - `BulkTransformMetadataSchema` requires `targetConnectorEntityIds.min(1)`; rejects when missing.
   - `BulkTransformResultSchema` round-trips `partialFailures` with optional `targetConnectorEntityId` + `column`.

### API unit tests

2. **`apps/api/src/__tests__/queues/processors/bulk-transform-writes.util.test.ts` (new)**:
   - `getByPath` — primitive at root (empty path), nested object (`a.b.c`), array index (`a[0]`), mixed (`a.b[0].c`), absent path returns `undefined`.
   - `shapeWritesForRecord` — each kind in isolation; multi-write per target; multi-target writes are split correctly; missing tool result for `tool_result` kind throws.

3. **`apps/api/src/__tests__/tools/bulk-transform-entity-records.tool.test.ts` (edit)**:
   - Valid input — single write, tool kind. Existing pattern, just shape-updated.
   - Multi-write across two targets — both columns validated, `targetConnectorEntityIds` computed correctly.
   - Pre-flight reject — unknown column on target B (others fine) → 400 naming `{ targetConnectorEntityId, column }`.
   - Pre-flight reject — `sql_alias` references an alias not declared in `expression.value` → 400 naming the alias.
   - Pre-flight reject — declared SQL alias not referenced by any `writes[]` → 400 naming the alias (open question 1).
   - Pre-flight reject — `constant` with value un-castable to the target column's PG type → 400.
   - Pre-flight reject — `source_column` references a non-existent column on the source wide table → 400.

4. **`apps/api/src/__tests__/services/job-lock.service.test.ts` (edit)**:
   - `assertConnectorEntityUnlocked(["a", "b"], org)` rejects when ANY of `a`/`b` is locked by a running job.
   - `BULK_JOB_TARGET_LOCKED` details enumerate every locked entity in the requested set.

5. **`apps/api/src/__tests__/db/repositories/jobs.repository.test.ts` (edit)** (or integration if jobs repo has only integration tests today):
   - `findRunningByTargetEntityIds` returns jobs whose metadata's `targetConnectorEntityIds` JSON array overlaps the requested set.

### API integration tests

6. **`apps/api/src/__tests__/__integration__/queues/bulk-transform-smoke-c.integration.test.ts` (edit — re-passes with single-write shape)**:
   - The existing §4 smoke C fixture migrates to `writes: [{ targetConnectorEntityId, column, valueFrom: { kind: "tool_result" } }]` with a single entry. Assertions unchanged — proves the new shape covers the old narrow case.

7. **`apps/api/src/__tests__/__integration__/queues/bulk-transform-multi-write.integration.test.ts` (new)**:
   - 10 source records, one tool that returns `{ km: number, miles: number }`, two writes against the same target — `c_distance_km` from `tool_path: "km"` and `c_distance_miles` from `tool_path: "miles"`. Asserts both columns populate on each upserted row.
   - Same fixture, but a third write into a side target entity (cross-target) — both targets get their values; locking-set query confirms both targets were locked during the job.
   - A failed tool dispatch for one record produces a `partialFailures` entry without `targetConnectorEntityId`/`column`; an UPSERT failure injected for one target produces an entry WITH both fields, and the other target's writes commit successfully.

## Acceptance criteria

- All existing parser + apps/api unit + integration tests pass through the migration. The §4 smoke C suite continues to pass against the single-write fixture.
- New tests pass: the five Zod schema cases (test 1), `getByPath` + `shapeWritesForRecord` cases (test 2), the seven tool pre-flight rejection cases (test 3), the locking generalization (tests 4 + 5), the §4 smoke single-write migration (test 6), and the multi-write smoke including cross-target + failure-isolation (test 7).
- `npm run type-check` clean across the repo.
- `grep -rn "targetColumn" packages/core/src apps/api/src` returns zero matches outside changelog / docs.
- `grep -rn "metadata->>'targetConnectorEntityId'" apps/api/src` returns zero matches — the new query uses the JSONB array path.
- Manual smoke against a station with a NEO-shaped tool: agent enqueues a multi-write job from one tool call (diameter in km + miles), both columns populate, the lock alert in the connector-instance view names both target entities (if cross-target) while the job runs.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| Migration of existing fixtures misses a callsite — type checker doesn't catch a Zod-only field rename. | The `targetColumn`→`writes` rename surfaces at every consumer through TypeScript (field is gone from the inferred type). The `grep` checks in acceptance criteria backstop. |
| Lock query's `?|` predicate is slower than the `->>` equality + B-tree path it replaces. | Per-row JSONB array of 1–5 ids is cheap. If volume turns into a hot path, add a GIN index on `(metadata->'targetConnectorEntityIds')` — follow-up, not blocker. |
| The per-target transaction wrapper deadlocks on cross-target locks under concurrent jobs. | The advisory-lock layer already serializes per-entity work. Cross-target writes within one job acquire each target's lock in a deterministic order (sorted by entity id) — no deadlock cycles. |
| `getByPath` hand-rolled parser has an edge case bug. | Six unit cases (test 2) cover the four supported shapes + empty path + missing path. Easy to extend if a real case surfaces. |
| Per-record per-target failure isolation produces confusing partial-failure listings (one record × N targets = N entries). | The result schema includes both fields, so the UI can group by `sourceKey` and render a per-record summary. The terminal-message renderer migrates in lock-step. |
| `runBatch`'s SQL-branch responsibility split (returns rows, processor writes) doubles the number of statements per batch. | The total work is the same — UPSERT moves from inside `runBatch` to the processor's fan-out. One PG round-trip vs. one, just at a different layer. |

**Rollback**: revert the merge commit. The migration is a single contract cut — restoring `targetColumn` restores the prior behavior. No live jobs to drain (per `project_no_production_data_yet`).

## Cross-references

- `docs/BULK_TRANSFORM_MULTI_COLUMN_WRITES.discovery.md` — decisions, leans, design space rationale.
- `docs/LARGE_DATA_OPS_GENERALIZATION.discovery.md` — the five-primitive umbrella discovery that spawned this ticket.
- `packages/core/src/models/job.model.ts` — `BulkTransformExpressionSchema`, `BulkTransformMetadataSchema`, `BulkTransformResultSchema`.
- `apps/api/src/tools/bulk-transform-entity-records.tool.ts` — tool input schema, pre-flight pipeline, enqueue.
- `apps/api/src/queues/processors/bulk-transform.processor.ts` — `runToolDispatchLoop` (tool branch), SQL-branch main loop.
- `apps/api/src/services/bulk-transform.service.ts` — `runBatch`, `upsertSuccesses` (per-target CTE flow).
- `apps/api/src/services/job-lock.service.ts` — `assertConnectorEntityUnlocked`.
- `apps/api/src/db/repositories/jobs.repository.ts` — `findRunningByTargetEntityId` → `…Ids` plural.
- Memory: `feedback_tool_purity`, `feedback_tool_output_shape_is_arbitrary`, `feedback_no_compat_aliases`, `project_no_production_data_yet`.
