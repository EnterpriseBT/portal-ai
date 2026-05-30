# Bulk writes & edits during a portal session — Discovery

**Issue:** [EnterpriseBT/portal-ai#85](https://github.com/EnterpriseBT/portal-ai/issues/85)

**Why this exists.** Agent-driven tools today (`entity_record_create`, `entity_record_update`, `entity_record_delete`) cap at **100 items per call** and run entirely inside the tool's HTTP roundtrip — normalization, transaction, wide-table mirror, all synchronous. The motivating case can't even be expressed in the current shape: *user has 100k parcels and asks the agent to "compute acreage for each and store the result in a join table."* The agent can't emit 100k records inline (LLM token budget), couldn't if it tried (Zod cap of 100), and even with the cap lifted the synchronous path would lock a portal tool roundtrip for the entire write duration.

The infrastructure to do better already exists: BullMQ workers, 4 existing job types, SSE-driven progress, the data-locking convention. What's missing is the bridge from the agent's tool-call surface to that async pipeline. This doc proposes that bridge, then names the new tool, new job type, and new SSE event shape needed to ship it. **This is the discovery that does X-Y-Z: profile where the bottleneck actually sits, choose between three tool-surface shapes, and walk the acreage smoke target end-to-end.**

## The current shape

### Synchronous bulk surface

| Concern | Where | What it does |
|---|---|---|
| Tool cap | `apps/api/src/tools/entity-record-create.tool.ts:36-42`, `entity-record-update.tool.ts:27-33`, `entity-record-delete.tool.ts:20-26` | Zod `.max(100)` on `items` — agent **cannot** emit more than 100 per call |
| Transaction | `entity-record-create.tool.ts:145-186` | Single `Repository.transaction()` wraps inserts + wide-table mirror; partial failure rolls everything back |
| Normalization | `apps/api/src/services/normalization.service.ts:54-66` (`normalizeMany`) | Field mappings loaded once per entity, applied per record; 8-step pipeline (extract → default → required → coerce → validate → canonicalize → store) |
| Wide-table mirror | `entity-record-create.tool.ts:164-184` | Grouped per entity, statement cache via `wideTableStatementCache` to avoid re-querying schema; skips if no live columns yet (reconciler hasn't run) |
| Failure mode | Transactional rollback | Either all 100 land or none — no partial-success orphans, but also no way to "resume from record 50" if the call dies |

The cap is the load-bearing piece. Lifting it without changing the execution model would let the agent kill a portal tool roundtrip; we need to switch from sync-tool to async-job.

### Async job infrastructure (already shipped, ready to extend)

| Concern | Where | What it does |
|---|---|---|
| Worker | `apps/api/src/queues/jobs.worker.ts:76-135` | BullMQ worker, dispatches to a typed processor registry by `job.data.type` |
| Progress | `jobs.worker.ts:119-124` (`updateProgress`) | Aggregate percentage only — forwards `bullJob.updateProgress(percent)` to `JobEventsService` → Redis Pub/Sub → SSE |
| Terminal | `jobs.worker.ts:93-102` | On return: status `completed`, `progress: 100`, processor return value as `result`. On throw: status `failed`, error message walks the cause chain for root Postgres detail |
| Cancellation | BullMQ's standard job-removal flow | No explicit cancel processor today — the BullMQ removal is the contract |
| Job types | `packages/core/src/models/job.model.ts:35-41` | `system_check`, `revalidation`, `connector_sync`, `file_upload_parse`, `layout_plan_commit` |
| Adding a JobType | `job.model.ts:240-287` | 3-step compile-time-checked pattern: enum entry + `<Type>MetadataSchema` + `<Type>ResultSchema` + `JobTypeMap` interface entry. TS errors if `JOB_TYPE_SCHEMAS` registry is incomplete |
| SSE | `apps/api/src/routes/job-events.router.ts:54-136` | `/api/sse/jobs/:id/events` — snapshot on connect, then update events; auto-closes on terminal status. Supports custom event types (`_eventType: "X"` → `job:X` SSE event) |
| Entity lock | `apps/api/src/services/job-lock.service.ts:80-95` (`assertConnectorInstanceUnlocked`) | Throws 409 `ENTITY_LOCKED_BY_JOB` with a `RunningJobSummary[]` if any non-terminal job targets the entity. Routes call this before mutations. Org-scoped; releases automatically on terminal status |
| Portal tool-call wiring | `apps/api/src/services/portal.service.ts:99-142` (`handleToolCall` / `handleToolResult`) | Vercel AI SDK `streamText()` loop. `resolveDisplayBlock()` can emit SSE events tied to tool results — this is the seam for "tool result is a job-handle widget" |

**The critical observation:** the existing `resolveDisplayBlock()` path already supports surfacing side-channel UI from a tool result. A bulk job's tool returns `{ jobId, … }` immediately; the display-block resolver emits an SSE event keyed to that jobId; the UI subscribes and fills in progress as batches commit. Zero new "tool returned but work still running" mechanism needed — the affordance already exists for chart-like display blocks.

## Profiling: where's the actual bottleneck?

The investigation ticket asked the question and I didn't run the workbench. Reasoning from the surfaces above + ticket numbers in mind:

- **Inline-array cap at 100 is the hard wall.** Independent of any LLM budget — the agent can't even *try* to emit 1000 records.
- **LLM token budget.** Output tokens for an array of 100 records (typical parcel shape, ~200 chars per record) ≈ 5k tokens — already near the practical agent-response cap. Lifting the Zod cap to, say, 1000 would put us at ~50k output tokens for one tool call, which is fine for Sonnet but wasteful (the agent is paying tokens to *enumerate* what's already in the DB).
- **HTTP timeout.** Vercel-style portal pipeline likely caps tool-call response time at 30–120s. Synchronous `createMany(10000)` + wide-table mirror + normalization at typical field-mapping cardinality is comfortably under 30s on dev hardware (`createMany` and the mirror are both batched), but 100k crosses the line.
- **DB transaction cost.** A 100k-row insert in one transaction holds locks and bloats the WAL; probably still completes in <60s but starves other writes during the window. Splitting into batches of ~1000 with per-batch transactions is the right shape regardless.
- **Wide-table mirror.** Per-record cost is dominated by the `projectToWideRow` projection (column lookup) — amortized by the statement cache. Not the bottleneck.

The dominant constraint is the agent's inability to express the operation, not the DB's inability to do it. Both fixes naturally land in the same place: **agent describes the operation declaratively, server executes it in batches.**

(Spike deferred. The acreage smoke target is a fine vehicle for actual numbers once we're implementing; for the design choice the qualitative picture is enough.)

## The design space

### Decision 1 — Tool-surface shape

How does the agent express "do X to every record in entity Y"?

- **A. Declarative bulk tool.** `bulk_transform_entity_records(sourceEntityId, targetEntityId, expression, keyField, batchSize?)`. The agent says *what*, the server iterates. Expression language is something pure + bounded (lean: SQL projection against the wide table, since it's already there).
- **B. Agent loops over batches.** Smaller `upsert_records_batch` tool, agent calls N times. Stays inside the existing sync surface; just bumps the cap. Falls down at ≥10k records — the agent has to emit too many calls, each carrying conversation context.
- **C. Agent emits a small program.** Like A but with a Turing-complete expression language (sandboxed JS — the upgrade path called out in the REST API connector discovery, decision 15). More flexible than A; bigger security surface.

| | A (declarative) | B (agent loops) | C (sandboxed JS) |
|---|---|---|---|
| Token cost | O(1) tool calls | O(N) | O(1) |
| Server-side execution model | Batched job worker | Inline tool calls | Sandboxed JS runtime |
| Security surface | Bounded by expression language | Already exists | Significant — needs `quickjs-emscripten` or `isolated-vm` |
| Acreage smoke target fits | ✅ — pure projection (`ST_Area(geometry) * conversion_factor`) | ✅ but slow | ✅ |
| Hardness floor (next 5 use cases) | Limited to what the expression language can do | Same limits as today × N | Anything |

**Lean: A, with a clean upgrade door to C.** The acreage case is a pure projection; ditto every "compute X from columns and store in Y" use case I can name (centroid from geometry, normalized address from raw, derived columns from a join, etc.). The expression language is SQL projection against the existing wide table — it's already there, the agent already uses it via the `sql_query` tool, and the result is a typed records array we know how to upsert. C stays on the shelf until use cases force it (matches the existing "sandboxed JS is gated, not free" stance from the REST API connector discovery).

### Decision 2 — Job lock granularity

What's locked while a bulk job runs?

- **A. Target entity only** (writes blocked on target, reads OK, source untouched).
- **B. Both source and target** entities locked.
- **C. The connector instance** containing target (broader; matches today's `assertConnectorInstanceUnlocked`).

**Lean: A.** Bulk transform reads the source as a snapshot at job-enqueue time; we don't need to prevent concurrent edits to the source while the job runs (the result is "snapshot-as-of-T," documented). Target needs the write lock because the bulk job is going to overwrite records there. Reads on either side stay open so the user can keep using the portal while the job runs (modulo seeing stale data on target). `job-lock.service.ts` currently has `assertConnectorInstanceUnlocked` — we'll need a sibling `assertConnectorEntityUnlocked` that checks for a more specific entity id rather than instance id.

### Decision 3 — Cancellation semantics

- **A. Stop-at-batch-boundary** — set a "cancel requested" flag, current batch finishes, no new batches. Already-committed batches stay.
- **B. Hard kill mid-batch** — kill the BullMQ job. Partial-batch state is whatever the DB transaction left.
- **C. Compensating delete** — on cancel, roll back already-committed records (delete what the job inserted).

**Lean: A.** Hard kill (B) is operationally messy — half-committed batches are recoverable via idempotent upsert but you'd have to know to retry. Compensating delete (C) is double the work for the user (now they're waiting on the cleanup) and requires tracking job-inserted ids separately. Stop-at-batch-boundary is the simplest contract: *"cancelled jobs leave the partial result in place; re-running an idempotent operation converges."* Surface the partial-completion stats (`recordsProcessed` of `totalRecords`) in the terminal SSE payload so the agent / user can decide what to do.

### Decision 4 — Resumability

- **A. Idempotent-by-key.** Every supported operation upserts on `keyField`. "Resume" == re-run; second run is a no-op for records already done. Requires the agent / user to be told that's the contract.
- **B. Durable checkpoint.** Job persists `lastProcessedKey` per batch; resume picks up where it stopped.

**Lean: A.** Matches stop-at-batch-boundary cancellation perfectly. The cost of `B` (durable checkpoint, recovery code, edge cases around source data changing between attempts) doesn't pay for itself when `A` covers every upsert-shaped operation we have. Document that the supported operation shape is "upsert keyed by `keyField`"; reject jobs that don't fit (rare — record-create / update operations all key on `source_id` or `id` naturally).

### Decision 5 — UI surface

How does the portal communicate progress?

- **A. Tool-result widget that fills in.** Agent's tool call returns `{ jobId, expectedRecords, ... }`; widget renders that initial state + subscribes to SSE; updates progress in place.
- **B. Sidecar "running operations" panel** outside the message thread.
- **C. System-level messages** injected into the portal-message timeline as new entries per progress milestone.

**Lean: A.** The `resolveDisplayBlock()` machinery (`portal.service.ts:120-142`) already supports custom display blocks tied to tool results. Sidecar (B) is a UX concept we don't have today; system-messages (C) clutters the conversation. The widget fills in: shows "0 / 100,000 processed (just enqueued, ETA ~3 min)" initially, becomes "47,000 / 100,000, ETA 1.4 min" as batches commit, becomes "100,000 / 100,000 ✓" on terminal. Cancel button is on the widget. On terminal-failure, the widget shows the error + the partial-completion count.

### Decision 6 — Agent ergonomics after dispatch

When the agent dispatches the bulk job and gets back `{ jobId, expectedRecords, estimatedSeconds }`:

- **A. Agent blocks** until the job finishes (the next turn waits on the SSE terminal event).
- **B. Agent continues** the conversation; portal listens for the SSE terminal and re-prompts the agent with the result on completion.
- **C. Hybrid:** agent gets a synchronous "started" response and decides per-call whether to wait or continue.

**Lean: B (continue + portal-orchestrated follow-up).** Blocking the agent on a 3-minute job is bad UX: the user can't ask anything else, and the agent is sitting on a spinner. Portal-orchestrated re-prompt is cleaner than agent-managed polling. Implementation: on the SSE terminal event for a bulk-job tool result, the portal injects a synthetic system-message back into the agent's context ("The bulk operation completed: 100,000 records written. Continue?") and the agent picks up from there. Until that happens, the agent can answer follow-up questions; the running job is visible to the agent via the conversation history so it knows not to dispatch the same operation twice.

### Decision 7 — Resource limits

- **Max records per job.** Lean: **1,000,000.** Above this, fail at enqueue with a hint to split. Anything in the 1–10M range probably wants a sharded model (out of scope).
- **Batch size.** Lean: **1,000.** Tunable per job. Matches the existing wide-table-mirror batching profile.
- **Concurrent bulk jobs per organization.** Lean: **2.** Bigger DB load can starve other writes; back-pressure (job-queue waiting state) for additional submissions.
- **Per-record cost ceiling.** Lean: do a per-batch wall-clock check and abort if a batch crosses N ms (10× typical?); the diagnostic is that the operation is more expensive than expected and the agent should split it.

### Decision 8 — Where does the per-record compute live?

For the acreage example: `acreage = ST_Area(geometry::geography) / 4047`. Three options for where this expression evaluates:

- **A. SQL projection at the wide table.** `INSERT INTO target SELECT key, ST_Area(geometry::geography) / 4047 FROM source_wide`. Fast, single statement, no marshaling. Requires PostGIS for the spatial case (we've explicitly deferred PostGIS in #84).
- **B. Server-side per-record tool dispatch.** The job iterates records, calls a tool function (`compute_area`) per record (or per batch), upserts results. Slower (round-trip per batch), but works without PostGIS and lets the agent compose any registered tool inside the bulk job.
- **C. Bulk job loads source, computes in-process, upserts.** Same as B but no tool dispatch — the bulk job is just "select-transform-upsert" with a typed transform function.

**Lean: A for SQL-expressible operations; B as the escape hatch.** Decision 1's "expression language is SQL projection" makes A the obvious primary path. The acreage smoke target works fine in A *if* we have PostGIS — without it, B (calling the future `compute_area` tool from #84 per record) is the fallback. Document that the bulk tool's `expression` field accepts either:

1. **A SQL expression** evaluated in PostgreSQL — fastest, requires SQL-expressible operations.
2. **A registered tool reference** (`@tool:compute_area`) — invoked per record / per batch, slowest but most flexible.

The first version of the bulk tool ships with both expression types; the agent picks the right one for the operation.

## Tradeoff comparison

| | Tool surface | Lock granularity | Cancellation | Resumability | UI | Agent ergonomics | Per-record compute |
|---|---|---|---|---|---|---|---|
| Lean | A — declarative | A — target entity only | A — stop at batch | A — idempotent re-run | A — widget fills in | B — continue + follow-up | A primary + B fallback |
| Spreads to spec | Yes | Yes | Yes | Yes | Yes | Yes | Yes |

Every lean composes cleanly with the next. No regret loops between decisions.

## Smoke walkthrough (the acreage case end-to-end)

1. User: *"For every parcel in the SaltLake_LIR_Parcels entity, compute its acreage from the geometry column and store the result in a parcel_metrics entity keyed by parcel id."*
2. Agent recognizes high cardinality (it can `sql_query` for `count(*)` first if it wants to confirm) and dispatches:
   ```
   bulk_transform_entity_records(
     sourceEntityId: "ce-parcels-…",
     targetEntityId: "ce-parcel-metrics-…",
     expression: { kind: "sql", value: "ST_Area(geometry::geography) / 4047 AS acreage" },
     keyField: "parcel_id",
     batchSize: 1000
   )
   ```
3. The tool route:
   - Validates the source + target entities (org-scoped, exist, target writeable).
   - Calls `JobLockService.assertConnectorEntityUnlocked(targetEntityId)` (new sibling of the existing `assertConnectorInstanceUnlocked`).
   - Validates the SQL expression by EXPLAIN-ing it against the source wide table (no execution; just schema check).
   - Enqueues a `bulk_transform` BullMQ job with metadata `{ organizationId, userId, sourceEntityId, targetEntityId, expression, keyField, batchSize, totalRecords }`.
   - Returns to the agent: `{ jobId, expectedRecords: 100000, estimatedSeconds: 180 }`.
4. The agent's response renders as a portal message with a "bulk-job-progress" display block tied to the jobId.
5. The frontend opens an SSE subscription to `/api/sse/jobs/<id>/events`. The widget renders "0 / 100,000 — starting…".
6. The job worker dispatches to `bulkTransformProcessor`. It runs the expression as an `INSERT INTO target_wide SELECT … FROM source_wide LIMIT batchSize OFFSET N` per batch, emitting a custom SSE event `{ _eventType: "batch", recordsProcessed: N, totalRecords: 100000 }` after each commit. The widget updates in-place.
7. On terminal `completed`, the SSE result payload carries `{ recordsProcessed: 100000, recordsFailed: 0, durationMs: 167000 }`. The widget renders "100,000 / 100,000 ✓ Completed in 2m 47s." Target entity is unlocked; the portal injects a synthetic message back into the agent's context ("Bulk transform completed: 100,000 records written to parcel_metrics. Continue?") and the agent picks up from there.
8. If the user clicks Cancel mid-job, the worker's per-batch loop sees the cancel flag (via BullMQ job's stalled/cancelled state), stops accepting new batches, and finishes the in-flight one. Terminal status is `cancelled` with `{ recordsProcessed: 47000, recordsFailed: 0, durationMs: 79000 }`. The widget renders "Cancelled at 47,000 / 100,000."

## Recommendation

1. **New tool:** `bulk_transform_entity_records` in a new toolpack (or within `entity_management`). Parameters: `sourceEntityId, targetEntityId, expression, keyField, batchSize?`. Expression is a discriminated union of `{ kind: "sql", value: string }` and `{ kind: "tool", ref: string }`. v1 supports `"sql"` only; `"tool"` lands in a follow-up once the per-record-tool-dispatch path is wired.
2. **New JobType:** `bulk_transform`. Metadata schema declares `targetEntityId` as the locked entity; result schema carries `recordsProcessed`, `recordsFailed`, `durationMs`, `partialFailures: { sourceKey, error }[]`.
3. **New processor:** `apps/api/src/queues/processors/bulk-transform.processor.ts`. Drives the batched INSERT/UPSERT loop, emits per-batch custom SSE events, honors the cancel flag, returns the result payload on terminal.
4. **New SSE event shape:** `{ _eventType: "batch", recordsProcessed, totalRecords, batchDurationMs }`. Maps to `job:batch` on the SSE channel.
5. **New lock primitive:** `JobLockService.assertConnectorEntityUnlocked(entityId)` — sibling of the existing instance-level check; queries `jobs.findRunningForConnectorEntity()` (new repository method).
6. **New display block:** `bulk-job-progress` rendered by a new `apps/web/src/components/BulkJobProgressBlock.component.tsx`. Subscribes to the SSE stream by `jobId` carried in the tool result. Renders progress bar + cancel button + terminal state.
7. **Portal follow-up injection:** when an SSE terminal event arrives for a bulk-job tool result, `portal.service.ts` injects a synthetic system message into the agent's context. New helper in `portal.service.ts`; existing infrastructure for context modification (already used by `connector_sync`?) is the model.
8. **Resource limits:** `MAX_BULK_RECORDS = 1_000_000`, `DEFAULT_BULK_BATCH = 1000`, `MAX_CONCURRENT_BULK_PER_ORG = 2`. Limits enforced at the enqueue route; configurable per org down the line if needed.

## Open questions (deferred to implementation)

1. **How does the agent know whether the SQL expression is safe?** EXPLAIN-against-the-wide-table validation at enqueue is a good first pass, but it doesn't catch every "this expression will spin for hours" case. Lean: per-batch wall-clock cap (Decision 7's "per-record cost ceiling") as the backstop. Implementation question: where exactly does the timeout sit — `statement_timeout` on the transaction, or a JS-level wall-clock?
2. **What happens if the source entity is itself being mutated by another (non-bulk) job mid-run?** Probably the bulk job sees a snapshot at each batch boundary (since we read `LIMIT/OFFSET` per batch from the live wide table). Document the "snapshot is per-batch, not global" contract; if the user wants global snapshot semantics they need to make the source read-only via the lock pattern. Worth a fresh look in implementation.
3. **Wide-table mirror vs. entity-record table.** v1's "expression: SQL" path INSERTs directly into the target's wide table. But the target's `entity_records` table is the canonical store, and the wide table is its projection (per the reconciler). Direct wide-table writes bypass the entity-record provenance. Decision: do we (a) write to entity-records first then let the reconciler mirror, or (b) write to both atomically per batch, or (c) write to wide-only and document the divergence. Lean (c) is fastest but bypasses normalization. Lean (a) is canonical. Pick during implementation — the answer probably depends on how the agent later wants to query / audit the result.
4. **Per-record-tool-dispatch (`expression: { kind: "tool", ref: "compute_area" }`).** Out of scope for v1 but the contract has to leave room for it. Implementation question: does the tool execute server-side in-process (sync function), or as a sub-job per batch? Latter is more general but adds 1 layer of indirection per batch.
5. **Quota / billing.** A 1M-record bulk job is real compute. Per-org budgets / accounting are presumably part of the GTM story; out of scope here but flag it.

## What this doesn't decide

- **PostGIS** — staying in JSONB for geometry (per #84). The acreage SQL in the smoke walkthrough assumes PostGIS exists; if it doesn't yet, the smoke target uses the `"tool"` expression kind (deferred) or computes acreage from raw `coordinates` in plain SQL (uglier). Either way, the bulk-job mechanism is orthogonal.
- **Sandboxed JS** (option C from Decision 1) — gated, deferred. Re-evaluate when ≥3 use cases surface that A can't express.
- **Distributed sharding** — single worker pool in v1.
- **Streaming the *result* back to the agent** — agent gets the terminal payload; the *user* sees per-batch progress via the UI. No record-by-record streaming to the LLM (would be a token nightmare).
- **Quota / billing** — flagged in open question 5; not designed here.

## Next step

Spec at `docs/BULK_WRITES.spec.md` codifies the wire contracts: `BulkTransformToolSchema`, `BulkTransformMetadataSchema`, `BulkTransformResultSchema`, the new SSE event type, the lock-primitive contract. Plan at `docs/BULK_WRITES.plan.md` slices the work, roughly: (1) JobType + schemas + lock primitive, (2) processor + cancel-flag handling, (3) tool + EXPLAIN validation, (4) SSE event shape + per-batch emission, (5) display block + cancel button + portal follow-up injection, (6) end-to-end smoke against the acreage target. ~6 slices; no DB migrations beyond schema definitions, no breaking changes to existing contracts.
