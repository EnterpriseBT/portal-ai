# Google Sheets Connector — Phase B Implementation Plan

Companion to `GOOGLE_SHEETS_CONNECTOR.discovery.md` and `.phase-A.plan.md`. Phase B scope:

> **Phase B** — Sheet listing + workbook fetch + cache. UI: just a debug page that lets a developer connect, list sheets, and inspect the cached workbook JSON.

Concretely: turn a Phase-A pending `ConnectorInstance` (with encrypted refresh token) into something a future workflow can drive, via three new endpoints — list spreadsheets, fetch one and cache it, serve cell-rectangle slices for over-cap sheets.

## What already exists (do not rebuild)

Phase B reuses much more existing infrastructure than Phase A. Don't duplicate:

- **`WorkbookCacheService`** (`apps/api/src/services/workbook-cache.service.ts`) — Redis-backed cache for parsed `WorkbookData`, TTL'd per `FILE_UPLOAD_CACHE_TTL_SEC`. Currently hardcoded to a `upload-session:` key prefix; Slice B1 generalizes the API to accept an opaque cache key so file-upload + google-sheets share one primitive.
- **`FileUploadSessionService.parseSession` + `sheetSlice`** (`apps/api/src/services/file-upload-session.service.ts`) — the reference shape for the inline-or-sliced response. `inflateSheetPreview` decides which sheets ship cells inline vs. with `sliced: true` based on `FILE_UPLOAD_INLINE_CELLS_MAX`. The select-sheet route returns the same payload shape so RegionEditor (Phase C) treats both pipelines identically.
- **`FILE_UPLOAD_INLINE_CELLS_MAX` (1M cells)** and **`FILE_UPLOAD_SLICE_CELLS_MAX` (50k cells/req)** env vars — apply unchanged to google-sheets-sourced workbooks. Don't introduce parallel `GSHEETS_*` knobs (per `feedback_no_compat_aliases`).
- **`WorkbookData` schema** (`@portalai/spreadsheet-parsing`) — the validation contract every adapter writes against.
- **`GoogleAuthService`** (Phase A) — `buildConsentUrl`, `exchangeCode`, `fetchUserEmail`. Phase B adds `refreshAccessToken` to the same class.
- **`GoogleSheetsConnectorService.handleCallback`** (Phase A) — returns the pending instance id; Phase B adds `listSheets`, `selectSheet`, `sheetSlice` methods alongside.
- **`googleSheetsAdapter`** (Phase A stub) — `toPublicAccountInfo` only. Phase B doesn't touch the adapter; sync/query are Phase D.
- **Encrypted credential round-trip** through `ConnectorInstancesRepository` — `findById` already decrypts. New service code never touches the encryption layer directly.
- **Redis client** (`apps/api/src/utils/redis.util.ts`) — used for both the workbook cache and the new access-token cache.

## What's net-new for Phase B

| Piece | File | Purpose |
|---|---|---|
| `refreshAccessToken` | `services/google-auth.service.ts` | Trade refresh token for fresh access token. |
| Access-token cache | `services/google-access-token-cache.service.ts` (new) | Redis-keyed `gsheets:access:{connectorInstanceId}`, ~50 min TTL. |
| Drive `files.list` proxy | `services/google-sheets-connector.service.ts` (extend) | Lists spreadsheets the authenticated user can read. |
| Sheets API → `WorkbookData` mapper | `services/google-sheets-workbook.service.ts` (new) | Pure mapper from `spreadsheets.get?includeGridData=true` response → `WorkbookData`. |
| `GET /sheets` route | `routes/google-sheets-connector.router.ts` (extend) | Authenticated list of the user's spreadsheets. |
| `POST /instances/:id/select-sheet` route | same | Fetch + cache + update `instance.config`. |
| `GET /instances/:id/sheet-slice` route | same | Cell-rectangle reads for over-cap sheets. |
| `WorkbookCacheService` rename + caller updates | existing files | Take an opaque cache key instead of `uploadSessionId`. |

## TDD discipline

Same as Phase A — every slice lands red → green → refactor, run via `npm run test:unit` / `npm run test:integration` from `apps/api/` (per `feedback_use_npm_test_scripts`). Don't move on with a red slice outstanding.

