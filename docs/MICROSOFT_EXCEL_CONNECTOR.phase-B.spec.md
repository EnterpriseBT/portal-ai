# Microsoft Excel Cloud Connector — Phase B Spec

**Workbook listing + download + cache.**

This spec covers the API surface that, given a Phase A `ConnectorInstance`, lets the user discover an `.xlsx` workbook in their OneDrive, fetches it server-side, parses it through the existing XLSX adapter, caches it, and exposes the editor's slice endpoint. After Phase B ships, no UI exists yet — verification is via curl or a debug page.

Resolved open questions used by this spec:

- **Q2 (workbook size cap):** for v1, surface a clear error `MICROSOFT_EXCEL_FILE_TOO_LARGE` when the file exceeds `FILE_UPLOAD_MAX_BYTES`. The user has stated they will likely raise the cap in production via env var.

Discovery doc reference: §"File Discovery & Selection", §"Workbook Acquisition", §"Large Spreadsheet Handling".

---

## Scope

### In scope

1. **`MicrosoftGraphService`** (`apps/api/src/services/microsoft-graph.service.ts`):
   - `searchWorkbooks(accessToken, query)` — wraps `GET https://graph.microsoft.com/v1.0/me/drive/search(q='{query}')` (or `/me/drive/recent` when query is empty), with `$top=25` and the documented `$select`. Post-filters response items to those with `file.mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"` AND name ending in `.xlsx`. Returns `[{ driveItemId, name, lastModifiedDateTime, lastModifiedBy }]`.
   - `headWorkbook(accessToken, driveItemId)` — `HEAD` (or pre-flight `GET` with no body consumption) against `/me/drive/items/{id}` to read `size` BEFORE attempting the download. Returns `{ size: number, name: string }`.
   - `downloadWorkbook(accessToken, driveItemId)` — `GET /me/drive/items/{id}/content` returning a `Readable` stream. Throws `MicrosoftGraphError("file_too_large", …)` if the response's `Content-Length` (or the size pre-flight from `headWorkbook`) exceeds `FILE_UPLOAD_MAX_BYTES`. The check happens before the body is consumed — the stream is `.cancel()`ed on refusal so we don't drain bytes through the API process.
2. **`MicrosoftExcelConnectorService`** additions (`apps/api/src/services/microsoft-excel-connector.service.ts`):
   - `searchWorkbooks({ connectorInstanceId, search? })` — gets a fresh access token from `MicrosoftAccessTokenCacheService`, calls `MicrosoftGraphService.searchWorkbooks`, returns `{ items: [{ driveItemId, name, lastModifiedDateTime, lastModifiedBy }] }`.
   - `selectWorkbook({ connectorInstanceId, driveItemId, organizationId, userId })`:
     1. Fresh access token.
     2. `MicrosoftGraphService.headWorkbook` → if `size > FILE_UPLOAD_MAX_BYTES` → `ApiError(413, MICROSOFT_EXCEL_FILE_TOO_LARGE)` with the actual size and configured cap in the error metadata.
     3. Validates the file extension: refuses anything not ending in `.xlsx` → `ApiError(415, MICROSOFT_EXCEL_UNSUPPORTED_FORMAT)`.
     4. `MicrosoftGraphService.downloadWorkbook` → stream piped to `xlsx.adapter.parse(stream)` → `WorkbookData`.
     5. `WorkbookCacheService.set(workbookCacheKey("microsoft-excel", connectorInstanceId), workbook)`.
     6. `connectorInstances.update` to set `config: { driveItemId, name, fetchedAt: Date.now() }` and `updatedBy: userId`.
     7. Returns the same inline-or-sliced preview shape `selectSheet` returns (`{ title, sheets, sliced? }`) — title comes from the workbook name (without the `.xlsx` extension).
   - `sheetSlice({ connectorInstanceId, sheetId, rowStart, rowEnd, colStart, colEnd })` — identical contract to the Google version; reads the cached workbook, calls `findSheetById` + `sliceWorkbookRectangle`, returns `SliceResult`. Cache miss → `ApiError(404, FILE_UPLOAD_SESSION_NOT_FOUND, "No cached workbook for instance … — call select-workbook first")`.
   - `resolveWorkbook(connectorInstanceId, organizationId)` — for the layout-plan-draft service to dispatch by `connectorInstanceId`. Cache miss is fatal here (no S3 fallback, mirrors Google). Phase D's sync path uses a separate `fetchWorkbookForSync` that always re-downloads.
