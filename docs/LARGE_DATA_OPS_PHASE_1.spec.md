# Large data operations — Phase 1: Shared infrastructure — Spec

**Phase 1 ships the wire contracts and primitives that Phases 2, 3, and 4 all depend on. Nothing is user-visible after Phase 1 — no new tools, no new routes, no new display blocks. After Phase 1, a new `bulk_transform` JobType exists with no processor; a query-handle response envelope is defined with no producer; the `ApiUserError` envelope carries a new `recommendation` field; `assertConnectorEntityUnlocked` is callable. Phases 2 (writes-SQL), 3 (reads), and 4 (writes-tool-dispatch) plug their concrete code into these contracts without redesigning them.**

Discovery: `docs/LARGE_DATA_OPS.discovery.md`. Issue: [EnterpriseBT/portal-ai#85](https://github.com/EnterpriseBT/portal-ai/issues/85).

## Scope

### In scope

1. **`ApiErrorSchema` gains a `recommendation` field** in `packages/core/src/contracts/api.contract.ts`. Optional in the wire shape (back-compat with every existing error path); required by convention for every new error path that lands in Phases 2/3/4. The field carries an actionable next step in plain English. The `ApiError` class (`apps/api/src/services/http.service.ts`) accepts a `recommendation?: string` in its constructor and threads it through `HttpService.error`.

2. **`BulkTransform` JobType** added to `JobTypeEnum` in `packages/core/src/models/job.model.ts`. Per-type metadata + result schemas:
   - `BulkTransformMetadataSchema` declares the source entity, target entity, expression (discriminated union of `sql` and `tool` shapes — both shapes land in v1 but only `sql` is processable until Phase 4), key field, batch size, and an optional `acknowledgeCost` flag.
   - `BulkTransformResultSchema` declares `recordsProcessed`, `recordsFailed`, `durationMs`, and an optional `partialFailures: { sourceKey: string, error: ApiUserError }[]`.
   - `JobTypeMap` entry wires the two schemas; compile-time check guarantees the discriminated union covers every JobType.
   - JSDoc on `BulkTransformMetadataSchema` declares that `targetConnectorEntityId` is the locked entity (per the data-locking convention in `CLAUDE.md`).

3. **`assertConnectorEntityUnlocked(entityId)` lock primitive** added to `apps/api/src/services/job-lock.service.ts` as a sibling of the existing `assertConnectorInstanceUnlocked`. Throws `ApiError(409, ApiCode.ENTITY_LOCKED_BY_JOB, …)` when any non-terminal job's metadata declares the entity id as its lock target. Releases on terminal status. Internal to API only — not exposed via core contracts.

4. **SSE event shape for `job:batch`** added to `packages/core/src/contracts/job-events.contract.ts` (new file). Wire shape:
   ```ts
   export const JobBatchEventSchema = z.object({
     _eventType: z.literal("batch"),
     recordsProcessed: z.number().int().nonnegative(),
     totalRecords: z.number().int().nonnegative(),
     batchDurationMs: z.number().int().nonnegative(),
     rows: z.array(z.record(z.string(), z.unknown())).optional(),
     rowIds: z.array(z.string()).optional(),  // fallback when rows payload exceeds BATCH_ROW_PAYLOAD_LIMIT
     failureCount: z.number().int().nonnegative().optional(),
   });
   ```
   Exactly one of `rows` or `rowIds` is set per event when the consuming widget needs row data; both omitted means counters-only. The contract is shape-only — no producer yet (Phase 2 wires the bulk-transform processor; the existing SSE infrastructure already supports custom event types via `_eventType: "X"` → `job:X` per `job-events.router.ts`).

5. **Query-handle envelope** defined in `packages/core/src/contracts/portal-sql.contract.ts` (new file). Returned by `sql_query` / `visualize` / `visualize_tree` in Phase 3 when row count exceeds the inline threshold:
   ```ts
   export const QueryHandleEnvelopeSchema = z.object({
     queryHandle: z.string(),                  // opaque id; "qh-<uuid>"
     rowCount: z.number().int().nonnegative(),
     schema: z.array(z.object({
       name: z.string(),
       type: z.string(),                       // PG type name as text
     })),
     sampled: z.boolean(),
     sampleSize: z.number().int().positive().optional(), // present when sampled=true
     truncated: z.boolean(),
     samplePeek: z.array(z.record(z.string(), z.unknown())).max(10),
   });
   ```
   No producer in Phase 1 — Phase 3 wires the producer + the two endpoints (stream + snapshot).

6. **Resource-limit constants** added to `packages/core/src/constants/large-data-ops.constants.ts` (new file). Shared between API and (eventually) web. Values:
   - `MAX_BULK_RECORDS = 1_000_000` (per-job cap; bulk tool route rejects past this)
   - `DEFAULT_BULK_BATCH = 1_000`
   - `MAX_CONCURRENT_BULK_PER_ORG = 2`
   - `BATCH_ROW_PAYLOAD_LIMIT = 256 * 1024` (bytes; per SSE event)
   - `READ_HANDLE_TTL_MS = 24 * 60 * 60 * 1000`
   - `SAMPLING_THRESHOLD = 50_000` (above this row count, reads automatically sample)
   - `STATEMENT_TIMEOUT_MS = 30_000` (per-query wall clock)
   - `INLINE_ROWS_THRESHOLD = 100` (below this, reads still inline rows instead of returning a handle)

7. **New `ApiCode` entries** in `apps/api/src/constants/api-codes.constants.ts`:
   - `BULK_JOB_TARGET_LOCKED` (sibling of existing `ENTITY_LOCKED_BY_JOB`, specific to entity-level locking)
   - `BULK_JOB_EXPRESSION_INVALID` (used by Phase 2 — pre-flight EXPLAIN failure)
   - `BULK_JOB_MAX_RECORDS_EXCEEDED`
   - `BULK_JOB_BATCH_TIMEOUT`
   - `BULK_JOB_CANCELLED`
   - `BULK_JOB_PARTIAL_FAILURE`
   - `READ_HANDLE_EXPIRED` (used by Phase 3)
   - `READ_STREAM_INTERRUPTED` (used by Phase 3)
   - `PORTAL_SQL_TIMEOUT` (used by Phase 3 — `statement_timeout` surface)
   - `BULK_DISPATCH_TOOL_NOT_FOUND` (used by Phase 4)
   - `BULK_DISPATCH_TOOL_NOT_BULK_DISPATCHABLE` (used by Phase 4)
   - `BULK_DISPATCH_COST_NOT_ACKNOWLEDGED` (used by Phase 4)

   Each carries a default `recommendation` constant alongside it (string literal) so the recommendation lives next to the code definition; consuming routes can use the default or override per call.

### Out of scope (deferred to later phases)

- **Bulk-transform processor.** `apps/api/src/queues/processors/bulk-transform.processor.ts` — Phase 2.
- **`bulk_transform_entity_records` tool.** `apps/api/src/tools/bulk-transform-entity-records.tool.ts` — Phase 2.
- **`bulk-job-progress` display block.** Web component — Phase 2.
- **Chat-thread input lock.** Web — Phase 2.
- **Per-record tool dispatch.** `bulkDispatch` metadata, dispatcher implementation, cost-acknowledgement gate — Phase 4.
- **Query-handle producer + storage + endpoints.** `apps/api/src/services/portal-sql-handle.service.ts`, the two routes — Phase 3.
- **Vega-Lite spec rewrite.** Phase 3.
- **Sampling logic + `statement_timeout` enforcement.** Phase 3.
- **Migration of existing `ApiError` paths to include `recommendation`.** Field is opportunistic on existing code; only new code paths in Phases 2/3/4 must populate it.

## Concept changes

### `ApiErrorSchema` evolution

Today's wire shape:

```ts
export const ApiErrorSchema = z.object({
  success: z.literal(false),
  message: z.string(),
  code: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});
```

Phase 1:

```ts
export const ApiErrorSchema = z.object({
  success: z.literal(false),
  message: z.string(),
  code: z.string(),
  recommendation: z.string().optional(),  // NEW — actionable next step
  details: z.record(z.string(), z.unknown()).optional(),
});
```

`ApiError` class constructor signature:

```ts
// before
new ApiError(status, code, message, details?);

// after
new ApiError(status, code, message, opts?: { recommendation?: string; details?: Record<string, unknown> });
```

The constructor accepts both shapes for back-compat (overload or a runtime check); existing call sites continue to compile.

### `BulkTransform` schemas

Discriminated-union expression shape — both kinds declared in v1 even though only `sql` is processable until Phase 4:

```ts
// packages/core/src/models/job.model.ts

export const BulkTransformExpressionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("sql"),
    value: z.string(),  // SELECT projection or scalar expression; per-batch processor wraps in INSERT … SELECT
  }),
  z.object({
    kind: z.literal("tool"),
    ref: z.string(),    // tool name; must be a registered bulkDispatch-able tool (Phase 4 validates)
    args: z.record(z.string(), z.unknown()).optional(),
  }),
]);

export const BulkTransformMetadataSchema = z.object({
  /** Source entity to scan. Read-only during the job; no lock. */
  sourceConnectorEntityId: z.string(),
  /** Target entity to write into. Locked while the job is non-terminal. */
  targetConnectorEntityId: z.string(),
  expression: BulkTransformExpressionSchema,
  /** Source field used as the upsert key on the target. */
  keyField: z.string(),
  batchSize: z.number().int().positive().max(10_000).default(DEFAULT_BULK_BATCH),
  /** Required when the dispatched tool declared `costHint: "expensive"`. */
  acknowledgeCost: z.boolean().optional(),
});

export const BulkTransformResultSchema = z.object({
  recordsProcessed: z.number().int().nonnegative(),
  recordsFailed: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  partialFailures: z.array(z.object({
    sourceKey: z.string(),
    error: ApiErrorSchema,  // reuses the universal envelope; carries `recommendation`
  })).optional(),
});
```

### `assertConnectorEntityUnlocked` shape

```ts
// apps/api/src/services/job-lock.service.ts

static async assertConnectorEntityUnlocked(
  connectorEntityId: string
): Promise<void> {
  // Find any non-terminal job whose metadata declares this entity id as its lock target.
  // Today only BulkTransform does; future job types declare their lock target in their
  // metadata's JSDoc per the CLAUDE.md convention.
  const lockingJob = await DbService.repository.jobs.findOneByEntityLock(connectorEntityId);
  if (lockingJob) {
    throw new ApiError(409, ApiCode.BULK_JOB_TARGET_LOCKED, "Target entity is locked by another bulk job.", {
      recommendation: `Wait for job ${lockingJob.id} to finish, or cancel it before retrying.`,
      details: {
        lockingJobId: lockingJob.id,
        lockingJobType: lockingJob.type,
        startedAt: lockingJob.created,
      },
    });
  }
}
```

`findOneByEntityLock` is a new repository method on `JobsRepository` that scans non-terminal jobs and checks the per-type metadata's lock target. For Phase 1 it only knows about `BulkTransform`'s `targetConnectorEntityId`; future job types extend it.

### Query-handle envelope semantics

The envelope is returned to the agent (not to the UI directly). The agent sees row count, schema, and a 10-row peek — enough to summarize. The actual data flows directly from the API to the web client via a handle id, never through the agent's context window. Phase 3 wires the producer + the two endpoints.

`samplePeek` is intentionally capped at 10 rows. The agent does not see "the data" — only a flavor. Asking the agent for analysis it can only do by seeing all 13k rows is no longer the agent's job; it asks for an aggregation via SQL or steers the user to the chart.

### SSE event shape for `job:batch`

Exactly one of these three configurations per event:

1. **Counters only** — `rows` and `rowIds` both omitted. Used when the consuming widget doesn't need row data (e.g. a counter-only status block, or when row data is too sensitive to broadcast).
2. **Inline rows** — `rows` populated. Used when the committed batch's row payload fits within `BATCH_ROW_PAYLOAD_LIMIT` (256 KB). The widget renders directly from the SSE payload via `vega.changeset` or React state.
3. **Row-id fallback** — `rowIds` populated. Used when the payload exceeds the cap (large geometry, JSONB blobs, etc.). The widget fetches the rows by id from the target wide table on demand. Phase 2 wires the per-batch shape selection in the bulk-transform processor.

## Surface

### `packages/core/src/contracts/api.contract.ts` (edit)

Add `recommendation: z.string().optional()` to `ApiErrorSchema`. Export the unchanged success shape.

### `packages/core/src/models/job.model.ts` (edit)

- Add `"bulk_transform"` to `JobTypeEnum`.
- Export `BulkTransformExpressionSchema`, `BulkTransformMetadataSchema`, `BulkTransformResultSchema` and their inferred types.
- Add the `bulk_transform` entry to `JobTypeMap`.
- Imports `DEFAULT_BULK_BATCH` from `../constants/large-data-ops.constants.js`.
- JSDoc on `BulkTransformMetadataSchema`: "Locks `targetConnectorEntityId`."

### `packages/core/src/contracts/job-events.contract.ts` (new)

- Export `JobBatchEventSchema` and its inferred type.

### `packages/core/src/contracts/portal-sql.contract.ts` (new)

- Export `QueryHandleEnvelopeSchema` and its inferred type.

### `packages/core/src/constants/large-data-ops.constants.ts` (new)

- Export the eight constants listed in scope item 6.

### `apps/api/src/services/http.service.ts` (edit)

- `ApiError` class accepts `{ recommendation?: string; details?: Record<string, unknown> }` as the fourth constructor argument (overload preserves the existing `details`-only call sites).
- `HttpService.error` includes `recommendation` in the response body when set.

### `apps/api/src/services/job-lock.service.ts` (edit)

- New static method `assertConnectorEntityUnlocked(connectorEntityId)`.
- Imports `findOneByEntityLock` from the jobs repository.

### `apps/api/src/db/repositories/jobs.repository.ts` (edit)

- New method `findOneByEntityLock(entityId)` — queries non-terminal jobs where `type = "bulk_transform"` and `metadata->>targetConnectorEntityId = $1`. Generalized signature so future job types extend it via a per-type lock-target map.

### `apps/api/src/constants/api-codes.constants.ts` (edit)

- Add the 11 new `ApiCode` enum entries.
- Add a parallel `ApiCodeDefaultRecommendation: Partial<Record<ApiCode, string>>` map exporting the default `recommendation` string per code so call sites can default cheaply.

## Tests

### Unit — `packages/core/src/__tests__/contracts/api.contract.test.ts` (edit, or new)

1. **`ApiErrorSchema` parses a payload with `recommendation`.**
2. **`ApiErrorSchema` parses a payload without `recommendation`** — back-compat.
3. **Round-trips:** parse → stringify → parse yields the same object including `recommendation`.

### Unit — `packages/core/src/__tests__/models/job.model.test.ts` (edit)

4. **`JobTypeEnum` includes `bulk_transform`.**
5. **`BulkTransformMetadataSchema.parse` accepts an `sql`-kind expression.**
6. **`BulkTransformMetadataSchema.parse` accepts a `tool`-kind expression.**
7. **Rejects mixed-shape expression** (`{ kind: "sql", ref: "..." }`) — discriminated union check.
8. **Defaults `batchSize` to `DEFAULT_BULK_BATCH` when omitted.**
9. **Rejects `batchSize` past 10_000.**
10. **`BulkTransformResultSchema.parse` accepts `partialFailures` whose nested `error` carries `recommendation`.**
11. **`JobTypeMap` has a `bulk_transform` entry whose metadata + result types match the exported schemas** — compile-time assertion via `IsAssignable`.

### Unit — `packages/core/src/__tests__/contracts/job-events.contract.test.ts` (new)

12. **`JobBatchEventSchema.parse` accepts a counters-only event** (both `rows` and `rowIds` absent).
13. **Accepts an `inline-rows` event** (`rows` set, `rowIds` absent).
14. **Accepts a `row-id` event** (`rowIds` set, `rows` absent).
15. **Rejects an event with negative counters.**

### Unit — `packages/core/src/__tests__/contracts/portal-sql.contract.test.ts` (new)

16. **`QueryHandleEnvelopeSchema.parse` accepts a non-sampled envelope.**
17. **Accepts a sampled envelope with `sampleSize`.**
18. **Rejects a `sampled: true` envelope missing `sampleSize`** — refine check.
19. **Caps `samplePeek` at 10 rows.**

### Unit — `apps/api/src/__tests__/services/http.service.test.ts` (edit, or new if absent)

20. **`new ApiError(status, code, message)` works without options.**
21. **`new ApiError(status, code, message, { recommendation })` sets the field.**
22. **`new ApiError(status, code, message, { details })` works without `recommendation`** — overload back-compat.
23. **`HttpService.error` writes `recommendation` into the response body when set.**

### Unit — `apps/api/src/__tests__/services/job-lock.service.test.ts` (edit)

24. **`assertConnectorEntityUnlocked` resolves when no job locks the entity.**
25. **Throws `ApiError(409, BULK_JOB_TARGET_LOCKED, …)` when a non-terminal `bulk_transform` job's metadata declares the entity as its target.**
26. **The thrown error's `recommendation` references the locking job id.**
27. **Ignores terminal jobs** — completed / failed / cancelled jobs don't lock.

### Integration — `apps/api/src/__tests__/__integration__/db/jobs-repository-entity-lock.integration.test.ts` (new)

28. **`findOneByEntityLock` returns the in-flight job when one matches.**
29. **Returns null when only terminal jobs target the entity.**
30. **Returns null when no jobs target the entity.**
31. **Distinguishes between two entities** — locking entity A doesn't trip the check for entity B.

## Acceptance criteria

- [ ] `ApiErrorSchema` carries an optional `recommendation` field; existing `ApiError(…)` call sites continue to compile.
- [ ] `JobTypeEnum` includes `bulk_transform`; `JobTypeMap` is exhaustive (compile-time assertion holds).
- [ ] `BulkTransformMetadataSchema` and `BulkTransformResultSchema` round-trip through Zod.
- [ ] `JobBatchEventSchema` and `QueryHandleEnvelopeSchema` round-trip.
- [ ] `assertConnectorEntityUnlocked` is callable from `JobLockService`; locks against in-flight `bulk_transform` jobs only.
- [ ] All new `ApiCode` enum entries are exported; `ApiCodeDefaultRecommendation` map keys each new code.
- [ ] `npm run type-check` clean across the monorepo.
- [ ] All new tests (cases 1–31) pass.
- [ ] No new tool, route, or display block has been registered. No processor exists. No frontend changes. Phase 1 is wire contracts only.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| `ApiError` overload breaks an existing call site whose fourth argument was a plain `details` object. | Constructor accepts either `Record<string, unknown>` (legacy, treated as `details`) or `{ recommendation?, details? }` (new). Add a runtime check that distinguishes the two shapes by the presence of `recommendation`. |
| `findOneByEntityLock` query is slow if `jobs` table has no index on `metadata->>'targetConnectorEntityId'`. | Phase 1 measures query latency in a baseline integration test; if latency is a problem, add a partial expression index in a follow-up migration. v1 acceptable without an index since the table is bounded by non-terminal-job count, typically small. |
| Adding `bulk_transform` to `JobTypeEnum` breaks the JobTypeMap exhaustiveness check at compile time if the schema entry is missing. | The spec's surface section requires both — type-check failure is the gate. Standard pattern matches the existing 5 job types. |
| Renaming `ApiErrorSchema`'s wire shape might break consumers serializing/deserializing errors across the API/web boundary. | The change is *additive* — `recommendation` is optional, no field is renamed or removed. Existing serializers continue to work; new code path opts in. |
| `BulkTransformExpressionSchema` declares both `sql` and `tool` shapes but only `sql` is processable until Phase 4. | The schema's existence doesn't imply a processor exists; Phase 2's processor branches on `expression.kind` and throws `BULK_DISPATCH_TOOL_NOT_FOUND` for `tool` kinds until Phase 4. Phase 1 ships the contract; Phases 2 + 4 ship the producers. |

**Rollback**: revert the merge commit. No DB migration, no data changes, no user-visible surface. The new `ApiCode` entries are removed; the `recommendation` field disappears from the wire shape (existing consumers ignore unknown fields anyway). Clean.

## Cross-references

- `docs/LARGE_DATA_OPS.discovery.md` — design space, decisions, smoke walkthroughs.
- `packages/core/src/models/job.model.ts` — existing JobType pattern; lines 35–42 (enum), 240–287 (3-step add-a-type guide), 215+ (existing per-type schemas as a reference).
- `apps/api/src/services/job-lock.service.ts` — existing `assertConnectorInstanceUnlocked` (line 80) is the sibling shape.
- `apps/api/src/constants/api-codes.constants.ts` — existing `ApiCode` enum.
- `packages/core/src/contracts/api.contract.ts` — existing `ApiErrorSchema` (line 30).
- `apps/api/src/routes/job-events.router.ts` — SSE custom event support; the producer for `job:batch` wires here in Phase 2.
- `CLAUDE.md` — "Async Job State & Data Locking" (lock convention) and "Database Schema Workflow" (dual-schema rules).
