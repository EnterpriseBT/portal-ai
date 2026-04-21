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

### Phase 5 — Frontend cutover

**Goal**: browser never ships workbook JSON again. Per-file upload progress comes from real XHR events, not a synthesized "50 % parsing" heuristic.

#### 5.1 Red — `apps/web/src/workflows/FileUploadConnector/__tests__/file-upload-workflow.util.test.ts`

New expectations:

- `startParse` pipeline becomes: `presign` → `putToS3` (per file) → `confirm` (per file) → `parse`. Hook state transitions `uploading → parsing → parsed` reflect real wall-clock phases; `overallUploadPercent` is the sum of per-file XHR progress, not a heuristic.
- Hook state gains `uploadSessionId: string | null` (replaces or complements `workbook: Workbook | null`; workbook becomes the **preview** workbook).
- `runInterpret(regions)` body is `{ uploadSessionId, regionHints }` — no workbook.
- `runCommit(plan)` body is `{ uploadSessionId, connectorDefinitionId, name, plan }` — no workbook.
- `reset()` clears `uploadSessionId` (cleanup of the S3 objects is the backend's job via the lifecycle rule + explicit delete on commit).

#### 5.2 Green

1. Extend `sdk.fileUploads`:
   - `presign()` — POST mutation returning `{ uploads: [{uploadId, putUrl, s3Key, expiresAt}] }`.
   - `putToS3(file, putUrl, { onProgress })` — bare `XMLHttpRequest` (not `fetchWithAuth`) since presigned URLs are bearer-less. Wrap in a hook that exposes the XHR progress event.
   - `confirm(uploadId)` — POST mutation.
   - `parse({ uploadIds })` — existing method, new body.
2. Container: `parseFile(files)` orchestrates the four-step pipeline, updating per-file progress between steps. Refactor `FileUploadProgress` so `loaded/total` come from the real XHR upload, not a parser heuristic.
3. Drop `workbookToBackend` and any inline workbook serialization from the container. Remove the 100 MB `REQUEST_JSON_LIMIT_BYTES` env note from the API once inline workbook payloads are gone (the cap stays; it just rarely matters).
4. Preview-workbook adapter: `backendWorkbookToPreview` already takes `WorkbookData` — unchanged. The backend just sends fewer cells.

#### 5.3 Storybook

`Interactive` story: replace the `parseFile: () => delay(DEMO_WORKBOOK)` stub with a multi-step fake that simulates presign → put → confirm → parse. Makes the story match the real UX (visible upload progress).

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

- PR 1 (backend): Phase 0 + Phase 1 + Phase 2 + Phase 3 + Phase 4. Endpoints live under feature flag `ENABLE_STREAMING_UPLOAD=true` initially. Phase 3b ships as a stub returning 501 unless real-world fixtures trip the inline cap.
- PR 2 (frontend): Phase 5. Flipped on behind the same flag; stories drive the Interactive demo.
- PR 3 (cutover): remove the flag, delete the inline-workbook code paths in `layout-plans.router.ts` and the frontend container, enable the S3 lifecycle rule.
- PR 4 (housekeeping): Phase 6 observability + docs. If the stub from Phase 3b hasn't fielded a 501 in production by now, promote it to a real implementation here; otherwise it stays deferred.

Each PR ends green on `type-check` + `test:unit` + `test:integration`.

## Exit criteria

- `curl -H Content-Length: 50_000_000 /api/layout-plans/interpret` never runs — the endpoint's largest realistic body is a few KB (region hints).
- `POST /api/file-uploads/presign` + S3 PUT upload a 500 MB CSV in under a minute on a typical connection; interpret + commit complete in seconds without re-transferring bytes.
- `REQUEST_JSON_LIMIT_BYTES` can be dropped back to a conservative default (say 2 MB) since no body legitimately exceeds that anymore.
- Integration tests cover success, cache-miss, cross-org rejection, and rollback for every new endpoint.
- `docs/SPREADSHEET_PARSING.backend.spec.md` updated: the sync-integration section swaps "inline workbook" for "uploadSessionId".

## Appendix — schema decisions considered + rejected

- **Stream the workbook as NDJSON over a persistent connection**: simpler than S3 but tangles transport with semantics and forces the browser to keep the connection open through the LLM call. Rejected.
- **Let the interpret/commit endpoints accept both inline and S3-backed bodies via a discriminated union**: doubles the test matrix with no real benefit; cutover is cheaper than coexistence.
- **Parse in a BullMQ worker instead of synchronously**: parse is fast enough on current fixtures (<2 s for 25 MB); async parse adds a polling UX we don't need yet. Revisit if customer files push beyond that bound.
- **Cache parsed workbooks in Postgres `file_uploads.parsed_workbook` column instead of Redis**: durable but bloats the row; Redis with re-parse fallback is simpler and bounds the store.
- **Use S3 server-side encryption (SSE-KMS)**: yes, default to SSE-S3 on the bucket; SSE-KMS if compliance asks for it later. Not in scope for this plan but listed so reviewers know it's deliberate.
