# Large Workbook Streaming — Implementation Plan

Stop shipping workbook JSON across HTTP. Upload raw bytes to S3 via presigned URLs, stream them on the backend, and reference them by id through the rest of the pipeline.

## Problem

The current FileUpload flow round-trips the workbook three times:

1. `POST /api/file-uploads/parse` (multipart) → response body carries the full sparse `WorkbookData` JSON.
2. `POST /api/layout-plans/interpret` → request body carries that same `WorkbookData` again.
3. `POST /api/layout-plans/commit` → request body carries it a third time.

Sparse-cell JSON is ~30 bytes per populated cell (`{"row":N,"col":N,"value":"..."}`), so a 5 MB CSV with dense data becomes a ~15–25 MB JSON blob. Multi-file uploads multiply that. Symptoms:

- Long `interpret`/`commit` latencies dominated by upload time, not parse or LLM calls.
- Express's `express.json()` cap (recently lifted to 100 MB) is a blunt ceiling that doesn't actually solve the problem — it just defers the wall.
- Client holds the full `Workbook` in memory through the entire review step.
- Every network hiccup mid-commit means re-sending the entire payload.

## Goal

End state: the raw file bytes live in S3 exactly once. Every server-side operation (parse, interpret, commit) streams them from S3 on demand. Client requests carry an opaque **`uploadSessionId`** plus the small plan/region-hint JSON — never the workbook.

## Non-goals

- Resumable multipart S3 uploads for very large (>100 MB) files. A single PUT up to the S3 part-size limit (5 GB) is enough for v1.
- Server-side virus scanning, DLP, or encryption-in-transit beyond the standard S3 TLS. Out of scope.
- Replacing ExcelJS / csv-parse with a different parser. The existing stream-based adapters stay.
- Background-worker parsing. Parse stays synchronous on the API node — "upload happens in the browser, parse on-the-fly server-side" is the shape; a separate queue is unnecessary until parse latency becomes a UX problem.

## Source of truth

- `docs/SPREADSHEET_PARSING.backend.spec.md` — canonical `WorkbookData` shape.
- `apps/api/src/services/workbook-adapters/{csv,xlsx}.adapter.ts` — both already stream-based, take a `node:stream.Readable`.
- `docs/LARGE_WORKBOOK_STREAMING.plan.md` (this doc) — supersedes the inline-JSON contract added in `SPREADSHEET_PARSING.frontend.plan.md` §Phase 6.

## Architecture at a glance

```
┌─────────┐   1. presign          ┌────────┐
│ browser │ ────────────────────▶ │  api   │ ──▶ creates file_uploads row
│         │ ◀────────────────── { putUrl, uploadId, s3Key, expiresAt } ◀──
│         │                       │        │
│         │   2. PUT (streamed)   │        │
│         │ ────────────────────▶ │  S3    │ (bytes persisted)
│         │                       │        │
│         │   3. parse            │  api   │ ──▶ streams S3 → csv/xlsx adapter
│         │ ──▶ { uploadIds } ──▶ │        │ ──▶ caches WorkbookData in Redis
│         │ ◀── { previewWorkbook, uploadSessionId } ◀──
│         │                       │        │
│         │   4. interpret        │  api   │ ──▶ loads WorkbookData from Redis
│         │ ──▶ { uploadSessionId, regionHints }
│         │ ◀── { plan } ◀────────│        │
│         │                       │        │
│         │   5. commit           │  api   │ ──▶ loads WorkbookData, replay,
│         │ ──▶ { uploadSessionId,│        │     create instance + records,
│         │     plan, name, ...}  │        │     delete S3 object on success
│         │ ◀── { connectorInstanceId } ◀──
└─────────┘                       └────────┘
```

Three persistence stores. Each has a clear owner:

| Store | Lives | Owns |
|---|---|---|
| **S3** | `uploads/<orgId>/<uploadId>/<filename>` | raw bytes. Lifecycle: auto-delete after 24 h; hard-delete on commit success |
| **Postgres `file_uploads`** | one row per presigned upload | audit trail: org, user, s3Key, status (`pending` \| `uploaded` \| `parsed` \| `committed` \| `failed`), created, sizeBytes |
| **Redis** | key `upload-session:<id>` → JSON-encoded `WorkbookData` + per-sheet names, TTL 1 h | parse cache so interpret + commit don't re-parse |

If the Redis cache expires between parse and commit, the backend re-streams from S3 and re-parses transparently. Losing Redis is never fatal, just slower.

## Surface changes (what's new, what's replaced)

### Backend endpoints

| New | Replaces | Behaviour |
|---|---|---|
| `POST /api/file-uploads/presign` | — | Request up to N presigned PUT URLs. Creates `file_uploads` rows in status `pending`. |
| `POST /api/file-uploads/confirm` | — | Client calls after PUT completes. Backend `HEAD`s the S3 object to verify + flips row to `uploaded`. |
| `POST /api/file-uploads/parse` | multipart variant | Body: `{ uploadIds: string[] }`. Streams each from S3, parses, merges, caches, returns preview. |
| `POST /api/layout-plans/interpret` | — (extend body shape) | Body gains `uploadSessionId`. Inline `workbook` removed. |
| `POST /api/layout-plans/commit` | — (extend body shape) | Body gains `uploadSessionId`. Inline `workbook` removed. |

