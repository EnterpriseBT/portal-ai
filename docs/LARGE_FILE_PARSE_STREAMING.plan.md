# Large-file parse: streaming refactor

## Problem

`POST /api/file-uploads/parse` OOM-kills the API task on files ≥ ~30 MB. Confirmed
in dev: ECS exit code 137, `OutOfMemoryError: container killed due to memory
usage`, on a 40 MB CSV upload (2026-05-10 task `118e1bba…`).

The browser surfaces this as a misleading CORS error
(`Access to fetch ... has been blocked by CORS policy`) because a SIGKILL'd
container's dropped TCP connection is returned by ALB without
`Access-Control-Allow-Origin`. The actual failure is server-side memory.

### Root cause

Both `csvToWorkbook` (`apps/api/src/services/workbook-adapters/csv.adapter.ts`)
and `xlsxToWorkbook` build a complete in-memory `WorkbookData`:

```ts
const cells: WorkbookCell[] = [];        // <— grows unbounded
for await (const record of parser) {
  for (let i = 0; i < record.length; i++) {
    cells.push({ row, col: i + 1, value });
  }
}
return { sheets: [{ name, dimensions, cells }] };
```

`parseUploadsToWorkbook` then merges those `WorkbookData` values, hands the
result to `WorkbookCacheService.set` (which `JSON.stringify`s it for Redis),
and finally builds the inline preview. Peak memory holds the full cell array,
its JSON serialization, and the response body simultaneously — empirically
~50–100 bytes per cell in V8, so a 40 MB CSV (5–20M cells) easily crosses
2 GB.

The same shape is used by `google-sheets-workbook.service.ts` and
`microsoft-excel-connector.service.ts`. Both feed `WorkbookCacheService.set`
the full workbook and call into the same `workbook-preview.util.ts` slice
helper. They will hit the same wall on any large enough source.

### Stop-gap shipped on `bugfix/fix-large-file-upload-bug`

- `infra/cloudformation/backend.yml`: Fargate `Memory` 2048 → 8192, plus
  `NODE_OPTIONS=--max-old-space-size=7000` in the task env so V8 actually
  uses the new headroom (Node's old-space cap is ~1.5 GB regardless of the
  container limit).

This buys roughly 4× — pushes the cliff from ~30 MB to ~120 MB-ish. It is
not a fix; the unbounded accumulator is still the underlying bug.

## Goals of the streaming refactor

1. Parsing a workbook never holds more than O(chunkSize × maxCol) cells in
   process memory at once, regardless of total file size.
2. The parse path tolerates the ALB 180s idle timeout without coupling it
   to the workbook size — i.e., parse becomes a background job.
3. The slice and inline-preview paths read row ranges from Redis without
   materializing the full workbook on the API side.
4. `interpret` and `commit` (layout plans) consume rows in chunks instead
   of demanding a fully-resolved `WorkbookData`.
5. Single cache shape across file-upload, google-sheets, microsoft-excel
   pipelines — no per-pipeline divergence.

## Design

### Chunked Redis cache layout

Replace the current single `JSON.stringify(WorkbookData)` blob with a
per-sheet chunked layout. All keys TTL'd at `FILE_UPLOAD_CACHE_TTL_SEC`.

```
upload-session:{id}:meta            → JSON { sheets: [{ id, name, rowCount, colCount }], status }
upload-session:{id}:sheet:{sheetId}:rows:{chunkIdx}
                                    → JSON of dense 2D array, one chunk's worth of rows
```

- `chunkIdx = floor(row / CHUNK_SIZE)`, `CHUNK_SIZE = 1000` (tunable env).
- Cells inside a chunk are stored dense (`string[][]`), so per-row lookup
  is O(1). Empty cells are `""`; trailing-empty-row trimming happens at
  read time.
- `meta` is the single source of truth for sheet ids / dimensions /
  parse status; readers always start there.

Same layout for google-sheets / microsoft-excel pipelines, just with a
different key prefix (`connector:wb:<slug>:{id}:…`). The existing
`utils/connector-cache-keys.util.ts` extends to expose `metaKey`,
`rowChunkKey`.

### `WorkbookCacheService` rewrite

New API (replaces the current `set` / `get` / `delete`):

```ts
WorkbookCacheService.beginSession(prefix, status) : RowWriter
RowWriter.appendRows(sheetId, rows: string[][])      // writes chunks lazily
RowWriter.finishSheet(sheetId, { rowCount, colCount })
RowWriter.finalize({ sheets, status })

WorkbookCacheService.getMeta(prefix)                    : SheetMeta[]
WorkbookCacheService.readRowRange(prefix, sheetId, r0, r1) : AsyncIterable<row>
WorkbookCacheService.delete(prefix)
```

