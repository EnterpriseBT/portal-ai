# Spreadsheet parser row-async refactor — Spec

**`interpret()` and `replay()` no longer require a fully-materialized `WorkbookData` in process memory. Each parser stage declares the row windows it needs via `await sheet.loadRange(r0, r1)` before reading; the underlying `Sheet` lazily backs those windows by streaming row chunks from the existing Redis cache. After this refactor, no production code path holds an entire workbook in V8 heap.**

Discovery: `docs/SPREADSHEET_PARSER_ROW_ASYNC.discovery.md`. Option D (composite — `loadRange` inside the parser + a `LazyWorkbook` adapter at the orchestration boundary).

Phase 4 of `docs/LARGE_FILE_PARSE_STREAMING.plan.md` ended with `reassembleWorkbookFromChunks` as the remaining OOM surface — interpret/commit still build a complete `WorkbookData` per request. This spec defines the contract that lets us delete that helper.

## Scope

### In scope

1. **`Sheet.loadRange(r0, r1)` accessor** added to the existing `Sheet` interface in `packages/spreadsheet-parsing/src/workbook/types.ts`. After `await sheet.loadRange(a, b)`, every `cell(r, c)` for `r ∈ [a, b]` is sync + correct. Calls outside the loaded window throw `RangeNotLoadedError`. Loaded windows are cumulative — a stage that calls `loadRange(0, 50)` then `loadRange(100, 150)` can read both ranges synchronously. Repeated calls for already-loaded windows are no-ops.

2. **Two `Sheet` implementations** behind that interface:
   - `EagerSheet` — produced by `makeWorkbook(data: WorkbookData)`. Pre-loaded from the input `cells` array; `loadRange` is a no-op resolving immediately. Sync forever. **Every parser unit test continues to work unchanged through this path.**
   - `LazySheet` — produced by `makeLazyWorkbookFromCache(...)` in `apps/api`. Backs `loadRange` with `WorkbookCacheService.readRowRange`. Each call resolves the chunk keys intersecting `[r0, r1]`, parses them, and populates the in-memory map. Out-of-window `cell()` throws.

3. **Parser stages migrate to `loadRange`**. Each stage that reads cells calls `await sheet.loadRange(...)` once near the top with the row window it intends to scan; the rest of the stage stays sync. Stages that scan dynamically (e.g., `replay/extract-records.scanTerminator`) loop with incremental `loadRange(cursor, cursor + WINDOW)` calls.

4. **`replay()` becomes async.** Its existing sync surface (`function replay(plan, workbook): ReplayResult`) becomes `async function replay(plan, workbook): Promise<ReplayResult>`. Every caller already invokes it from an `async` context (server routes, sync processors); the migration is mechanical.

5. **`interpret()` stays async** (its existing signature). Internal stages that were sync today (each takes `state` and returns `state`) become async (`async (state) => Promise<state>`) where they call `loadRange`. The interpret runner already awaits each stage; no orchestration change.

6. **`LazyWorkbook` factory in `apps/api`**. New `apps/api/src/utils/lazy-workbook.util.ts` exports `makeLazyWorkbookFromCache(prefix, sheetMetas)` which builds a `Workbook` whose sheets back `loadRange` with `WorkbookCacheService.readRowRange(prefix, sheetId, r0, r1)`. The factory takes the already-loaded `SheetMeta[]` (the parser needs sheet dimensions sync) so a `getMeta` round-trip happens once at construction; per-`loadRange` is one batched `MGET` over the intersecting chunk keys.

7. **Orchestrators return `LazyWorkbook`**. The four `resolveWorkbook` call sites (`google-sheets-connector.service.ts`, `microsoft-excel-connector.service.ts:415` + `:527`, `file-upload-session.service.ts`) stop calling `reassembleWorkbookFromChunks` and call `makeLazyWorkbookFromCache(prefix, meta)` instead. Same return type from the orchestrators' perspective: `Workbook`. Downstream callers (interpret/commit) see a `Workbook` and don't care which factory built it.

8. **Delete `reassembleWorkbookFromChunks`**. Once all callers migrate, the helper and its tests are removed.

9. **Tests at every layer**:
   - Parser unit tests of new `loadRange` semantics on both `EagerSheet` + `LazySheet` (the lazy one mocked over a fake reader).
   - Parser unit tests that the migrated stages still produce identical output (regression net).
   - Integration tests in `apps/api` that interpret + commit run end-to-end against a 50k-row chunked-cache fixture without `reassembleWorkbookFromChunks` (and without OOM under a constrained `NODE_OPTIONS=--max-old-space-size=512` runner).