### Frontend SDK

| New | Replaces |
|---|---|
| `sdk.fileUploads.presign(files: Array<{ fileName, contentType, sizeBytes }>)` | — |
| `sdk.fileUploads.putToS3(file, putUrl)` — raw `fetch` PUT with XHR progress events | current `parseMutate(files)` multipart POST |
| `sdk.fileUploads.confirm(uploadId)` | — |
| `sdk.fileUploads.parse({ uploadIds })` | same method, new body shape |
| `sdk.layoutPlans.interpret({ uploadSessionId, regionHints })` | inline-workbook variant |
| `sdk.layoutPlans.commit({ uploadSessionId, connectorDefinitionId, name, plan })` | inline-workbook variant |

## Parse response shape

The user must be able to draw regions anywhere in the spreadsheet, so the parse response ships **full cell data** — not a capped preview. The grid-virtualized region editor already handles rendering large sheets without paying the full DOM cost; the constraint is just the size of the JSON response and the browser's in-memory `Workbook`.

```ts
ParseResponsePayload = {
  uploadSessionId: string;
  sheets: Array<{
    id: string;            // stable, mints to value= in entityOptions
    name: string;
    rowCount: number;      // total rows
    colCount: number;      // total cols
    cells: CellValue[][];  // full dense 2-D
  }>;
  // `true` when any sheet in this workbook is served via the lazy-slice
  // endpoint below rather than inlined in `cells`. See §Lazy slicing.
  sliced?: boolean;
};
```

### Lazy slicing for very large sheets

Full-body parse stays the default for the common case (most workbooks come in under a million cells). A per-sheet threshold protects the response from genuinely huge sheets:

- **Inline limit**: `FILE_UPLOAD_INLINE_CELLS_MAX` (default `1_000_000`, ~30 MB JSON). Sheets under this cap ship their `cells` inline in the parse response.
- **Sliced sheets**: sheets over the cap come back with `cells: []` and a `sliced: true` flag on the response. The client fetches their content via `GET /api/file-uploads/sheet-slice?uploadSessionId=&sheetId=&rowStart=&rowEnd=&colStart=&colEnd=` — paginated by cell rectangle, backed by the cached `WorkbookData` in Redis (same cache the interpret/commit calls use).
- **Virtualization contract**: the region editor already virtualizes cell rendering. For sliced sheets it requests slices keyed to the viewport, renders a "loading…" placeholder for not-yet-fetched rows, and swaps the cells in as they arrive. Region-draft bounds (row/col indices) are unaffected — the user can draw a region whose endpoint is in an unloaded rectangle; the backend replays against the full workbook regardless.

Slicing is therefore **invisible at the region-editor level**: the user drags anywhere, the editor fetches what it needs. It's not a UX degradation; it's just bounded memory.

### Why a cell count, not a row/col cap

Row caps punish wide sheets (100 cols × 5,000 rows = 500k cells fits easily, but a 50-row cap hides the data). Column caps punish tall sheets. `rowCount * colCount` captures the thing that actually costs us — JSON bytes.

### What happens at the limit edge

A workbook with a 1,500,000-cell sheet + a 500-cell sheet comes back as `sliced: true`, the 500-cell sheet inline, the 1.5M-cell sheet requiring slice calls. No "all-or-nothing" cliff.

## TDD rhythm

Each phase follows red → green → refactor → Swagger (where a route changes). Commands after each phase:

```bash
npm run type-check
npm --workspace apps/api run test:unit
npm --workspace apps/api run test:integration
npm --workspace apps/web run test:unit
```

## Ordered phases

### Phase 0 — Foundations: S3 service + `file_uploads` table

**Goal**: bring back the S3 wrapper we deleted, model the persisted audit row, wire environment config.

#### 0.1 Red

- `apps/api/src/__tests__/services/s3.service.test.ts`: covers `createPresignedPutUrl(s3Key, contentType, expiresIn)` returning a URL, `getObjectStream(s3Key)` returning a `Readable`, `headObject(s3Key)` returning `{contentLength, contentType} | null`, `deleteObject(s3Key)` issuing a DELETE.
- `apps/api/src/__tests__/__integration__/db/repositories/file-uploads.repository.integration.test.ts`: covers `create`, `findById`, `updateStatus`, `hardDeleteByOrg` for the new repo.

#### 0.2 Green