3. **Routes** (`apps/api/src/routes/microsoft-excel-connector.router.ts`):
   - `GET  /api/connectors/microsoft-excel/workbooks?connectorInstanceId=&search=` — JWT-protected. Returns the search results.
   - `POST /api/connectors/microsoft-excel/instances/:id/select-workbook` — JWT-protected. Body `{ driveItemId }`. Returns the parseSession-shaped payload.
   - `GET  /api/connectors/microsoft-excel/instances/:id/sheet-slice?sheetId&rowStart&rowEnd&colStart&colEnd` — JWT-protected. Returns the slice.
4. **Contracts** (`packages/core/src/contracts/microsoft-excel.contract.ts`):
   - `MicrosoftExcelListWorkbooksRequestQuerySchema` (`{ connectorInstanceId, search? }`).
   - `MicrosoftExcelListWorkbooksItemSchema` (`{ driveItemId, name, lastModifiedDateTime, lastModifiedBy: string | null }`).
   - `MicrosoftExcelListWorkbooksResponsePayloadSchema` (`{ items: [...] }`).
   - `MicrosoftExcelSelectWorkbookRequestBodySchema` (`{ driveItemId }`).
   - `MicrosoftExcelSelectWorkbookRequestSchema` (`{ connectorInstanceId, driveItemId }`).
   - `MicrosoftExcelSelectWorkbookResponsePayloadSchema` aliased to `FileUploadParseSheetSchema`-derived `{ title, sheets, sliced? }`.
   - `MicrosoftExcelSheetSliceRequestSchema` and `MicrosoftExcelSheetSliceResponsePayloadSchema` aliased to the file-upload slice contracts (matching how Google aliases them).
5. **Frontend SDK** (`apps/web/src/api/microsoft-excel.api.ts`):
   - `sdk.microsoftExcel.searchWorkbooks()` — `useAuthMutation`, `method: "GET"`, `body: () => undefined`, URL builder constructs the query string.
   - `sdk.microsoftExcel.selectWorkbook()` — `useAuthMutation`, POST, body strips path-only fields.
   - `sdk.microsoftExcel.sheetSlice()` — `useAuthMutation`, GET, identical builder shape to `googleSheets.sheetSlice`.
6. **API codes** (`apps/api/src/constants/api-codes.constants.ts`):
   - `MICROSOFT_EXCEL_INVALID_INSTANCE_ID`, `MICROSOFT_EXCEL_LIST_FAILED`, `MICROSOFT_EXCEL_FETCH_FAILED`, `MICROSOFT_EXCEL_INVALID_PAYLOAD`, `MICROSOFT_EXCEL_FILE_TOO_LARGE`, `MICROSOFT_EXCEL_UNSUPPORTED_FORMAT`.

### Out of scope

- Frontend workflow shell (Phase C).
- Sync (Phase D).
- Layout-plan interpret/commit endpoints — they already exist, dispatch by `connectorInstanceId`, and will pick up the new `resolveWorkbook` automatically.
- Error UX for the file-too-large case beyond surfacing the API code (Phase C will render a clear message).

---

## Workbook acquisition pre-flight (the only Excel-specific risk surface)

The spec's hard requirement: **never consume the response body of an oversized workbook**. The flow:

