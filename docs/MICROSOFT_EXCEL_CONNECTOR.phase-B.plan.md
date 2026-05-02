# Microsoft Excel Cloud Connector — Phase B Plan

**Workbook listing + download + cache.**

Spec: `docs/MICROSOFT_EXCEL_CONNECTOR.phase-B.spec.md`. Discovery: `docs/MICROSOFT_EXCEL_CONNECTOR.discovery.md`.

Tests-first per slice. Run with `cd apps/api && npm run test:unit` and `npm run test:integration`.

---

## Slice 1 — API codes + contracts

**Files**

- Edit: `apps/api/src/constants/api-codes.constants.ts` — add the six `MICROSOFT_EXCEL_*` codes from the spec.
- Edit: `packages/core/src/contracts/microsoft-excel.contract.ts` — add list/select/slice schemas (the authorize schema landed in Phase A).
- Edit: `packages/core/src/contracts/index.ts` — export the new schemas.
- New: `packages/core/src/__tests__/contracts/microsoft-excel.contract.test.ts` (or extend the Phase A file) covering the six new schemas.

**Steps**

1. Write the contract tests (parse happy path + missing-required-field rejects, alias identity for slice schemas).
2. Run; verify failures.
3. Add the schemas mirroring `google-sheets.contract.ts`. The slice request/response schemas import from `file-uploads.contract.ts` (or the same place Google does) and re-export under Microsoft names — same alias pattern.
4. Add the API codes (no tests for the enum itself).
5. Re-run; green.

**Done when:** schemas exported and tests green.

---

## Slice 2 — `MicrosoftGraphService`

**Files**

- New: `apps/api/src/services/microsoft-graph.service.ts`.
- New: `apps/api/src/__tests__/services/microsoft-graph.service.test.ts`.

**Steps**

1. Write the unit tests per spec §test-plan-#1. Mock `fetch` via `jest.unstable_mockModule` (consistent with the existing google-auth test pattern). For `downloadWorkbook`, build a `Response` with a `ReadableStream` body and assert `body.cancel` is called when oversized.
2. Run; verify failures.
3. Implement the service:
   - `MicrosoftGraphError` subclass with `kind` enum: `"search_failed" | "head_failed" | "download_failed" | "file_too_large"`.
   - `searchWorkbooks(accessToken, query)` — empty query routes to `/me/drive/recent`; non-empty to `/me/drive/search(q='…')`. URL-encode the query; for the `(q='…')` path-segment form, escape internal single quotes by doubling them per OData rules. Build the `$select` and `$top` query params. Post-filter for `.xlsx` mime + extension. Map to `{ driveItemId, name, lastModifiedDateTime, lastModifiedBy }`.
   - `headWorkbook(accessToken, driveItemId)` — `GET /me/drive/items/{id}` with `$select=size,name`. Returns `{ size, name }`.
   - `downloadWorkbook(accessToken, driveItemId)` — `GET /me/drive/items/{id}/content`. Read `Content-Length` from the headers; if present and over `environment.FILE_UPLOAD_MAX_BYTES`, call `body?.cancel()` and throw `MicrosoftGraphError("file_too_large", …)`. Returns `body` as a Node `Readable` (use `Readable.fromWeb(body as any)` for the web → node conversion if exceljs needs it).
4. Re-run; green.

**Done when:** all `MicrosoftGraphService` unit tests pass.

---

## Slice 3 — `MicrosoftExcelConnectorService.searchWorkbooks`

**Files**

- Edit: `apps/api/src/services/microsoft-excel-connector.service.ts` — add `searchWorkbooks` method.
- New: `apps/api/src/__tests__/services/microsoft-excel-connector.service.searchWorkbooks.test.ts`.

**Steps**

1. Write the test: mock the access-token cache and graph service; assert the connector service threads the args through correctly and shapes the response as `{ items }`.
2. Run; verify failure.
3. Implement; trivial.
4. Re-run; green.

---

## Slice 4 — `MicrosoftExcelConnectorService.selectWorkbook` (the load-bearing slice)

**Files**