A few slices below are pure-function units (`refreshAccessToken`, the workbook mapper) that the test pyramid wants in-process unit tests against; the route slices are integration tests against the real DB + Redis (testcontainers handles both).

---

## Slice 1 — Generalize `WorkbookCacheService` to take an opaque cache key

### Goal

Lift the hardcoded `upload-session:` prefix out of `WorkbookCacheService` so a second caller (google-sheets) can use the same cache primitive without copy-paste. No behavior change.

### Red

- Update `apps/api/src/__tests__/services/workbook-cache.service.test.ts` (or create one if absent) to pass an explicit `cacheKey` like `"upload-session:abc"` and assert that:
  1. `set + get` round-trip returns the same workbook for that exact key.
  2. Two distinct keys don't collide (`"upload-session:abc"` and `"gsheets:wb:abc"` are independent).
  3. Delete on one key doesn't affect the other.

### Green

- Rename `set/get/delete(uploadSessionId, …)` → `set/get/delete(cacheKey, …)`. Drop the internal `KEY_PREFIX` constant — callers now own their prefix.
- Update the four call sites in `FileUploadSessionService` to pass `` `upload-session:${uploadSessionId}` ``. Take the diff small.

### Refactor

- A `cacheKey()` helper at the top of `FileUploadSessionService` that builds the prefixed key — keeps the magic-string in one place.

### Verification

```
npm run test:unit -- --testPathPattern workbook-cache
npm run test:integration -- --testPathPattern file-upload
```

---

## Slice 2 — `GoogleAuthService.refreshAccessToken`

### Goal

Trade a refresh token for a fresh access token. Mirrors `exchangeCode` shape but with `grant_type=refresh_token` and no `redirect_uri`. Throws `GoogleAuthError("refresh_failed")` on `invalid_grant` so callers can mark the instance `status="error"` and prompt the user to reconnect.

### Red

Extend `apps/api/src/__tests__/services/google-auth.service.test.ts` with a fourth describe block:

1. POSTs to `oauth2.googleapis.com/token` with `Content-Type: application/x-www-form-urlencoded`, body containing `client_id`, `client_secret`, `refresh_token`, `grant_type=refresh_token`. No `redirect_uri` (Google rejects it on refresh).
2. Returns `{ accessToken, expiresIn }` on 200 (no `refreshToken` — Google doesn't rotate it on refresh).
3. Throws `GoogleAuthError("refresh_failed")` on 4xx; `cause` carries the upstream `invalid_grant` body so the route can surface it specifically.

### Green

Add a static `refreshAccessToken(refreshToken: string, fetchFn?): Promise<{ accessToken: string; expiresIn: number }>` to `GoogleAuthService`. Reuse the existing `formEncode` / `safeReadText` helpers.

### Refactor

Lift the Google OAuth URL constants and the `fetch`-or-throw boilerplate into private helpers if `exchangeCode` and `refreshAccessToken` start to look duplicated.

---

## Slice 3 — Access-token cache (`GoogleAccessTokenCacheService`)

### Goal

Concurrent syncs / list calls share a single live access token rather than each minting a fresh one. Keyed by `connectorInstanceId`; TTL is `expiresIn - 600s` (10-min safety margin so an in-flight request doesn't end up holding a token that expires mid-call).

### Red

New file `apps/api/src/__tests__/services/google-access-token-cache.service.test.ts`:

1. **Cache hit** — `getOrRefresh(id)` returns the cached value without calling `refreshAccessToken`.
2. **Cache miss → refresh → store** — first call invokes `refreshAccessToken` exactly once, stores under `gsheets:access:{id}` with the right TTL, and returns the token.
3. **Concurrent miss** — two simultaneous `getOrRefresh(id)` calls produce **one** refresh call (single-flight de-dup via Redis SET NX or in-memory promise cache). Test with `Promise.all`.
4. **Refresh failure** — when `refreshAccessToken` throws `GoogleAuthError("refresh_failed")`, the service updates `connectorInstance.status = "error"` with `lastErrorMessage` and rethrows so the caller surfaces a 502 (with a link to a future "Reconnect" UI from Phase E).

### Green

New file `apps/api/src/services/google-access-token-cache.service.ts`. Internals:

- `cacheKey = `gsheets:access:${id}``
- `getOrRefresh(connectorInstanceId)`:
  1. `redis.get(cacheKey)` → return on hit.
  2. Load instance → decrypt credentials → `refreshAccessToken(credentials.refresh_token)`.
  3. Set with `EX expiresIn - 600` (clamped ≥ 60).
  4. Return token.
- Single-flight: in-memory `Map<string, Promise<string>>` keyed by id; `delete` after settle. Sufficient for v1 (single API process). Cross-process coordination is Redis SET NX with a short lock TTL — flag in Refactor as a "if we ever scale to N processes" note.
- Refresh-failure branch: `connectorInstancesRepo.update(id, { status: "error", lastErrorMessage })` before rethrow.

### Refactor

If the single-flight Map becomes load-bearing, lift it into a small `singleFlight<T>(key, fn): Promise<T>` util in `utils/`. Don't pre-extract.

---

## Slice 4 — Drive `files.list` proxy (`listSheets` service method)

### Goal

Server-side proxy for Drive's `files.list` filtered to spreadsheets. Returns a paginated slim view (id, name, modifiedTime, owners) the UI renders in `AsyncSearchableSelect`.

### Red

Extend `apps/api/src/__tests__/services/google-sheets-connector.service.test.ts` (create if absent):

1. Mock `fetch`. Request URL is `https://www.googleapis.com/drive/v3/files?…` with:
   - `q` containing `mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`.
   - `q` extends with `name contains '<search>'` when `search` is non-empty.
   - `fields=files(id,name,modifiedTime,owners(emailAddress,displayName)),nextPageToken`.
   - `pageSize=25` (or whatever the UI debounce expects).
   - `pageToken=<token>` when supplied.
   - `Authorization: Bearer <token from GoogleAccessTokenCacheService>`.
2. Returns `{ items: [{ spreadsheetId, name, modifiedTime, ownerEmail }], nextPageToken }` — the Drive `id` field maps to `spreadsheetId` to keep the connector vocabulary consistent.
3. Empty search returns the full list (no `name contains` clause).
4. Drive 4xx → throws `GoogleAuthError("listSheets_failed")` (or a connector-specific error class — see Refactor); 401 specifically signals stale credentials and surfaces a 502 to the route layer.
5. Sanitizes `search` — escapes `'` so `q` syntax can't be hijacked. Test with a search of `O'Brien`.

### Green

Add `listSheets({ connectorInstanceId, search, pageToken }): Promise<ListSheetsResult>` to `GoogleSheetsConnectorService`:

1. Resolve access token via `GoogleAccessTokenCacheService.getOrRefresh(connectorInstanceId)`.
2. Build `q` with proper quote-escaping; `pageSize=25`.
3. `fetch(driveUrl, { headers: { Authorization } })`.
4. Map response to the slim shape.

Add a new `GoogleAuthErrorKind` value (or introduce `ConnectorIntegrationError` if the error vocabulary starts to bloat — see Refactor).

### Refactor

If `GoogleAuthError` grows past 5-6 kinds the file is signaling that "Google integration error" deserves its own class. Promote when the next kind appears, not before.

---

## Slice 5 — `GET /sheets` route

### Goal

Authenticated endpoint that resolves a `connectorInstanceId`, validates ownership, and returns the listSheets result.

### Red

Extend `apps/api/src/__tests__/__integration__/routes/google-sheets-connector.router.integration.test.ts`:

1. **401** when called without a JWT.
2. **400** `GOOGLE_SHEETS_INVALID_INSTANCE_ID` when `connectorInstanceId` query param is missing.
3. **404** `CONNECTOR_INSTANCE_NOT_FOUND` when the id doesn't exist for the caller's org.
4. **403** when the id exists but belongs to a different org.
5. **200** happy path — mocked `fetch` returns 2 sheets; response payload shape = `{ items: [...], nextPageToken? }`. Verifies `Authorization` header on the upstream call carries the cached access token.
6. **502** `GOOGLE_OAUTH_REFRESH_FAILED` when `getOrRefresh` throws (refresh-token revoked); response includes a hint that the user must reconnect.

### Green

`googleSheetsConnectorRouter.get("/sheets", getApplicationMetadata, async (req, res, next) => {…})`. Validates query → checks instance ownership against `req.application.metadata.organizationId` → calls `GoogleSheetsConnectorService.listSheets`.

Add API codes: `GOOGLE_SHEETS_INVALID_INSTANCE_ID`, `GOOGLE_SHEETS_LIST_FAILED`, `GOOGLE_OAUTH_REFRESH_FAILED`.

### Refactor

The "resolve + verify ownership" block will repeat in every Phase B/D route. Extract a `resolveOwnedInstance(req, instanceId): Promise<ConnectorInstanceSelect>` helper as soon as the second callsite appears (Slice 7).

---

## Slice 6 — Sheets API → `WorkbookData` mapper

### Goal

Pure function that turns a `spreadsheets.get?includeGridData=true` response into a `WorkbookData` validated by `WorkbookSchema`. Pure-function tests, no network.

### Red

New file `apps/api/src/__tests__/services/google-sheets-workbook.service.test.ts`. Use small fixtures (inline JSON) — start with three:

1. **One sheet, one tab, all primitive values.** Maps to a `Workbook` with a single sheet whose cells include strings, numbers, booleans, ISO-string dates derived from Sheets' `effectiveValue` shape.
2. **Multiple sheets.** Each tab gets its own `Workbook.sheets[]` entry; sheet names preserved verbatim (no `uniqueSheetName` collision logic — Sheets enforces unique tab names server-side).
3. **Empty cells.** Sheets API returns sparse `rowData[].values[]` with gaps — mapper materializes them as `null` cells in the right `(row, col)` slots so the parser's coordinate math still works.
4. **Date / formula / hyperlink edge cases.** Sheets returns `effectiveValue.numberValue` for serial-date numbers when format is DATE — map to ISO strings via the same logic the file-upload XLSX adapter uses; reuse it if the helper is already exported.
5. **Validation gate.** The function ends with `WorkbookSchema.safeParse(...)`; an internal-bug response shape that fails parse throws — same pattern as `parseUploadsToWorkbook` (`file-upload-session.service.ts:209`).

### Green

New file `apps/api/src/services/google-sheets-workbook.service.ts` exporting `googleSheetsToWorkbook(response)`. Single function for v1; extract sub-helpers only when test pressure forces it. Keep the date-coercion logic in lockstep with the XLSX adapter so an interpreted date from a Sheets tab matches what the same date in an uploaded XLSX produces.

### Refactor

If the date-coercion logic ends up duplicated between the XLSX adapter and this mapper, lift to `@portalai/spreadsheet-parsing` as a shared helper. Don't pre-extract — wait for a second consumer.

---

## Slice 7 — `POST /instances/:id/select-sheet` route + service

### Goal

The user has authorized + listed; now they pick a spreadsheet. Server fetches the full workbook (`spreadsheets.get?includeGridData=true`), maps to `WorkbookData`, caches it under `gsheets:wb:{connectorInstanceId}`, updates `instance.config = { spreadsheetId, title, fetchedAt }`, and returns the same inline-or-sliced response shape `parseSession` returns so the RegionEditor (Phase C) treats both sources identically.

### Red

Extend the router integration test:

1. **401 / 400 / 404 / 403** — same envelope as `/sheets`.
2. **400 `GOOGLE_SHEETS_INVALID_PAYLOAD`** when `spreadsheetId` is missing.
3. **502 `GOOGLE_SHEETS_FETCH_FAILED`** on Google API error; no DB write, no cache write.
4. **Happy: small sheet** — mocked Sheets response with ~100 cells. Asserts:
   - Response payload has `sheets[].cells` populated inline.
   - Response top-level `sliced` is `false` (or absent).
   - Redis key `gsheets:wb:{id}` exists with a `WorkbookData` JSON.
   - DB `connector_instances.config` updated to `{ spreadsheetId, title, fetchedAt: <epoch> }`.
5. **Happy: large sheet (over `FILE_UPLOAD_INLINE_CELLS_MAX`)** — mocked response with > 1M cells. Response shape returns `cells: []` + `sliced: true` for that sheet, but the cache contains the full `WorkbookData`. Same as `parseSession` (`file-upload-session.service.ts:425-446`).
6. **Re-select-sheet** — calling the endpoint a second time with a different `spreadsheetId` overwrites both the cache and `instance.config`. No stale data leaks.

### Green

Service method `GoogleSheetsConnectorService.selectSheet({ connectorInstanceId, spreadsheetId, organizationId, userId })`:

1. Resolve owned instance (via the helper extracted in Slice 5 refactor).
2. `getOrRefresh` access token.
3. `fetch('https://sheets.googleapis.com/v4/spreadsheets/{id}?includeGridData=true&fields=…')` — limit `fields` to keep the response slim (sheet `properties` + `rowData.values.{effectiveValue,formattedValue}`).
4. `googleSheetsToWorkbook(response)` → `WorkbookData`.
5. `WorkbookCacheService.set(`gsheets:wb:${connectorInstanceId}`, workbook)`.
6. `connectorInstancesRepo.update(connectorInstanceId, { config: { spreadsheetId, title, fetchedAt: Date.now() }, updatedBy: userId })`.
7. Run `inflateSheetPreview` against each sheet (reuse the file-upload helper — extract it from `file-upload-session.service.ts` to a module-shared util if not already exported).
8. Return `{ sheets, sliced }`.

Route: `googleSheetsConnectorRouter.post("/instances/:id/select-sheet", getApplicationMetadata, …)`.

Add API codes: `GOOGLE_SHEETS_FETCH_FAILED`, `GOOGLE_SHEETS_INVALID_PAYLOAD`.

### Refactor

`inflateSheetPreview` lives inside `file-upload-session.service.ts` today as a helper. Phase B promotes it to `apps/api/src/services/workbook-preview.util.ts` (or wherever the shared utility belongs) so both pipelines call it. Don't duplicate — promote.

---

## Slice 8 — `GET /instances/:id/sheet-slice` route + service

### Goal

For sheets that came back over-cap (`sliced: true`), the editor pulls cell rectangles on demand. Same shape as `/api/file-uploads/sheet-slice`. v1 reads from the cached `WorkbookData` — we already have the full workbook in Redis from Slice 7. (A future optimization could skip caching the full grid and proxy to `spreadsheets.values.get` per-rectangle, but that's a Phase D concern when sync repeatedly fetches.)

### Red

Extend the router integration test:

1. **401 / 404 / 403** — same envelope.
2. **400 `FILE_UPLOAD_PARSE_INVALID_PAYLOAD`** (or new `GOOGLE_SHEETS_SLICE_INVALID_PAYLOAD`) when `sheetId` / `rowStart` / etc. are missing or malformed.
3. **400 `FILE_UPLOAD_SLICE_TOO_LARGE`** when the requested rectangle exceeds `FILE_UPLOAD_SLICE_CELLS_MAX`. Reuse the existing code so the UI can handle one error code regardless of source.
4. **404 `FILE_UPLOAD_SESSION_NOT_FOUND`** when the cache key has expired (Redis miss).
5. **400 `FILE_UPLOAD_SLICE_OUT_OF_BOUNDS`** when `rowStart >= sheet.rowCount`.
6. **Happy** — known cached workbook, request a 5×5 rectangle, response cells match.

### Green

Service method `GoogleSheetsConnectorService.sheetSlice({ connectorInstanceId, sheetId, rowStart, rowEnd, colStart, colEnd, organizationId })`:

1. Resolve owned instance.
2. `WorkbookCacheService.get(`gsheets:wb:${connectorInstanceId}`)` → 404 on miss.
3. Reuse the slicing logic in `FileUploadSessionService.sheetSlice` — extract the actual rectangle-from-`WorkbookData` helper to `workbook-preview.util.ts` (started in Slice 7 refactor).
4. Return `{ cells }`.

Route: `googleSheetsConnectorRouter.get("/instances/:id/sheet-slice", getApplicationMetadata, …)`.

### Refactor

After Slice 7 + 8 land, the file-upload and google-sheets pipelines share three helpers (`workbook-preview.util.ts`: `inflateSheetPreview`, `sliceWorkbookRectangle`, plus any shared validation). Confirm both call sites use the same code paths so a bug fix in one fixes both.

---

## End-to-end verification gate

After Slices 1-8 land, run the developer debug flow against staging or local:

1. (Phase A) Run authorize → callback to create a pending instance with email `you@example.com`.
2. `GET /api/connectors/google-sheets/sheets?connectorInstanceId=<id>` → returns a paginated list of your spreadsheets (filter by `?search=` to narrow).
3. Pick a spreadsheet id; `POST /api/connectors/google-sheets/instances/<id>/select-sheet` with `{ spreadsheetId }`. Response includes the sheet preview shape with inline cells (or `sliced: true` for big sheets).
4. `redis-cli GET gsheets:wb:<id>` shows the cached `WorkbookData` JSON.
5. `psql ... SELECT config FROM connector_instances WHERE id = '<id>'` shows `{ "spreadsheetId": "...", "title": "...", "fetchedAt": <epoch> }`.
6. For an over-cap sheet: `GET /api/connectors/google-sheets/instances/<id>/sheet-slice?sheetId=<id>&rowStart=0&rowEnd=20&colStart=0&colEnd=10` returns 200 cells.
7. (Optional) Wait > `FILE_UPLOAD_CACHE_TTL_SEC`; re-call select-sheet — the cache repopulates.

If all seven checks pass, Phase B is done. Phase C (region-editing workflow) consumes the same select-sheet + sheet-slice endpoints the file-upload pipeline already feeds into RegionEditor; the workflow shell is the work, not the data layer.

---

## Out of scope for Phase B

- **Region-editing workflow** (Phase C) — wires the existing RegionEditor + commit pipeline against the new endpoints.
- **Manual sync + watermark reconciliation + identity-strategy guard** (Phase D — see discovery doc § Sync Model).
- **Reconnect / `invalid_grant` recovery flow** (Phase E). Slice 3 already marks the instance `status="error"` on refresh failure; the UI affordance to re-enter the OAuth flow against the existing instance id is Phase E.
- **Frontend** of any kind — the integration tests cover the API surface; manual verification per the gate above stands in for E2E until Phase C builds the workflow.
- **Google Picker UI** — the discovery doc closed this question with "Option B (API-driven list) for v1." Don't reopen.
- **Per-tab Workbook fetch** — fetching only specific tabs of a workbook to reduce API cost. The existing `spreadsheets.get?fields=…` already trims fields; per-tab filtering is a Phase D optimization once measured cost makes it worth it.

## Risks specific to Phase B

- **Drive API quota.** Default 1000 reads/100s/user, 10000/100s/project. Listing spreadsheets is one read per page; each page is 25 sheets. Power users with thousands of spreadsheets see 100s of pageloads per session. Mitigate via the `AsyncSearchableSelect` debounce and `pageSize=25` — re-evaluate when first user feedback comes in.
- **`spreadsheets.get?includeGridData=true` response size.** A 10M-cell sheet returns hundreds of MB of JSON. The mapper holds it in memory. Two safeguards already exist: (a) Slice 6's `WorkbookSchema` parse fails fast on malformed shapes, and (b) the inline-or-sliced cap means we never *re-serialize* the full thing into the response — but we do build the in-memory `WorkbookData`. Add an early "request `Content-Length` header > X" check in Slice 7 if production sees OOMs; not a v1 blocker.
- **Sheet-tab name collisions across workbooks.** Doesn't apply (we're one workbook per instance, per the discovery doc's workbook-level scoping decision). Note for Phase B/C: don't reuse the `uniqueSheetName` logic from `parseUploadsToWorkbook`; google-sheets workbooks are inherently single-source.
- **Refresh-token rotation.** Google sometimes rotates refresh tokens (rare, mostly on policy changes / scope grants). Slice 2 deliberately ignores any `refresh_token` in the refresh response; Phase E's reconnect flow handles the case where Google has fully invalidated the old token (`invalid_grant`).
- **Workbook cache key collision with file-upload.** The Slice 1 refactor pushes the prefix to callers — `upload-session:` and `gsheets:wb:` are distinct. A regression where a future caller forgets the prefix would silently overlap; the Slice 1 test that asserts cross-key isolation prevents this.