### Out of scope

- **Push-based row streams** (option C in discovery). Pure streaming would let us delete `loadRange` entirely, but it requires every interpret stage to be rewritten around a row source. Defer until metrics show per-region fetch cost is the bottleneck.
- **Adding `mergedRange` / merge-metadata accessors**. XLSX merge metadata is dropped by the streaming adapter (`LARGE_FILE_PARSE_STREAMING.plan.md` Phase 2 notes); this refactor doesn't change that.
- **TTL changes / cache-layer rewrites**. `WorkbookCacheService.readRowRange` is reused as-is.
- **`computeWorkbookFingerprint` migration**. Fingerprinting reads only the top-left anchor cell per sheet — already trivially small. It stays sync, accepting either an `EagerWorkbook` or a `LazyWorkbook` whose `loadRange(0, 0)` has been awaited at the call site.
- **Parser package's public API renames**. `Workbook`, `Sheet`, `WorkbookData`, `WorkbookCell` — all stay. The `Sheet` interface gains `loadRange`; that's the only public surface change.

## Concept changes

### `loadRange` semantics

```ts
interface Sheet {
  // existing surface
  name: string;
  dimensions: SheetDimensions;
  cell(row: number, col: number): WorkbookCell | undefined;
  range(r0, c0, r1, c1): (WorkbookCell | undefined)[][];

  // new — see also `RangeNotLoadedError` below
  loadRange(r0: number, r1: number): Promise<void>;
}
```

- `r0` / `r1` are **inclusive** row indices. (Matches the existing `range()` convention.)
- After `await loadRange(a, b)`, every `cell(r, c)` for `a ≤ r ≤ b` (and any `c`) is sync + correct and returns `WorkbookCell | undefined` per today's semantics.
- Calling `cell(r, c)` for `r ∉ ⋃ loaded ranges` throws `RangeNotLoadedError("Cell at (r=…, c=…) is outside the loaded window")`. The throw is intentional — a forgotten `loadRange` is a programmer error, not a sparse-cell condition.
- `EagerSheet.loadRange` always resolves immediately; every cell is considered loaded. No throws.
- `LazySheet.loadRange` reads the chunk keys intersecting `[r0, r1]` from the cache, parses, and merges into its internal `Map<"row:col", WorkbookCell>`. Loaded windows union; no eviction inside a single parser invocation.
- `loadRange` is **idempotent**. Calling it twice with the same window does one fetch.
- `loadRange` clamps to the sheet's `dimensions.rows` at the upper bound and `0` at the lower; out-of-bounds windows resolve as no-ops without fetching.

### `RangeNotLoadedError`

A typed error exported from `@portalai/spreadsheet-parsing` so callers can distinguish it from sparse-cell `undefined`:

```ts
export class RangeNotLoadedError extends Error {
  constructor(public readonly row: number, public readonly col: number) {
    super(`Cell at (row=${row}, col=${col}) is outside the loaded window`);
    this.name = "RangeNotLoadedError";
  }
}
```

Thrown only by `LazySheet.cell`. Stages that catch the throw to fall back to a `loadRange` retry are an anti-pattern — load up-front, then read. The throw is a backstop, not a control-flow signal.

### `LazyWorkbook` factory shape

```ts
// apps/api/src/utils/lazy-workbook.util.ts

export interface LazySheetMeta {
  id: string;
  name: string;
  rowCount: number;
  colCount: number;
}

export function makeLazyWorkbookFromCache(
  prefix: string,
  sheetMetas: ReadonlyArray<LazySheetMeta>,
  deps: { workbookCacheService: typeof WorkbookCacheService } = { workbookCacheService: WorkbookCacheService }
): Workbook;
```

Why `sheetMetas` passed in:
- `Workbook.sheets` exposes `Sheet[]` synchronously today. Callers iterate `workbook.sheets`, read `.name` and `.dimensions`, and then `await sheet.loadRange(...)`.
- The metas (sheet ids + dimensions) come from `WorkbookCacheService.getSessionMeta(prefix)` — a single round-trip the orchestrator already does to validate the session before calling the factory. Passing the result through keeps the factory pure and synchronous to construct.

The factory returns a `Workbook` whose `.sheets` is a `LazySheet[]` built one per meta. Each `LazySheet` closes over `prefix` + `meta.id`; `loadRange` calls `WorkbookCacheService.readRowRange(prefix, meta.id, r0, r1)`, parses the result into `WorkbookCell[]`, and merges into the in-memory map.

