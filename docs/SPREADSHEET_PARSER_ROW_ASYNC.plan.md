# Spreadsheet parser row-async refactor — Plan

**TDD-sequenced implementation of the contract in `docs/SPREADSHEET_PARSER_ROW_ASYNC.spec.md`. Six slices, each behind a green test suite, each landing as one commit. The slicing is shaped so the parser package's existing test suite stays the load-bearing regression net — every stage migration is gated by the existing fixture-based tests passing unchanged.**

Spec: `docs/SPREADSHEET_PARSER_ROW_ASYNC.spec.md`. Discovery: `docs/SPREADSHEET_PARSER_ROW_ASYNC.discovery.md`.

Run tests with:

```bash
# parser package gates
cd packages/spreadsheet-parsing && npm test

# api gates
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration

# repo gates at slice boundaries
npm run lint
npm run type-check
```

Each slice loop:

1. Write failing tests for the slice's new behaviour.
2. Implement the smallest change that makes them pass.
3. Run focused tests; confirm green.
4. **Run the entire parser test suite** — every existing interpret/replay test must continue to pass against the migrated stages. This is the slice's main regression gate.
5. Lint + type-check at slice boundary.
6. Commit.

The slices are sequenced so the destructive cuts (slice 5: `reassembleWorkbookFromChunks` deletion) come strictly after every reader has migrated.

---

## Slice 0 — `loadRange` on the `Sheet` interface (no behavior change)

**Why first.** Every subsequent slice consumes `loadRange`. Landing the type + the `EagerSheet` no-op implementation first is a pure additive change — every existing test passes unchanged, and the slice exists only to gate the type checker through subsequent migrations.

**Files**

- Edit: `packages/spreadsheet-parsing/src/workbook/types.ts` — add `loadRange(r0, r1): Promise<void>` to `Sheet`, export `RangeNotLoadedError`.
- Edit: `packages/spreadsheet-parsing/src/workbook/helpers.ts` — `makeSheetAccessor` becomes `EagerSheet`; its `loadRange` resolves immediately, `cell()` unchanged. Add `makeLazySheetAccessor(meta, fetcher)` as the second factory.
- Edit: `packages/spreadsheet-parsing/src/index.ts` — export `RangeNotLoadedError` + `makeLazySheetAccessor`.
- New: `packages/spreadsheet-parsing/src/__tests__/workbook/eager-sheet.test.ts` — pulled from the existing `helpers.test.ts` plus a `loadRange` no-op assertion.
- New: `packages/spreadsheet-parsing/src/__tests__/workbook/lazy-sheet.test.ts` — cases 1.1–1.6 below.

**Steps**

1. **Add the interface field.** `Sheet.loadRange(r0, r1): Promise<void>`. Export `RangeNotLoadedError` from `workbook/types.ts`.

2. **Implement `EagerSheet.loadRange`** as a `Promise.resolve()` no-op. Every existing `makeSheetAccessor` consumer continues to work.

3. **Implement `LazySheet`** via `makeLazySheetAccessor(meta, fetcher)`:
   - Internal state: `loadedRanges: Array<[r0, r1]>` (merged on each call) + `cellMap: Map<"r:c", WorkbookCell>` (populated as windows resolve).
   - `loadRange(r0, r1)`:
     - Clamp `[max(0, r0), min(meta.dimensions.rows - 1, r1)]`.
     - Subtract already-loaded segments; if nothing left, return immediately (idempotent).
     - Call `fetcher(remainingR0, remainingR1)`, await, populate `cellMap` with each returned `WorkbookCell`, merge the range into `loadedRanges`.
   - `cell(r, c)`:
     - If `r` is inside any loaded range, return `cellMap.get(\`${r}:${c}\`)` (may be `undefined` for genuinely sparse cells).
     - Otherwise throw `new RangeNotLoadedError(r, c)`.

