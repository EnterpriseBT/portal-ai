# Spreadsheet parser row-async refactor — Discovery

**Why this exists.** `docs/LARGE_FILE_PARSE_STREAMING.plan.md` Phase 4 fixed parse-time OOM for every spreadsheet pipeline — file-upload, google-sheets, microsoft-excel — by routing all of them through a shared chunked Redis cache. Parse no longer materializes a full workbook in memory. Interpret and commit still do, via `reassembleWorkbookFromChunks` (`apps/api/src/utils/workbook-preview.util.ts`). The plan's Phase-4 notes explicitly flag this as the remaining OOM surface and defer it as a follow-up "in `@portalai/spreadsheet-parsing` proper."

The follow-up is this refactor.

## The current shape

### Parser package

`packages/spreadsheet-parsing/src/workbook/types.ts` defines:

```ts
interface Sheet {
  name: string;
  dimensions: SheetDimensions;
  cell(row, col): WorkbookCell | undefined;
  range(r0, c0, r1, c1): (WorkbookCell | undefined)[][];
}

interface Workbook {
  sheets: Sheet[];
}

interface WorkbookData {       // serializable form
  sheets: SheetData[];
}
```

`makeWorkbook(data)` (`helpers.ts`) builds an in-memory `Map<"row:col", WorkbookCell>` from the `WorkbookData.cells` array per sheet, then implements `cell()` / `range()` as O(1) lookups. All accessors are synchronous.

### Consumers

| Consumer | Entry point | Access pattern |
|---|---|---|
| `interpret()` | `packages/spreadsheet-parsing/src/interpret/index.ts` | Bounded sampling — reads 1–5 header rows + a handful of classification hints per region. ~45 `sheet.cell()` calls across the pipeline; **`range()` not used**. |
| `replay()` | `packages/spreadsheet-parsing/src/replay/index.ts` | Linear per-record iteration — `extractRecords` walks record coordinates and reads the cell at each. ~40 `sheet.cell()` calls in `extract-records`, ~15 in `drift.ts`. |
| `computeWorkbookFingerprint` | `packages/spreadsheet-parsing/src/...` | Reads only 1–2 cells per sheet. Trivial. |

Specific sub-helpers (each opens with a fresh `for r in bounds.startRow..bounds.endRow` loop):
- `detect-headers.collectRowLabels`, `collectColLabels`
- `detect-identity.collectDataValuesInColumn`, `collectDataValuesInRow`
- `detect-segments.cellLabel`
- `extract-records` (replay)
- `drift.ts` — identity column + header label scans
- `scanTerminator` (replay) — walks one axis until a terminator fires; dynamic extent

### Orchestration layer

Four spots in `apps/api/src/services/` call `reassembleWorkbookFromChunks` and hand the resulting `WorkbookData` to interpret/commit:

- `google-sheets-connector.service.ts:446` — `resolveWorkbook`
- `microsoft-excel-connector.service.ts:415` — `resolveWorkbook`
- `microsoft-excel-connector.service.ts:527` — `fetchWorkbookForSync`
- `file-upload-session.service.ts:696` — `resolveWorkbook`

Two orchestrators feed them:

- `LayoutPlanDraftService.resolveWorkbookBySource` — dispatches by connector slug, calls the matching `resolveWorkbook`, then calls `LayoutPlanInterpretService.analyze` or `LayoutPlanCommitService.commit`.
- `MicrosoftExcelConnectorService.fetchWorkbookForSync` — sync-time variant; feeds `replay(plan, wb)` directly.

Both `analyze` and `commit` take `WorkbookData` (or `unknown` validated to `WorkbookData`) and pass it straight through to the parser module. They don't walk cells themselves.

## The design space

### A. Make `Sheet.cell()` async

Smallest API delta — change every `cell(r, c): WorkbookCell | undefined` site to `await cell(r, c)`. Internally the parser keeps its `Map<"row:col", WorkbookCell>` but populates entries on demand via a row-fetcher passed in at construction.

| Pro | Con |
|---|---|
| Single replacement, type checker forces every caller to await. | ~85 call sites inside the parser package alone (interpret stages + replay extractors + drift + segments). Each becomes `await`. |
| No new abstraction in the public surface. | Random-access pattern is preserved even where linear scans would be cheaper to issue as a single fetch. Each cell read = potentially one network round-trip unless the underlying fetcher caches aggressively. |
| Works for the 5% genuinely random-access spots. | Eager-fetch optimization is hidden inside the fetcher; reasoning about cache pressure becomes the fetcher's job, not the caller's. |