1. Resolve a fresh access token.
2. `headWorkbook(driveItemId)` returns `{ size, name }`. Implementation: `GET /me/drive/items/{id}` (the metadata endpoint, not `/content`) returning a small JSON payload with `size` and `name`.
3. If `size > FILE_UPLOAD_MAX_BYTES`: throw immediately. The download endpoint is never called. This is the cheap path — one small JSON request, no body draining.
4. Else: `downloadWorkbook(driveItemId)` streams `/content`. As a defensive secondary check, on the response the service inspects `Content-Length` — if present and oversized despite the pre-flight (drift between metadata and the actual content blob is theoretically possible), the stream is cancelled before any bytes are read into the parser.
5. Stream is piped to `exceljs.Workbook.xlsx.read(stream)` — bounded memory.

The `MICROSOFT_EXCEL_FILE_TOO_LARGE` API error includes `details: { sizeBytes, capBytes }` so the frontend can render "Your workbook is 87 MB; the limit is 50 MB. Contact support if you need a higher cap" without having to compute.

---

## Test plan (TDD ordering)

### Unit tests (`apps/api/src/__tests__/services/`)

1. **`microsoft-graph.service.test.ts`**:
   - `searchWorkbooks` happy path: builds the correct URL (`/me/drive/search(q='Q3')`), returns parsed items.
   - `searchWorkbooks` empty query: hits `/me/drive/recent` instead.
   - `searchWorkbooks` mime/extension filter: response containing a mix of `.xlsx`, `.xlsm`, `.csv`, and folders → returns only `.xlsx` items.
   - `searchWorkbooks` quote escaping: a query containing a single quote (`O'Brien`) is escaped per Graph's predicate rules (or URL-encoded — depends on the chosen approach; assert the URL string).
   - `headWorkbook` returns `{ size, name }`.
   - `downloadWorkbook` happy path returns a stream (mocked `fetch` with a `ReadableStream` body; assert `.body` is consumable).
   - `downloadWorkbook` throws `MicrosoftGraphError("file_too_large")` when the response `Content-Length` exceeds `FILE_UPLOAD_MAX_BYTES`; the stream is cancelled (assert `cancel` was called on the body).
   - `downloadWorkbook` non-2xx → `MicrosoftGraphError("download_failed", …)`.
2. **`microsoft-excel-connector.service.searchWorkbooks.test.ts`**:
   - Calls `MicrosoftAccessTokenCacheService.getOrRefresh` then `MicrosoftGraphService.searchWorkbooks` with the right args; returns `{ items }` shape.
3. **`microsoft-excel-connector.service.selectWorkbook.test.ts`**:
   - File too large → `ApiError(413, MICROSOFT_EXCEL_FILE_TOO_LARGE)` with `details: { sizeBytes, capBytes }`. The download endpoint is **not** called (mock asserts).
   - Wrong extension (e.g. `.xlsm`) → `ApiError(415, MICROSOFT_EXCEL_UNSUPPORTED_FORMAT)`. Download endpoint not called.
   - Happy path: parses workbook, writes the cache under the correct key, updates `config: { driveItemId, name, fetchedAt }`, returns `{ title, sheets }` (or `{ title, sheets, sliced: true }` when `inflateSheetPreview` returns sliced).
   - Title strips the `.xlsx` extension.
4. **`microsoft-excel-connector.service.sheetSlice.test.ts`**:
   - Cache miss → `ApiError(404, FILE_UPLOAD_SESSION_NOT_FOUND)`.
   - Sheet missing in cached workbook → `ApiError(404, FILE_UPLOAD_SLICE_OUT_OF_BOUNDS)`.
   - Happy path: returns `sliceWorkbookRectangle` output.
5. **`microsoft-excel-connector.service.resolveWorkbook.test.ts`**:
   - Cache miss → fatal `ApiError(404, FILE_UPLOAD_SESSION_NOT_FOUND)`.
   - Wrong org → `ApiError(403, CONNECTOR_INSTANCE_NOT_FOUND)`.
   - Happy path returns the cached `WorkbookData`.