### Orchestrator return shape

All four `resolveWorkbook`-shaped functions stop returning `WorkbookData` and start returning `Workbook`. The signature changes from:

```ts
async function resolveWorkbook(...): Promise<WorkbookData>
```

to:

```ts
async function resolveWorkbook(...): Promise<Workbook>
```

Internally they:
1. `getSessionMeta(prefix)` → check ready / re-parse on cache miss (same fallback as today).
2. `makeLazyWorkbookFromCache(prefix, sheetMetas)` → return.

`reassembleWorkbookFromChunks` is no longer called. The caller (interpret / commit) accepts a `Workbook` directly, the same shape today's `replay()` already accepts (it currently coerces `WorkbookData` via `makeWorkbook` if needed; that coercion stays, only the lazy-construction path becomes the default).

### `LayoutPlanInterpretService.analyze` and `LayoutPlanCommitService.commit` signatures

Both today accept `WorkbookData` and call into `interpret({ workbook: ... })` / `replay(plan, workbook)`. After the refactor they accept `Workbook`:

```ts
LayoutPlanInterpretService.analyze(workbook: Workbook, hints, orgId, userId): Promise<LayoutPlan>;

LayoutPlanCommitService.commit(
  connectorInstanceId, planId, organizationId, userId,
  body: { workbook: Workbook },
  syncOptions: CommitSyncOptions = {}
): Promise<LayoutPlanCommitResult>;
```

`validateWorkbook` (currently coerces `unknown` → `WorkbookData`) drops; the orchestrator hands a `Workbook` directly, the parser internals accept it. The `body: { workbook: unknown }` shape was only there to defend against malformed cache payloads — now the cache layer is upstream of the orchestrator and produces a typed `Workbook` or throws.

### Per-stage `loadRange` pattern

Each interpret stage and each replay stage starts with:

```ts
// interpret/stages/detect-headers.ts (illustrative)
export async function detectHeaders(state: InterpretState): Promise<InterpretState> {
  const newRegions: Region[] = [];
  for (const region of state.regions) {
    const sheet = state.workbook.sheets.find((s) => s.name === region.sheet);
    if (!sheet) continue;
    await sheet.loadRange(region.bounds.startRow, region.bounds.endRow);
    // ...existing sync logic stays here...
  }
  return { ...state, regions: newRegions };
}
```

