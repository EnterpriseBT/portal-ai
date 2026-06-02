# Large data operations — Phase 2: Writes-SQL track — Plan

**TDD-sequenced implementation of `docs/LARGE_DATA_OPS_PHASE_2.spec.md`. Seven slices, each behind a green test suite, each landing as one commit. Slicing flows backend → frontend → smoke: the processor and tool land first (slices 0–2); the terminal-message + portal-events SSE channel + running-jobs query wire up the lock plumbing (slice 3); the frontend widget + chat lock follow (slices 4–5); Smoke A (slice 6) is the acceptance gate.**

Spec: `docs/LARGE_DATA_OPS_PHASE_2.spec.md`. Phase 1: `docs/LARGE_DATA_OPS_PHASE_1.{spec,plan}.md`. Issue: [#85](https://github.com/EnterpriseBT/portal-ai/issues/85).

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

## Slice 0 — Bulk-transform processor (SQL path, counters-only SSE)

**Why first.** The processor is the load-bearing piece of the writes-SQL track; everything else (tool, widget, terminal hook) depends on the job actually running. Lands behind unit + integration tests that drive a real BullMQ job through a mocked SSE emitter.

**Files**

- New: `apps/api/src/queues/processors/bulk-transform.processor.ts`
- Edit: `apps/api/src/queues/processors/index.ts` — register `bulk_transform` in the processors map.
- New: `apps/api/src/__tests__/queues/processors/bulk-transform.processor.test.ts` — cases 1–5.

**Steps**

1. **Write the failing tests** (cases 1–5):
   - 3-batch SQL job emits 3 `job:batch` events with monotonically increasing `recordsProcessed`.
   - When committed-batch payload fits the cap, `rows` is present in the event.
   - When payload exceeds the cap, `rows` is absent (oversized-batch degrade).
   - Cancel flag set between batches → returns `status: "cancelled"` with the committed count.
   - `expression.kind === "tool"` throws `BULK_DISPATCH_TOOL_NOT_FOUND`.

2. **Confirm red.** Processor file doesn't exist; imports fail.

3. **Implement the processor.** Pattern follows `connector-sync.processor.ts`:
   - Parse `job.data` via `BulkTransformMetadataSchema`.
   - Resolve source + target entity row shapes (column names, key column).
   - Loop: `OFFSET 0; OFFSET batchSize; …` until processed = total.
   - Per batch: build the INSERT-SELECT SQL, run inside a transaction, RETURN the committed rows; emit `job:batch` event via the existing SSE pub-sub.
   - Cancel check: `bullJob.isFailed()` between batches.
   - Final result: `{ recordsProcessed, recordsFailed: 0, durationMs, partialFailures: [] }`.

4. **Register the processor** in `processors/index.ts`.

5. **Confirm green** — cases 1–5 pass.

6. **Run the full `apps/api` unit suite.** Unchanged.

7. **Lint + type-check.** Clean.

**Done when:** A `bulk_transform` job can be enqueued (by hand, in a test) and runs to completion against a seeded source + target. SSE events fire per batch.

**Risk:** the SQL assembly (INSERT INTO target_wide SELECT … FROM source_wide ON CONFLICT) has to thread the `expression.value` through correctly. Mitigation: unit test 1 asserts the resulting target wide-table rows match the expression against the seeded source.

---

## Slice 1 — Bulk-transform tool + pre-flight + registration

**Why now.** Slice 0 has a working processor; this slice wires the tool that enqueues the job, including all pre-flight checks (lock, EXPLAIN, max-records). Tool registration in `tools.service.ts` happens here so the agent can dispatch the tool end-to-end.

**Files**

- New: `apps/api/src/tools/bulk-transform-entity-records.tool.ts`
- New: `apps/api/src/__tests__/tools/bulk-transform-entity-records.tool.test.ts` — cases 6–11.
- Edit: `apps/api/src/services/tools.service.ts` — register the tool inside `entity_management` + `hasWrite`; thread `portalId` argument through `buildAnalyticsTools`.
- Edit: `apps/api/src/services/portal.service.ts` — pass `portalId` to `buildAnalyticsTools`; extend `resolveDisplayBlock` to recognize the new tool (case 16).
- Edit: `apps/api/src/__tests__/services/tools.service.test.ts` — verify the tool is registered under entity_management + hasWrite.

**Steps**

1. **Write the failing tool tests** (cases 6–11 + 16). Each test mocks the DB + lock primitive + JobService.enqueue and asserts the pre-flight branch / final shape.

2. **Confirm red.** Tool file doesn't exist.

3. **Implement the tool**:
   - Class extends `Tool<typeof BulkTransformInputSchema>`. The input schema mirrors `BulkTransformMetadataSchema` minus `portalId` (which the tool's `build` closes over).
   - `build(portalId, stationId, organizationId, userId)` returns the Vercel AI SDK `tool()` whose `execute` runs the 6-step pre-flight in order, then enqueues via `JobService.enqueue`, then returns the tool result.

4. **Thread `portalId` through `buildAnalyticsTools`.** Add it as a new required arg; update the existing callers in `PortalService.streamResponse` to pass the portal id (already available in scope).

5. **Register the tool** in `tools.service.ts` inside the `entity_management` + `hasWrite` block.

6. **Extend `resolveDisplayBlock`** to recognize `toolName === "bulk_transform_entity_records"` and return the `bulk-job-progress` display-block content.

7. **Confirm green** — cases 6–11 + 16 pass; existing tools-service tests still green.

8. **Lint + type-check.** Clean.

**Done when:** The agent can dispatch `bulk_transform_entity_records` from a portal session and the response includes a `bulk-job-progress` display block bound to a real `jobId`.

**Risk:** `EXPLAIN` against the assembled SQL might surface PG errors that don't map cleanly to a user-actionable recommendation. Pre-flight test 8 captures the error in `details.pgError` so the developer can iterate; the user-facing message stays generic.

---

## Slice 2 — Per-batch SSE row payload + per-batch cap logic

**Why now.** Slice 0 emitted counters-only events. This slice extends each `job:batch` event to carry `rows` when payload fits and degrades to counters-only when it doesn't. The processor test cases 2 + 3 already encode the contract from slice 0; this slice's tests deepen them with realistic row shapes.

**Files**

- Edit: `apps/api/src/queues/processors/bulk-transform.processor.ts` — implement the cap logic + RETURNING from INSERT.
- Edit: `apps/api/src/__tests__/queues/processors/bulk-transform.processor.test.ts` — expand cases 2 + 3 with concrete fixture sizes.

**Steps**

1. **Strengthen the failing tests**: tighten cases 2 + 3 to assert `rows` content matches expected committed-row shape (column names, values, ordering).

2. **Confirm red.** Slice 0's implementation emits empty arrays; the new assertions fail.

3. **Implement the RETURNING + cap logic.** Per-batch INSERT now `RETURNING record_id, c_<key>, c_<col1>, …`. After commit, serialize the rows, check against `BATCH_ROW_PAYLOAD_LIMIT`, build the event.

4. **Confirm green.**

5. **Lint + type-check.** Clean.

**Done when:** Per-batch SSE events carry committed rows when payload fits and degrade to counters-only when it doesn't, deterministically.

**Risk:** the wide-table column projection has to match the schema. Pre-implementation, audit `apps/api/src/services/wide-table-reconciler.service.ts` to confirm the column-naming convention (`c_<normalized_key>` was added in #87's work and is the source of truth).

---

## Slice 3 — Portal-events SSE channel + running-jobs query + `notifyJobTerminal`

**Why now.** With the processor + tool live, the missing pieces for the chat-lock plumbing land here. Frontend depends on the running-jobs query and the portal-events SSE channel; the terminal-message injection completes the server-side flow.

**Files**

- New: `apps/api/src/queues/hooks/bulk-transform-terminal.hook.ts` — fired after a `bulk_transform` job terminal.
- Edit: `apps/api/src/queues/jobs.worker.ts` — register the terminal hook into the worker's terminal-status path.
- Edit: `apps/api/src/services/portal.service.ts` — `notifyJobTerminal` static method.
- Edit: `apps/api/src/db/repositories/jobs.repository.ts` — `countRunningByPortalId(portalId)` + `findRunningByPortalId(portalId)`.
- Edit: `apps/api/src/routes/portals.router.ts` — `GET /api/portals/:id/running-jobs`.
- Edit (or new): `apps/api/src/routes/portal-events.router.ts` — `GET /api/sse/portals/:id/events`; Redis Pub/Sub channel key `portal:{id}:events`.
- New: `apps/api/src/__tests__/services/portal.service.notify-job-terminal.test.ts` — cases 12–15.
- New: `apps/api/src/__tests__/db/repositories/jobs.repository.running-by-portal.test.ts` — small fixture asserting the query.
- New: `apps/api/src/__tests__/routes/portal-running-jobs.test.ts` — auth + payload-shape tests for the new route.

**Steps**

1. **Write all failing tests** (cases 12–15 + the repo + route shape tests). Mocks: `repo.portalMessages.create`, the SSE pub-sub layer.

2. **Confirm red.** Methods / routes don't exist.

3. **Implement** `notifyJobTerminal`, the worker hook, the repo methods, the running-jobs route, the portal-events SSE route. All exclude business logic that's not in scope (no agent re-prompt; just persist + publish).

4. **Confirm green** for unit cases 12–15 and the small route tests.

5. **Run the full `apps/api` unit + integration suite.** Unchanged.

6. **Lint + type-check.** Clean.

**Done when:** Terminal-status worker hook fires `notifyJobTerminal` which persists an assistant-role message + publishes the portal-events SSE event. The running-jobs endpoint returns the expected shape. Phase 2 backend is functionally complete.

**Risk:** worker-hook registration shape isn't standardized; the existing `connector-sync` writes its own post-terminal work inside the processor. Decide at implementation: either register a separate hook map keyed by job type, or inline `notifyJobTerminal` at the end of the bulk-transform processor before returning. The hook map is cleaner; the inline call is simpler. Lean: the hook map, for symmetry with future job types.

---

## Slice 4 — Frontend `bulk-job-progress` widget + display-block registration

**Why now.** Backend is end-to-end functional. This slice ships the frontend widget that consumes the SSE stream. Lands behind unit tests that drive the widget through a stubbed SSE source.

**Files**

- New: `apps/web/src/components/BulkJobProgressBlock.component.tsx`
- New: `apps/web/src/components/BulkFailuresTableBlock.component.tsx` — used in the terminal assistant message when `recordsFailed > 0`.
- Edit: `apps/web/src/components/DisplayBlock.component.tsx` (or wherever the block registry lives) — wire the new block types.
- New: `apps/web/src/__tests__/components/BulkJobProgressBlock.component.test.tsx` — cases 21–27.

**Steps**

1. **Write the failing widget tests** (cases 21–27). Stub the SSE source via a small `EventSource` test double; assert reducer transitions, view-selector rendering, cancel-button behavior, pinnable flag.

2. **Confirm red.** Component doesn't exist.

3. **Implement the widget.** `useEffect` opens the SSE connection on mount; `useReducer` handles `BATCH` / `STATUS` actions. Vega view constructed via `vega-embed`; `view.change('primary', changeset).run()` per batch. View selector is an MUI `<ToggleButtonGroup>`.

4. **Implement the failures-table block** (smaller — paginated MUI table with a "retry failed only" button that calls a stub mutation; the actual retry plumbing lands in Phase 4 when per-record failures exist).

5. **Register both block types** in the display-block registry.

6. **Confirm green** — cases 21–27 pass.

7. **Run the full `apps/web` unit suite.** Unchanged.

8. **Lint + type-check.** Clean.

**Done when:** A test harness can render `<BulkJobProgressBlock content={{ jobId, expectedRecords, viewKind: "histogram" }} />` and drive it through batch + terminal events to verify the UI behavior.

**Risk:** vega-embed mocking in Jest is fiddly. Tests use a tiny shim that captures `view.change` calls into a spy. The real Vega path is exercised by manual smoke in slice 6.

---

## Slice 5 — Chat-thread input lock + `usePortalChatLock` hook

**Why now.** Widget lands first because it's standalone; this slice integrates the portal view's chat input with the running-jobs state. Tests verify the hook's behavior end-to-end against a stubbed SSE channel + query.

**Files**

- New: `apps/web/src/hooks/usePortalChatLock.util.ts`
- Edit: `apps/web/src/api/portals.api.ts` — add `runningJobs` and `cancelJob` SDK helpers.
- Edit: `apps/web/src/views/Portal.view.tsx` — call the hook; pass `locked` to the chat input.
- New: `apps/web/src/__tests__/hooks/usePortalChatLock.util.test.ts` — cases 17–20.

**Steps**

1. **Write the failing hook tests** (cases 17–20).

2. **Confirm red.**

3. **Implement the hook.** `useAuthQuery(queryKeys.portals.runningJobs(portalId))` for initial state; `EventSource` subscription to `/api/sse/portals/:id/events` invalidates the query on `bulk_job_started` / `bulk_job_terminal`.

4. **Add SDK helpers** in `portals.api.ts`.

5. **Wire the portal view** — pass `locked` down to the chat-input owner; show a tooltip on the disabled input.

6. **Confirm green** — cases 17–20 pass.

7. **Lint + type-check.** Clean.

**Done when:** Opening a portal with a running bulk job disables the chat input; finishing the job re-enables it.

**Risk:** the portal view's chat-input owner might not have a `disabled` prop today. Audit at implementation; if absent, add one (small surface change). The reference test for chat-input behavior lives next to the portal view's existing tests.

---

## Slice 6 — Smoke A integration test + acceptance walkthrough

**Why last.** All pieces in place; this slice's job is to verify end-to-end behavior on a seeded source + target via the real worker + Pub/Sub + DB. The integration test is the long pole; the manual smoke is documentation.

**Files**

- New: `apps/api/src/__tests__/__integration__/bulk-transform-smoke-a.integration.test.ts` — case 28.
- Existing integration tests for lock conflicts (case 29) and source-deletion-mid-job (case 30) — add to the same file or sibling.

**Steps**

1. **Write the integration test** that:
   - Seeds source entity with 1,000 synthetic rows (small enough to keep the test fast).
   - Mounts the worker against a real BullMQ instance.
   - Dispatches `bulk_transform_entity_records` via the actual tool execute.
   - Subscribes to the portal-events SSE channel.
   - Asserts terminal SSE event fires, target wide table has 1,000 rows, terminal assistant message persisted.

2. **Confirm red.** First run fails — Phase 2 backend hasn't been verified end-to-end on a real database.

3. **Iterate to green.** Most failures will be configuration / wiring bugs in earlier slices; surface and fix.

4. **Add the lock-conflict test** (case 29): launch one job, attempt to launch a second against the same target, assert `BULK_JOB_TARGET_LOCKED`.

5. **Add the source-deletion test** (case 30): start a job, delete a source row mid-batch, assert no crash + the per-batch consistency promise (subsequent batches skip the deleted row).

6. **Manual smoke walkthrough** (record in this slice's commit message):
   - `npm run dev`
   - Create a portal in a station with `entity_management` + `data_query` packs.
   - Seed a 1,000-row source entity.
   - Prompt: "For every parcel, compute its acreage and store it in `parcel_metrics`."
   - Observe: tool dispatches; widget mounts; counters tick; histogram fills in; chat input is locked; terminal message lands; chat unlocks.

7. **Verify acceptance criteria** in `docs/LARGE_DATA_OPS_PHASE_2.spec.md#acceptance-criteria` — each box ticks.

8. **Lint + type-check.** Clean.

**Done when:** Smoke A passes deterministically in the integration suite; manual smoke passes against a running dev environment.

**Risk:** the test might be flaky due to BullMQ + SSE timing. Mitigation: explicit polling for "job in terminal state" with a generous timeout (30s default); the test is `RUN_SLOW_TESTS=1`-gated if it grows past 10s.

---

## Cross-slice gates

After every slice:

1. `npm run test:unit --workspace=apps/api` is green.
2. `npm run test:unit --workspace=apps/web` is green (slices 4 + 5).
3. `npm run test:integration --workspace=apps/api` is green when slice touches integration surface (slices 0 partial, 3 partial, 6 fully).
4. `npm run lint && npm run type-check` from repo root are clean.
5. `git diff --stat` matches the slice's "Files" list.

After all slices land (Phase 2 end):

- All test cases (1–30) pass.
- Acceptance-criteria checkboxes in the spec are ticked.
- A grep for `bulk_transform_entity_records` returns matches in: the tool file, the registration in `tools.service.ts`, the resolve-display-block extension, the smoke test, the spec, the discovery.
- A grep for `bulk-job-progress` returns matches in: the frontend block component, the block registry, the resolve-display-block extension, the smoke test, the spec.

---

## What this phase does *not* attempt

- **`expression.kind === "tool"` dispatch.** Phase 4.
- **`rowIds` SSE fallback + per-entity row fetch endpoint.** Phase 3 (composes on the query-handle infrastructure).
- **Reads track.** Phase 3.
- **Agent re-prompt for observations.** Deferred enhancement; not in v1.
- **Audit trail on bulk-written rows.** Discovery's open question 1; deferred.
- **Pin work.** Filed as #92.
- **PostGIS provisioning.** Infra concern, not code.

---

## Next phase

`docs/LARGE_DATA_OPS_PHASE_3.spec.md` and `.plan.md` — the reads track end-to-end. Phase 3 wires the query-handle envelope producer, the two endpoints (stream + snapshot), the Vega-Lite spec rewrite, sampling, `statement_timeout`, and a `query-result-data` display block. Phase 3 also adds the `rowIds`-fallback for Phase 2's oversized-batch case (per-entity row fetch endpoint composes on the read-side handle infrastructure). Phases 2 and 3 can develop in parallel since they share only Phase 1's contracts.

After Phase 3, Phase 4 (writes-tool-dispatch) builds on Phase 2's processor + tool, adding the `bulkDispatch` metadata on `ToolpackTool`, the dispatcher (`pLimit` + token bucket + `withTimeout`), the cost-acknowledgement gate, and per-record failure surfacing.