`RowWriter.appendRows` buffers in memory up to one `CHUNK_SIZE` window,
then flushes via `redis.set` and discards. There is no path that
serializes a full sheet at once.

### Streaming CSV adapter

`csvToWorkbook` becomes `csvToCache(stream, sheetId, writer)`. It returns
`{ sheetId, rowCount, colCount }` — never `WorkbookCell[]`, never a
`WorkbookData`. Internally:

```ts
let buffer: string[][] = [];
let row = 0, maxCol = 0;
for await (const record of parser) {
  row++;
  if (record.length > maxCol) maxCol = record.length;
  buffer.push(record as string[]);
  if (buffer.length >= CHUNK_SIZE) {
    await writer.appendRows(sheetId, buffer);
    buffer = [];
  }
}
if (buffer.length) await writer.appendRows(sheetId, buffer);
return { sheetId, rowCount: row, colCount: maxCol };
```

Memory is bounded by `CHUNK_SIZE × maxCol × avgCellBytes` ≈ a few MB at
worst, regardless of total file size.

### Streaming XLSX adapter

Replace ExcelJS `Workbook.xlsx.read(stream)` with `WorkbookReader`
(streaming, sheet-by-sheet, row-by-row). Same writer pattern as CSV. The
sheet-name-merge / unique-name logic stays in the caller.

### Slice + inline preview from chunks

`workbook-preview.util.ts` becomes a thin wrapper over
`WorkbookCacheService.readRowRange`:

- `inflateSheetPreview(sheetMeta, inlineCellsMax)` — if
  `rowCount × colCount ≤ inlineCellsMax`, read every row chunk into a
  dense response; otherwise return `cells: []` with `sliced: true`.
- `sliceWorkbookRectangle(sheetMeta, query)` — read row chunks
  intersecting `[rowStart, rowEnd]`, project to `[colStart, colEnd]`.

### Async parse via Bull worker

The HTTP `/parse` route stops doing the parse inline:

```
POST /api/file-uploads/parse
  body: { uploadIds: string[] }
  ↓ enqueue file-upload-parse job, init meta with status=parsing
  ↓ return 202 { uploadSessionId, status: "parsing" }

worker (file-upload-parse):
  for each upload:
    stream from S3 → adapter → writer.appendRows
  writer.finalize({ sheets, status: "ready" })
  publish SSE event: parse.ready { uploadSessionId, sheets }

GET /api/file-uploads/parse/:uploadSessionId  (status poll fallback)
  ↓ read meta, return { status, sheets? }
```

SSE channel is the existing `/api/sse` router scoped per-session. The
frontend's `parseFile` callback subscribes after `parseMutate` returns
202; on `parse.ready` it consumes the same `sheets` payload it does
today.

On `parse.error`, the worker writes `{ status: "failed", error }` to
meta and publishes; the frontend surfaces it through `serverError`.

### `interpret` and `commit` row-stream

`layout-plan-interpret.service.ts` and `layout-plan-commit.service.ts`
currently take a `WorkbookData`. They are refactored to take
`{ sheets: SheetMeta[], readRows: (sheetId, r0, r1) => AsyncIterable<row> }`
so they can sample headers and stream rows without ever asking for the
full workbook. Existing call sites (`file-upload-session.service.ts`,
`google-sheets-connector.service.ts`,
`microsoft-excel-connector.service.ts`) pass the
`WorkbookCacheService.readRowRange`-bound reader instead of a resolved
`WorkbookData`.

This deletes `resolveWorkbook` from all three connector services — its
job (re-fetch from source on cache miss) becomes the writer's job: when
`getMeta` returns nothing, the caller re-runs the parse pipeline (same
worker job in the file-upload case, same `googleSheetsToWorkbook` /
ExcelJS call in the OAuth cases) before reading.

## Phasing

Each phase is independently deployable. Phase 1 alone fixes the OOM in
the file-upload path; the rest tighten the design.

> **Status (2026-05-10):** Phase 1 + Phase 2 landed on
> `bugfix/fix-large-file-upload-bug` (memory bump shipped separately on
> `bugfix/upload-task-memory-bump`). Phase 3 + 4 remain.

### Phase 1 — Chunked cache + streaming CSV (file-upload only) ✅ done

- New `WorkbookCacheService` chunked API alongside the existing one
  (legacy `set/get` stays until Phase 4).
- `csvToWorkbook` → `csvToCache` (streaming writer).
- `xlsxToWorkbook` stays inline for now; xlsx files OOM less because
  ExcelJS already deduplicates strings, but they will be migrated in
  Phase 2.
- `parseSession` uses chunked path for CSV uploads, legacy path for
  xlsx; key shape is the same so the slice endpoint can read either.