Stages with dynamic extents (replay's `scanTerminator`) follow a paged pattern:

```ts
const WINDOW = 200;
let cursor = startRow;
while (cursor <= maxRow) {
  await sheet.loadRange(cursor, Math.min(cursor + WINDOW, maxRow));
  // walk synchronously within the loaded window
  // break early if terminator fires
  cursor += WINDOW;
}
```

### Test fixtures unchanged

Every test that builds a `Workbook` via `makeWorkbook({ sheets: [...] })` continues to work unchanged. `makeWorkbook` now produces an `EagerWorkbook` whose `loadRange` is a no-op. The migrated stages call `loadRange` once; on an `EagerWorkbook` that's a cheap synchronous resolve, and the test assertions are identical to today's.

The only new test surface is:
- `LazySheet` unit tests (`loadRange` actually fetches, merges, throws on out-of-window) — using a stub reader.
- Integration tests in `apps/api` that exercise the `LazyWorkbook` factory + interpret/commit through it.

## Surface

### `packages/spreadsheet-parsing/src/workbook/types.ts` (edit)

Add `loadRange` to the `Sheet` interface. Export `RangeNotLoadedError`.

### `packages/spreadsheet-parsing/src/workbook/helpers.ts` (edit)

`makeSheetAccessor` becomes the `EagerSheet` implementation. Add a new helper `makeLazySheetAccessor(meta, fetcher)` for the lazy form:

```ts
export function makeLazySheetAccessor(
  meta: { name: string; dimensions: SheetDimensions; id: string },
  fetcher: (r0: number, r1: number) => Promise<WorkbookCell[]>
): Sheet;
```

`fetcher` is the only side-effectful seam; it's implemented in `apps/api`'s `makeLazyWorkbookFromCache` as a closure over `WorkbookCacheService.readRowRange`. The parser package itself never imports the cache service.

### `packages/spreadsheet-parsing/src/replay/index.ts` (edit)

`function replay(plan, workbook)` → `async function replay(plan, workbook)`. The internal helpers (`extractRecords`, `drift`, etc.) become async at each call boundary where they hit `loadRange`.

### `packages/spreadsheet-parsing/src/interpret/` (edit)

Each stage's function signature becomes async if it touches `loadRange`. The interpret runner (`interpret/index.ts`) is already orchestrating async stages — no runner change.

### `apps/api/src/utils/lazy-workbook.util.ts` (new)

`makeLazyWorkbookFromCache(prefix, sheetMetas)` factory described above.

### `apps/api/src/services/google-sheets-connector.service.ts` (edit)

`resolveWorkbook` returns `Promise<Workbook>` via the lazy factory. The reassemble path is deleted.

### `apps/api/src/services/microsoft-excel-connector.service.ts` (edit)

Same as google-sheets, for both `resolveWorkbook` and `fetchWorkbookForSync`.

### `apps/api/src/services/file-upload-session.service.ts` (edit)

Same.

### `apps/api/src/services/layout-plan-draft.service.ts` (edit)

`resolveWorkbookBySource` returns `Promise<Workbook>` (was `Promise<WorkbookData>`).

### `apps/api/src/services/layout-plan-interpret.service.ts` (edit)

`analyze` accepts `Workbook`.

### `apps/api/src/services/layout-plan-commit.service.ts` (edit)

`commit`'s `body.workbook` typed as `Workbook`. `validateWorkbook` deletes.

### `apps/api/src/utils/workbook-preview.util.ts` (edit)

`reassembleWorkbookFromChunks` deletes once all callers migrate (slice 5). Tests for the helper delete with it.

## Tests

### Parser unit tests (`packages/spreadsheet-parsing/src/__tests__/`)

1. **`workbook/lazy-sheet.test.ts` (new)**:
   - `loadRange(0, 10)` calls the fetcher with `[0, 10]`, populates the map, makes `cell(0, 0)` synchronously available.
   - `cell(r, c)` outside the loaded window throws `RangeNotLoadedError`.
   - Loaded windows are cumulative — `loadRange(0, 10)` + `loadRange(20, 30)` lets you read both.
   - Idempotent — calling `loadRange(0, 10)` twice fires the fetcher once.
   - Out-of-bounds windows clamp without throwing on construction.
   - Fetcher exception propagates from `loadRange`.

2. **`workbook/eager-sheet.test.ts` (new — split from existing `helpers.test.ts`)**:
   - `loadRange(a, b)` is a no-op resolving immediately.
   - `cell(r, c)` works for every `(r, c)` in `dimensions` without prior `loadRange`.
   - Regression net for the existing `cell()` / `range()` semantics.

3. **Stage regression tests (`interpret/__tests__/`, `replay/__tests__/`)**:
   - Every existing test in these directories continues to pass, unchanged, against the `EagerWorkbook` fixture path. This is the primary regression net for the migration.

### apps/api unit tests

4. **`apps/api/src/__tests__/utils/lazy-workbook.util.test.ts` (new)**:
   - Constructs a `LazyWorkbook` over a stubbed `WorkbookCacheService.readRowRange` and asserts:
     - `workbook.sheets` matches the supplied metas (names + dimensions).
     - `await sheet.loadRange(0, 10)` calls `readRowRange(prefix, sheetId, 0, 10)` exactly once.
     - Subsequent `cell()` calls return the row chunks the stub yielded.

### apps/api integration tests

5. **`apps/api/src/__tests__/__integration__/services/layout-plan-row-async.integration.test.ts` (new)**:
   - Seeds a chunked-cache prefix with a 5,000-row × 10-col synthetic CSV worth of data.
   - Calls `LayoutPlanInterpretService.analyze(makeLazyWorkbookFromCache(...))`; asserts the produced plan matches the plan produced by the legacy `reassembleWorkbookFromChunks → analyze` path on the same input. (Run both paths until slice 5 deletes the legacy.)
   - Calls `LayoutPlanCommitService.commit(...)` with the lazy workbook; asserts records-written count matches the legacy path.

6. **Memory smoke (`apps/api/src/__tests__/__integration__/services/layout-plan-row-async-memory.integration.test.ts` — `RUN_SLOW_TESTS=1` gate)**:
   - Same 50k-row × 20-col seed.
   - Runs the lazy-path commit under `NODE_OPTIONS=--max-old-space-size=512`.
   - Asserts: completes without OOM. (The legacy path on the same input would crash; the test documents that as a comment, doesn't run the legacy comparison.)

### Existing tests stay

- The interpret + replay test suites (`packages/spreadsheet-parsing/src/{interpret,replay}/__tests__/`) keep their `WorkbookData`-shaped fixtures and pass unchanged against the `EagerSheet` migration. This is the strongest regression net the refactor has.
- The `layout-plans.router.integration.test.ts` suite stays — it exercises interpret/commit end-to-end and will transparently switch from the reassemble path to the lazy path once slice 4 lands.

## Acceptance criteria

- [x] All existing parser + apps/api tests pass through the migration; no behavioral change visible at the public surface. (464 parser + 1033 apps/api unit, with the gated memory smoke skipped by default.)
- [x] The new tests pass: lazy-sheet (slice 0, cases 1.1–1.6), lazy-workbook factory (slice 3, case 4), lazy-vs-eager replay equivalence (slice 4, case 5), and the gated memory smoke (slice 6, case 6).
- [x] `npm run type-check` clean across the repo. `npm run lint` reports only the pre-existing `drift.test.ts:617` irregular-whitespace error from commit 94ca306 (orthogonal to this refactor).
- [x] `grep -rn "reassembleWorkbookFromChunks" apps/api/src` returns zero matches after slice 5.
- [x] `RangeNotLoadedError` is exported from `@portalai/spreadsheet-parsing`.
- [x] Memory smoke (case 6) confirms a 50,000-row × 20-col replay completes under `--max-old-space-size=512` — heap peaked at 229 MB, RSS at 422 MB in 1.4 s. The 2 GB cap from `LARGE_FILE_PARSE_STREAMING.plan.md` Phase 4 retains its headroom margin; no longer load-bearing on this workload class.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| A migrated stage forgets to `loadRange` before reading; production hits `RangeNotLoadedError`. | Per-stage regression tests against `EagerWorkbook` catch the missing read deterministically — the eager form's `loadRange` is a no-op, but the assertion that `cell()` returns the expected value catches a regression where a stage reads outside what it loaded. (The bug pattern: stage scans `bounds.startRow..bounds.endRow` but only `loadRange(bounds.startRow, bounds.startRow + 1)` for header — the test fails because the scan returns `undefined` instead of the expected cell.) |
| `loadRange` becomes a serial bottleneck — stages await one window at a time. | Each stage typically loads one window per region; per-call latency is one `MGET` over the chunk keys. Multi-region plans pre-load each region in sequence; if profiling shows it matters, an opt-in parallel `loadRanges([{r0, r1}, ...])` is a follow-up. |
| `LazySheet`'s in-memory map grows unbounded as stages `loadRange` further regions. | Bounded by the workbook size since we don't evict. The whole point of the refactor is to *not* hold the workbook in memory unless a stage reaches it — which is bounded by the regions the plan defines, not the workbook total. Profile via the memory smoke (test 6). |
| `replay()` becoming async breaks an external caller. | `replay` is only exported from `@portalai/spreadsheet-parsing/replay` and only consumed by `apps/api/src/services/`. Internal monorepo only; type checker catches every site. |
| Backwards compatibility of the cache shape. | No cache-layer change. `WorkbookCacheService.readRowRange` is reused as-is; the lazy factory is purely a new consumer. |
| Subtle drift in regression: the new code path computes the *same* records but in a different order, breaking an order-sensitive test. | The migration preserves linear iteration; replay's record emission stays per-region. Test 5 explicitly asserts record-by-record equality between the legacy and lazy paths on the same seed. |

**Rollback**: revert the merge commit. `reassembleWorkbookFromChunks` returns; orchestrators go back to producing `WorkbookData`. The new `loadRange` on the `Sheet` interface stays (additive change; no consumer depends on its absence), so a partial revert is also viable.

## Cross-references

- `docs/SPREADSHEET_PARSER_ROW_ASYNC.discovery.md` — design space + recommendation rationale.
- `docs/LARGE_FILE_PARSE_STREAMING.plan.md` Phase 4 notes — the follow-up flag this refactor closes.
- `packages/spreadsheet-parsing/src/workbook/types.ts` — `Workbook` / `Sheet` definitions.
- `packages/spreadsheet-parsing/src/interpret/index.ts` — interpret runner; already orchestrates async stages.
- `packages/spreadsheet-parsing/src/replay/index.ts` — `replay`; becomes async.
- `apps/api/src/utils/workbook-preview.util.ts` — host of `reassembleWorkbookFromChunks`; helper deletes at slice 5.
- `apps/api/src/services/workbook-cache.service.ts` — `readRowRange` reused as-is.