### Contract tests (`packages/core/src/__tests__/contracts/microsoft-excel.contract.test.ts`)

6. Each schema parses a representative sample and rejects a missing-required-field sample. Verifies the slice schemas alias to the file-upload contracts (a deep-equal assertion on the exported schema object — they should be the same reference).

### Integration tests (`apps/api/src/__tests__/__integration__/routes/microsoft-excel-connector.router.integration.test.ts`)

7. **`GET /workbooks`** happy path: mock `fetch` to return three Graph items (one `.xlsx`, one `.xlsm`, one folder), assert the response only contains the `.xlsx` item.
8. **`GET /workbooks`** without `connectorInstanceId` → 400 `MICROSOFT_EXCEL_INVALID_INSTANCE_ID`.
9. **`GET /workbooks`** instance owned by another org → 403.
10. **`POST /instances/:id/select-workbook`** happy path: mock the head + download responses, supply a real small `.xlsx` byte buffer (existing test fixtures from the file-upload tests), assert:
    - DB row's `config` updated.
    - Redis cache key `connector:wb:microsoft-excel:{id}` populated with parsed workbook (or assert via `WorkbookCacheService.get`).
    - Response payload shape matches the contract.
11. **`POST /instances/:id/select-workbook`** oversize file: mock head response with `size: 100_000_000` (>50 MB), assert 413 + the `details.sizeBytes` and `details.capBytes` fields. Assert the download was never called.
12. **`POST /instances/:id/select-workbook`** wrong extension: head returns `name: "data.xlsm"` → 415; download not called.
13. **`GET /instances/:id/sheet-slice`** post-select-workbook → returns the slice; pre-select → 404.

### Frontend tests (`apps/web/src/__tests__/api/microsoft-excel.api.test.ts`)

14. Each SDK call constructs the correct URL + method + body. Same shape as `google-sheets.api.test.ts`.

### Verification (manual)

```sh
# After Phase A's instance exists:

# List workbooks
curl -H "Authorization: Bearer $JWT" \
  "http://localhost:3001/api/connectors/microsoft-excel/workbooks?connectorInstanceId=$CI_ID&search=Q3"

# Pick one
curl -X POST -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"driveItemId":"01ABC..."}' \
  "http://localhost:3001/api/connectors/microsoft-excel/instances/$CI_ID/select-workbook"

# Slice a few cells
curl -H "Authorization: Bearer $JWT" \
  "http://localhost:3001/api/connectors/microsoft-excel/instances/$CI_ID/sheet-slice?sheetId=0&rowStart=0&rowEnd=10&colStart=0&colEnd=10"

# Try an oversized file (manually upload a 60+ MB workbook to OneDrive, then):
# expect 413 with MICROSOFT_EXCEL_FILE_TOO_LARGE and details.sizeBytes / details.capBytes
```

---

## Risks & follow-ups

- **Graph drift between metadata `size` and `/content` payload.** If a user uploads a new revision between our head and download requests, the size could change. The defensive `Content-Length` check on the download response covers this; the worst case is a clear 413 returned mid-flight before any bytes are buffered.
- **`/me/drive/search` may return items the user has shared-with rather than owned.** This is fine for v1 — `Files.Read.All` already grants read access to those. The list endpoint returns whatever Graph returns; ownership filtering is not in scope.
- **Folder filtering.** Graph search can return folder items in some shapes; the post-filter `file.mimeType` check excludes them, but the test suite must cover a folder item explicitly to lock this down.
- **Redis cache eviction during the editor session.** Same risk as Google — if the cache TTL elapses mid-edit, the slice endpoint will 404. The frontend's existing reload-on-cache-miss behavior (Phase C) handles it by re-calling `selectWorkbook`. Document this in the service header.
