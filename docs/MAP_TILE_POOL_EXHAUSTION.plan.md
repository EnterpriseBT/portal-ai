# Map tiles exhausting the DB pool — Plan

**A TDD-sequenced implementation of #698: per-kind tile simplify, the `AdmissionGate` utility, request-scoped DB cancellation with an admission deadline, the tile gate (`MAP_TILE_BUSY`), the web busy/backoff state, and the convention note.**

Spec: `docs/MAP_TILE_POOL_EXHAUSTION.spec.md`. Discovery: `docs/MAP_TILE_POOL_EXHAUSTION.discovery.md`. Issue: #698. Builds on the shipped #350 (client tile cap), #449 (`MAP_TILE_TIMEOUT`), #532 (count-driven tile modes) and #647 (request context / `memoizeForRequest`).

Seven slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `fix/698-map-tile-pool-exhaustion`**: one bugfix, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`), using `--testPathPattern` for the touched files locally:

```bash
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
cd apps/web && npm run test:unit
```

Each slice:
1. Write failing tests.
2. Make the smallest change that turns them green.
3. Run the focused tests.
4. Run `npm run lint && npm run type-check` at the boundary.
5. Move to the next slice.

Sequencing rationale:

- **Slice 1** is the trigger fix: pure SQL-builder change, independent of everything else. **It resolves the contour map alone** and could ship first if the rest stalls.
- **Slice 2** is the `AdmissionGate`: pure, in-memory, with no callers yet.
- **Slice 3** adds the request-context signal and cancel state, plus the typed errors and their mapping. These are the vocabulary slices 4–5 speak.
- **Slice 4** is the SQL instrumentation, wired into `client.ts`, covering the request admission deadline and before-start cancel for **every route**. It depends on slice 3's context fields.
- **Slice 5** adds the tile gate and router: composes 2 + 3 + 4 (gate, `"always"` policy, `MAP_TILE_BUSY`, `Retry-After`, CORS, OpenAPI).
- **Slice 6** is the web side. It needs slice 5's `503` + exposed `Retry-After` contract, though its own tests are pure client tests.
- **Slice 7** is the doc-sync bullet in `CLAUDE.md` and its mirror.

No migration, no seed.

---

## Slice 1 — per-kind tile simplify

Lines and points simplify with `ST_Simplify`; polygons keep `ST_SimplifyPreserveTopology` (spec §Surface 1).

**Files**

- Edit: `apps/api/src/services/portal-map-tile.service.ts`:
  - add `tileSimplifyExpr(geomExpr, tolerance, kind)`;
  - `buildRawTileSql` gains a trailing `kind` parameter;
  - `buildLineHybridTileSql` uses `"lines"`;
  - the call sites at `:862`/`:897` pass `aggregation.kind`.
- Edit: `apps/api/src/__tests__/services/portal-map-tile.service.test.ts`.
- Edit: `apps/api/src/__tests__/__integration__/db/map-aggregation.integration.test.ts`.
- Edit: `apps/api/src/__tests__/__integration__/routes/portal-map.router.integration.test.ts` (the lines fast-path case).

**Steps**

1. **Tests (spec: service unit cases 1–4; map-aggregation case; router-integration lines case).**
   - `tileSimplifyExpr` per kind, including `null` and tolerance 0.
   - `buildRawTileSql(…, "lines")` contains `ST_Simplify(` and not `ST_SimplifyPreserveTopology`.
   - The polygon path keeps SPT.
   - The hybrid builder uses `ST_Simplify(`.
   - A ranked raw lines tile still returns its non-sub-pixel features.
   - A lines-layer tile route still renders.

   Run; fail.
2. **Implement** the helper and thread `kind`. Green.
3. Lint + type-check.

**Done when:** the 6 cases pass and the existing tile suites stay green (polygon/dissolve snapshots unchanged).

**Risk:** existing string assertions in the service test that expect `ST_SimplifyPreserveTopology` on a lines layer. Update them deliberately; they encode the bug.

---

## Slice 2 — `AdmissionGate` utility

A bounded, per-key-fair async semaphore with wait timeout and abort (spec §Surface 2). Nothing calls it yet.

**Files**

- New: `apps/api/src/utils/admission-gate.util.ts`: `AdmissionGate`, `GateRejectedError`, `AdmissionGateOptions`, `GateRejectReason`.
- New: `apps/api/src/__tests__/utils/admission-gate.util.test.ts`.

**Steps**

1. **Tests (spec: admission-gate cases 1–11).**
   - Admission and ordering: FIFO admission to `concurrency`; `queue_full`; `timeout` (fake timers); `perKeyLimit` skips a capped key.
   - Abort: abort-while-queued removes the waiter; abort-while-holding doesn't release.
   - Release: on reject; ordering under concurrent release; per-key count back to 0.
   - Housekeeping: `stats()`; no leaked timers.

   Run; fail.
2. **Implement.** Green.
3. Lint + type-check.

**Done when:** the 11 cases pass and the file has no importer outside its test.

**Risk:** per-key skipping must not starve a capped key forever. The test "capped key admitted once its own slot frees" covers it.

---

## Slice 3 — request signal, cancel state, typed errors

The vocabulary layer (spec §Surface 5, §7): a per-request `AbortSignal` and the cancel policy and reason in `RequestContext`, three `ApiCode`s, `toDbCancellationApiError`, and the app error-handler mapping. Nothing sets a cancel reason yet.

**Files**

- Edit: `apps/api/src/utils/request-context.util.ts`:
  - add the `signal`, `dbCancelPolicy`, `dbCancelReason` and `dbStarted` fields;
  - add `getRequestSignal`, `setDbCancelPolicy` and `getDbCancelReason`;
  - add internal `setDbCancelReason` / `markDbStarted` for slice 4.
- Edit: `apps/api/src/middleware/request-context.middleware.ts`: an `AbortController` per request, aborted on `res` `close` before `writableFinished`.
- Edit: `apps/api/src/constants/api-codes.constants.ts`: `MAP_TILE_BUSY`, `DB_ADMISSION_TIMEOUT`, `REQUEST_ABANDONED` (JSDoc citing #698).
- New: `apps/api/src/db/request-cancellation.util.ts`, containing **only** `toDbCancellationApiError` and `DB_ADMISSION_MAX_WAIT_MS` in this slice.
- Edit: `apps/api/src/app.ts`: the error handler maps non-`ApiError` errors through `toDbCancellationApiError`. `REQUEST_ABANDONED` logs at `info` and skips the write when `res.destroyed`.
- New: `apps/api/src/__tests__/middleware/request-context.middleware.test.ts`.
- New: `apps/api/src/__tests__/db/request-cancellation.util.test.ts`, holding the two mapping cases now.

**Steps**

1. **Tests.**
   - Middleware cases 1–3: abort on early close; no abort after finish; default policy.
   - The `toDbCancellationApiError` cases (spec: request-cancellation unit cases 10–11): both reasons map; a plain `57014` with no reason is ignored.

   Run; fail.
2. **Implement.** Green.
3. Lint + type-check.

**Done when:** 5 cases pass. Every existing API test is unaffected: the signal is only ever read.

**Risk:** `res.on("close")` also fires after a normal finish. The guard is `!res.writableFinished`, pinned by middleware case 2.

---

## Slice 4 — SQL instrumentation + request admission deadline

`instrumentSqlForRequests` wraps the pool handed to drizzle. It gives every route before-start cancel on disconnect and the 30 s admission deadline (spec §Surface 6, decision table).

**Files**

- Edit: `apps/api/src/db/request-cancellation.util.ts`: `instrumentSqlForRequests(sql, { maxWaitMs })` wraps `unsafe` and `begin`/`savepoint`-scoped sql, tracks each `Query`, and applies the policy table. Logs with `{ dbCancel, policy, queued }`.
- Edit: `apps/api/src/db/client.ts`: `drizzle(instrumentSqlForRequests(connection), { schema })`. `reserveConnection`/`closeDatabase` stay on the raw `connection`.
- Edit: `apps/api/src/__tests__/db/request-cancellation.util.test.ts`: unit cases 1–9 against fake `Query`/`Sql`.
- New: `apps/api/src/__tests__/__integration__/db/request-cancellation.integration.test.ts`: integration cases 1–6, each on its own `postgres(url, { max: 1 })`, wrapped, inside `requestContext.run`.

**Steps**

1. **Unit tests (cases 1–9).**
   - Passthrough with no context.
   - Before-start: queued + abort → cancel; active + abort → keep; abort after `dbStarted` → later queued query kept.
   - Always: active + abort → cancel.
   - Deadline: fires on queued; not after acquire.
   - Cleanup on settle; `begin` scope wrapped.

   Run; fail.
2. **Integration tests (cases 1–6).**
   - A cancelled queued `INSERT` never executes.
   - A deadline-cancelled `INSERT` never executes and maps to `DB_ADMISSION_TIMEOUT`.
   - An active `pg_sleep(5)` under `"always"` is cancelled within ~1 s and is gone from `pg_stat_activity`.
   - An active statement under `"before-start"` completes.
   - A queued `begin` past the deadline leaves no partial writes.
   - No context → nothing cancelled.

   Run; fail.
3. **Implement** the wrapper, then wire `client.ts`. Green.
4. Run the **full** `apps/api` unit + integration suites once, here rather than per-file: this slice touches every DB call. Lint + type-check.

**Done when:** 15 cases pass and both full API suites are green.

**Risk:** the highest-risk slice, because it touches every query.
- It relies on postgres.js's internal `Query.state`; integration case 4 is the canary.
- The wrapper must preserve drizzle's chained calls (`.values()`, `.execute()`). Return the original `Query` object and never a new promise, so the chain and its types are untouched.
- If the full suites show any regression, stop and fix before slice 5.

---

## Slice 5 — tile gate + router contract

The tile gate wraps the tile query work. Tiles opt into the `"always"` policy, and overload becomes `503 MAP_TILE_BUSY` + `Retry-After` (spec §Surface 3, 4, 7).

**Files**

- Edit: `apps/api/src/services/portal-map-tile.service.ts`:
  - the `TILE_GATE_*` / `TILE_BUSY_RETRY_AFTER_S` constants and `tileAdmissionGate`;
  - `RenderTileDeps.gate`;
  - `renderTile` wraps `runTileQuery` in `gate.run(organizationId, getRequestSignal(), …)` and maps `GateRejectedError`;
  - `mapTileError` checks `toDbCancellationApiError` first;
  - a `warn` log on rejection with `stats()`.
- Edit: `apps/api/src/routes/portal-map.router.ts`:
  - `handle()` calls `setDbCancelPolicy("always")`;
  - sets `Retry-After` on `MAP_TILE_BUSY`;
  - a `503` in both `@openapi` blocks.
- Edit: `apps/api/src/app.ts`: `exposedHeaders` adds `"Retry-After"`.
- Edit: `apps/api/src/__tests__/services/portal-map-tile.service.test.ts`: service cases 5–9.
- Edit: `apps/api/src/__tests__/__integration__/routes/portal-map.router.integration.test.ts`: router-integration cases 2–4.

**Steps**

1. **Unit tests (service cases 5–9).**
   - `renderTile` runs through `deps.gate` with the org key.
   - The 304 path skips the gate.
   - `queue_full` → `MAP_TILE_BUSY` 503 + `retryAfterSeconds`.
   - `aborted` → `REQUEST_ABANDONED`.
   - `mapTileError` prefers the cancellation mapping.

   Run; fail.
2. **Integration tests (router cases 2–4).**
   - A saturated injected gate → 503 `MAP_TILE_BUSY`, `Retry-After: 2`.
   - The CORS response exposes `Retry-After`.
   - `/api/docs/spec` documents the 503 on both tile routes.

   Run; fail.
3. **Implement.** Green.
4. Lint + type-check.

**Done when:** 8 cases pass and the existing tile integration suite (reader-role 503s, rollback, hybrid, fast path) stays green.

**Risk:** the router-integration "saturated gate" case needs a seam. Expose the gate through `RenderTileDeps`, or a test-only reset of `tileAdmissionGate`; never a module-level mock. Choose the deps seam if `handle()` can pass deps, otherwise add a small `__setTileGateForTests`, documented as a test seam.

---

## Slice 6 — web busy state + `Retry-After` backoff

The map shows a distinct busy notice and pauses the tab's tile queue when the server says so (spec §Surface 8).

**Files**

- Edit: `apps/web/src/modules/MapWidget/utils/tile-source.util.ts`: `TileStatus.busy`, `EMPTY_TILE_STATUS.busy`, and `readTileStatus` (503 → busy, excluded from `failed`).
- Edit: `apps/web/src/modules/MapWidget/utils/tile-protocol.util.ts`: `parseRetryAfter`, `pauseTileFetches`; `acquireFetchSlot` honours the pause; `fetchTile` pauses on 503 before throwing.
- Edit: `apps/web/src/modules/MapWidget/MapWidget.component.tsx`: the `map-widget-tile-busy` notice.
- Edit: `apps/web/src/modules/MapWidget/__tests__/tile-protocol.util.test.ts` (cases 1–5), `__tests__/tile-source.util.test.ts` (cases 1–2) and `__tests__/MapWidget.test.tsx` (case 1).

**Steps**

1. **Tests (web cases, 8 total).**
   - The 503 pause window (fake timers) and `parseRetryAfter` clamps.
   - The longest pause wins; an abort during the pause drops the tile; a 503 still throws.
   - `readTileStatus` 503/504; the busy notice renders.

   Run; fail.
2. **Implement.** Green.
3. `npm run lint && npm run type-check` in `apps/web` (the zero-warning gate). If the pure-UI `MapWidgetUI` gains a prop, update its story too.

**Done when:** 8 cases pass and the existing tile-protocol cap/abort tests stay green.

**Risk:** the pause is module-global, like the #350 cap, so every map in the tab pauses. That's intended, since they share the server, but reset module state between tests (the existing suite's pattern).

---

## Slice 7 — convention doc-sync

**Files**

- Edit: `CLAUDE.md` → *API Style Guide*: one bullet. DB work in a request is cancelled on client disconnect only before it starts (`"before-start"`), and queued first queries fail with `503 DB_ADMISSION_TIMEOUT` after 30 s. A read-only route whose work is safe to cut mid-flight opts into `setDbCancelPolicy("always")` (tiles are the reference). Expensive per-request DB work goes behind an `AdmissionGate`.
- Edit: `.github/copilot-instructions.md`: the same bullet, mirrored.

**Steps**

1. **Test:** `npm run lint:doc-pointers` (the durable-doc pointer gate) stays green. There's no behavioural test.
2. Write the bullets.

**Done when:** both files carry the bullet, and the pointer lint is green.

**Risk:** none.

---

## Sequence summary

| # | Lands | Gate |
|---|---|---|
| 1 | Per-kind simplify (fixes the contour map) | 6 cases; tile suites green |
| 2 | `AdmissionGate` | 11 cases |
| 3 | Request signal, cancel state, 3 `ApiCode`s, error mapping | 5 cases |
| 4 | SQL instrumentation + 30 s admission deadline (all routes) | 15 cases + **full API suites** |
| 5 | Tile gate, `MAP_TILE_BUSY`, `Retry-After`, CORS, OpenAPI | 8 cases |
| 6 | Web busy notice + `Retry-After` pause | 8 cases |
| 7 | `CLAUDE.md` + copilot mirror | `lint:doc-pointers` |

That's 53 cases in total, matching the spec.

## Cross-slice notes

- **The `ApiCode`s land in slice 3** even though `MAP_TILE_BUSY` is first thrown in slice 5. That keeps slice 5 free of forward deps, and the enum entries are inert until used.
- **`request-cancellation.util.ts` grows across slices 3 → 4**: the mapping first, then the wrapper. Its unit test file grows with it.
- **The full suites run only in slice 4.** Every other slice is file-scoped (`feedback_test_only_touched_files_locally`); CI runs the full suites on push.
- **Static Checks gate**: run `npm run build` at the root after slice 5. The new `ApiCode` and `TileStatus.busy` could ripple into typed fixtures in other packages (`feedback_core_model_change_run_full_build`).
- **Doc sync**:
  - **Slice 7** covers conventions.
  - **Help / glossary:** no user-facing copy describes tile limits, so nothing to change.
  - **OpenAPI:** the 503 is in slice 5.
  - **`docs/DEPLOYMENT_SECURITY_REVIEW.md`:** unaffected, since there's no new egress.
- **Smoke, after implementation:**
  - Re-open the contour portal on app-dev after deploy; this needs a merged `main`, so it's part of the post-merge smoke.
  - Locally: saturate the gate with a burst and watch `pg_stat_activity` while panning and closing the tab.

## Next step

Once discovery, spec and plan are confirmed, implementation starts on `fix/698-map-tile-pool-exhaustion` with slice 1, tests first, one commit per slice.