### B. Row-async iterator + explicit pre-fetch windows

Keep `cell(r, c)` synchronous. Add:

```ts
interface Sheet {
  // ... existing sync surface ...
  loadRange(r0: number, r1: number): Promise<void>;
  // After `await loadRange(a, b)`, every `cell(r, c)` for r in [a, b] is sync + correct.
  // Cells outside that window throw a typed error.

  // Optional sugar for linear scans:
  rows(r0: number, r1: number): AsyncIterable<(WorkbookCell | undefined)[]>;
}
```

Stages that walk a region first call `await sheet.loadRange(bounds.startRow, bounds.endRow)`, then iterate with sync `cell()`. The fetcher loads the row chunks that intersect the window from Redis, populates the in-memory map, and resolves. Stages that scan dynamically (`scanTerminator`) loop with `await sheet.loadRange(r, r + CHUNK)` until the terminator fires.

| Pro | Con |
|---|---|
| Concentrates async at the orchestration boundary; the bulk of parser internals stays sync + linear. | Two-step API — load + access. Forgetting to `loadRange` is a latent bug (throws at runtime). |
| Each `loadRange` is one batched fetch; cache pressure is predictable. | Stages that read N rows scattered across a sheet (drift across the entire identity column) have to issue N loadRange calls or one giant one. |
| `rows()` iterator is the natural shape for replay's per-record emission. | Adds a stateful concept to `Sheet` (the loaded window). Today's `Sheet` is purely functional. |

### C. Push-based row callback

Flip the orchestration: instead of pulling cells, the orchestrator pushes rows into interpret/replay:

```ts
interpret({ sheets: SheetMeta[], readRows: (sheetId, r0, r1) => AsyncIterable<row> }, ...)
replay(plan, { sheets, readRows })
```

The parser internals consume rows as they arrive, never asking for a specific cell by index.