- Edit: `apps/api/src/services/microsoft-excel-connector.service.ts` — add `selectWorkbook`, `resolveWorkbook`, `sheetSlice`.
- New: `apps/api/src/__tests__/services/microsoft-excel-connector.service.selectWorkbook.test.ts`.
- New: `apps/api/src/__tests__/services/microsoft-excel-connector.service.sheetSlice.test.ts`.
- New: `apps/api/src/__tests__/services/microsoft-excel-connector.service.resolveWorkbook.test.ts`.

**Steps**

1. Write the three test files per spec §test-plan-#3, #4, #5. Use a real small `.xlsx` fixture for the happy path (re-use the file-upload test fixtures under `apps/api/src/__tests__/fixtures/` or wherever they live).
2. Run; verify failures.
3. Implement `selectWorkbook` step-by-step per the spec scope §2:
   - Read access token.
   - Pre-flight `headWorkbook`. Validate size, validate extension. Throw cleanly with `details: { sizeBytes, capBytes }`.
   - Download stream.
   - Pipe through `xlsx.adapter.parse(stream)` → `WorkbookData`. (If today's `xlsx.adapter` is a non-streaming buffer-only API, the slice grows by one step: read `xlsx.adapter.ts` first; if it accepts a buffer, buffer the stream up to `FILE_UPLOAD_MAX_BYTES` then parse. The discovery doc claims it streams — verify and document the actual surface in this slice's PR description.)
   - Cache via `WorkbookCacheService.set(workbookCacheKey("microsoft-excel", id), workbook)`.
   - Update instance `config`.
   - Compute `inflateSheetPreview` for each sheet; return `{ title, sheets, sliced? }`.
4. Implement `sheetSlice` and `resolveWorkbook` — both are direct ports of the Google implementations with the cache-key swap.
5. Re-run; green.

**Risk:** if `xlsx.adapter` doesn't stream, the buffering step makes us hold the full file in memory. With the cap at 50 MB and typical Node API processes at 512 MB - 1 GB heap, this is fine for v1. Note in the PR description for follow-up.

**Done when:** all unit tests pass; manual `select-workbook` against a real OneDrive file produces a cached workbook a curl to `sheet-slice` can read.

---

## Slice 5 — Routes

**Files**

- Edit: `apps/api/src/routes/microsoft-excel-connector.router.ts` — add the three new route handlers (mirror of `google-sheets-connector.router.ts:286-485`).
- New: `apps/api/src/__tests__/__integration__/routes/microsoft-excel-connector.router.integration.test.ts` (or extend the Phase A file).

**Steps**

1. Write integration tests per spec §test-plan-#7-13.
2. Run; verify failures.
3. Implement the route handlers; reuse `resolveOwnedInstance` and `mapMicrosoftAuthError` (will need a parallel `mapMicrosoftGraphError` for graph errors — `file_too_large` → `ApiError(413, MICROSOFT_EXCEL_FILE_TOO_LARGE)` with the details, the others to 502).
4. Re-run; green.

**Done when:** all integration tests pass.

---

## Slice 6 — Frontend SDK

**Files**

- Edit: `apps/web/src/api/microsoft-excel.api.ts` — add the three new method exports.
- New: `apps/web/src/__tests__/api/microsoft-excel.api.test.ts` (or extend Phase A's).

**Steps**

1. Write the SDK tests asserting each method targets the correct URL/method/body, mirroring `google-sheets.api.test.ts`.
2. Run; verify failures.
3. Implement; near-direct port.
4. Re-run; green.

**Done when:** SDK tests pass; the workflow shell (Phase C) can call `sdk.microsoftExcel.searchWorkbooks/.selectWorkbook/.sheetSlice` against the live API.

---

## Cross-slice checklist before declaring Phase B complete

- [ ] `npm run test:unit && npm run test:integration` green in `apps/api`.
- [ ] `npm run test:unit` green in `apps/web` (just the SDK contract tests for now).
- [ ] `npm run lint && npm run type-check && npm run build` green at the monorepo root.
- [ ] Manual exercise of all three new endpoints succeeds against a real OneDrive workbook.
- [ ] Manual oversize-file test (>50 MB workbook) returns 413 with the documented `details` shape; download was never attempted (verifiable by tailing API logs and confirming no `download_workbook` log line for the oversize attempt).
- [ ] `connector_instances.config` shows `{ driveItemId, name, fetchedAt }` after a successful `select-workbook`.
- [ ] No frontend workflow shell yet — Phase C.
