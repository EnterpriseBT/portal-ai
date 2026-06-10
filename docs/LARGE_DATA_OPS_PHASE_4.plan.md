# Large data operations — Phase 4: Writes via per-record tool dispatch — Plan

**TDD-sequenced implementation of `docs/LARGE_DATA_OPS_PHASE_4.spec.md`. Six slices, each behind a green test suite, each landing as one commit. Slicing flows backend → tool pre-flight → frontend → smoke: dispatcher first (slice 0), processor branch + tool helper (slice 1), tool route pre-flight extensions (slice 2), frontend failures-table + retry surface (slice 3), Smoke C (slice 4), and `sourceFilter` + retry-flow integration (slice 5). Closes #85.**

Spec: `docs/LARGE_DATA_OPS_PHASE_4.spec.md`. Phase 1: shared contracts. Phase 2: bulk-transform tool + processor + display block this phase extends. Issue: [#85](https://github.com/EnterpriseBT/portal-ai/issues/85).

Run tests with:

```bash
# package gates
npm run test:unit --workspace=apps/api
npm run test:integration --workspace=apps/api
npm run test:unit --workspace=apps/web

# repo gates
npm run lint
npm run type-check
```

Each slice loop:

1. Write all failing tests for the slice's new behavior.
2. Confirm red.
3. Implement the smallest change that makes them pass.
4. Confirm green.
5. Run the full unit suite (and integration suite when touched).
6. Lint + type-check at slice boundary.
7. Commit.

---

## Slice 0 — `BulkDispatchMetadata` on `ToolpackTool` + dispatcher

**Why first.** The dispatcher is the load-bearing piece of Phase 4 — everything downstream consumes it. The metadata extension is its companion (the dispatcher needs the metadata at runtime). Both land together because they're tightly coupled and small.

**Files**

- Edit: `packages/core/src/registries/builtin-toolpacks.ts` — add `BulkDispatchMetadata` interface; extend `ToolpackTool` with optional `bulkDispatch?: BulkDispatchMetadata`.
- New: `apps/api/src/queues/processors/bulk-transform-tool.dispatcher.ts` — `dispatchBatch` function.
- New: `apps/api/src/utils/with-timeout.util.ts` (if not present) — `withTimeout(promise, ms)` helper.
- New: `apps/api/src/utils/token-bucket.util.ts` — small token-bucket implementation.
- New: `apps/api/src/__tests__/queues/processors/bulk-transform-tool.dispatcher.test.ts` — cases 3–7.
- New: `apps/api/src/__tests__/utils/token-bucket.util.test.ts` — drift-tolerant rate-limit assertions.

**Steps**

1. **Write the failing dispatcher tests** (cases 3–7). Use small synthetic tools (functions that sleep / throw / return) and `jest.useFakeTimers()` where determinism matters.

2. **Confirm red.** Dispatcher file doesn't exist.

3. **Implement `withTimeout`** if not already present — a small `Promise.race` wrapper rejecting with a typed error.

4. **Implement `tokenBucket`** — a class with `acquire()` that resolves when a token's available; refills at `ratePerSec` per second via `setInterval` (cleanable on destroy).

5. **Implement `dispatchBatch`.** `p-limit` from npm (already in deps; reuse) wraps each invocation. Per-record: optional `tokenBucket.acquire()`, then `withTimeout(toolExecutor(input), timeoutMs)`. Errors caught into `failures`. Returns `{ successes, failures, batchDurationMs }`.

6. **Extend `ToolpackTool`** with the optional `bulkDispatch` field. Update one built-in tool's registration to declare it (e.g. `web_search` with `{ maxConcurrency: 5, timeoutMs: 10000, idempotent: true, costHint: "metered" }`) so the type extension is exercised. (No behavioral change for existing tools; the field is optional.)

7. **Confirm green** — cases 3–7 pass. Token-bucket tests for case 4 use fake timers.

8. **Run the full `apps/api` unit suite.** Unchanged.

9. **Lint + type-check.** Clean.

**Done when:** the dispatcher can fan out per-batch tool calls with concurrency + rate + timeout semantics, against a synthetic test tool. `ToolpackTool` carries the metadata field.

**Risk:** `p-limit`'s behavior under `AbortSignal` is undocumented. Slice 0 doesn't wire abort; the processor's cancel-flag check (slice 1) bridges. If abort propagation matters in practice, swap `p-limit` for a hand-rolled semaphore in a follow-up.

---

## Slice 1 — Processor branch + `lookupBulkDispatchable` helper

**Why now.** Dispatcher in hand, slice 1 wires it into the bulk-transform processor when `expression.kind === "tool"`. Also adds a small `ToolService.lookupBulkDispatchable` helper that resolves a tool by name + station-scope + metadata declaration.

**Files**

- Edit: `apps/api/src/queues/processors/bulk-transform.processor.ts` — branch on `expression.kind`; when `"tool"`, look up the tool + dispatch each batch.
- Edit: `apps/api/src/services/tools.service.ts` — add `lookupBulkDispatchable(toolRef, stationId, organizationId)` returning `{ executor, metadata } | null`.
- Edit: `apps/api/src/__tests__/queues/processors/bulk-transform.processor.test.ts` — cases 8–11.
- Edit: `apps/api/src/__tests__/services/tools.service.test.ts` — helper test.

**Steps**

1. **Write the failing processor tests** (cases 8–11). Mock `lookupBulkDispatchable` to return a test executor.

2. **Confirm red.** Processor still throws `BULK_DISPATCH_TOOL_NOT_FOUND` for `"tool"` kind (Phase 2 behavior); the new tests expect dispatcher invocation.

3. **Implement `lookupBulkDispatchable`.** Build the station's tools record via `buildAnalyticsTools`; look up the named tool; cross-reference its `bulkDispatch` declaration (from the toolpack registry); return `{ executor, metadata }` only when both exist.

4. **Implement the processor branch.** When `expression.kind === "tool"`:
   - Resolve the tool via `lookupBulkDispatchable`.
   - Per batch (already in the cursor loop): call `dispatchBatch`; merge `successes` into the target wide table; accumulate `failures` into the job's running `partialFailures` array; emit the per-batch SSE event with `failureCount` reflecting the batch's failed count.

5. **Implement the per-batch UPSERT for tool successes.** The shape is similar to the SQL path's UPSERT but the values come from the dispatcher result. Use parameterized INSERT … ON CONFLICT pattern; column names from the union of tool result keys.

6. **Confirm green** — cases 8–11 pass.

7. **Run the full `apps/api` unit suite + the integration suite.** Existing Phase 2 flows pass; new tool-dispatch path tested in unit only at this slice.

8. **Lint + type-check.** Clean.

**Done when:** the processor routes tool-kind expressions to the dispatcher; successes upsert to the target; failures land in `partialFailures`.

**Risk:** the union-of-result-keys insertion produces NULL columns for varying tool shapes — that's the spec'd behavior. Tests in case 9 assert this explicitly.

---

## Slice 2 — Tool pre-flight extensions

**Why now.** Processor end-to-end works in unit. The tool's pre-flight now lights up the new error paths: cost gate, bulk-dispatchable check, ETA, sourceFilter validation.

**Files**

- Edit: `apps/api/src/tools/bulk-transform-entity-records.tool.ts` — pre-flight extensions; ETA computation.
- Edit: `packages/core/src/models/job.model.ts` — add optional `sourceFilter: { whereSqlFragment: z.string() }` to `BulkTransformMetadataSchema`.
- Edit: `apps/api/src/__tests__/tools/bulk-transform-entity-records.tool.test.ts` — cases 12–17.

**Steps**

1. **Write the failing pre-flight tests** (cases 12–17). Mock `lookupBulkDispatchable` for the cost-gate and not-bulk-dispatchable branches.

2. **Confirm red.** Pre-flight today only handles the `sql`-kind path; the `tool`-kind branches don't exist.

3. **Implement the pre-flight extensions:**
   - Tool exists + declares `bulkDispatch` → `BULK_DISPATCH_TOOL_NOT_FOUND` / `BULK_DISPATCH_TOOL_NOT_BULK_DISPATCHABLE`.
   - Cost gate when `costHint === "expensive"` and `acknowledgeCost !== true` → `BULK_DISPATCH_COST_NOT_ACKNOWLEDGED`.
   - ETA from `estimatedMsPerCall × expectedRecords / maxConcurrency`.
   - `sourceFilter.whereSqlFragment` validated via EXPLAIN of `SELECT 1 FROM source WHERE <fragment> LIMIT 1`. Invalid → `BULK_JOB_EXPRESSION_INVALID`.

4. **Confirm green** — cases 12–17 pass.

5. **Run the full `apps/api` unit suite.** Unchanged.

6. **Lint + type-check.** Clean.

**Done when:** the bulk-transform tool's pre-flight rejects malformed tool-kind dispatches with the right typed errors, computes ETA, and validates `sourceFilter`.

**Risk:** EXPLAIN of a synthetic SELECT to validate the WHERE fragment is the same SQL-injection surface called out in spec § Risks. The fragment ships through to the processor's cursor; reviewers should confirm the validation gate is sufficient for the surface area.

---

## Slice 3 — Frontend: populate `BulkFailuresTableBlock` + retry button

**Why now.** Backend is end-to-end functional. This slice wires the frontend failure-table to real data + the retry surface.

**Files**

- Edit: `apps/web/src/components/BulkFailuresTableBlock.component.tsx` — render paginated rows; expand-row for full envelope; retry button.
- Edit: `apps/web/src/__tests__/components/BulkFailuresTableBlock.component.test.tsx` — cases 18–21.

**Steps**

1. **Write the failing widget tests** (cases 18–21). Use react-testing-library; stub the chat-message POST mutation; assert the retry button's payload.

2. **Confirm red.** Phase 2's block was stub-only.

3. **Implement the block**:
   - `Table` from MUI with `TablePagination`.
   - Each row: `sourceKey | error.code | error.message | error.recommendation` (recommendation truncated with tooltip-on-hover).
   - Expansion: `<Collapse>` showing the full `ApiUserError` JSON.
   - "Retry failed only" button:
     ```tsx
     const failedKeys = failures.map(f => f.sourceKey);
     const message = `Retry the failed records from job ${jobId}. The failed source keys: ${failedKeys.join(', ')}.`;
     await postChatMessage({ portalId, role: "user", content: message });
     ```
   - Disable the retry button after click; show a "Retrying…" state.

4. **Confirm green** — cases 18–21 pass.

5. **Run the full `apps/web` unit suite.** Unchanged.

6. **Lint + type-check.** Clean.

**Done when:** failure table renders, expansion works, retry button POSTs the synthetic user message.

**Risk:** the agent might phrase the retry differently from the system-prompt's canonical shape (`sourceFilter.whereSqlFragment`). Mitigation: slice 4's system-prompt addition makes the canonical shape explicit; smoke (slice 4) verifies end-to-end.

---

## Slice 4 — System-prompt addition + Smoke C

**Why now.** All code in place; this slice adds the agent guidance and verifies end-to-end. Smoke C is the acceptance gate for Phase 4.

**Files**

- Edit: `apps/api/src/prompts/system.prompt.ts` — entity-management section gains a "retry failed records" guidance block (when the user asks the agent to retry, call `bulk_transform_entity_records` with the same expression and a `sourceFilter.whereSqlFragment` filtering on the failed keys).
- New: `apps/api/src/__tests__/__fixtures__/distance-to-nearest-hospital.tool.ts` — test-fixture tool with deterministic compute + injected failures for specific source ids.
- New: `apps/api/src/__tests__/__integration__/bulk-transform-smoke-c.integration.test.ts` — case 22.
- Edit: `apps/api/src/__tests__/prompts/system.prompt.test.ts` — assert the retry guidance is present when entity_management is enabled.

**Steps**

1. **Write the failing prompt tests** — assert the retry-guidance string lands in the rendered prompt under `entity_management`.

2. **Write the failing Smoke C integration test** (case 22). Seed 1,000 parcels; inject the test-fixture tool into the station's analytics-tools; dispatch the bulk-transform; assert 997 written, 3 failed with the expected source keys, terminal assistant message contains a `bulk-failures-table` block with those failures.

3. **Confirm red.** Prompt copy missing; integration test fails because the test-fixture tool isn't yet registered into a test station.

4. **Implement the prompt addition.** Short paragraph in the existing entity-management section.

5. **Implement the test-fixture tool.** Deterministic hash-based distance compute; injected failures for `parcel_id IN ('p-99', 'p-499', 'p-999')`.

6. **Iterate on Smoke C until green.** Expected failures are wiring bugs in earlier slices that didn't surface in unit tests.

7. **Manual smoke walkthrough** (record in this slice's commit message):
   - `npm run dev`.
   - Create a portal in a station with `entity_management` + `data_query`.
   - Register the test-fixture tool (or use a real `bulkDispatch`-declared tool if available locally).
   - Seed 100 parcels.
   - Prompt: "For each parcel, compute its distance to the nearest hospital and store it."
   - Observe: tool dispatches; cost ETA surfaces in agent's response; `bulk-job-progress` mounts (live histogram of `distance_km`); chat locks; terminal message lands with failure-table for the 3 injected failures.
   - Click "Retry failed only".
   - Observe: agent re-dispatches with `sourceFilter.whereSqlFragment`; the 3 failed records re-attempt (the fixture is deterministic, so they fail again — assertion is "round-trip works", not "retry succeeds").

8. **Lint + type-check.** Clean.

**Done when:** Smoke C passes deterministically; manual walkthrough clears the acceptance criteria from the spec.

**Risk:** the retry round-trip depends on the agent following the system-prompt guidance reliably. If unreliable in practice, the fallback is an explicit retry route (deferred per spec § Out of scope). Slice 5 verifies the round-trip in integration.

---

## Slice 5 — Retry-failed-only round-trip integration test

**Why last.** Round-trip exercises the chat-driven retry path end-to-end: failure-table button → synthetic user message → agent → bulk-transform tool with `sourceFilter` → new job. Verifies the system-prompt addition works in practice.

**Files**

- New: `apps/api/src/__tests__/__integration__/bulk-transform-retry-failed-only.integration.test.ts` — case 23.

**Steps**

1. **Write the failing test** that:
   - Runs Smoke C's setup; observes 3 failures.
   - POSTs a synthetic user message: `"Retry the failed records from job <id>. The failed source keys: p-99, p-499, p-999."`.
   - Waits for the agent's response; asserts a new `bulk_transform` job is enqueued with `sourceFilter.whereSqlFragment` containing the 3 keys.
   - Asserts the new job's terminal result shows the same 3 failures (deterministic fixture).

2. **Confirm red.** Likely passes immediately if slice 4 worked correctly. If not, iterate on the system-prompt guidance until the agent's behavior is reliable.

3. **Lint + type-check.** Clean.

**Done when:** the retry-failed-only round-trip is exercised end-to-end and passes deterministically.

**Risk:** LLM behavior tests are flaky by nature. Mitigation: the test asserts on the *enqueued job's metadata*, not on the agent's prose. If the prose varies (it will), the test still passes as long as the agent invokes `bulk_transform_entity_records` with the right `sourceFilter`. If the agent fails to invoke the tool at all, the test fails — and the fix is system-prompt iteration.

---

## Cross-slice gates

After every slice:

1. `npm run test:unit --workspace=apps/api` is green.
2. `npm run test:unit --workspace=apps/web` is green (slice 3).
3. `npm run test:integration --workspace=apps/api` is green where slice touches integration surface (slices 4 + 5).
4. `npm run lint && npm run type-check` from repo root are clean.
5. `git diff --stat` matches the slice's "Files" list.

After all slices land (Phase 4 end):

- All test cases (1–23) pass.
- Acceptance-criteria checkboxes in the spec are ticked.
- A grep for `bulkDispatch` returns matches in: the type extension, the dispatcher, the lookup helper, the processor branch, the tool pre-flight, the spec, and the smoke fixture.
- A grep for `sourceFilter.whereSqlFragment` returns matches in: the schema extension, the processor's cursor-WHERE injection, the tool pre-flight's EXPLAIN check, and the retry-flow integration test.

---

## What this phase does *not* attempt

- **Sandboxed JS for the write expression.** Discovery option C; gated.
- **Automatic per-call retry on transient failure.** Tools opt-in to idempotency; retry is user-initiated via the failure-table button.
- **Distributed dispatch across multiple workers.** Single worker pool; concurrency caps are in-process.
- **Sub-bulk-dispatch recursion.** Hard cap at depth 1; a bulk-dispatched tool can't enqueue another bulk job.
- **Per-org quota / billing for tool dispatch.** Open question 9.
- **Direct retry route bypassing the agent.** All retries flow through the chat surface.
- **Custom toolpack (#65) end-to-end smoke.** Built-in only in Phase 4; custom pickup is free via the descriptor schema extension.
- **PostGIS-backed distance compute.** Test-fixture uses a deterministic hash.

---

## What closes when Phase 4 lands

- Issue [#85](https://github.com/EnterpriseBT/portal-ai/issues/85) — all four phases shipped; writes-SQL + writes-tool + reads + shared infrastructure all live in production.
- Phases 1–4 PRs merged; the `docs/bulk-writes` branch is squash-merged into `main`.
- Follow-up issue #92 (live trace-based pins) remains open as a separate work stream.