4. **Write the lazy-sheet tests (cases 1.1–1.6).**
   - 1.1 — `await sheet.loadRange(0, 10)` calls the stub fetcher exactly once with `(0, 10)`; subsequent `cell(0, 0)` returns the cell the fetcher yielded.
   - 1.2 — `cell(r, c)` outside the loaded window throws `RangeNotLoadedError`.
   - 1.3 — `loadRange(0, 10)` then `loadRange(20, 30)` calls the fetcher twice; cells in both windows are readable; a cell in the unloaded `[11, 19]` gap throws.
   - 1.4 — calling `loadRange(0, 10)` twice fires the fetcher once.
   - 1.5 — `loadRange(-5, 1_000_000)` on a 100-row sheet clamps to `[0, 99]` (single fetcher call with the clamped range).
   - 1.6 — fetcher rejection (`new Error("redis down")`) propagates from `loadRange` (the promise rejects with the same error).

5. **Run cases 1.1–1.6** + the moved eager-sheet tests. Green.

6. **Run the entire parser test suite** unchanged. Every interpret + replay test passes — `EagerSheet` is the existing behavior under a new name.

7. **Lint + type-check.** Clean.

**Done when:** the `Sheet` interface carries `loadRange`; `EagerSheet` is a no-op; `LazySheet` is a fully-tested standalone unit with no consumers yet.

**Risk:** none beyond the type checker complaining at every existing `Sheet` implementation that doesn't yet have `loadRange`. There's exactly one (`makeSheetAccessor`); the slice's commit closes that.

---

## Slice 1 — Migrate `interpret/` stages to `loadRange`

**Why now.** Slice 0 made the API available; this is the first stage of consumers. Doing interpret before replay keeps each slice's diff small; both end up with the same pattern (await once near the top of each stage).

**Files**

- Edit: each `packages/spreadsheet-parsing/src/interpret/stages/*.ts` that calls `sheet.cell()` — survey: `detect-headers`, `detect-segments`, `detect-identity`, `classify-field-segments`, `classify-logical-fields`, `header-line.util`, and any other stage that reads cells.
- No new tests — the existing `packages/spreadsheet-parsing/src/__tests__/interpret/` suite is the regression net.

**Steps**

1. **Survey + map** each interpret stage that calls `sheet.cell()`. For each, identify the row window it scans (typically `region.bounds.startRow..region.bounds.endRow` for stages that operate per region).

2. **Migrate one stage at a time.** Pattern:

   ```ts
   // Before
   export function detectHeaders(state: InterpretState): InterpretState {
     for (const region of state.regions) {
       const sheet = state.workbook.sheets.find((s) => s.name === region.sheet);
       if (!sheet) continue;
       // ...reads sheet.cell(r, c) for r in bounds.startRow..bounds.endRow...
     }
     return ...;
   }

   // After
   export async function detectHeaders(state: InterpretState): Promise<InterpretState> {
     for (const region of state.regions) {
       const sheet = state.workbook.sheets.find((s) => s.name === region.sheet);
       if (!sheet) continue;
       await sheet.loadRange(region.bounds.startRow, region.bounds.endRow);
       // ...identical sync logic stays here...
     }
     return ...;
   }
   ```

3. **Update the interpret runner.** `interpret/index.ts` already awaits each stage's return today (per the discovery's audit). If a stage was sync and the runner called it without `await`, the runner picks up the `await` mechanically. Run the typechecker; fix the few sites that need it.

4. **Run the parser test suite.** Every interpret test passes — `EagerSheet.loadRange` is a no-op, the existing `WorkbookData` fixtures continue to work.

5. **Lint + type-check.** Clean.

**Done when:** every interpret stage that touches `sheet.cell()` awaits `loadRange` before reading; the parser test suite is green.

**Risk:** a stage's `loadRange` window is smaller than its scan — the scan then trips `RangeNotLoadedError` at runtime, but every existing interpret test catches this deterministically (`EagerSheet.loadRange` is a no-op, so the *eager* path doesn't see the throw, but the regression test still fails because the lazy migration in slice 4 is what surfaces the mismatch). **Mitigation**: when this happens, the test failure points at the stage; fix by widening the window. Catch it early by running slice 4's integration test (5 in the spec) against every intermediate commit during development, even before slice 4 lands as a commit.