| Pro | Con |
|---|---|
| Zero in-memory accumulation — the parser holds at most one row window at a time. | Massive internal rewrite. The interpret pipeline today is stage-based and each stage operates on `Sheet` accessors; rewriting around a streaming row source touches every stage's helper. |
| Aligns perfectly with the chunked cache shape (read row windows). | Random-access stages (`scanTerminator`, drift's identity column scan, header detection across the entire region simultaneously) don't fit a single-pass model — they'd need a separate pass each, fanning out to N reads. |
| Best long-term shape if we ever want to compile interpret to a pure streaming pipeline. | Hardest to migrate incrementally — interpret stages all change shape at once. |

### D. Composite — B inside the parser, A at the orchestration boundary

Adopt B's `loadRange` + sync `cell()` model inside the parser. The orchestration layer (`LayoutPlanDraftService.resolveWorkbookBySource` and friends) doesn't return a `WorkbookData` anymore — it returns a `LazyWorkbook` whose sheets back their `loadRange` calls with `WorkbookCacheService.readRowRange`. Interpret/replay accept the lazy workbook; the existing `WorkbookData → Workbook` factory (`makeWorkbook`) becomes an `EagerWorkbook` subtype that pre-loads everything (used in tests + fingerprinting).

The async surface lives at:

1. The `LazyWorkbook` factory (`makeLazyWorkbookFromCache(prefix)` — closes over the cache prefix, never holds chunks for sheets that haven't been touched).
2. `loadRange` itself (one method per `Sheet`).
3. `interpret()` / `replay()` signatures (already async / sync-but-cheap; `replay` becomes async).

Everything else inside the parser stays sync.

## Tradeoff comparison

|  | A (async cell) | B (loadRange + sync) | C (push rows) | D (B + lazy WB orchestration) |
|---|---|---|---|---|
| Parser package edits | ~85 sites → await | ~10 sites add `loadRange` calls | Every stage rewritten | Same as B |
| Orchestration package edits | New `LazyWorkbook` factory; 4 `resolveWorkbook` callers | Same as A | Same as A + interpret/replay signature change | Same as A |
| Cache-fetch cost per region | Many small reads | One bounded read per scan | One streaming pass | One bounded read per scan |
| Latent bug surface | Low — type checker enforces | Medium — forget `loadRange` = runtime throw | Low — push model is forced | Medium — same as B |
| Future-proof for true row-streaming | No — random-access is still the model | Partial — `rows()` iterator exists but is secondary | Yes — that *is* the model | Partial — same as B |

## Recommendation

**Go with D** — the composite. Reasons:

1. **Keeps the parser package's internals sync.** Stages stay reasoning-cheap; the test fixtures stay `WorkbookData`-shaped. Only the new `LazyWorkbook` adapter is async-aware.

2. **One-step migration per call site.** Each interpret stage gets one `await sheet.loadRange(region.bounds.startRow, region.bounds.endRow)` near the top. The rest of the stage stays unchanged.

3. **Predictable cache pressure.** Each region's worth of reads is one batched fetch (`MGET` over the chunk keys that intersect the range). No N+1.

4. **Backwards-compatible test surface.** Tests that construct workbooks via `makeWorkbook(data: WorkbookData)` continue to work — that becomes the `EagerWorkbook` factory (every range is pre-loaded; `loadRange` is a no-op).

5. **The 5% random-access spots still work.** `drift.ts` reads down an identity column for the whole region — one `loadRange(region.bounds.startRow, region.bounds.endRow)` covers it. `scanTerminator` reads forward until a terminator fires — incremental `loadRange(cursor, cursor + WINDOW)` calls let it consume cheaply.

Option C is the long-term ideal — once the parser is a real streaming pipeline, OOM is structurally impossible — but it's also the biggest rewrite and the discovery doesn't surface any large file the streaming variant *needs* yet. We pick D for v1 and leave C as a possible follow-up if the per-region fetch cost ever becomes a hot spot.

## Open questions

1. **Eager vs. lazy at the test level.** Should the parser's existing `WorkbookData`-shaped test fixtures continue to wrap into a synchronous `Workbook`, or should every test go through the async `loadRange` path? The answer matters for how much churn lands in the parser test suite. **Lean: keep both factories** — `makeWorkbook(data)` returns an `EagerWorkbook` (sync forever, `loadRange` no-op), `makeLazyWorkbookFromCache(prefix)` returns a `LazyWorkbook`. Stage tests use the eager form; the integration tests under `apps/api` exercise the lazy path through interpret/commit.

2. **What does `loadRange` return / throw?** Today's `cell(r, c)` returns `undefined` for missing cells. After `loadRange(0, 100)`, calling `cell(150, 0)` should... return `undefined` (lenient) or throw `RangeNotLoadedError` (strict)? **Lean: throw.** Forgetting to load is a programmer error, not a sparse-cell condition. The throw is a development-time signal; in prod every call site is preceded by a paired `loadRange`.

3. **Drift's identity-column-wide scan.** `drift.ts` walks the entire identity column to count duplicates. For a 13980-row sheet that's one `loadRange(0, 13980)` = the whole sheet in memory transiently. Acceptable, or do we paginate? **Lean: accept it for v1.** That's the largest single load we'd issue and it's bounded by the sheet size, not the workbook size; the wide-table mode already serializes the same data into Postgres on commit. Optimize if metrics show pressure.

4. **`fetchWorkbookForSync` is a sync-time path.** Microsoft Excel's `fetchWorkbookForSync` reassembles the whole workbook and calls `replay(plan, wb)`. Replay becomes async (it touches `loadRange`). The sync orchestrator becomes async by extension. Worth confirming nothing in the sync queue depends on a sync replay return. **Lean: trivially confirm.** Sync workers are already async-driven.

5. **Public API surface.** `Workbook` / `Sheet` interfaces stay published. The change is additive (`loadRange`) plus a typed `async` flag in the replay signature. **No breaking change to consumers outside this repo.** (There aren't any today — the parser package is private to this monorepo.)

## What this doesn't decide

- Whether to do option C eventually. Out of scope; leave as a follow-up if pressure shows up.
- The TTL on chunked cache reads inside `loadRange`. Reuse what the existing `WorkbookCacheService.readRowRange` does today; this refactor doesn't change cache lifetime.
- Whether to add a `mergedRange` accessor along the way (XLSX merge metadata is dropped by the streaming adapter — see `LARGE_FILE_PARSE_STREAMING.plan.md` Phase 2 notes). Out of scope; the row-async refactor doesn't introduce a new opportunity to re-add it.

## Next step

Write `docs/SPREADSHEET_PARSER_ROW_ASYNC.spec.md` (contract) and `.plan.md` (slices). The slicing target: option D's `LazyWorkbook` lands first behind a feature flag, parser stages migrate one by one, then `reassembleWorkbookFromChunks` deletes. Each slice green-testable, each one ships independently.
