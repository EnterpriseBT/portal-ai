# Large data operations — Phase 4: Writes via per-record tool dispatch — Spec

**Phase 4 unlocks `expression.kind === "tool"` on the bulk-transform tool from Phase 2. After Phase 4 lands, the agent can dispatch a bulk job that calls a tool per source record — e.g. "for each parcel, call `compute_distance_to_nearest_hospital` and store the result." A dispatcher fans out per-batch with bounded concurrency, an optional per-second rate cap, and per-call timeouts; successful results upsert by `keyField`; per-record failures collect into the terminal result's `partialFailures` array. The `bulk-failures-table` block (already shipped in Phase 2) now renders real data and exposes a "retry failed only" button. A cost-acknowledgement gate keeps the agent honest before launching expensive operations. Smoke C — 50,000 parcels × a test-fixture tool with realistic `bulkDispatch` metadata — completes end-to-end. After Phase 4, issue #85 closes.**

Discovery: `docs/LARGE_DATA_OPS.discovery.md`. Phase 1: shared contracts. Phase 2: writes-SQL (the processor + tool this phase extends). Phase 3: reads (independent; not on the dependency path). Issue: [#85](https://github.com/EnterpriseBT/portal-ai/issues/85).

## Scope

### In scope

1. **`bulkDispatch` metadata on `ToolpackTool`** (`packages/core/src/registries/builtin-toolpacks.ts`). New optional field on the existing `ToolpackTool` interface:
   ```ts
   interface BulkDispatchMetadata {
     maxConcurrency: number;          // pLimit cap; required
     timeoutMs: number;               // per-call timeout; required
     ratePerSec?: number;             // token bucket cap (e.g. metered APIs)
     idempotent: boolean;             // required; documents whether retry on failure is safe
     estimatedMsPerCall?: number;     // used for ETA computation in the route's pre-flight
     costHint?: "free" | "metered" | "expensive";  // gates acknowledgeCost requirement
   }

   interface ToolpackTool {
     name: string;
     description: string;
     parameterSchema: Record<string, unknown>;
     examples?: ToolpackToolExample[];
     bulkDispatch?: BulkDispatchMetadata;  // NEW — opt-in
   }
   ```
   Built-in tools that want to be bulk-dispatchable declare `bulkDispatch` in their registration entry. Custom toolpacks (#65) carry the metadata through their JSONata-validated descriptor schema (new field added to the toolpack-descriptor schema; backwards-compatible since it's optional).

2. **Dispatcher** (`apps/api/src/queues/processors/bulk-transform-tool.dispatcher.ts`, new). Pure function invoked by the bulk-transform processor when `expression.kind === "tool"`. Per batch:
   - Fan out via `pLimit(maxConcurrency)`: spawn a bounded number of in-flight tool invocations.
   - Optional token-bucket rate limiting: when `ratePerSec` is set, acquire a token before each call; bucket refills at `ratePerSec` per second.
   - Per-call timeout via `withTimeout(timeoutMs)`: reject calls that take longer; collected as failures.
   - Per-call result is a tuple `{ sourceKey: string, status: "ok" | "error", value?: unknown, error?: ApiUserError }`.
   - Successful results upserted in one statement per batch (mirrors the SQL path's batched UPSERT, but the values come from per-call results rather than a SELECT projection).
   - Failed results accumulate into the job's running `partialFailures: { sourceKey, error }[]` array.
   - Per-batch SSE event includes `failureCount` reflecting the batch's failed-record count (Phase 1's `JobBatchEventSchema` already carries this).

3. **Bulk-transform processor extension** (`apps/api/src/queues/processors/bulk-transform.processor.ts`). Branch on `expression.kind`:
   ```ts
   if (expression.kind === "sql") {
     // Existing Phase 2 path
   } else if (expression.kind === "tool") {
     await dispatchToolBatches(/* … */);
   }
   ```
   The dispatcher is a separate file; the processor just branches and delegates.

4. **Tool route pre-flight extension** (`apps/api/src/tools/bulk-transform-entity-records.tool.ts`). Three new pre-flight checks when `expression.kind === "tool"`:
   - **Tool exists + available to the station.** Look up `expression.ref` in the station's analytics-tools record (built via `ToolService.buildAnalyticsTools`). Reject with `BULK_DISPATCH_TOOL_NOT_FOUND` if absent.
   - **Tool declares `bulkDispatch`.** Look up the tool's `ToolpackTool` descriptor; if `bulkDispatch` isn't declared, reject with `BULK_DISPATCH_TOOL_NOT_BULK_DISPATCHABLE` and a recommendation: "Tool 'X' isn't bulk-dispatchable. Add a `bulkDispatch` metadata block to its toolpack descriptor."
   - **Cost-acknowledgement gate.** When the tool's `bulkDispatch.costHint === "expensive"` AND the input's `acknowledgeCost !== true`, reject with `BULK_DISPATCH_COST_NOT_ACKNOWLEDGED` and a recommendation: "This operation calls a costly tool. Confirm with the user, then retry with `acknowledgeCost: true`."
   - **ETA computation.** When `estimatedMsPerCall` is set, compute `expectedRecords × estimatedMsPerCall / (maxConcurrency × 1000)` seconds and include in the tool's return shape. Falls back to a generic estimate when `estimatedMsPerCall` is absent.

5. **`compute_distance_to_nearest_hospital` test-fixture tool** (`apps/api/src/__tests__/__fixtures__/distance-to-nearest-hospital.tool.ts`, new — test-only). Deterministic compute (a small hash-based distance derived from the source row's `parcel_id`) with realistic `bulkDispatch` metadata: `{ maxConcurrency: 10, timeoutMs: 5000, ratePerSec: 50, idempotent: true, estimatedMsPerCall: 200, costHint: "metered" }`. Used by Smoke C and by per-batch dispatcher unit tests. **Not** a real tool — does not register in any production toolpack. Phase 4 closes #85 without depending on #84's GIS toolpack.

6. **Per-record failure surfacing in `bulk-failures-table` block** (`apps/web/src/components/BulkFailuresTableBlock.component.tsx`). Phase 2 stubbed the block with empty data; Phase 4 wires real `partialFailures` data:
   - Renders a paginated MUI table: `sourceKey | error.code | error.message | error.recommendation`.
   - Header row exposes a chip with the total failure count + the per-batch breakdown.
   - **"Retry failed only" button** wired: dispatches a new `bulk_transform` job via the agent's tool-call surface, scoped to the `sourceKey`s in the table. Practically: the button opens a portal-message asking the agent to retry; the agent (with its tool guidance updated in this phase's system-prompt addition) recognizes the request and dispatches `bulk_transform_entity_records` with a SQL-WHERE-IN filter on `keyField`.
   - Per-error inspection: expanding a row shows the full `ApiUserError` envelope (`details` included).

7. **Retry-failed-only flow.** The button's onClick triggers a portal-message POST through the existing chat surface, containing a synthetic user-role message: "Retry the failed records from job `<id>`. The failed source keys are: [list]." The agent (with the system-prompt addition surfaced via the bulk-job's terminal context) re-dispatches `bulk_transform_entity_records` with a SQL `WHERE keyField IN (...)` predicate on the source. This is implemented as a chat-driven flow rather than a direct API call so the user sees the retry as a normal conversation turn (preserves the "agent is acting on my behalf" model).

8. **System-prompt addition for retry behavior** — when a bulk job terminates with `recordsFailed > 0`, the synthetic terminal message includes a hint: "If you want to retry only the failed records, call `bulk_transform_entity_records` with the same expression and a source-side WHERE predicate filtering on the source key field." This nudges the agent toward the right tool call when the user clicks "retry failed only" or asks for a retry in prose.

9. **Smoke C — acceptance integration test.** New integration test `apps/api/src/__tests__/__integration__/bulk-transform-smoke-c.integration.test.ts`:
   - Seed source entity with 1,000 synthetic parcels (smaller than 50k to keep test fast; shape assertions, not throughput).
   - Register the test-fixture `compute_distance_to_nearest_hospital` tool in the test's tools.service mock.
   - Dispatch `bulk_transform_entity_records` with `expression: { kind: "tool", ref: "compute_distance_to_nearest_hospital" }`.
   - Inject 3 deterministic failures (e.g. for `parcel_id IN ('p-99', 'p-499', 'p-999')` the tool throws).
   - Assert: target wide table has 997 written rows; terminal `BulkTransformResult.recordsFailed === 3`; `partialFailures` has 3 entries with the expected `sourceKey`s; assistant message contains a `bulk-failures-table` block with those failures.

### Out of scope

- **Sandboxed JS for the write expression** — option C in discovery decision W1; gated until ≥3 use cases force it.
- **Per-call retry policy.** Phase 4's dispatcher invokes a tool exactly once per record; if it fails, it goes into `partialFailures`. The "retry failed only" surface IS the retry mechanism. Discovery open question 15 (tool-internal `RATE_LIMITED` backoff) is a follow-up.
- **Distributed dispatch.** Single worker pool; concurrency caps are in-process. v1 scaling envelope.
- **Sub-bulk-dispatch recursion.** Discovery open question 16. Hard cap at depth 1: a bulk-dispatched tool cannot itself enqueue another bulk job. Enforced at the tool route by checking the calling context.
- **Per-org quota / billing for tool dispatch.** Out of scope; flagged in open question 9 of the discovery.
- **A "retry-failed-only" route that bypasses the agent.** All retry flows compose on the existing tool surface; no separate API.
- **Custom toolpack (#65) end-to-end smoke.** Phase 4's smoke is built-in only. Custom toolpacks pick up `bulkDispatch` for free because the descriptor schema is extended, but their end-to-end flow needs telemetry from real usage before we commit it to a smoke test.
- **PostGIS distance compute.** The test-fixture tool uses a deterministic hash; if #84 lands first, swap to the real `ST_DistanceSphere` shape in a follow-up.

## Concept changes

### `bulkDispatch` metadata semantics

```ts
interface BulkDispatchMetadata {
  /** Max concurrent in-flight invocations per batch. */
  maxConcurrency: number;

  /** Per-call wall-clock budget. Calls past this reject. */
  timeoutMs: number;

  /** Optional token-bucket rate limit. Enforced across all in-flight calls in this batch. */
  ratePerSec?: number;

  /** Documents whether retrying a failed call is safe.
   *  Future: if false, the dispatcher won't auto-retry on transient failure. */
  idempotent: boolean;

  /** Used for ETA pre-flight: estimated wall-clock per call. */
  estimatedMsPerCall?: number;

  /** Drives the cost-acknowledgement gate.
   *  - "free": no gate; agent dispatches freely.
   *  - "metered": agent surfaces cost to user before launching, no API gate.
   *  - "expensive": route requires `acknowledgeCost: true`; agent must confirm. */
  costHint?: "free" | "metered" | "expensive";
}
```

**Why these specific fields:** they mirror the dispatcher's runtime decisions one-to-one. Anything not on this struct can't be enforced; anything on it must be enforced. The struct is intentionally narrow.

### Dispatcher signature

```ts
// apps/api/src/queues/processors/bulk-transform-tool.dispatcher.ts

interface DispatchOptions {
  toolRef: string;
  toolMetadata: BulkDispatchMetadata;
  staticArgs?: Record<string, unknown>;  // from expression.args
  batch: SourceRow[];                     // committed batch from the cursor
  keyField: string;                       // upsert key on the target wide table
  toolExecutor: (input: unknown) => Promise<unknown>;  // closed-over Tool.execute
}

interface DispatchResult {
  successes: Array<{ sourceKey: string; value: Record<string, unknown> }>;
  failures: Array<{ sourceKey: string; error: ApiUserError }>;
  batchDurationMs: number;
}

async function dispatchBatch(opts: DispatchOptions): Promise<DispatchResult>;
```

Implementation sketch:
- Build per-record inputs: merge `staticArgs` with the row's data (the row's columns are accessible by name via the source wide-table schema). The shape of the per-record input is `{ ...staticArgs, sourceRow: { _record_id, c_col1, c_col2, ... } }` — the tool sees the full row context.
- Acquire a `pLimit(maxConcurrency)` semaphore.
- For each record: optionally `await tokenBucket.acquire()` (when `ratePerSec` set), then call `withTimeout(toolExecutor(input), timeoutMs)`. Catch errors into `failures`.
- After fan-out completes, return the dispatcher result for the processor to act on.

### Tool-result merging into the target wide table

The dispatcher's `successes[].value` is the per-record tool result. The processor must merge that into the target wide table per the `keyField`. The shape of the merge:

```sql
INSERT INTO er__<target_entity_id> (record_id, c_<keyField>, c_<col1>, c_<col2>, …, _last_written_by_job_id)
VALUES
  ($1, $2, $3, $4, …, $job_id),
  …
ON CONFLICT (c_<keyField>) DO UPDATE
  SET c_<col1> = EXCLUDED.c_<col1>, …, _last_written_by_job_id = EXCLUDED._last_written_by_job_id;
```

Where the values come from the dispatcher's `successes[]` array, keyed against the target entity's wide-table columns. The mapping from `tool result keys → target columns` follows convention: a tool result that returns `{ distance_km: 3.2, hospital_name: "St. Mary's" }` writes `c_distance_km, c_hospital_name` on the target.

When the tool result keys don't match the target's columns, the processor surfaces `BULK_JOB_EXPRESSION_INVALID` at the first batch and bails. Pre-flight tries to catch this via EXPLAIN-equivalent (a column-shape check against an example tool invocation) but the runtime check is the safety net.

### Cost-acknowledgement gate flow

```
Agent calls bulk_transform_entity_records with expression.kind="tool":
  ↓
Tool route pre-flight:
  - assertConnectorEntityUnlocked
  - tool exists + bulkDispatch declared
  - if costHint === "expensive" AND acknowledgeCost !== true:
      → reject with BULK_DISPATCH_COST_NOT_ACKNOWLEDGED
  - count records, compute ETA
  - enqueue job
  ↓
Agent sees the rejection envelope including recommendation:
  "This operation calls a costly tool. Confirm with the user, then retry with `acknowledgeCost: true`."
  ↓
Agent surfaces to user: "This will call a costly tool. Estimated cost: $X. Proceed?"
  ↓
User confirms; agent re-dispatches with `acknowledgeCost: true`.
  ↓
Tool route accepts; job runs.
```

The gate is **opt-in via tool metadata**, not a global "is this expensive" heuristic. Tool authors mark their tools.

For `costHint === "metered"`: no API gate. The route's response includes the ETA + a hint string in the tool's return shape; the agent surfaces it to the user but doesn't need a separate confirmation. This is the Smoke C path.

### "Retry failed only" — chat-driven flow

The `BulkFailuresTableBlock` button is a small affordance:

```tsx
<Button onClick={handleRetryFailedOnly}>
  Retry failed only ({failures.length})
</Button>
```

`handleRetryFailedOnly`:
1. Build a synthetic user-role message: `"Retry the failed records from job ${jobId}. The failed source keys: ${failures.map(f => f.sourceKey).join(', ')}"`.
2. POST to the chat endpoint as a user message.
3. The agent receives this, recognizes the retry intent (system-prompt nudges this behavior via the terminal-message addition), and dispatches `bulk_transform_entity_records` with the same expression + a source-side filter (e.g. `expression: { kind: "tool", ref: "compute_distance_to_nearest_hospital" }` plus a new optional `sourceFilter: { whereSqlFragment: "c_parcel_id IN ('p-99', 'p-499', 'p-999')" }`).

This means the bulk-transform tool's input schema gains an optional `sourceFilter.whereSqlFragment: string` field — a constrained SQL fragment that the processor injects into the cursor's WHERE clause. The fragment is validated via EXPLAIN before enqueueing. This is the smallest surface change to support filtered retries.

## Surface

### `packages/core/src/registries/builtin-toolpacks.ts` (edit)

- Add `BulkDispatchMetadata` interface.
- Extend `ToolpackTool` with optional `bulkDispatch?: BulkDispatchMetadata`.
- Document the field in the JSDoc + the toolpack-author guide.

### `packages/core/src/models/job.model.ts` (edit)

- `BulkTransformMetadataSchema` gains an optional `sourceFilter: { whereSqlFragment: z.string() }` to support filtered re-runs (the retry-failed-only path uses this).

### `apps/api/src/queues/processors/bulk-transform-tool.dispatcher.ts` (new)

- `dispatchBatch(opts)` as described above.

### `apps/api/src/queues/processors/bulk-transform.processor.ts` (edit)

- Branch on `expression.kind`. For `"tool"`, look up the tool via `ToolService.lookupBulkDispatchable(toolRef, stationId)` (new helper) and invoke `dispatchBatch` per batch.

### `apps/api/src/services/tools.service.ts` (edit)

- New helper `lookupBulkDispatchable(toolRef, stationId)`: returns `{ executor, metadata }` for a tool that has `bulkDispatch` declared. Used by the bulk-transform processor.

### `apps/api/src/tools/bulk-transform-entity-records.tool.ts` (edit)

- Pre-flight extended for `expression.kind === "tool"`:
  - Tool exists.
  - `bulkDispatch` declared.
  - Cost-acknowledgement gate (when `costHint === "expensive"`).
  - ETA computation using `estimatedMsPerCall`.
- `sourceFilter.whereSqlFragment` validated via EXPLAIN before enqueue.

### `apps/api/src/constants/api-codes.constants.ts` (edit)

- `BULK_DISPATCH_TOOL_NOT_FOUND` already in Phase 1.
- `BULK_DISPATCH_TOOL_NOT_BULK_DISPATCHABLE` already in Phase 1.
- `BULK_DISPATCH_COST_NOT_ACKNOWLEDGED` already in Phase 1.
- Wire each code's default recommendation per Phase 1's map.

### `apps/api/src/__tests__/__fixtures__/distance-to-nearest-hospital.tool.ts` (new — test-only)

- Test-fixture tool with deterministic compute + realistic `bulkDispatch` metadata. Used by Smoke C and by per-batch dispatcher unit tests.

### `apps/api/src/prompts/system.prompt.ts` (edit)

- Augment the entity-management section: when a bulk job terminates with failures, the recommended action is to call `bulk_transform_entity_records` again with the same expression + a `sourceFilter.whereSqlFragment` predicate on the failed keys. (Terminal-message text already nudges this; the system prompt makes it canonical.)

### `apps/web/src/components/BulkFailuresTableBlock.component.tsx` (edit)

- Wire `partialFailures[]` data through to a paginated MUI table.
- Per-row expansion shows the full `ApiUserError` envelope.
- "Retry failed only" button: builds the synthetic user message and POSTs it via the existing chat-message endpoint.

### `apps/web/src/api/portals.api.ts` (edit, if needed)

- Reuse existing chat-message POST mutation; no new endpoint.

## Tests

### Unit — `BulkDispatchMetadata` type-level

1. **`ToolpackTool` accepts `bulkDispatch` when declared.**
2. **`bulkDispatch.costHint` is the literal union `"free" | "metered" | "expensive"`** — exhaustiveness asserted via `IsAssignable`.

### Unit — `dispatchBatch`

3. **Resolves all calls in parallel up to `maxConcurrency`.** Spawn 20 calls with `maxConcurrency: 5` against a tool that sleeps 100ms; assert total runtime ≈ 400ms (within tolerance).
4. **Honors `ratePerSec` via the token bucket.** Spawn 20 calls with `ratePerSec: 10` against a fast tool; assert total runtime ≥ 2 seconds.
5. **Times out a stuck call.** Tool that never resolves; `timeoutMs: 100`; the call lands in `failures` with `error.code === "BULK_DISPATCH_CALL_TIMEOUT"`.
6. **Collects per-record failures.** Three of ten calls throw; assert `failures.length === 3` with the right `sourceKey`s.
7. **Successful results carry the tool's return value.** Tool returns `{ distance_km: 3.2 }`; the dispatcher's `successes[i].value` matches.

### Unit — bulk-transform processor branch

8. **Routes `expression.kind === "sql"` to the existing path** (unchanged from Phase 2).
9. **Routes `expression.kind === "tool"` to the dispatcher** + merges successes into the target wide table.
10. **Forwards per-batch failures into the final result's `partialFailures` array.**
11. **`sourceFilter.whereSqlFragment` is injected into the cursor's WHERE clause** when present.

### Unit — `bulk_transform_entity_records` tool pre-flight (extensions)

12. **Rejects when `expression.ref` doesn't resolve in the station's tools** (`BULK_DISPATCH_TOOL_NOT_FOUND`).
13. **Rejects when the tool has no `bulkDispatch` declared** (`BULK_DISPATCH_TOOL_NOT_BULK_DISPATCHABLE`).
14. **Rejects `costHint: "expensive"` without `acknowledgeCost: true`** (`BULK_DISPATCH_COST_NOT_ACKNOWLEDGED`).
15. **Accepts `costHint: "metered"` without `acknowledgeCost`** — surfaces ETA in tool return but doesn't gate.
16. **ETA computed from `estimatedMsPerCall × expectedRecords / maxConcurrency`.**
17. **`sourceFilter.whereSqlFragment` validated via EXPLAIN** — invalid fragment rejects with `BULK_JOB_EXPRESSION_INVALID`.

### Unit — `BulkFailuresTableBlock` (web)

18. **Renders an empty state when `failures: []`.**
19. **Renders paginated rows** — sourceKey, error.code, error.message, error.recommendation.
20. **Row expansion** shows the full `ApiUserError` envelope.
21. **"Retry failed only" button** POSTs a synthetic user message via the chat endpoint with the failed source keys in the body.

### Integration — end-to-end

22. **Smoke C**: 1,000-record tool-dispatched transform with 3 injected failures. See § In scope item 9.
23. **Retry-failed-only round-trip** (integration): launch a bulk job with failures; click "retry failed only"; assert a new `bulk_transform` job is enqueued with `sourceFilter.whereSqlFragment` scoping to the failed keys.

## Acceptance criteria

- [ ] `ToolpackTool` carries `bulkDispatch?` field; existing tool registrations still type-check.
- [ ] Dispatcher fans out per-batch with bounded concurrency, optional rate limit, per-call timeout, per-record failure collection; tests 3–7 pass.
- [ ] Processor branches on `expression.kind`; tests 8–11 pass.
- [ ] Tool pre-flight extensions; tests 12–17 pass.
- [ ] `BulkFailuresTableBlock` renders real data + retry button works; tests 18–21 pass.
- [ ] Smoke C (test 22) passes against a seeded source + test-fixture tool with injected failures.
- [ ] Retry-failed-only round-trip (test 23) passes end-to-end.
- [ ] `npm run type-check` clean.
- [ ] All new unit + integration tests pass; existing suites unchanged.
- [ ] Manual smoke: dispatch a tool-based bulk transform on 100 records; observe per-record failures; click "retry failed only"; observe agent re-dispatches and the failed records succeed (or report stable failure shapes).

## Risks & rollback

| Risk | Mitigation |
|---|---|
| Per-record timeout fires for a slow but successful tool — record gets marked failed even though the tool would have succeeded. | `timeoutMs` is per-tool metadata; tool authors set conservatively. Document in the toolpack-author guide. |
| Token bucket leaks tokens (timing bugs in JS event loop). | Implementation uses a simple counter + setInterval refill; tested explicitly in case 4 with deterministic timing tolerances. |
| Tool's return shape doesn't match the target wide-table columns — every record fails at the INSERT step. | Pre-flight runs the tool once on a sentinel record (the first source row), inspects the result shape, asserts it covers the target's columns; rejects with `BULK_JOB_EXPRESSION_INVALID` if not. Catches the misconfiguration at dispatch time. |
| `sourceFilter.whereSqlFragment` is a SQL-injection vector. | Validated via EXPLAIN before enqueue; runs only against the source entity's wide table; org-scope guard applied. The fragment is constructed by the agent based on system-prompt guidance, so it's not user-typed; surface still uses parametric binding where possible. Open question for security review. |
| The "retry failed only" chat-driven flow has the agent in the loop; the agent might phrase the retry differently or skip the source filter. | System-prompt addition makes the canonical retry shape explicit. If reliability is an issue, an explicit `retry-failed-only` endpoint is the fallback (deferred per § Out of scope). |
| Dispatcher's `pLimit` doesn't propagate `AbortSignal` from the BullMQ cancel. | The dispatcher checks the cancel flag between records (similar to processor's check between batches). Stale in-flight calls complete; the dispatcher returns early with the so-far results. |
| Tool result shape varies per source row — `{ distance_km }` for some, `{ distance_km, hospital_name }` for others. | The processor accumulates the union of result keys across the batch and writes NULL for missing columns. Documented in the toolpack-author guide. |

**Rollback**: revert the merge commit. The dispatcher disappears; the processor's `expression.kind === "tool"` branch throws `BULK_DISPATCH_TOOL_NOT_FOUND` (Phase 2's existing rejection). Phase 2's writes-SQL flow continues to work. Frontend retry button becomes inert; failures still display but the button no-ops. Clean.

## Cross-references

- `docs/LARGE_DATA_OPS.discovery.md` — § Smoke C walkthrough, § Tool-dispatch track recommendation.
- `docs/LARGE_DATA_OPS_PHASE_1.spec.md` — `BulkDispatchMetadata`-relevant ApiCodes already shipped; `BulkTransformResultSchema.partialFailures` shape.
- `docs/LARGE_DATA_OPS_PHASE_2.spec.md` — bulk-transform processor + tool this phase extends.
- `packages/core/src/registries/builtin-toolpacks.ts:42` — `ToolpackTool` interface extension point.
- `apps/api/src/queues/processors/bulk-transform.processor.ts` — Phase 2 processor that branches in this phase.
- `apps/api/src/services/tools.service.ts` — `buildAnalyticsTools` returns the station's tools record; `lookupBulkDispatchable` composes on the same data.
- `CLAUDE.md` § Async Job State & Data Locking — locking convention.