---

## Slice 2 — Migrate `replay/` to `loadRange` + make `replay()` async

**Why now.** Same pattern as slice 1, applied to the replay package. `replay()`'s signature changes from sync to async — that ripples to the four callers in `apps/api`.

**Files**

- Edit: `packages/spreadsheet-parsing/src/replay/index.ts` — `replay()` becomes async.
- Edit: `packages/spreadsheet-parsing/src/replay/extract-records.ts` — `loadRange` per region; `scanTerminator` uses the paged pattern.
- Edit: `packages/spreadsheet-parsing/src/replay/drift.ts` — `loadRange` over identity column + header label range.
- Edit: `packages/spreadsheet-parsing/src/replay/resolve-headers.ts` — `loadRange` for the header row/col.
- Edit: callers of `replay()` in `apps/api/src/`:
  - `apps/api/src/services/layout-plan-commit.service.ts:130` — `const result = replay(plan, wb);` becomes `await replay(plan, wb)`.
  - `apps/api/src/services/microsoft-excel-connector.service.ts` (sync's `replay(plan, wb)` call).
  - Any other site found via `grep -rn "replay(" apps/api/src --include="*.ts"`.

**Steps**

1. **Migrate `extract-records`.** The bulk of replay's reads happen here.
   - For each region, `await sheet.loadRange(region.bounds.startRow, region.bounds.endRow)` once at the top of `extractRecords`.
   - The terminator-scan loop becomes:
     ```ts
     const WINDOW = 200;
     let cursor = startRow;
     let extent = startRow;
     while (cursor <= maxRow) {
       const end = Math.min(cursor + WINDOW - 1, maxRow);
       await sheet.loadRange(cursor, end);
       for (let r = cursor; r <= end; r++) {
         if (terminatorFires(r, sheet)) break outer;
         extent = r;
       }
       cursor = end + 1;
     }
     ```
     (Skeleton — actual implementation preserves the existing termination semantics.)

2. **Migrate `drift.ts`.** One `await sheet.loadRange(bounds.startRow, bounds.endRow)` covers the identity column + header label scans + anchor cell. Sync logic stays.

3. **Migrate `resolve-headers.ts`.** Header row/col is bounded by region; one `loadRange` covers it.

4. **Make `replay()` async.** Change signature, run typechecker, fix every caller. Inside the function: each `extractRecords` call already returns awaitable work after slice 2's edits to extract-records.

5. **Update apps/api callers.** Add `await` at each `replay(...)` call site. The three known sites:
   - `layout-plan-commit.service.ts:130` (commit pipeline).
   - `microsoft-excel-connector.service.ts` sync's `fetchWorkbookForSync → replay` chain.
   - Anywhere else surfaced by grep.

6. **Run the parser test suite.** Replay tests pass — the `EagerSheet` path is a no-op for `loadRange`. The async signature is invisible from the test's perspective (Jest awaits returned promises).

7. **Run `cd apps/api && npm run test:unit`** — confirm the apps/api callers got the `await` correctly. The type checker catches missed `await`s.

8. **Run `cd apps/api && npm run test:integration`** — every layout-plan-router / commit pipeline test that exercises replay continues to pass.

9. **Lint + type-check.** Clean.

**Done when:** `replay()` is async; every internal replay helper that reads cells has loaded its range first; every apps/api caller awaits.

**Risk:** `scanTerminator`'s windowed-load pattern has more moving parts than the static-window stages. The existing terminator tests in `packages/spreadsheet-parsing/src/replay/__tests__/` cover the relevant cases (untilBlank / fixed count / etc.); if any of those tests fail, the diff's the smoking gun. **Mitigation**: write the dynamic-scan loop as a small isolated helper (`forEachRowInWindow(sheet, startRow, maxRow, WINDOW, predicate)`) so the windowing logic is testable on its own — bolt-on test if needed.

---

## Slice 3 — `makeLazyWorkbookFromCache` factory in apps/api

**Why now.** Slices 1–2 established that consumers work with both `EagerWorkbook` and (hypothetically) `LazyWorkbook`. This slice ships the `LazyWorkbook` factory itself, behind a unit test using a stub reader. Still no production caller switches over (that's slice 4).

**Files**

- New: `apps/api/src/utils/lazy-workbook.util.ts` — `makeLazyWorkbookFromCache(prefix, sheetMetas)` + supporting types.
- New: `apps/api/src/__tests__/utils/lazy-workbook.util.test.ts` — case 4 from the spec.

**Steps**

1. **Define `LazySheetMeta`** (matching the spec):
   ```ts
   export interface LazySheetMeta {
     id: string;
     name: string;
     rowCount: number;
     colCount: number;
   }
   ```

2. **Implement `makeLazyWorkbookFromCache`.** One `LazySheet` per meta, each closing over `WorkbookCacheService.readRowRange(prefix, meta.id, r0, r1)` as the fetcher. The fetcher returns `WorkbookCell[]` — adapt `readRowRange`'s row-shape output (dense `string[][]` per chunk) into `WorkbookCell` records via the existing `inflateRowToCells(row, rowIdx)` helper (or extract it from `workbook-preview.util.ts`).

3. **Write the factory test (case 4).** Mock `WorkbookCacheService.readRowRange` to return a synthetic dense row payload; build a workbook; call `await sheet.loadRange(0, 10)`; assert:
   - The mock was called once with `(prefix, sheetId, 0, 10)`.
   - `workbook.sheets[0].cell(5, 2)` returns the expected `WorkbookCell` shape.
   - `workbook.sheets[0].cell(50, 0)` throws `RangeNotLoadedError`.

4. **Run case 4.** Green.

5. **Lint + type-check.** Clean.

**Done when:** the factory is callable and unit-tested; nothing in production uses it yet.

**Risk:** the row-payload-to-`WorkbookCell` adapter needs to match `readRowRange`'s output exactly. **Mitigation**: read `readRowRange`'s implementation + tests first; if needed, the adapter is a small isolated helper covered by its own test.

---

## Slice 4 — Switch orchestrators to `LazyWorkbook`

**Why now.** All the pieces are in place — slice 1+2 lets consumers operate on lazy sheets; slice 3 provides the lazy factory. This slice flips the production code path.

**Files**

- Edit: `apps/api/src/services/google-sheets-connector.service.ts` — `resolveWorkbook` builds a `LazyWorkbook` instead of calling `reassembleWorkbookFromChunks`.
- Edit: `apps/api/src/services/microsoft-excel-connector.service.ts` — same for both `resolveWorkbook` (line ~415) and `fetchWorkbookForSync` (line ~527).
- Edit: `apps/api/src/services/file-upload-session.service.ts` — same for `resolveWorkbook` (line ~696).
- Edit: `apps/api/src/services/layout-plan-draft.service.ts` — `resolveWorkbookBySource` now returns `Promise<Workbook>` (was `Promise<WorkbookData>`).
- Edit: `apps/api/src/services/layout-plan-interpret.service.ts` — `analyze(workbook: Workbook, ...)`.
- Edit: `apps/api/src/services/layout-plan-commit.service.ts` — `commit(...)` accepts `Workbook` in its body; `validateWorkbook` deletes.
- New: `apps/api/src/__tests__/__integration__/services/layout-plan-row-async.integration.test.ts` — case 5 from the spec.

**Steps**

1. **Migrate each `resolveWorkbook` site.** Pattern:

   ```ts
   // Before
   async resolveWorkbook(connectorInstanceId, organizationId): Promise<WorkbookData> {
     const meta = await WorkbookCacheService.getSessionMeta(prefix);
     // ... cache-miss fallback re-parses ...
     return reassembleWorkbookFromChunks(prefix, meta);
   }

   // After
   async resolveWorkbook(connectorInstanceId, organizationId): Promise<Workbook> {
     const meta = await WorkbookCacheService.getSessionMeta(prefix);
     // ... cache-miss fallback re-parses ...
     return makeLazyWorkbookFromCache(prefix, meta.sheets);
   }
   ```

2. **Update the type seam at `layout-plan-draft.service.ts`.** `resolveWorkbookBySource` now returns `Workbook`. Downstream callers (interpret, commit, sync) need the type update.

3. **Drop `validateWorkbook` in `layout-plan-commit.service.ts`.** The orchestrator hands a `Workbook` directly. `body: { workbook: Workbook }` is typed; runtime validation is unnecessary because the cache layer is upstream.

4. **Update `LayoutPlanInterpretService.analyze` and `LayoutPlanCommitService.commit` signatures.** They accept `Workbook`. Existing tests that build `WorkbookData` literals continue to work — they wrap via `makeWorkbook(...)` (eager) to produce a `Workbook` argument.

5. **Write the integration test (case 5).**
   - Seed a chunked-cache prefix (use the same fixture builder the file-uploads tests use) with a 5,000-row × 10-col synthetic CSV.
   - Build a `Workbook` via `makeLazyWorkbookFromCache(prefix, meta.sheets)`.
   - Call `LayoutPlanInterpretService.analyze(workbook, [], orgId, userId)`; assert the produced plan's region count + per-region binding count match a snapshot computed from the same input fed through `reassembleWorkbookFromChunks → analyze` (run both paths and compare; the legacy path's reassemble call is still callable in this slice, deletes in slice 5).
   - Call `LayoutPlanCommitService.commit(...)` with the lazy workbook; assert `result.recordCounts` matches the legacy path.

6. **Run case 5** plus the full apps/api integration suite. Green.

7. **Lint + type-check.** Clean.

**Done when:** every production code path that previously called `reassembleWorkbookFromChunks` now calls `makeLazyWorkbookFromCache`; the helper exists but is unreferenced from `apps/api/src/services/`. Slice 5 deletes it.

**Risk:** the orchestrators' cache-miss re-parse paths need to play nicely with the lazy factory. **Mitigation**: re-parse already populates the chunked cache via the existing writer; after re-parse, the factory call is the same. No new failure mode introduced.

---

## Slice 5 — Delete `reassembleWorkbookFromChunks`

**Why now.** After slice 4, the only references to `reassembleWorkbookFromChunks` are in its own tests + the integration test from case 5 (which calls it for the equivalence assertion). Once we trust the new path, the legacy is dead weight.

**Files**

- Edit: `apps/api/src/utils/workbook-preview.util.ts` — delete `reassembleWorkbookFromChunks` (and any private helpers used only by it).
- Edit: `apps/api/src/__tests__/utils/workbook-preview.util.test.ts` (if it exists) — delete the helper's tests.
- Edit: `apps/api/src/__tests__/__integration__/services/layout-plan-row-async.integration.test.ts` — drop the legacy-path comparison; assert the lazy-path result against a frozen snapshot built once and committed alongside.

**Steps**

1. **Grep + verify**:
   - `grep -rn "reassembleWorkbookFromChunks" apps/api/src` returns matches only inside the helper itself, its tests, and the case-5 integration test.
   - Delete each match (and the helper) cleanly.

2. **Reshape case 5's assertion.** The comparison was "lazy path equals legacy path on same input." With the legacy gone, the test asserts the lazy path against a snapshot — built once at slice-5 commit time, committed as a fixture next to the test. Future regressions trip the snapshot.

3. **Run the full apps/api integration + unit suites.** Green.

4. **Final grep gates** (acceptance criteria from the spec):
   - `grep -rn "reassembleWorkbookFromChunks" apps/api/src` → 0 matches.
   - `grep -rn "WorkbookData" apps/api/src/services` → matches only where the type is genuinely needed (legacy contract types, test fixtures that build via `makeWorkbook`). The orchestrator surface no longer mentions `WorkbookData`.

5. **Lint + type-check.** Clean.

**Done when:** `reassembleWorkbookFromChunks` is gone; the integration test's snapshot is the source of truth for the lazy path's per-region output; the parser test suite is unchanged.

**Risk:** an external caller still depends on `reassembleWorkbookFromChunks`. Grep at step 1 is the gate.

---

## Slice 6 — Memory smoke + acceptance criteria

**Files**

- New: `apps/api/src/__tests__/__integration__/services/layout-plan-row-async-memory.integration.test.ts` — case 6 from the spec. Gated behind `RUN_SLOW_TESTS=1`.

**Steps**

1. **Write the memory smoke test (case 6).**
   - Seed a chunked-cache prefix with a 50,000-row × 20-col synthetic CSV.
   - Spawn a child process (`child_process.spawn`) running the apps/api test suite with `NODE_OPTIONS=--max-old-space-size=512` against just the `LayoutPlanCommitService.commit` flow over the lazy workbook.
   - Assert: the child exits cleanly (no signal-9, no `JavaScript heap out of memory` in stderr).
   - Document expected runtime in a comment (likely ~30s on dev hardware; the test's threshold is "completes," not "completes in N seconds").

2. **Run with `RUN_SLOW_TESTS=1`.** Green.

3. **Manual smoke run-book.**
   - `npm run dev` in `apps/api` + `apps/web`.
   - Upload a 50 MB CSV via the new-connector wizard.
   - Watch RSS during parse (already streaming) + commit (the new lazy path). Confirm RSS stays well under the API task's 8 GB Fargate cap with `NODE_OPTIONS=--max-old-space-size=2048` (i.e., the wide-headroom override from `LARGE_FILE_PARSE_STREAMING.plan.md` becomes unnecessary; we keep it for defense in depth but it's no longer load-bearing).
   - Verify the committed records render in the connector-instance detail view.

4. **Verify every acceptance-criteria checkbox** from `docs/SPREADSHEET_PARSER_ROW_ASYNC.spec.md#acceptance-criteria`. Each should be satisfied at this point.

**Done when:** case 6 passes under `RUN_SLOW_TESTS=1`; the manual smoke clears every acceptance criterion.

**Risk:** the 50k-row seed may exceed the integration test runner's default timeout (`30_000` ms in `jest.integration.config.js`). **Mitigation**: per-test `timeout: 120_000` ms on the slow case; the test is `RUN_SLOW_TESTS=1`-gated so it doesn't slow CI by default.

---

## Cross-slice gates

After every slice:

1. `cd packages/spreadsheet-parsing && npm test` is green. **This is the primary regression net.** Every existing interpret + replay test passes against the migrated stages, unchanged. If one fails, the migration broke a behavior the eager-path fixtures encode.
2. `cd apps/api && npm run test:unit && npm run test:integration` is green.
3. `npm run lint && npm run type-check` from repo root are clean.
4. `git diff --stat` matches the slice's "Files" list.

After slice 4, before slice 5:

- `grep -rn "reassembleWorkbookFromChunks" apps/api/src/services` returns **zero** matches. (The only matches left are in `workbook-preview.util.ts` itself + the integration test.)
- This is the gate that says "slice 5's destructive cut is safe to run."

After slice 5 (refactor end):

- All new test cases (1.1–1.6, 4, 5, 6) pass.
- All 6 acceptance-criteria checkboxes from the spec are satisfied.
- The manual `npm run dev` + 50 MB CSV smoke reproduces parse + commit without OOM under a constrained `--max-old-space-size=2048`.

---

## What this plan does *not* attempt

- **Pure streaming `interpret` / `replay`.** Discovery option C. Defer until metrics demand it.
- **Merge-metadata re-introduction.** The streaming xlsx adapter dropped merge cell metadata back in Phase 2 of the earlier work. This refactor doesn't change that.
- **`computeWorkbookFingerprint` async migration.** Fingerprinting reads 1–2 cells per sheet. Stays sync. Callers `await sheet.loadRange(0, 0)` before invoking it; trivially small.
- **Cache layer changes.** `WorkbookCacheService.readRowRange` is reused as-is. No new TTL, no new keying, no new compression.
- **Backwards-compat shim for an old `WorkbookData`-typed `analyze` / `commit`.** Internal monorepo only; type checker catches every site. Clean cut.
