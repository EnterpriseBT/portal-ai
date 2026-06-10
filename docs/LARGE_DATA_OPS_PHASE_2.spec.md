# Large data operations — Phase 2: Writes-SQL track — Spec

**Phase 2 ships the writes-SQL flow end-to-end. After Phase 2 lands, the agent can call `bulk_transform_entity_records` with an `expression.kind === "sql"` shape; a `bulk_transform` job runs in the worker; the user sees a `bulk-job-progress` widget that fills in live as batches commit; the chat thread is locked from new input while the job runs; on terminal, a template-driven assistant message lands in the conversation with the job summary (plus a failure-table block when applicable). Smoke A — 100k parcels × `ST_Area(geometry::geography) / 4047 AS acreage` — passes end-to-end.**

Discovery: `docs/LARGE_DATA_OPS.discovery.md`. Phase 1: `docs/LARGE_DATA_OPS_PHASE_1.spec.md` (the wire contracts this phase consumes). Issue: [#85](https://github.com/EnterpriseBT/portal-ai/issues/85).

## Scope

### In scope

1. **Bulk-transform processor** (`apps/api/src/queues/processors/bulk-transform.processor.ts`). Walks the source entity in batches of `batchSize` (default 1000); for each batch, runs `INSERT INTO target_wide (key, c_<col1>, …) SELECT key, <expression> FROM source_wide … LIMIT <batch> OFFSET <offset> ON CONFLICT (key) DO UPDATE SET …`. After each batch commits, emits a `job:batch` SSE event carrying counters and (when the row payload fits the cap) the committed rows. Honors cancellation: checks the BullMQ job's cancel flag between batches and exits with a `BULK_JOB_CANCELLED` terminal status. Throws `BULK_DISPATCH_TOOL_NOT_FOUND` for any `expression.kind === "tool"` payload (Phase 4 handles).

2. **`bulk_transform_entity_records` tool** (`apps/api/src/tools/bulk-transform-entity-records.tool.ts`). Input schema matches `BulkTransformMetadataSchema` from Phase 1 plus a derived `portalId` (threaded from the calling portal). Pre-flight in the tool's `execute`:
   - Source + target entities exist + belong to the org (via `repo.connectorEntities.findById`).
   - `assertConnectorEntityUnlocked(targetConnectorEntityId)`.
   - Expression kind: `sql` accepted; `tool` rejected with `BULK_DISPATCH_TOOL_NOT_FOUND` until Phase 4.
   - EXPLAIN: assemble the INSERT-SELECT SQL with `LIMIT 1` and run `EXPLAIN`; on PG error reject with `BULK_JOB_EXPRESSION_INVALID` carrying the error in `details.pgError`.
   - Max records: `SELECT count(*) FROM source_wide WHERE … (org scope)`; reject with `BULK_JOB_MAX_RECORDS_EXCEEDED` if > `MAX_BULK_RECORDS`.
   - Enqueue the job via `JobService.enqueue("bulk_transform", metadata)`; persist the `portalId` in the metadata.
   - Return `{ jobId, expectedRecords, estimatedSeconds }`.

3. **Tool registration** in `apps/api/src/services/tools.service.ts`. Inside the existing `entity_management` pack switch, gated on `hasWrite`:
   ```ts
   tools.bulk_transform_entity_records = new BulkTransformEntityRecordsTool().build(
     portalId, stationId, organizationId, userId
   );
   ```
   Tool is added to the same block as `entity_record_create` and siblings. The `portalId` is threaded from the calling portal context (it's already available in the existing portal-service flow that calls `buildAnalyticsTools`).

4. **Per-batch SSE event production**. The processor emits a `job:batch` event per batch commit, conforming to Phase 1's `JobBatchEventSchema`:
   - `recordsProcessed`, `totalRecords`, `batchDurationMs`, `failureCount` always set (failureCount is always 0 in Phase 2 — SQL path commits batches atomically, no per-record failures).
   - `rows` populated when the committed batch's serialized JSON size is ≤ `BATCH_ROW_PAYLOAD_LIMIT` (256 KB).
   - When the batch exceeds the cap: `rows` and `rowIds` both omitted (counters-only event). Phase 3 wires the `rowIds`-based fallback path; Phase 2 explicitly degrades to counters-only for oversized batches.

5. **Portal terminal-message injection** — `apps/api/src/services/portal.service.ts` gains a new static `notifyJobTerminal(portalId, jobId, terminalResult)`. Called by a new worker hook (`apps/api/src/queues/jobs.worker.ts` extension) when a `bulk_transform` job reaches terminal status. Persists a synthetic assistant-role message in `portal_messages` with:
   - A short text summary ("Done — 100,000 records written, 0 failed in 3m 12s.").
   - When `recordsFailed > 0`: a `bulk-failures-table` display block carrying the `partialFailures[]` array + a "retry failed only" affordance.
   - When `status === "cancelled"`: text noting the cancel and the partial count.
   - When `status === "failed"` (the job itself errored, not per-record): the `ApiUserError` envelope as a block.
   
   No agent re-prompt. The assistant message is template-driven and includes the failure-table block where applicable; the user can ask the agent for observations as their next turn. (See § Out of scope for the agent-observations follow-up.)

6. **`bulk-job-progress` display block** (`apps/web/src/components/BulkJobProgressBlock.component.tsx`). The bulk-tool's result block renders this widget. Mounts an SSE subscription to `/api/sse/jobs/:jobId/events` on first render. State machine: `running` → `completed` | `failed` | `cancelled` (driven by job-status events; `job:batch` updates counters + data buffer). Renders:
   - A **view selector** at mount: `histogram` (default — over the most-recently-written column), `bar`, `paginated-table`. Choice persists in the block's `content` so re-mounts keep the same view.
   - The selected view, fed by an in-memory rows buffer that grows per `job:batch` event. Charts call `vega.changeset().insert(rows)`; the paginated table appends to React state.
   - A counter/ETA strip: "12,547 / 100,000 records written · 23 failed · ETA 2m 17s". Hidden ETA after terminal.
   - A `Cancel` button visible while `status === "running"`. Calls `POST /api/jobs/:id/cancel`.
   - `pinnable: false` while `status === "running"`; flips to `pinnable: true` on terminal so the rendered widget is the final pinnable artifact (per the snapshot pin shape today; the live-trace pin work is filed as #92).

7. **Chat-thread input lock** (`apps/web/src/views/Portal.view.tsx` or the equivalent chat-input owner). New hook `usePortalChatLock(portalId)` returns `{ locked: boolean, reason?: string }`. State derives from a query against the running-jobs endpoint added in this phase: `GET /api/portals/:id/running-jobs` returns `{ jobs: { id, type, startedAt, expectedRecords?, recordsProcessed? }[] }`. The hook subscribes to a portal-level SSE channel (`/api/sse/portals/:id/events`, also added in this phase) so unlock fires immediately on the terminal event without polling. The chat input is `disabled` when `locked === true`; tooltip shows "A bulk operation is running — input unlocks when it finishes."

8. **Portal events SSE channel** — new endpoint `GET /api/sse/portals/:id/events` mounted alongside the existing `/api/sse/jobs/:id/events`. Emits:
   - `bulk_job_started` when a `bulk_transform` job tied to this portal starts.
   - `bulk_job_terminal` when one reaches terminal status.
   - Reuses the existing Redis Pub/Sub infrastructure; new channel key `portal:{portalId}:events`.

9. **Smoke A — Acceptance integration test**. New integration test `apps/api/src/__tests__/__integration__/bulk-transform-smoke-a.integration.test.ts`:
   - Seed source entity with 1,000 synthetic parcels (smaller than 100k to keep the test fast; the assertion is shape-correctness, not throughput).
   - Run `bulk_transform_entity_records` end-to-end (tool dispatch → enqueue → processor → terminal).
   - Assert: target entity wide table has 1,000 rows; each row's `c_acreage` matches `ST_Area(geometry::geography) / 4047`; `job:batch` SSE events received include row payloads; terminal SSE event carries the expected `BulkTransformResult`; a terminal assistant message exists in `portal_messages`.
   - Optional manual smoke: run against a real 100k-parcel dataset locally and verify the live widget fills in.

### Out of scope

- **Tool-dispatch expression kind** (`expression.kind === "tool"`). Phase 4 implements the dispatcher, the `bulkDispatch` metadata on `ToolpackTool`, the cost-acknowledgement gate, and the per-record failure path. Phase 2's processor returns `BULK_DISPATCH_TOOL_NOT_FOUND` for the `tool` kind.
- **`rowIds` SSE event payload + per-entity row fetch endpoint.** When a batch's row payload exceeds the cap, Phase 2 emits a counters-only event. Phase 3 (which has the query-handle infrastructure) wires the proper row-id fallback alongside its read-side endpoints.
- **Reads track.** `sql_query` / `visualize` / `visualize_tree` rewrite, query-handle endpoints, sampling, statement_timeout, Vega-Lite spec rewrite — all Phase 3.
- **Agent re-prompt with observations** on the bulk-job result. Phase 2 ships a template-driven terminal assistant message; the agent isn't re-invoked to generate prose observations. If a real customer use case demands it, file as a v1.5 follow-up. The chat unlocks on terminal regardless; users can ask the agent for observations as a normal next turn.
- **PostGIS bootstrap.** Smoke A's `ST_Area` expression assumes PostGIS is loaded. If the local PG instance doesn't have it, the smoke degrades to a simpler arithmetic expression (`assessed_value / 1000 AS assessed_k`). Phase 2 doesn't ship PostGIS; that's an infra concern.
- **Audit / provenance on bulk-written rows.** Discovery's open question 1 (wide-table direct INSERT bypasses entity-records provenance). Phase 2 takes the simpler direct-INSERT path; the audit follow-up is deferred.

## Concept changes

### Bulk-transform processor mechanics

Per-batch transaction shape:

```sql
BEGIN;
INSERT INTO "er__{target}" (record_id, c_{key_field}, c_{col1}, c_{col2}, …, _portal_origin, _last_written_by_job_id)
SELECT
  gen_random_uuid() AS record_id,
  c_{key_field},
  {expression} AS c_{col1},
  …
FROM "er__{source}"
WHERE deleted IS NULL AND organization_id = '{org_id}'
ORDER BY record_id
LIMIT {batch_size}
OFFSET {offset}
ON CONFLICT (record_id) DO UPDATE
  SET c_{col1} = EXCLUDED.c_{col1},
      _last_written_by_job_id = EXCLUDED._last_written_by_job_id;
COMMIT;
```

(Schema-binding details — actual column names, RETURNING for SSE rows, etc. — locked at implementation time.)

Cancellation is checked between batches via `bullJob.isFailed()` and `bullJob.token` per BullMQ's cancel mechanism (same pattern as the existing `connector_sync` processor). If cancelled, the processor commits whatever's already in-flight and exits with `status: "cancelled"`; committed batches stay (idempotent re-run).

### Row payload selection per batch

After `INSERT … RETURNING record_id, c_<col1>, …`, the processor has the committed rows in memory. Selection:

```ts
const serialized = JSON.stringify(rows);
const event: JobBatchEvent = {
  _eventType: "batch",
  recordsProcessed,
  totalRecords,
  batchDurationMs,
  failureCount: 0,
  ...(serialized.length <= BATCH_ROW_PAYLOAD_LIMIT ? { rows } : {}),
};
```

When the rows are dropped, the widget continues incrementing counters but can't grow its chart for that batch. Phase 3 adds `rowIds` fallback.

### Tool input + pre-flight order

Pre-flight checks run in order; first failure short-circuits with the typed `ApiError`:

```
1. Source + target exist + org-scoped         → ENTITY_NOT_FOUND or BULK_JOB_TARGET_LOCKED
2. assertConnectorEntityUnlocked(targetId)    → BULK_JOB_TARGET_LOCKED
3. expression.kind === "sql"                  → BULK_DISPATCH_TOOL_NOT_FOUND (Phase 4 handles "tool")
4. EXPLAIN INSERT … LIMIT 1                   → BULK_JOB_EXPRESSION_INVALID
5. SELECT count(*) FROM source ≤ MAX          → BULK_JOB_MAX_RECORDS_EXCEEDED
6. Enqueue + return jobId
```

Each error path populates `recommendation` from Phase 1's `ApiCodeDefaultRecommendation` map (or overrides per call with context-specific copy).

### Tool result shape

```ts
{
  jobId: string,
  expectedRecords: number,
  estimatedSeconds: number,
  message: string,  // "Importing 100,000 parcels. ETA 3m 12s."
  blockKind: "bulk-job-progress",
  blockContent: {
    jobId,
    expectedRecords,
    viewKind: "histogram",       // default; widget honors if set
    columnRef: "<derived>",      // most-recently-written column from the expression
  }
}
```

The `resolveDisplayBlock` function (already in `portal.service.ts:156+`) extends to recognize `toolName === "bulk_transform_entity_records"` and return `{ block: { type: "bulk-job-progress", content: <blockContent> } }`.

### Portal terminal-message injection

New static on `PortalService`:

```ts
static async notifyJobTerminal(
  portalId: string,
  jobId: string,
  terminalResult: BulkTransformResult & { status: "completed" | "failed" | "cancelled" }
): Promise<void>;
```

Implementation:
1. Build the assistant-message blocks:
   - A `text` block: template summary string per status.
   - When `recordsFailed > 0`: a `bulk-failures-table` block with `content: { jobId, failures: terminalResult.partialFailures }`.
   - When `status === "failed"`: an `error-envelope` block with the `ApiUserError`.
2. Persist via `repo.portalMessages.create({ portalId, role: "assistant", blocks: [...] })`.
3. Publish to the portal-events SSE channel (`portal:{portalId}:events`) so live clients see the terminal event.

The worker hook calls this after the bulk-transform processor returns. New file `apps/api/src/queues/hooks/bulk-transform-terminal.hook.ts` registered into the worker's terminal-status path (mirroring how the existing `connector_sync` already handles post-terminal work).

### Frontend `bulk-job-progress` widget

Block content shape:

```ts
interface BulkJobProgressContent {
  jobId: string;
  expectedRecords: number;
  viewKind: "histogram" | "bar" | "paginated-table";
  columnRef?: string;
}
```

Widget mounts → opens SSE connection → renders the view-selector chip group + the current view + the counter strip + the cancel button. On `job:batch`: counters update; rows (when present) feed the active view via `vega.changeset` or React state. On `job:completed` / `job:failed` / `job:cancelled`: status transitions; cancel button disappears; pinnable flips on; SSE channel closes.

State managed in a `useReducer` so the per-batch update is one dispatch per event. Vega view is constructed once at mount; subsequent updates use `view.change('primary', changeset).run()`.

### Chat-input lock

Hook signature:

```ts
function usePortalChatLock(portalId: string): {
  locked: boolean;
  reason?: string;
  runningJobs: Array<{ id: string; type: string; startedAt: number; expectedRecords?: number }>;
};
```

Implementation:
1. Initial query via `useAuthQuery(queryKeys.portals.runningJobs(portalId), …)` — hits `/api/portals/:id/running-jobs`.
2. SSE subscription to `/api/sse/portals/:id/events` — on `bulk_job_started` / `bulk_job_terminal`, invalidate the query.
3. `locked === runningJobs.length > 0`.

Chat input owner reads the hook; disables its submit affordance when locked.

## Surface

### `apps/api/src/queues/processors/bulk-transform.processor.ts` (new)

Processor function exported per the existing pattern (see `connector-sync.processor.ts` as the reference). Receives the BullMQ job, parses metadata via `BulkTransformMetadataSchema`, loops batches, emits SSE events, returns `BulkTransformResult` on completion.

### `apps/api/src/queues/processors/index.ts` (edit)

Add `bulk_transform: bulkTransformProcessor` to the `processors` map.

### `apps/api/src/queues/hooks/bulk-transform-terminal.hook.ts` (new)

Worker hook fired after a `bulk_transform` job reaches terminal status. Calls `PortalService.notifyJobTerminal`.

### `apps/api/src/queues/jobs.worker.ts` (edit)

Register the terminal hook into the worker's terminal-status path. New `terminalHooks: Record<JobType, (job, result) => Promise<void>>` map (or extend the existing pattern).

### `apps/api/src/tools/bulk-transform-entity-records.tool.ts` (new)

`BulkTransformEntityRecordsTool` class. `build(portalId, stationId, organizationId, userId)` returns the Vercel AI SDK tool with the input schema + the pre-flight + enqueue execute.

### `apps/api/src/services/tools.service.ts` (edit)

Inside `entity_management` pack + `hasWrite`, register the new tool. Thread `portalId` through `buildAnalyticsTools` (new argument) and through the `PortalService.streamResponse` caller.

### `apps/api/src/services/portal.service.ts` (edit)

- New `notifyJobTerminal` static method.
- `resolveDisplayBlock` recognizes the new tool name and returns the `bulk-job-progress` block.
- Update the existing `buildAnalyticsTools` call site to pass `portalId`.

### `apps/api/src/routes/portals.router.ts` (edit)

- New `GET /api/portals/:id/running-jobs` route.

### `apps/api/src/routes/portal-events.router.ts` (edit) or new sibling

- New `GET /api/sse/portals/:id/events` route (alongside the existing `/api/sse/portals/:id` if it exists). Subscribes to Redis Pub/Sub channel `portal:{id}:events`.

### `apps/api/src/db/repositories/jobs.repository.ts` (edit)

- New `countRunningByPortalId(portalId)` and `findRunningByPortalId(portalId)` methods. Query: non-terminal jobs where `metadata->>'portalId' = $1`.

### `apps/web/src/components/BulkJobProgressBlock.component.tsx` (new)

The display-block widget. Imports vega-embed, the existing SSE subscription utility, the SDK's `useAuthMutation` for cancel.

### `apps/web/src/components/BulkFailuresTableBlock.component.tsx` (new)

Renders the paginated failure list at terminal time. Used in the assistant message when `recordsFailed > 0`.

### `apps/web/src/hooks/usePortalChatLock.util.ts` (new)

The hook described above.

### `apps/web/src/views/Portal.view.tsx` (edit)

- Call `usePortalChatLock(portalId)`.
- Pass `locked` to the chat input owner; disable submit on `locked === true`.

### `apps/web/src/api/portals.api.ts` (edit)

- Add `runningJobs: useAuthQuery(...)` SDK helper.
- Add `cancelJob: useAuthMutation(...)` if not already present.

### `apps/web/src/components/DisplayBlock.component.tsx` (or wherever the block registry lives, edit)

- Register `bulk-job-progress` → `BulkJobProgressBlock` and `bulk-failures-table` → `BulkFailuresTableBlock`.

## Tests

### Unit — processor

1. **Processes a 3-batch SQL job and emits 3 `job:batch` events** with correct counters.
2. **Emits committed rows when batch size fits the cap.**
3. **Drops rows from the event when serialized payload exceeds `BATCH_ROW_PAYLOAD_LIMIT`.**
4. **Honors cancellation between batches** — when the cancel flag is set, returns with `status: "cancelled"` and `recordsProcessed` reflects committed-only batches.
5. **Throws `BULK_DISPATCH_TOOL_NOT_FOUND` for `expression.kind === "tool"`.**

### Unit — tool

6. **Pre-flight rejects unknown target entity** (`ENTITY_NOT_FOUND`).
7. **Pre-flight rejects locked target** (`BULK_JOB_TARGET_LOCKED` with `details.lockingJobId` populated).
8. **Pre-flight rejects invalid expression** (`BULK_JOB_EXPRESSION_INVALID` with PG error in details).
9. **Pre-flight rejects record count past `MAX_BULK_RECORDS`.**
10. **Pre-flight rejects `expression.kind === "tool"`** until Phase 4.
11. **Happy path enqueues the job** with metadata including `portalId`; returns `{ jobId, expectedRecords, estimatedSeconds }`.

### Unit — `PortalService.notifyJobTerminal`

12. **Persists a template assistant message** with text summary + status code on `status: "completed"`.
13. **Includes a `bulk-failures-table` block** when `recordsFailed > 0`.
14. **Includes an `error-envelope` block** when `status: "failed"`.
15. **Publishes a `bulk_job_terminal` SSE event** to the portal-events channel.

### Unit — `resolveDisplayBlock`

16. **Returns a `bulk-job-progress` block** for `toolName === "bulk_transform_entity_records"`.

### Unit — `usePortalChatLock` (web)

17. **`locked === false` when no running jobs.**
18. **`locked === true` when the running-jobs query returns ≥1 job.**
19. **Refetches on `bulk_job_started` SSE event.**
20. **Refetches on `bulk_job_terminal` SSE event.**

### Unit — `BulkJobProgressBlock` (web)

21. **Mounts an SSE subscription on first render.**
22. **Updates counters on each `job:batch` event.**
23. **Appends rows to the active view's data buffer when `rows` present.**
24. **Counter still updates when `rows` absent** (oversized batch).
25. **Status transitions on `job:completed` / `:failed` / `:cancelled`.**
26. **Cancel button POSTs to `/api/jobs/:id/cancel`** and disables itself.
27. **`pinnable: false` while running; `pinnable: true` on terminal.**

### Integration — end-to-end

28. **Smoke A**: 1,000-record SQL transform completes, target wide table has the expected rows, SSE events fire, terminal message is persisted. See § In scope item 9.
29. **Concurrent lock conflict**: launching a second `bulk_transform` against the same target rejects with `BULK_JOB_TARGET_LOCKED`.
30. **Source-deleted-mid-job**: deleting a source record mid-job doesn't crash the processor (per-batch consistency is acceptable; document the behavior).

## Acceptance criteria

- [ ] Processor implemented and registered; passes unit tests 1–5.
- [ ] Tool implemented and registered; passes unit tests 6–11.
- [ ] `notifyJobTerminal` persists assistant messages + publishes SSE; passes tests 12–15.
- [ ] `resolveDisplayBlock` recognizes the new tool; test 16 passes.
- [ ] `usePortalChatLock` works end-to-end against a real SSE channel; tests 17–20 pass.
- [ ] `BulkJobProgressBlock` renders all three view kinds; tests 21–27 pass.
- [ ] Smoke A integration test (case 28) passes against a seeded source entity.
- [ ] `npm run type-check` clean.
- [ ] `npm run test:unit --workspace=apps/api` and `--workspace=apps/web` green.
- [ ] `npm run test:integration --workspace=apps/api` green.
- [ ] Manual smoke: open a portal, dispatch `bulk_transform_entity_records` on a 1,000-row source; observe the widget fill in live, chat input locks, terminal message lands, chat unlocks.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| BullMQ cancel mechanism doesn't fire promptly mid-batch. | Processor checks cancel between batches, not within. A batch in flight runs to completion (~1s for 1000 rows); cancel fires on the next batch boundary. Acceptable. |
| `ST_Area` expression assumes PostGIS extension. | Smoke A degrades to a non-PostGIS arithmetic expression if not loaded locally; spec doesn't ship PostGIS. |
| Row-payload cap routinely trips on entities with wide JSONB rows. | Phase 3 wires the `rowIds` fallback. In the interim, the widget's counter stays accurate; the visible chart undercounts batches that overflowed. Acceptable for v1; flagged in discovery open question 8. |
| Portal-events SSE channel scales poorly under many concurrent portals. | Channel-per-portal keys with Redis Pub/Sub; the existing job-events infrastructure handles this pattern at scale. |
| Worker hook fires twice for retried jobs. | Hook idempotency: it persists a message keyed by `(portalId, jobId)`; second invocation no-ops via `ON CONFLICT DO NOTHING` on a unique index. |
| `notifyJobTerminal` race vs. an in-flight `streamResponse` for the same portal. | The portal-message persistence is serializable per portal; the terminal message lands after any in-flight assistant message. Worst case the user sees the terminal message above an in-progress agent stream — acceptable, and exceedingly rare since chat is locked. |

**Rollback**: revert the merge commit. The new processor, tool, and frontend assets are gone; existing flows untouched. Jobs in flight at rollback time: their result rows are already in the target wide table (idempotent), no cleanup needed; the bulk-transform processor goes missing so any retry fails with "No processor registered for job type: bulk_transform" — operator manually cancels the orphaned jobs via the existing job-cancel route. No DB migration to undo.

## Cross-references

- `docs/LARGE_DATA_OPS.discovery.md` — § Smoke A walkthrough, § Recommendation > Writes track.
- `docs/LARGE_DATA_OPS_PHASE_1.spec.md` — the contracts this phase consumes.
- `apps/api/src/queues/processors/connector-sync.processor.ts` — reference processor with cancel-flag pattern.
- `apps/api/src/queues/processors/index.ts` — processor registration.
- `apps/api/src/services/tools.service.ts` — tool-registration site (lines 419+ for `entity_management` + `hasWrite`).
- `apps/api/src/services/portal.service.ts:156` — `resolveDisplayBlock` extension point.
- `apps/api/src/routes/job-events.router.ts` — existing per-job SSE channel (model for the new portal-events channel).
- `CLAUDE.md` § Async Job State & Data Locking — entity-locking convention.