1. Re-add `S3Service` (purged in the deprecation cleanup). Dependencies: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` — reinstall.
2. Drizzle table `file_uploads`:
   ```sql
   create table file_uploads (
     id text primary key,                -- uploadId
     organization_id text not null references organizations(id),
     created_by text not null references users(id),
     filename text not null,
     content_type text,
     size_bytes bigint,
     s3_key text not null unique,
     status text not null,               -- 'pending' | 'uploaded' | 'parsed' | 'committed' | 'failed'
     upload_session_id text,             -- set when grouped into a parse session
     created bigint not null,
     updated bigint,
     deleted bigint,
     deleted_by text
   )
   create index file_uploads_by_org on file_uploads(organization_id);
   create index file_uploads_by_session on file_uploads(upload_session_id);
   ```
3. `FileUploadsRepository` following the `Repository<T>` base pattern.
4. Environment:
   - `UPLOAD_S3_BUCKET`, `UPLOAD_S3_REGION`, `UPLOAD_S3_PREFIX` (restored).
   - `UPLOAD_S3_PRESIGN_EXPIRY_SEC` (default `600`).
   - `UPLOAD_MAX_FILES_PER_SESSION` (default `25`, mirrors current router cap).
   - `UPLOAD_MAX_FILE_SIZE_BYTES` (default `500 * 1024 * 1024`).
   - `FILE_UPLOAD_INLINE_CELLS_MAX` (default `1_000_000`). Per-sheet cell-count threshold — sheets under it ship inline in the parse response; over it fall back to lazy slicing.
   - `FILE_UPLOAD_SLICE_CELLS_MAX` (default `50_000`). Per-request rectangle size cap for the sheet-slice endpoint.
   - Keep `FILE_UPLOAD_PARSE_MAX_BYTES` as the per-file post-decode cap used by the parser service (bytes read from S3 ≤ this value before we bail).

#### 0.3 Refactor

- Drop the legacy `@portalai/core/models` `FileUpload*` schemas — they were for the retired flow and don't describe this one.
- Document `status` transitions in a code-block comment on the table file.

### Phase 1 — `POST /api/file-uploads/presign`

**Goal**: the client receives a batch of presigned PUT URLs + the audit rows they back.

#### 1.1 Red — `apps/api/src/__tests__/__integration__/routes/file-uploads.router.integration.test.ts` (new describe)

- POST with `{ files: [{fileName, contentType, sizeBytes}] }` returns `{ uploads: [{uploadId, putUrl, s3Key, expiresAt}] }`, one entry per file, in order.
- Each `uploadId` corresponds to a `file_uploads` row with status `"pending"` scoped to the caller's org.
- Rejects empty array, too-many files, oversize files, unsupported extensions — mirrors the existing parse endpoint's gate semantics.
- S3Service.createPresignedPutUrl is called once per file with the expected key shape `uploads/<orgId>/<uploadId>/<filename>`.

#### 1.2 Green

1. New contracts: `FileUploadPresignRequestBodySchema` / `FileUploadPresignResponsePayloadSchema`.
2. Router handler in `routes/file-uploads.router.ts` (alongside the existing `/parse`).
3. Service `FileUploadSessionService.presign(orgId, userId, files)` that validates, mints uploadIds, inserts rows, calls S3, returns the response.

#### 1.3 Swagger

Register the two schemas + the route.

### Phase 2 — `POST /api/file-uploads/confirm`

**Goal**: the client notifies the backend that the PUT succeeded. The backend `HEAD`s the object and flips the row to `"uploaded"`.

#### 2.1 Red

- Rejects unknown `uploadId` with 404.
- Rejects mismatched org with 403.
- Returns 409 when the object is not present in S3 (user abandoned mid-PUT).
- Happy path returns the updated row; row status transitions `pending → uploaded`.

#### 2.2 Green

- Contract + route + service.
- Enforce state machine: reject confirm if status is not `"pending"` (idempotent no-op if already `"uploaded"`).

### Phase 3 — `POST /api/file-uploads/parse` (rewire for streaming)

**Goal**: body takes `{ uploadIds: string[] }` instead of multipart. Backend streams each from S3, parses, caches the full workbook in Redis, returns the full workbook inline (or slice metadata for huge sheets).

#### 3.1 Red

Parity tests copied from the current multipart suite, rewritten to seed `file_uploads` rows + mock `S3Service.getObjectStream`:

- Multi-CSV merge, multi-sheet XLSX, mixed, sheet-name collision, Latin-1 — same assertions as `file-uploads.router.integration.test.ts` today.
- Response body contains `uploadSessionId`. Small sheets come back with full `cells`; `sliced` is absent or `false`.
- A test fixture that produces a sheet with > `FILE_UPLOAD_INLINE_CELLS_MAX` cells yields `sliced: true` in the response and `cells: []` on that specific sheet only — other sheets in the same response still inline their cells.
- Missing uploadId → 404.
- uploadId in wrong org → 403.
- uploadId in status `"pending"` (never confirmed) → 409.

#### 3.2 Green

1. Contract update: `FileUploadParseRequestBodySchema = { uploadIds: [...] }`. Response gains `uploadSessionId` + optional `sliced: boolean`.
2. `FileUploadParseService.parse(inputs)` signature change: takes `Array<{ stream: Readable; filename: string }>` instead of `{ buffer, filename }[]`.
3. Router streams from S3 via `S3Service.getObjectStream(s3Key)` for each upload, calls service, caches result.
4. New `WorkbookCacheService`:
   - `set(sessionId, WorkbookData)` — JSON-stringify + `SET ... EX 3600` in Redis.
   - `get(sessionId): Promise<WorkbookData | null>`.
   - `delete(sessionId)`.
5. Response builder: for each sheet, count `rowCount * colCount`. Under the inline cap → emit full dense cells. Over the cap → emit `cells: []` and set `sliced: true` at the top level. The full data always lives in Redis regardless.
6. On parse success: update `file_uploads` rows to status `"parsed"` and set `uploadSessionId`. Preserves linkage between session and individual uploads.

#### 3.3 Decommission legacy multipart

- The multipart `/parse` handler is gone; the old integration suite is replaced by the new one that drives `uploadIds`.
- `multer` stays only if still needed elsewhere — grep confirms it isn't, drop the dep.

### Phase 3b — `GET /api/file-uploads/sheet-slice`

**Goal**: the region editor can fetch cell rectangles from a cached workbook on demand. Only needed for the sliced-sheet path in Phase 3, but worth isolating into its own phase because the contract + virtualization wiring is non-trivial.

#### 3b.1 Red

- `GET /api/file-uploads/sheet-slice?uploadSessionId=&sheetId=&rowStart=&rowEnd=&colStart=&colEnd=` returns `{ cells: CellValue[][] }` sized to the requested rectangle.
- Out-of-bounds coordinates clamp to the sheet's `rowCount`/`colCount` (no 400 for overshoot — the editor scrolls past edges all the time).
- `uploadSessionId` in wrong org → 403.
- `uploadSessionId` not in Redis → backend re-streams + re-parses from S3 transparently, same as interpret/commit.
- Max slice size cap — reject rectangles over `FILE_UPLOAD_SLICE_CELLS_MAX` (default `50_000`, tuned to a few viewport-heights) with 400 so runaway clients can't reconstruct the full sheet in one request.

#### 3b.2 Green

- Query-param contract schema.
- Route handler → `WorkbookCacheService.get(uploadSessionId)` → slice the requested rectangle → respond.
- Frontend: `sdk.fileUploads.sheetSlice({ uploadSessionId, sheetId, rowStart, rowEnd, colStart, colEnd })`.
- `SheetCanvas` gets a `loadSlice?: (args) => Promise<CellValue[][]>` prop. When present, unloaded rectangles trigger a request; a per-session in-memory cache on the client coalesces overlapping viewport requests so quick scrolls don't spam the network.

#### 3b.3 Decision deferred

If Phase 3's real-world fixtures never trip `FILE_UPLOAD_INLINE_CELLS_MAX`, Phase 3b can ship as a stub that returns 501 `NOT_IMPLEMENTED` and fix-forward when a customer uploads one. The threshold tuning is empirical — pick a default that covers observed workbooks, raise it if slicing is wasting bandwidth on requests that only ever touch small rectangles.

### Phase 4 — `/api/layout-plans/{interpret,commit}` take `uploadSessionId`

**Goal**: drop the inline workbook from both request bodies.

#### 4.1 Red

Extend the existing `layout-plans.router.integration.test.ts`:

- Interpret with `{ uploadSessionId, regionHints }` — backend pulls `WorkbookData` from Redis (or re-streams from S3 on cache miss), runs `LayoutPlanInterpretService.analyze`, returns `{ plan }`.
- Commit with `{ uploadSessionId, connectorDefinitionId, name, plan }` — same lookup, runs commit pipeline, marks `file_uploads` rows `"committed"`, fire-and-forget deletes S3 objects.
- Cache-miss path: clear the Redis key manually before the interpret call; assert the request still succeeds (backend re-parses).
- 404 when `uploadSessionId` doesn't exist.
- 403 when session belongs to another org.

#### 4.2 Green

1. Contract changes:
   - `LayoutPlanInterpretDraftRequestBodySchema = { uploadSessionId, regionHints? }` (drops `workbook`).
   - `LayoutPlanCommitDraftRequestBodySchema = { uploadSessionId, connectorDefinitionId, name, plan }` (drops `workbook`).
2. `LayoutPlanDraftService.interpretDraft` and `commitDraft` both call a new internal `resolveWorkbook(uploadSessionId, orgId)` helper: tries Redis first, falls back to re-streaming the S3 objects linked to the session.
3. `commitDraft` rollback path (existing) also deletes S3 objects + `file_uploads` rows when it tears down the connector instance, so a failed commit leaves nothing behind.
4. On success: issue S3 deletes + mark rows `"committed"`. Best-effort — a residual S3 object is handled by the lifecycle rule in Phase 6.

#### 4.3 Swagger

Update the two route blocks + schema registrations.

### Phase 5 — Frontend cutover (presign → put → confirm → parse)

**Goal**: browser never ships workbook JSON again. Per-file upload progress comes from real XHR events, not a synthesized "50 % parsing" heuristic.

This is the baseline cutover. Progressive client-side grid population lives in Phases 5a–5c; 5 establishes the pipeline they hook into.

#### 5.1 Red — `apps/web/src/workflows/FileUploadConnector/__tests__/file-upload-workflow.util.test.ts`

New expectations:

- `startParse` pipeline becomes: `presign` → `putToS3` (per file) → `confirm` (per file) → `parse`. Hook state transitions `uploading → parsing → parsed` reflect real wall-clock phases; `overallUploadPercent` is the sum of per-file XHR progress, not a heuristic.
- Hook state gains `uploadSessionId: string | null`.
- `runInterpret(regions)` body is `{ uploadSessionId, regionHints }` — no workbook.
- `runCommit(plan)` body is `{ uploadSessionId, connectorDefinitionId, name, plan }` — no workbook.
- `reset()` clears `uploadSessionId` (cleanup of the S3 objects is the backend's job via the lifecycle rule + explicit delete on commit).

#### 5.2 Green

1. Extend `sdk.fileUploads`:
   - `presign()` — POST mutation returning `{ uploads: [{uploadId, putUrl, s3Key, expiresAt}] }`.
   - `putToS3(file, putUrl, { onProgress, signal })` — bare `XMLHttpRequest` (not `fetchWithAuth`) since presigned URLs are bearer-less. Exposes real progress events + `AbortSignal` for cancel on modal close.
   - `confirm(uploadId)` — POST mutation.
   - `parse({ uploadIds })` — existing method, new body.
2. Container: `parseFile(files)` orchestrates the four-step pipeline, updating per-file progress between steps. `FileUploadProgress.loaded/total` come from real XHR events.
3. Drop `workbookToBackend` and any inline workbook serialization from the container. `REQUEST_JSON_LIMIT_BYTES` can fall back to a conservative default once this lands.

#### 5.3 Storybook

`Interactive` story: replace the `parseFile: () => delay(DEMO_WORKBOOK)` stub with a multi-step fake that simulates presign → put → confirm → parse. Makes the story match the real UX (visible upload progress).

---

### Phase 5a — `SheetCanvas` virtualization (prerequisite for streaming grid)

**Goal**: the region-editor grid renders only cells in (or near) the viewport. Required before any streaming grid population makes sense — today's `SheetCanvas` emits `rowCount × colCount` DOM nodes in a flat loop, which becomes the bottleneck long before streaming helps.

#### 5a.1 Red — `SheetCanvas.test.tsx`

- Rendering a 50 000-row × 30-col sheet creates at most `OVERSCAN × colCount` visible cell nodes (tens, not hundreds of thousands).
- Scrolling the container shifts which rows render; cells in the scrolled-to region mount on demand.
- All existing interactions still work across the virtualized scroll: pointer-down-drag from row 10 to row 8 000 produces a region with `startRow=10, endRow=8000` even if most of the intermediate cells were never mounted.
- Sticky column-header row stays pinned across scrolls.
- Sticky row-header column stays pinned across horizontal scrolls.
- Auto-scroll during drag still works; pulling the pointer toward the top/bottom edge advances the viewport.
- Overlay `RegionOverlayUI` is pinned to the *grid*, not the viewport — a region whose bounds are off-screen still has its overlay present in the DOM at the correct coordinates so it's visible when the user scrolls there.

#### 5a.2 Green

1. Row-level virtualization via `@tanstack/react-virtual` (already an indirect dep via MUI; lightweight; fits well for fixed-height rows).
2. Column-level virtualization defer — real workbooks rarely exceed a few hundred columns; row count is the dominant scale dimension. A future extension if we see >500-col sheets in the wild.
3. Refactor the `gridBody` useMemo to:
   - Keep sticky col-header row (not virtualized).
   - Virtualize the data-row loop. The virtualizer yields `{ index, start, size }` per visible row; we render only those.
4. Update `computeMovedBounds` / `computeResizedBounds` usage — nothing changes because they operate on coordinates, not DOM nodes.
5. Region overlay: switch from absolute-positioned divs on top of every region to a single absolutely-positioned layer sized to the full grid dimensions. Overlays for off-screen regions render but are painted far above/below the current scroll — cheap.

#### 5a.3 Storybook / stories

Add a `LargeSheet` story in the RegionEditor stories that seeds a 100 000-row fixture. Scrolling it should stay smooth (>= 50 fps on a mid-range laptop). This is the subjective smoke test the phase closes on.

---

### Phase 5b — Client-side streaming parse for CSV/TSV

**Goal**: for delimited text files, rows appear in the grid *during* the S3 upload rather than after. First cells visible in ~100 ms on a 100 MB file; user can start drawing regions immediately.

#### 5b.1 Red — `utils/client-streaming-parse.util.test.ts`

- `streamParseCsv(file)` yields row batches asynchronously; a 10 000-row fixture produces multiple batches before the input stream closes.
- Each batch appends to the sheet's `cells` array (tested at hook level): after the first flush, `result.current.workbook.sheets[0].cells.length > 0 && < rowCount`. After the stream closes, `length === rowCount`.
- Delimiter detection: commas, semicolons, tabs, and pipes all parse correctly (mirrors backend adapter behaviour).
- Encoding: UTF-8 is the default; a flag exposes Latin-1 fallback to match the backend's chardet-driven decoding. Mismatch between client and server is accepted — server parse is source-of-truth, client is UX.
- Abort: calling the returned `cancel()` mid-stream stops parsing, does not flush any more rows, and never throws.
- Row limits: a safety valve at `CLIENT_PARSE_MAX_ROWS` (default `5_000_000`) halts parsing and leaves `workbook.sheets[i].truncated = true` for the UI to flag.

#### 5b.2 Green

1. New util `utils/client-streaming-parse.util.ts`:
   - Uses `file.stream().pipeThrough(new TextDecoderStream(encoding))`.
   - CSV parser: tiny hand-rolled streaming CSV reader (handles quotes, embedded newlines, escapes). Papa Parse would work; I lean toward ~80 lines of hand-written code to avoid a dependency for something this small.
   - Emits `{ rows: CellValue[][], sheetId }` batches every `FLUSH_EVERY_ROWS` (default 500) or every 16 ms (whichever first) via a `WritableStream`-based consumer.
2. Hook change: `startParse` concurrently runs `uploadAndStreamParse(files)` which:
   - For each file, starts XHR upload + client-streaming parse from the same `File` handle. These don't share the byte stream (PUT needs the whole file body; would need `tee()` + duplex fetch — not universally supported). Instead the `File` is read twice, once by XHR (as a Blob body) and once by the parse pipe via `file.stream()`. The browser caches `File` bytes in memory or on disk so this is cheap.
   - Appends each parse batch to `state.workbook.sheets[i].cells` via a merged `setState`. Skips the "parsed" backend-preview hydration for files we've already parsed client-side.
3. After all uploads finish and `confirm` succeeds: call `sdk.fileUploads.parse({ uploadIds })` to register the session server-side. The response's cell data is discarded client-side (the client's progressive grid is the source of truth for the editor); we only keep `uploadSessionId`.
4. **Fallback**: if client parse throws mid-stream (bad bytes, unexpected encoding), swallow the error and fall back to the server-side parse response exactly as Phase 5 wired it. The grid re-populates from the server's authoritative parse. User sees "Parsing on server…" briefly.

#### 5b.3 Storybook

Add a `CSVStreamingInteractive` story. Uses a 100 000-row in-memory CSV blob; demonstrates the progressive fill.

---

### Phase 5c — Client-side streaming parse for XLSX (Web Worker)

**Goal**: same progressive-fill UX for XLSX workbooks. Required for v1 — the FileUpload connector is used for XLSX at least as much as CSV, and users shouldn't get a worse experience on the richer format.

XLSX is a ZIP of XML. Unlike CSV it can't be parsed truly one byte at a time — the ZIP central directory and `sharedStrings.xml` must be present before cell values are interpretable. The practical shape:

1. **Upload + parse run in parallel on the main page**, like CSV.
2. **Parsing runs in a Web Worker** so the main thread stays responsive even while the parser crunches through the full workbook.
3. **The worker emits rows in batches** as it walks each sheet's `sheet<n>.xml`. The user sees cells fill in sheet-by-sheet, top-to-bottom, just like the CSV path — the lag is "parse initialisation" (reading the string table) rather than "full block".
4. **Cold-start time on a 25 MB XLSX is single-digit seconds**, during which the upload is progressing. Once the string table loads, cells stream in sub-second.

#### 5c.1 Red — `utils/client-streaming-parse.util.test.ts` (extended)

- `streamParseXlsx(file)` parses a multi-sheet XLSX fixture (built via the existing `xlsx-fixtures.util` in the API tests, imported into web tests via the shared `node:stream`→`Blob` shim) and emits row batches per sheet.
- Multiple sheets appear in `workbook.sheets[]` in their XLSX workbook order.
- Password-protected XLSX rejects cleanly (error state, no partial grid).
- Rich text / formula result / date cells are coerced the same way the server-side adapter does them: dates → ISO strings, booleans → `"TRUE"`/`"FALSE"`, numbers → numeric, nulls/empties → `""`.
- Worker lifecycle: spawning the worker is lazy (no worker created if no XLSX file is uploaded). `cancel()` calls `worker.terminate()`; no stuck workers after modal close.
- Worker message shape: `{ type: "sheet-start", sheet: { id, name, rowCount?, colCount? } }` | `{ type: "rows", sheetId, rows: CellValue[][] }` | `{ type: "sheet-end", sheetId }` | `{ type: "done" }` | `{ type: "error", message }`.

#### 5c.2 Green

1. Library choice: **SheetJS (`xlsx`)** compiled for the worker. It isn't a true stream parser — it reads the full ZIP then iterates cells — but combined with a worker and row-batch posting, the user perception is streaming. The library is well-tested on browser fixtures, handles the messy edge cases (merged cells, shared strings, date serial numbers), and the cost is about 200 KB gzipped worker bundle. Documented explicitly so reviewers know why we picked buffered-parse-in-worker over true-streaming-in-main-thread.
   - **Alternative considered**: custom ZIP streaming + XML SAX. Correct in theory, pile of edge cases in practice (sharedStrings at end of file, inconsistent inflate order). Not worth the maintenance.
2. Worker file at `apps/web/src/workflows/FileUploadConnector/workers/xlsx-parse.worker.ts`, built via Vite's `?worker` import so the bundler handles the worker entry.
3. Main-thread util `streamParseXlsx(file, { signal, onBatch })`:
   ```ts
   const worker = new XlsxParseWorker();
   file.arrayBuffer().then((buf) => worker.postMessage(buf, [buf]));
   worker.onmessage = (e) => dispatch(e.data);
   signal.addEventListener("abort", () => worker.terminate());
   ```
4. Batch size: `XLSX_BATCH_ROWS` (default 500) — the worker accumulates and posts every N rows. Avoids postMessage overhead on each cell.
5. Hook integration: `uploadAndStreamParse` dispatches by file extension:
   - `.csv` / `.tsv` → `streamParseCsv`
   - `.xlsx` / `.xls` → `streamParseXlsx`
   - Any other supported extension → error out of the pipeline before presign.
6. **Same fallback as CSV**: worker error → drop to server-side parse response.

#### 5c.3 UX note

During the ~1–3s XLSX worker cold start, the upload is running. Show:
- Phase 1: per-file upload progress bar (driven by XHR).
- Phase 2: "Parsing `<filename>`…" with a smaller spinner per file once upload finishes but worker is still initialising.
- Phase 3: sheet tabs populate as `sheet-start` events arrive; cells fill per batch.

Matches the streaming pipe from CSV without pretending XLSX bytes can be trickled directly into the grid.

#### 5c.4 Storybook

Add an `XlsxStreamingInteractive` story with a multi-sheet XLSX fixture. Scripted with a fake worker that replays pre-captured batch messages so the story is deterministic; the real worker is only used in the dev server.

---

### Phase 5d — Abort + failure handling for streaming parse

**Goal**: no matter how the user exits mid-stream, nothing leaks — XHR aborts, workers terminate, state resets.

#### 5d.1 Red

- Close the modal while CSV stream is in flight: `AbortController.abort()` fires, XHR cancels, parse pipe closes, no further `setState` runs after the close.
- Close the modal while XLSX worker is parsing: `worker.terminate()` fires, no orphan worker remains, no further `onmessage` events are handled.
- Interrupt mid-stream (simulated network error during upload): pipeline resets to `uploadPhase: "error"`, user sees the error, can retry.
- Concurrent files: aborting during multi-file upload cancels *all* in-flight uploads and parses.

#### 5d.2 Green

1. Shared `AbortController` per upload session; `handleClose` calls `.abort()` before resetting hook state.
2. Hook's existing `runTokenRef` gates late-arriving parse batches (same mechanism the reset guard already uses).
3. Worker lifecycle: one worker per XLSX file, tracked in a `workersRef: Set<Worker>`. `handleClose` iterates and terminates.

---

### Phase 6 — Lifecycle, cleanup, observability

**Goal**: no orphan S3 objects, no zombie `file_uploads` rows, operators can see upload volume.

#### 6.1 S3 lifecycle rule

- Add an S3 lifecycle rule (managed via infrastructure-as-code, not the API): objects under `uploads/` older than 24 h are deleted.
- Document in `apps/api/README.md` under a new "S3 bucket setup" section.

#### 6.2 Application-side cleanup

- `file_uploads` rows older than 24 h in any non-`"committed"` state → soft-delete via a daily cron or at-startup sweeper. Tracked in a follow-up ticket; the lifecycle rule alone keeps us safe for now.
- `commitDraft` rollback path hard-deletes the instance + plan row (already) **and** deletes the S3 objects + `file_uploads` rows for the session.

#### 6.3 Metrics

- Pino log events:
  - `upload.presign.issued` — one per presign call, with count + total declared bytes.
  - `upload.confirmed` — one per confirm.
  - `upload.parse.completed` — with `sheetCount`, `rowCount`, `bytesStreamed`, `durationMs`.
  - `upload.cache.{hit,miss}` — cache-miss rate is the tell for "Redis TTL is too short".
- No new dashboard this PR; events feed whatever aggregation the team runs on Pino.

## Failure modes + mitigations

| Failure | Mitigation |
|---|---|
| User PUTs to S3 then closes the tab | 24 h lifecycle rule deletes the object; `file_uploads` row stays in `pending`/`uploaded` and gets swept |
| PUT succeeds, `confirm` never called | Same — `pending` row is swept; S3 object expires |
| Parse succeeds, user abandons | `parsed` row sweeps; Redis cache TTLs naturally; S3 object expires |
| Commit fails server-side | Existing rollback tears down instance + plan; this plan extends it to also delete S3 objects + `file_uploads` rows (no orphan) |
| Redis down | `resolveWorkbook` re-streams from S3; slower but functional |
| S3 down during interpret | 500; user retries; client holds `uploadSessionId` so retry is one click |
| Presigned URL expires before client PUTs | Client requests a new presign for that file; backend rotates the row's `s3Key` if required |
| Multi-file PUTs: some succeed, some fail | Client retries the failed ones individually using the original presign (or re-presigns) before calling `parse` |

## Rollout

Compatibility with the current inline-workbook flow isn't required — this is a new connector path, not a public API. We cut over wholesale in a single feature branch:

- **PR 1 (backend)**: Phase 0 + Phase 1 + Phase 2 + Phase 3 + Phase 4. Endpoints live under feature flag `ENABLE_STREAMING_UPLOAD=true` initially. Phase 3b ships as a stub returning 501 unless real-world fixtures trip the inline cap.
- **PR 2 (frontend pipeline)**: Phase 5. Baseline presign/put/confirm/parse pipeline replaces the multipart path. Flipped on behind the same flag; stories drive the Interactive demo. Grid still loads from the backend parse response.
- **PR 3 (grid virtualization)**: Phase 5a. Required before streaming parse is useful; safe to land independently since it's a pure internal refactor of `SheetCanvas`.
- **PR 4 (streaming parse)**: Phase 5b + 5c + 5d together. CSV and XLSX streaming are both required for v1 so they ship in one PR — the shared abort/fallback code path and hook integration are one refactor, not three.
- **PR 5 (cutover)**: remove the feature flag, delete the inline-workbook code paths in `layout-plans.router.ts` and the frontend container, enable the S3 lifecycle rule.
- **PR 6 (housekeeping)**: Phase 6 observability + docs. If the stub from Phase 3b hasn't fielded a 501 in production by now, promote it to a real implementation here; otherwise it stays deferred.

Each PR ends green on `type-check` + `test:unit` + `test:integration`.

## Exit criteria

- `curl -H Content-Length: 50_000_000 /api/layout-plans/interpret` never runs — the endpoint's largest realistic body is a few KB (region hints).
- `POST /api/file-uploads/presign` + S3 PUT upload a 500 MB CSV in under a minute on a typical connection; interpret + commit complete in seconds without re-transferring bytes.
- Users can drag a region across any row/column of any sheet, regardless of the sheet's total size. Sliced sheets fetch cells lazily behind the scenes; no rectangle is out of reach.
- **CSV**: first cells visible in the grid within 500 ms of drop on a 100 MB file; additional rows fill in progressively during upload.
- **XLSX**: first cells visible within 3 seconds on a 25 MB workbook; all sheets' tabs appear as the worker reaches them; additional rows fill in progressively per sheet.
- **Region-editor responsiveness**: 100 000-row sheet scrolls at ≥ 50 fps on a mid-range laptop (validates Phase 5a virtualization).
- **Abort hygiene**: closing the modal mid-stream terminates all XHR uploads and Web Workers in under 100 ms; the browser's DevTools show zero orphan workers after close.
- `REQUEST_JSON_LIMIT_BYTES` on the API can stay at its conservative default (say 2 MB) — the parse response is the only legitimate >2 MB body left, and it has its own ceiling via `FILE_UPLOAD_INLINE_CELLS_MAX`.
- Integration tests cover success, cache-miss, cross-org rejection, rollback, and sliced-sheet fetch for every new endpoint. Frontend tests cover CSV + XLSX streaming parse (happy path, abort, fallback-to-server-parse).
- `docs/SPREADSHEET_PARSING.backend.spec.md` updated: the sync-integration section swaps "inline workbook" for "uploadSessionId".

## Appendix — decisions considered + rejected

- **Stream the workbook as NDJSON over a persistent connection**: simpler than S3 but tangles transport with semantics and forces the browser to keep the connection open through the LLM call. Rejected.
- **Let the interpret/commit endpoints accept both inline and S3-backed bodies via a discriminated union**: doubles the test matrix with no real benefit; cutover is cheaper than coexistence.
- **Parse XLSX in the main thread instead of a Web Worker**: xlsx libraries are CPU-heavy and will block pointer events during scroll / region-draw. Worker is non-optional if we want the progressive grid to feel responsive.
- **True byte-streaming XLSX parser (custom ZIP inflate + XML SAX)**: theoretically cleaner than buffered-parse-in-worker, but handling `sharedStrings.xml` arriving after the sheets + partial inflate + merged cells across compressed chunks is a maintenance sink for marginal latency win. Deferred until we see a workbook big enough that worker cold-start dominates total time.
- **`tee()` the file stream for simultaneous upload + parse**: tempting but `fetch(url, { body: readableStream, duplex: "half" })` isn't universally supported and `file.stream()` can only be consumed once. Reading the `File` handle twice (once for XHR body, once for `file.stream()`) works in every browser and the OS caches the underlying bytes.
- **Parse in a BullMQ worker instead of synchronously (server)**: parse is fast enough on current fixtures (<2 s for 25 MB); async parse adds a polling UX we don't need yet. Revisit if customer files push beyond that bound.
- **Cache parsed workbooks in Postgres `file_uploads.parsed_workbook` column instead of Redis**: durable but bloats the row; Redis with re-parse fallback is simpler and bounds the store.
- **Use S3 server-side encryption (SSE-KMS)**: yes, default to SSE-S3 on the bucket; SSE-KMS if compliance asks for it later. Not in scope for this plan but listed so reviewers know it's deliberate.
