# Large data operations — Phase 3: Reads track — Plan

**TDD-sequenced implementation of `docs/LARGE_DATA_OPS_PHASE_3.spec.md`. Seven slices, each behind a green test suite, each landing as one commit. Slicing flows backend → tool rewires → frontend → writes-fallback close-out → smoke: the handle service + storage lands first (slices 0–1); the read tools rewire onto it (slices 2–3); the frontend display block consumes it (slice 4); the writes-side `rowIds` fallback (slice 5) closes Phase 2's deferral; Smoke B (slice 6) is the acceptance gate.**

Spec: `docs/LARGE_DATA_OPS_PHASE_3.spec.md`. Phase 1: `docs/LARGE_DATA_OPS_PHASE_1.{spec,plan}.md`. Phase 2: `docs/LARGE_DATA_OPS_PHASE_2.{spec,plan}.md`. Issue: [#85](https://github.com/EnterpriseBT/portal-ai/issues/85).

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

## Slice 0 — `PortalSqlHandleService` + Redis storage + Pub/Sub publish

**Why first.** Every later slice consumes the handle service. Lands behind unit + integration tests that drive a real PG cursor against a seeded table, write batches to Redis, publish to Pub/Sub, and assert the envelope shape.

**Files**

- New: `apps/api/src/services/portal-sql-handle.service.ts` — `produce`, `getSnapshot`, internal helpers (sampling decision, statement-timeout setup, batch publish).
- Edit: `packages/core/src/constants/large-data-ops.constants.ts` — add `SAMPLE_SIZE`, `MAX_ROWS_BY_ID`, `MARK_CAPS`, `READ_HANDLE_LIMIT_PER_ORG`.
- Edit: `apps/api/src/constants/api-codes.constants.ts` — `BULK_DISPATCH_TOO_MANY_IDS`, `READ_HANDLE_LIMIT_EXCEEDED` (the others already in Phase 1).
- New: `apps/api/src/__tests__/services/portal-sql-handle.service.test.ts` — cases 1–8.

**Steps**

1. **Write the failing service tests** (cases 1–8). Mock the PG client to yield deterministic batches; mock Redis to capture writes + publishes. Each test asserts a single behavior: batch keying, payload, complete event, sampling trigger, timeout mapping, snapshot read, expired-handle response.

2. **Confirm red.** Service file doesn't exist.

3. **Implement** in order:
   - Constants extension first (slice 0's leaf prerequisite).
   - `produce(opts)`: open a read-only transaction, set `statement_timeout`, declare cursor, walk batches, write+publish each batch, write meta envelope after exhaustion, publish `complete`.
   - `getSnapshot(handleId, range)`: read batches from Redis, page server-side.
   - Error path: catch PG `57014` (`query_canceled`), translate to `PORTAL_SQL_TIMEOUT` envelope; persist + publish error event.

4. **Confirm green** — cases 1–8 pass.

5. **Run the full `apps/api` unit suite.** Unchanged.

6. **Lint + type-check.** Clean.

**Done when:** The service produces handles, batches arrive in Redis, Pub/Sub channels emit. No HTTP surface yet.

**Risk:** the sampling decision needs a `SELECT COUNT(*) FROM (<user_sql>) _src` pre-flight, which itself is bounded by `statement_timeout`. For pathological queries the count might trip the timeout. Acceptable v1: the tool surfaces `PORTAL_SQL_TIMEOUT`; the user retries with a tighter SQL. Document in the producer.

---

## Slice 1 — SSE streaming + snapshot HTTP endpoints

**Why now.** Slice 0 has the producer + storage; this slice exposes the two consumption surfaces. Lands behind route tests that subscribe to the SSE channel + hit the snapshot endpoint against a seeded handle.

**Files**

- New: `apps/api/src/routes/portal-sql-handle.router.ts` — both endpoints + Pub/Sub subscription wiring.
- Edit: `apps/api/src/app.ts` (or the equivalent route-mounting site) — mount the new router under `/api/portal-sql`.
- New: `apps/api/src/__tests__/routes/portal-sql-handle.router.test.ts` — cases 19–22.

**Steps**

1. **Write the failing route tests** (cases 19–22): SSE replays cached batches then forwards live; snapshot returns paged rows; expired handles return the envelope; scope checks reject cross-portal access.

2. **Confirm red.** Router doesn't exist.

3. **Implement the SSE route.** Uses the existing `SseUtil` (the same one job-events uses). On subscribe: read cached batches from Redis up to the current cursor position, replay them as `data` events, then subscribe to the live Pub/Sub channel for any remaining batches + the `complete` event.

4. **Implement the snapshot route.** `GET /api/portal-sql/handle/:id?offset=N&limit=M`. Validate `limit ≤ 5000`; reject larger requests. Read `[offset, offset+limit)` from cached batches; return `{ rows, total, offset, limit }`.

5. **Mount the router.** Wire under `/api/portal-sql` alongside any existing portal-sql routes.

6. **Confirm green** — cases 19–22 pass.

7. **Lint + type-check.** Clean.

**Done when:** A test client can subscribe to a handle's SSE channel and receive batches; the same client can fetch a paged snapshot.

**Risk:** the "replay cached then forward live" sequence has a race — if the producer completes between cache-read and Pub/Sub subscribe, the consumer misses the `complete` event. Mitigation: write the envelope's terminal status to Redis before publishing `complete`; the consumer re-reads after subscribing to detect missed terminals.

---

## Slice 2 — `sql_query` rewires + inline-vs-handle branch

**Why now.** With slices 0–1 live, the read tool can choose to inline or hand off. Lands behind tool tests that drive both branches.

**Files**

- Edit: `apps/api/src/tools/sql-query.tool.ts` — branch on row count; produce handle when over threshold.
- Edit: `apps/api/src/__tests__/tools/sql-query.tool.test.ts` — cases 12–14.

**Steps**

1. **Write the failing tool tests** (cases 12–14). Mock `PortalSqlService.runSqlQuery` for the inline path; mock `PortalSqlHandleService.produce` for the handle path.

2. **Confirm red.** Today's tool always inlines; the new tests for the handle branch fail.

3. **Implement the branch.** After parse + view-binding (today's `runSqlQuery`), run a pre-flight count. If `≤ INLINE_ROWS_THRESHOLD`, inline as today. Otherwise produce a handle and return the envelope.

4. **Confirm green** — cases 12–14 pass.

5. **Lint + type-check.** Clean.

**Done when:** `sql_query` returns either inline rows or a handle envelope based on row count; existing tests continue to pass for small results.

**Risk:** the pre-flight count adds a query to every read. Cheap for indexed tables; could be slow for joins over unindexed columns. Acceptable v1 — surfaces as `PORTAL_SQL_TIMEOUT` if the count alone exceeds 30s.

---

## Slice 3 — `visualize` + `visualize_tree` rewires + Vega spec rewrite

**Why now.** Same pattern as `sql_query`; lands as its own slice because the spec rewrite is a separate piece of plumbing.

**Files**

- New: `apps/api/src/utils/vega-spec-rewrite.util.ts` — `rewriteForNamedDataset`.
- Edit: `apps/api/src/tools/visualize.tool.ts` — branch on row count; call rewrite before return; update description with per-mark caps.
- Edit: `apps/api/src/tools/visualize-tree.tool.ts` — same branch + rewrite + description.
- New: `apps/api/src/__tests__/utils/vega-spec-rewrite.util.test.ts` — cases 9–11.
- Edit: `apps/api/src/__tests__/tools/visualize.tool.test.ts` — cases 15–17.
- Edit: `apps/api/src/__tests__/tools/visualize-tree.tool.test.ts` — case 18.

**Steps**

1. **Write the failing util tests** (cases 9–11).

2. **Confirm red.** Util doesn't exist.

3. **Implement the rewrite util.** Pure function; covers single-source + named-dataset + multi-source pass-through.

4. **Write the failing tool tests** (cases 15–18).

5. **Confirm red.** Tools don't yet call the rewrite or branch on count.

6. **Implement the rewires.** Mirror slice 2's branch logic; additionally call `rewriteForNamedDataset` on the spec before returning. Update each tool's `description` string with the per-mark caps + handle-envelope behavior + `samplePeek` semantics.

7. **Confirm green** — cases 15–18 pass.

8. **Run the full `apps/api` unit suite.** Existing visualize tests pass through the inline-rows path unchanged.

9. **Lint + type-check.** Clean.

**Done when:** Both visualize tools return handles for large results with rewritten specs; small results stay inline.

**Risk:** the rewrite might break an existing visualize-test fixture that depends on the inline `data.values` shape. Audit pre-implementation; tests 15–17 lock the new behavior, and existing tests should pass through the rewrite as no-ops for the multi-source / already-named-dataset cases.

---

## Slice 4 — `QueryResultDataBlock` display block + `VegaLiteBlock` update

**Why now.** Backend is end-to-end functional. This slice consumes the SSE + snapshot endpoints from the frontend.

**Files**

- New: `apps/web/src/components/QueryResultDataBlock.component.tsx` — the new display block.
- Edit: `apps/web/src/components/VegaLiteBlock.component.tsx` — detect `queryHandle`; mount `QueryResultDataBlock` when present.
- Edit: `apps/web/src/components/DisplayBlock.component.tsx` (or the block registry) — register the new block type.
- New: `apps/web/src/api/portal-sql.api.ts` — SDK helpers for the snapshot fetch + SSE subscribe.
- New: `apps/web/src/__tests__/components/QueryResultDataBlock.component.test.tsx` — cases 26–29.

**Steps**

1. **Write the failing widget tests** (cases 26–29). Stub the SSE source via a small `EventSource` test double; stub the snapshot fetch; assert reducer transitions, vega view changes, snapshot fallback, error rendering.

2. **Confirm red.** Component doesn't exist.

3. **Implement the widget.** `useEffect` opens the SSE connection on mount; `useReducer` handles `DATA` / `COMPLETE` / `ERROR` actions; on remount or resize, the reducer dispatches a `SNAPSHOT_FETCH`. Vega view constructed via `vega-embed`; `view.change('primary', changeset).run()` per `data` event.

4. **Update `VegaLiteBlock`** — detect `content.queryHandle`; render the new component when present, keep today's inline path otherwise.

5. **Register the new block type** in the display-block registry.

6. **Confirm green** — cases 26–29 pass.

7. **Run the full `apps/web` unit suite.** Existing tests pass through the legacy path unchanged.

8. **Lint + type-check.** Clean.

**Done when:** A test harness drives the widget through SSE + snapshot + error paths and the assertions hold.

**Risk:** vega-embed mocking — same constraint as Phase 2 slice 4. Tests use the same shim pattern.

---

## Slice 5 — `rowIds` write-fallback endpoint + `BulkJobProgressBlock` extension

**Why now.** Closes Phase 2's deferral. Lands cleanly here since the per-entity row-fetch path benefits from the read-side cache mental model. Small surface — one endpoint + one widget update.

**Files**

- Edit: `apps/api/src/routes/connector-entities.router.ts` — add `POST /api/connector-entities/:entityId/rows-by-id`.
- Edit: `apps/api/src/db/repositories/connector-entities.repository.ts` (or `wide-table-reconciler.service.ts`) — add a `fetchRowsByIds(entityId, ids)` helper that selects from the wide table.
- New: `apps/api/src/__tests__/routes/connector-entities-rows-by-id.test.ts` — cases 23–25.
- Edit: `apps/web/src/components/BulkJobProgressBlock.component.tsx` — handle `job:batch` events where `rowIds` is set; fetch via the new endpoint; merge into the rendered buffer.
- Edit: `apps/web/src/__tests__/components/BulkJobProgressBlock.component.test.tsx` — extend Phase 2's cases to verify the rowIds path.

**Steps**

1. **Write the failing route tests** (cases 23–25). Hit the new endpoint with valid + over-limit + non-readable scopes.

2. **Confirm red.** Endpoint doesn't exist.

3. **Implement the endpoint.** Body validates `{ ids: string[] }`; reject > `MAX_ROWS_BY_ID`; resolve entity + check read capability; query wide table; return `{ rows }`.

4. **Implement the repository helper.** Single query against `er__<entityId>` projecting `record_id` + all `c_*` columns where `record_id = ANY($1)`.

5. **Confirm green** for cases 23–25.

6. **Extend `BulkJobProgressBlock`** to dispatch the `rows-by-id` fetch when a `job:batch` event carries `rowIds` instead of `rows`. Merge results into the active view's data buffer.

7. **Update the widget tests** to verify the rowIds branch — a `job:batch` event with `rowIds` triggers the fetch and the resulting rows feed the buffer.

8. **Lint + type-check.** Clean.

**Done when:** A bulk job whose batches exceed the row-payload cap renders correctly — the widget fetches rows by id and the chart fills in as it does for the inline-rows path.

**Risk:** N+1 fetch pattern if every batch's rowIds triggers a new request. Mitigation: batch the fetches client-side with a small debounce (collect ids across 200ms windows, single fetch). Document in the widget; defer if not needed in practice.

---

## Slice 6 — Smoke B integration test + acceptance walkthrough

**Why last.** All pieces in place; this slice's job is to verify end-to-end behavior on a 13k-row seeded dataset.

**Files**

- New: `apps/api/src/__tests__/__integration__/portal-sql-handle-smoke-b.integration.test.ts` — case 30.

**Steps**

1. **Write the integration test** that:
   - Seeds 13,000 synthetic parcels into a wide table.
   - Dispatches `visualize` for the scatter-plot SQL.
   - Asserts the tool returns a `QueryHandleEnvelope` (not inline rows).
   - Subscribes to the SSE channel; collects all batches.
   - Asserts batch count × rows-per-batch = 13,000.
   - Asserts the snapshot endpoint returns the same rows when fetched after the cursor exhausts.
   - Asserts the rewritten spec uses `data: { name: "primary" }`.
   - Asserts the tool result the agent sees doesn't contain raw rows.

2. **Confirm red.** First run fails — Phase 3 backend hasn't been verified end-to-end on a real database.

3. **Iterate to green.** Most failures will be configuration / wiring bugs in earlier slices; surface and fix.

4. **Manual smoke walkthrough** (record in this slice's commit message):
   - `npm run dev`
   - Seed a 13k-row source entity locally.
   - Prompt: "Show me a scatter plot of acreage vs assessed value for residential parcels."
   - Observe: tool dispatches; `query-result-data` block mounts; SSE batches arrive; chart fills in over ~2–3 seconds; navigating away and back loads the cached snapshot.

5. **Verify acceptance criteria** in `docs/LARGE_DATA_OPS_PHASE_3.spec.md#acceptance-criteria` — each box ticks.

6. **Lint + type-check.** Clean.

**Done when:** Smoke B passes deterministically + manual smoke clears every acceptance criterion.

**Risk:** the test might be flaky due to SSE timing. Mitigation: explicit polling on the snapshot endpoint (with a 30s budget) after asserting `complete` event arrived.

---

## Cross-slice gates

After every slice:

1. `npm run test:unit --workspace=apps/api` is green.
2. `npm run test:unit --workspace=apps/web` is green (slices 4 + 5 partial).
3. `npm run test:integration --workspace=apps/api` is green where slice touches integration surface (slice 0 partial, 6 fully).
4. `npm run lint && npm run type-check` from repo root are clean.
5. `git diff --stat` matches the slice's "Files" list.

After all slices land (Phase 3 end):

- All test cases (1–30) pass.
- Acceptance-criteria checkboxes in the spec are ticked.
- A grep for `queryHandle` returns matches in: the handle service, both visualize tools + sql_query, the new display block, the snapshot/stream router, the smoke test, the spec.
- A grep for `rowIds` in `apps/web/src/components/BulkJobProgressBlock.component.tsx` shows the new branch.

---

## What this phase does *not* attempt

- **Hard runtime enforcement of per-mark caps.** Tool descriptions surface them; runtime enforcement is a follow-up.
- **Cross-portal handle sharing.** Handles are portal-scoped.
- **Cache invalidation on connector sync.** TTL is the only invalidator.
- **Multi-source Vega spec rewrite.** Pass-through; degrades to inline-rows.
- **Backwards migration of legacy pinned charts.** Snapshot semantics for legacy pins stay; live-trace pins are #92.
- **`TABLESAMPLE BERNOULLI` sampling.** v1 uses `ORDER BY random() LIMIT N`; swap if telemetry warrants.
- **Reads-of-reads chaining (handle → handle pipeline).** Each read is its own handle; the agent runs a fresh SQL per chart.

---

## Next phase

`docs/LARGE_DATA_OPS_PHASE_4.spec.md` and `.plan.md` — writes via per-record tool dispatch (Smoke C). Phase 4 builds on Phase 2's processor, adding:

- `bulkDispatch` metadata on `ToolpackTool`.
- Dispatcher with `pLimit(maxConcurrency)` + token bucket for `ratePerSec` + `withTimeout(timeoutMs)`.
- Cost-acknowledgement gate for tools declared `costHint: "expensive"`.
- Per-record failure surfacing in the terminal follow-up (the `bulk-failures-table` block already lands in Phase 2; Phase 4 populates it).
- Smoke C: 50,000 parcels × `compute_distance_to_nearest_hospital`.

After Phase 4, #85 closes.