- `sheetSlice` + `inflateSheetPreview` read from the chunked cache.
- `resolveWorkbook` reassembles from chunks for interpret/commit
  (still O(workbook) memory for those flows; Phase 4 fixes them).

Exit criterion: 40 MB CSV upload completes without OOM. ✅

Implementation notes (as shipped):
- `WorkbookCacheService` got `beginSession` / `appendRows` /
  `finishSheet` / `finalize` / `fail` (writer side) and
  `getSessionMeta` / `readRows` / `getMerges` / `deleteSession`
  (reader side). Legacy `set/get/delete` kept verbatim for the
  google-sheets / microsoft-excel pipelines.
- `csv.adapter.ts` lost `csvToWorkbook` and gained `csvToCache`. The
  CSV path is end-to-end streaming.
- `workbook-preview.util.ts` got `inflateSheetPreviewFromChunks`,
  `sliceSheetRectangleFromChunks`, `findSheetMetaById`, and
  `reassembleWorkbookFromChunks` (the last is the interpret/commit
  bridge until Phase 4).
- `file-upload-session.service.ts` rewrote `parseSession`,
  `sheetSlice`, `resolveWorkbook`, and `markSessionCommitted` against
  the chunked API. Org-ownership checks moved to a shared
  `requireSessionMeta` helper.

### Phase 2 — Streaming XLSX ✅ done

- Added `xlsxToCache` using ExcelJS `WorkbookReader`. Same writer
  signature as `csvToCache`. The file-upload pipeline now streams
  XLSX too.
- `xlsxToWorkbook` is **not** deleted — the microsoft-excel connector
  service still consumes `WorkbookData` via the legacy blob cache, so
  the old buffer-the-world adapter stays until Phase 4 migrates that
  pipeline. Added a header comment in `xlsx.adapter.ts` flagging it.
- Trade-off: the streaming xlsx path drops merged-cell metadata
  (ExcelJS' streaming reader sees `mergeCell` tags but does not
  surface them, and a grep at refactor time found no consumer of
  `WorkbookCell.merged` downstream of the adapter). If a renderer or
  interpreter starts using merge info, capture it via a dedicated XLSX
  side-pass.

Exit criterion: 250 MB xlsx upload completes without OOM (matches the
existing per-file size cap).

### Phase 3 — Bull worker + SSE

- New `file-upload-parse` queue + processor.
- `/parse` route returns 202 immediately; new
  `GET /parse/:uploadSessionId` for status polling.
- Worker publishes `parse.ready` / `parse.error` over SSE.
- Frontend `parseFile` subscribes to SSE and resolves on
  `parse.ready`.

Exit criterion: 40 MB CSV upload no longer races the ALB 180 s idle
timeout regardless of parse duration; the HTTP request completes in
< 1 s.

### Phase 4 — Migrate google-sheets, microsoft-excel, interpret/commit

- Both OAuth connector services adopt the chunked writer.
- `layout-plan-interpret` and `layout-plan-commit` row-stream from the
  chunked cache instead of accepting `WorkbookData`.
- Delete legacy `WorkbookCacheService.set/get(WorkbookData)` and
  `resolveWorkbook` from all three services.
- Drop `WorkbookSchema.safeParse` of full workbooks — schema validation
  moves to per-row at adapter level.

Exit criterion: large google-sheet / large xlsx-via-graph syncs no
longer OOM the API task. Single cache shape across all three pipelines.

## Risks and tradeoffs

- **Redis memory.** Chunked storage is roughly the same total bytes as
  the current single-blob cache (sheet data dominates). No new pressure
  on the Redis instance — the same TTL applies to the meta + chunk
  keys, and `delete` walks them via `SCAN`.
- **Slice latency.** A slice now does N `redis.get` round-trips
  instead of one. Mitigate with `MGET` / pipeline for the chunk keys
  intersecting the requested rectangle. Still typically 1–3 calls in
  practice.
- **Backwards compatibility.** Project memory says no production data
  yet; the cache key change does not need a migration. The legacy cache
  API stays in place through Phase 1–3 to keep blast radius small per
  phase.
- **interpret/commit semantics.** Today these endpoints can be called
  long after `/parse` (cache may have expired, `resolveWorkbook`
  re-fetches from source). After Phase 4 the same property holds, but
  via re-running the parse pipeline rather than re-loading a cached
  blob. The TTL conversation is unchanged.

## Out of scope

- Changing the per-file size cap (`UPLOAD_MAX_FILE_SIZE_BYTES = 250 MB`)
  or the per-sheet inline cap (`FILE_UPLOAD_INLINE_CELLS_MAX = 1M`).
- Compressing chunk payloads. Plain JSON is fine until Redis pressure
  shows up in metrics.
- Multi-task parse fan-out. Single Bull job per upload session is enough
  to clear the timeout / OOM problem.
