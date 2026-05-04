# Microsoft Excel Cloud Connector — Discovery

## Goal

Add a `microsoft-excel` connector that lets a user authorize Portal.ai against their Microsoft 365 account, pick an Excel workbook stored in OneDrive (personal or business), run the same region-editing workflow that Google Sheets and file uploads already use, and let them **manually re-sync** the data into `entity_records` from the source workbook on demand.

This is a near-clone of the `google-sheets` connector. The user-facing workflow is **identical** in shape — same 4-step stepper, same RegionEditor, same review/commit, same Sync-now affordance — and only differs at the edges where Microsoft's identity platform and Graph API replace Google's:

1. **OAuth2 against Microsoft identity platform v2.0** (instead of Google).
2. **Microsoft Graph file discovery + workbook fetch** (instead of Drive `files.list` + `spreadsheets.get`).
3. **Microsoft-flavoured account identity** (UPN / mail) for per-(org, account) instance scoping.

Everything from "user has a `Workbook`" onwards is the existing pipeline, unchanged.

Concretely, we ship:

1. **OAuth2 authorization flow.** User grants Portal.ai read access to their OneDrive/Excel files. We persist refresh-token-bearing credentials per `ConnectorInstance`. Microsoft refresh tokens **rotate on every refresh** — the cache layer must overwrite stored refresh tokens on success, unlike Google's static refresh tokens.
2. **Workbook discovery + selection.** After auth, the user picks an Excel workbook (`.xlsx`) from their authorized scope via an `AsyncSearchableSelect`, identical UX to the Google Sheets step.
3. **Region editing — same UX as Google Sheets and file upload.** We reuse `modules/RegionEditor` and the shared interpret/commit pipeline so the user can draw regions, get an LLM-interpreted plan, and review/commit bindings exactly like the existing workflows.
4. **Manual re-sync.** Once committed, the user can hit "Sync now" on the connector. The server re-fetches the source workbook, replays the persisted `LayoutPlan` against the new bytes, and upserts into `entity_records`. Same watermark-based reaping as `google-sheets`.

Non-goals for this discovery:

- Two-way write-back to Excel (we only `read` / `sync`, not `write` / `push`).
- Scheduled / repeating sync (hourly, daily, weekly). v1 ships manual-only — same posture as `google-sheets`.
- Real-time push via Graph subscriptions / webhooks.
- SharePoint sites, Teams channels, Excel files attached to email. v1 covers OneDrive Personal + OneDrive for Business only. SharePoint is a follow-up that needs an additional scope (`Sites.Read.All`) and a slightly different drive lookup.
- `.xlsm` (macro-enabled), `.xlsb` (binary), `.csv`. v1 is `.xlsx` only — the existing XLSX adapter and the Graph Workbook API both refuse anything else.

---

## Existing State

### What we have already (reusable as-is)

The Google Sheets connector landed across phases A–E and most of its infrastructure is connector-agnostic by design. The Excel connector inherits all of it:

- **OAuth2 state token (`apps/api/src/utils/oauth-state.util.ts`).** Provider-neutral signed-state util — no Google specifics; it just signs `{ userId, organizationId, iat, nonce }`. Used as-is for the Microsoft flow.
- **Encrypted credentials column.** `connector_instances.credentials` already stores encrypted JSON (`utils/crypto.util.ts:decryptCredentials`). The Google flow's `{ refresh_token, scopes, googleAccountEmail }` becomes Microsoft's `{ refresh_token, scopes, microsoftAccountUpn, microsoftAccountEmail, tenantId }`. Same encrypt-on-write / decrypt-on-read pattern at the repository layer.
- **Connector primitives.** `connector_definitions`, `connector_instances`, `ConnectorAdapter` interface, `ConnectorAdapterRegistry`, `connector_instance_layout_plans`. All slug-keyed and connector-agnostic.
- **Workbook cache (`apps/api/src/services/workbook-cache.service.ts`).** Redis-backed, prefix-keyed (`gsheets:wb:{ciId}` for sheets; we add `mexcel:wb:{ciId}` for Excel). TTL behavior unchanged.
- **Inline-or-sliced workbook preview (`apps/api/src/utils/workbook-preview.util.ts`).** `inflateSheetPreview` + `sliceWorkbookRectangle` — already pipeline-agnostic; consumed by both file-upload and google-sheets.
- **Layout-plan interpret + commit services.** `LayoutPlanInterpretService`, `LayoutPlanCommitService`. Already dispatch by `connectorInstanceId` via `resolveWorkbook` in each connector's service. The Excel service registers its own `resolveWorkbook` and the rest of the pipeline is hands-off.
- **Region editor module (`apps/web/src/modules/RegionEditor`).** Workbook-shape-agnostic. Powers both file upload and Google Sheets workflows; Excel will be its third consumer with no module changes.
- **Frontend popup hook (`apps/web/src/workflows/GoogleSheetsConnector/utils/google-sheets-popup.util.ts`).** This is the one piece that currently embeds a provider name (`"google-sheets-authorized"` postMessage type, hard-coded `MESSAGE_TYPE`). The hook itself is otherwise generic — see "Refactors before duplication" below.
- **Sync-eligibility advisory model (`apps/api/src/services/sync-eligibility.util.ts`).** `assertSyncEligibleIdentity` returns `identityWarnings` for `rowPosition` regions. Excel's adapter calls it identically.
- **Watermark reap (`entity_records.softDeleteBeforeWatermark`).** Per-run watermark reaping is repository-level and connector-agnostic.
- **Shared spreadsheet workflow hook (`apps/web/src/workflows/_shared/spreadsheet/use-spreadsheet-workflow.util.ts`).** The post-authorize stages (workbook → draw → review → commit) live here. The Excel workflow hook wraps it the same way `useGoogleSheetsWorkflow` does.

### What does NOT exist yet (new work)

- A Microsoft identity platform OAuth2 client equivalent to `GoogleAuthService` (consent URL, code exchange, refresh, userinfo).
- A Microsoft access-token cache equivalent to `GoogleAccessTokenCacheService`. Differs in one important way — Microsoft rotates refresh tokens on every refresh, so the cache must persist the **new** refresh token back to the encrypted credentials column when it runs.
- A Graph file-listing service (search + filter to `.xlsx` mimeType).
- A workbook acquisition service (download `.xlsx` and parse, or Graph Workbook API — see "Workbook Acquisition" below).
- A connector adapter for `microsoft-excel` (mirror of `googleSheetsAdapter`).
- The connector definition seed (`slug: "microsoft-excel"`, `authType: "oauth2"`, capability flags `{ sync: true, read: true, write: false, push: false }`).
- Frontend SDK group (`sdk.microsoftExcel.*`) and workflow folder (`workflows/MicrosoftExcelConnector/`).
- Microsoft contracts (`packages/core/src/contracts/microsoft-excel.contract.ts`) — Zod schemas for the four endpoints.
- API codes (`MICROSOFT_OAUTH_*`, `MICROSOFT_EXCEL_*`).
- Env vars: `MICROSOFT_OAUTH_CLIENT_ID`, `MICROSOFT_OAUTH_CLIENT_SECRET`, `MICROSOFT_OAUTH_REDIRECT_URI`, `MICROSOFT_OAUTH_TENANT` (default `common`).

### Refactors before duplication

Three small generalizations are worth doing **as part of Phase A**, not after, because they pay back the moment the second connector lands:

1. **Hoist the OAuth popup hook.** `useGooglePopupAuthorize` is 95% provider-agnostic. Move it to `apps/web/src/utils/oauth-popup.util.ts` (or `apps/web/src/modules/OAuthPopup/`) and parameterize the `messageType` (`"google-sheets-authorized"` → `"<slug>-authorized"`) and `popupName`. Each connector calls it with its own slug. No duplicated postMessage / origin-check code.
2. **Hoist the OAuth callback HTML renderer.** `renderCallbackHtml` in `google-sheets-connector.router.ts` is almost provider-agnostic. Pull into `apps/api/src/utils/oauth-callback-html.util.ts` and parameterize the message `type` (the slug). Both routers call it.
3. **Drop the `gsheets:` prefix in cache keys for the workbook + access-token caches.** The current keys are `gsheets:wb:{id}` and `gsheets:access:{id}`. Rename to `connector:wb:{slug}:{id}` and `connector:access:{slug}:{id}` so a second connector doesn't squat on a collision. Migration is trivial — these are short-lived (TTL'd) caches, no persistent state survives a deploy.

These refactors are scoped to Phase A; they show up in the plan's first slice so the Excel work that follows is genuinely additive.

---

## Authentication Approach: Microsoft Identity Platform v2.0

The Google Sheets discovery considered Auth0 IdP federation vs. direct OAuth2 against Google and chose direct. Same call applies here for the same reasons (multi-account, scope creep on every sign-in, rate-limit ceiling). We go direct against the Microsoft identity platform.

### Tenant choice

Microsoft's `/{tenant}/oauth2/v2.0/authorize` endpoint accepts:

| Tenant | Who can sign in |
|---|---|
| `common` | Personal Microsoft accounts AND work/school accounts. |
| `organizations` | Work/school accounts only. |
| `consumers` | Personal Microsoft accounts only. |
| `<tenant-id>` | Single specific tenant (locked-down enterprise). |

**Decision: `common`** by default, configurable via `MICROSOFT_OAUTH_TENANT` env var. `common` maximizes reach (a single button works for both personal OneDrive and OneDrive for Business). The tradeoff is that some enterprise admins gate `common` apps and require single-tenant registration — those orgs can self-serve by setting `MICROSOFT_OAUTH_TENANT=<their-tenant-id>` in their Portal.ai deployment. v1 doesn't surface this in the UI.

### Scopes

```
openid
profile
email
offline_access
User.Read
Files.Read.All
```

- `openid` + `profile` + `email` — required to call `/oauth2/v2.0/userinfo` and read identity. Microsoft requires `openid` to issue an `id_token`; without it the response is access-token-only and we have no email/UPN.
- `offline_access` — required to receive a `refresh_token`. **Without this scope Microsoft's response has no refresh token at all** (and unlike Google there is no `prompt=consent` workaround; the scope is the only switch).
- `User.Read` — required for the `GET /me` call (when we don't trust the id_token claims). Lightweight scope, no admin consent needed.
- `Files.Read.All` — read access to **all** files the user can see in their OneDrive (personal + business). The narrower `Files.Read` only covers files in the user's drive root, not files shared with them; for v1 we accept the broader scope to mirror the `drive.readonly` posture from Google. A future picker-based flow could narrow to `Files.ReadWrite.AppFolder` or per-file consent.

### Flow (parallels Google's, near-line-for-line)

1. User clicks "Connect Microsoft 365" in the new connector workflow.
2. Frontend hits `POST /api/connectors/microsoft-excel/authorize` → API mints a `state` token via the **shared** `oauth-state.util.ts:signState({ userId, organizationId })` and returns the consent URL with `response_type=code`, `prompt=select_account` (so the user can pick which Microsoft account, instead of silent SSO into the last-used one), and the scopes above.
3. User consents. Microsoft redirects to `https://api-{env}.portalsai.io/api/connectors/microsoft-excel/callback?code=...&state=...`.
4. API verifies `state`, exchanges `code` for `{ access_token, refresh_token, id_token, expires_in, scope }` against `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`.
5. API fetches the user's UPN + email — either via `GET https://graph.microsoft.com/v1.0/me` (Graph) or by decoding the `id_token` claims (`oid`, `preferred_username`, `email`, `tid`). **Decision: Graph `/me`.** The `id_token` is fine for the happy path but the userinfo endpoint also returns an account-type indicator we want for diagnostics, and Graph is a single source of truth across all subsequent calls.
6. API find-or-update a `(organization, microsoftAccountUpn)`-scoped `ConnectorInstance` (mirror of Google's `findByEmail` → rename to `findByUpn`; UPN is canonical because `mail` is null on some account types).
7. API renders the standard popup-postMessage HTML and the popup closes, identical to Google's flow.

### Refresh-token rotation (the one Microsoft-specific thing)

Microsoft rotates refresh tokens on every refresh. Where Google's `/token?grant_type=refresh_token` returns `{ access_token, expires_in }`, Microsoft's returns `{ access_token, refresh_token, expires_in, scope }` and the **old refresh token will eventually stop working** (Microsoft's docs say tokens are valid for up to 24 hours past their last use during rotation, but treat it as "single-use after rotation").

Implication for the cache layer:

- `MicrosoftAccessTokenCacheService.refreshAndStore` must, on every successful refresh:
  1. Cache the new access token in Redis (same as Google).
  2. **Update `connector_instances.credentials.refresh_token` with the new refresh token** (encrypted).
  3. Record `lastRefreshedAt` for observability.
- Concurrent refreshes need single-flight (we already have this for Google), AND the persistent write of the new refresh token must be idempotent under contention — last-writer-wins is fine here because both refresh calls received valid new tokens; the older one will simply be discarded on the next refresh. We must NOT, however, race two refreshes against Microsoft simultaneously with the same refresh token — Microsoft considers a token consumed the moment it's accepted, and the second concurrent call would fail with `invalid_grant`. The existing in-memory `inflight` Map already handles this for a single-process deploy.
- On `invalid_grant` (refresh token revoked / expired / consumed by a stale call), mirror Google's behavior: mark the instance `status="error"` with `lastErrorMessage`, surface a Reconnect button. Same Phase E flow as Google.

### Credential blob shape

```ts
// Encrypted into `connector_instances.credentials`:
{
  refresh_token: string,          // rotates every refresh
  scopes: string[],                // e.g. ["openid","profile","email","offline_access","User.Read","Files.Read.All"]
  microsoftAccountUpn: string,     // canonical identity (e.g. "alice@contoso.com")
  microsoftAccountEmail: string | null, // mail claim — may be null for personal MSAs
  microsoftAccountDisplayName: string,
  tenantId: string,                // from id_token "tid"; "9188040d-6c67-4c5b-b112-36a304b66dad" for personal MSA
  lastRefreshedAt: number          // Date.now() updated by the cache service
}
```

The adapter's `toPublicAccountInfo` returns `{ identity: upn, metadata: { email, displayName, tenantId } }`. Frontend chip renders `microsoftAccountUpn` as the identity (mirror of Google's `googleAccountEmail`).

### Account scoping

One `ConnectorInstance` per `(organization, microsoftAccountUpn)`. A user with personal + work Microsoft accounts gets two instances; the chip on each card disambiguates. Same posture as Google, with UPN substituting for email.

### New env vars / secrets

| Name | Where | Why |
|------|-------|-----|
| `MICROSOFT_OAUTH_CLIENT_ID` | SSM `/portalai/{env}/microsoft-oauth-client-id` | Public, env-specific. |
| `MICROSOFT_OAUTH_CLIENT_SECRET` | Secrets Manager `portalai/{env}/microsoft-oauth-client-secret` | Required by token exchange. |
| `MICROSOFT_OAUTH_REDIRECT_URI` | env, derived from `api-{env}.portalsai.io` | Must exactly match the registration in Microsoft Entra. |
| `MICROSOFT_OAUTH_TENANT` | env, default `common` | Tenant scope. Single-tenant deployments override. |

`backend.yml` and `deploy-dev.yml` need additions matching the existing pattern (SSM parameter for non-secret, Secrets Manager full-ARN for secret, plus a new `SecretArnMicrosoftOauthClientSecret` parameter).

---

## File Discovery & Selection

After authorization, the user picks a workbook. **Decision: Graph search via `/me/drive/search` with a mime-type filter, surfaced through `AsyncSearchableSelect`.** This mirrors the Google Sheets `Drive.files.list` approach.

```
GET https://graph.microsoft.com/v1.0/me/drive/search(q='{query}')
  ?$filter=file ne null
  &$top=25
  &$select=id,name,lastModifiedDateTime,createdBy,file,parentReference
```

Then **server-side**, filter the response items to those whose `file.mimeType` is `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` and whose `name` ends in `.xlsx`. Graph's `$filter` doesn't support `file/mimeType eq '…'` reliably (it's not in the predicate-supported set across all drive providers), so we filter in service code — the page size is small (25) and we already do similar post-filter work for Google.

Empty-search affordance: when the user opens the dropdown without typing, hit `GET /me/drive/recent?$top=25` and post-filter to `.xlsx` so the user immediately sees their five most-recent workbooks. (Google's flow does the equivalent with `files.list` un-`q`-d.)

The selected workbook's `driveItemId` (Graph's id, opaque string) and `name` get stored in `ConnectorInstance.config: { driveItemId, name, fetchedAt }`. We do **not** persist the `parentReference` / drive id — re-fetch via `/me/drive/items/{id}` is sufficient because Graph resolves the drive from the user's identity at request time.

### File-shape filter

`.xlsx` only for v1 (rationale: scope alignment with the existing XLSX adapter, refusal of `.xlsm` macros for security, refusal of `.xlsb` binary because exceljs doesn't support it). The select-sheet endpoint validates the workbook's name extension before fetch and returns `MICROSOFT_EXCEL_UNSUPPORTED_FORMAT` if the file ends in anything other than `.xlsx`. The list-files filter already excludes non-xlsx items, so the only path that exercises this is a hand-crafted API call.

---

## Workbook Acquisition

This is **the only meaningful design decision** unique to Excel. Two options; both are viable.

### Option A — Download `.xlsx` bytes via Graph and parse with our existing XLSX adapter (recommended)

```
GET https://graph.microsoft.com/v1.0/me/drive/items/{id}/content
  Authorization: Bearer <access_token>
→ binary stream (the .xlsx file's actual bytes)
```

Pipe the response through the existing `apps/api/src/services/workbook-adapters/xlsx.adapter.ts` (which wraps `exceljs` and produces a canonical `WorkbookData`). Cache under `connector:wb:microsoft-excel:{ciId}`.

**Pros:**
- Reuses 100% of the file-upload pipeline's parsing surface — battle-tested, dates / merged cells / formula results all behave identically to file-uploaded XLSX.
- One round-trip to Microsoft per workbook fetch. No per-cell or per-range API latency.
- Graph's `/content` endpoint has no documented size cap that's smaller than the underlying drive's per-file cap (4 GB on personal OneDrive, 250 GB on OneDrive for Business). Our hard cap is the existing `FILE_UPLOAD_MAX_BYTES` env var (≈ 50 MB at present), enforced by short-circuiting on `Content-Length`.
- Keeps the Excel adapter trivially small.

**Cons:**
- Always fetches the whole file. A 30 MB workbook is downloaded in full on every sync, even if only one region is bound. This is a sync-frequency concern (once-per-manual-trigger today) more than a steady-state one.
- No delta API — we can't ask "what changed since last sync." Microsoft Graph's `/delta` endpoint works on items, not cells, and only tells us "the workbook was modified," not which cells changed. Same constraint applies to Option B.

### Option B — Microsoft Graph Workbook API (deferred)

```
GET /me/drive/items/{id}/workbook/worksheets
GET /me/drive/items/{id}/workbook/worksheets/{name}/usedRange
GET /me/drive/items/{id}/workbook/worksheets/{name}/range(address='A1:Z100')
  Headers: workbook-session-id: <session>
```

The Graph Workbook API returns parsed cell values + formats + formulas in JSON, mirroring Google's `spreadsheets.get?includeGridData`. It supports per-range fetches and a session header for performance. We'd write a Microsoft equivalent of `google-sheets-workbook.service.ts` to map the JSON shape to `WorkbookData`.

**Pros:**
- Per-range fetches let large-sheet sync pull only bound regions, matching the "range-scoped fetch" optimization the Google Sheets discovery flagged for sync.
- No file-bytes parsing — everything's already JSON.
- Workbook sessions provide read-consistency snapshots across multiple range fetches.

**Cons:**
- Microsoft's per-tenant throttling on the Workbook API is materially tighter than on `/content` downloads. At even moderate sync volumes this becomes the rate-limit ceiling.
- Workbook sessions have a 5-7 minute idle TTL that we'd need to manage.
- Doesn't work for files larger than ~5 MB without "persistent sessions" (which themselves have undocumented limits) — for files above the cap, Microsoft's docs say to download the file, parse locally, modify, upload, which is exactly Option A.
- Adds a parallel mapping service (Microsoft JSON shape → `WorkbookData`) that has to handle Excel's full quirk surface (merged cells, formula errors, date serial numbers, rich text, …) — every quirk that exceljs already handles for free.

### Decision: Option A for v1, with Option B as a post-v1 escape hatch for very large files

The user has explicitly asked the Excel connector to follow the Google Sheets model, and the Google Sheets model uses an API-driven JSON fetch. But Microsoft's Workbook API isn't a clean equivalent — it's a tighter-quota'd, smaller-files-only sibling of `/content`, not a peer of `spreadsheets.get`. The closer architectural match is "fetch the workbook bytes server-side, hand them to the same parser file-upload uses." That keeps the new code surface tiny and reuses the most battle-tested part of the stack. The file-upload XLSX adapter and the Excel cloud adapter become near-identical — the *only* difference is where the bytes come from.

Open question (see below): for sheets that exceed `FILE_UPLOAD_MAX_BYTES`, do we fail loudly, lift the cap, or fall back to Option B's range-scoped fetch? My read is "fail loudly with a clear error" for v1; revisit when a customer asks.

### Implementation note: streaming

The download is a `fetch` with `Authorization: Bearer …`; the response body is piped into `exceljs.Workbook.xlsx.read()` which accepts a Node `Readable`. We do NOT buffer the whole file in memory before parsing — `exceljs` streams. Today's `xlsx.adapter.ts` already accepts a stream input. Same surface; new caller.

---

## Reusing the Region-Editing Workflow

Same story as Google Sheets — the workflow shell is parallel.

| Stage | Google Sheets | Microsoft Excel |
|---|---|---|
| Get bytes | Drive `files.list` + `spreadsheets.get?includeGridData=true` | Graph `/me/drive/search` + `/me/drive/items/{id}/content` |
| Build `Workbook` | `googleSheetsToWorkbook` (custom mapper) | Existing `xlsx.adapter.ts` (no new mapper) |
| Cache | Redis `connector:wb:google-sheets:{ciId}` | Redis `connector:wb:microsoft-excel:{ciId}` |
| Interpret | `LayoutPlanInterpretService` | **identical** |
| Commit | `LayoutPlanCommitService` | **identical** |
| Sync | `googleSheetsAdapter.syncInstance` re-fetches → replays plan → upserts → reaps | `microsoftExcelAdapter.syncInstance` does the same, with the Graph `/content` fetch in step 2 |

Workflow folder shape (mirrors `workflows/GoogleSheetsConnector/`):

```
workflows/
  MicrosoftExcelConnector/
    index.ts
    MicrosoftExcelConnectorWorkflow.component.tsx        # container + UI pair
    AuthorizeStep.component.tsx                            # "Connect Microsoft 365" button + status
    SelectWorkbookStep.component.tsx                       # AsyncSearchableSelect of user's workbooks
    MicrosoftExcelRegionDrawingStep.component.tsx          # thin wrapper around modules/RegionEditor
    MicrosoftExcelReviewStep.component.tsx                 # mirrors GoogleSheetsReviewStep
    utils/
      microsoft-excel-workflow.util.ts                     # container hook (auth → select → fetch → interpret → commit)
    __tests__/
    stories/
```

The `AuthorizeStep` component differs from Google's only in the button copy / icon (`MicrosoftIcon` from `@mui/icons-material/Microsoft`, plus copy that says "Microsoft 365" instead of "Google Sheets"). It's worth questioning whether this is genuinely two components or one parameterized `OAuthAuthorizeStep` that takes `{ providerLabel, providerIcon, scopesDescription }` — see "Open Questions."

The `SelectWorkbookStep` is identical in structure to `SelectSheetStep` modulo the SDK call name and the surfaced label ("workbook" vs "spreadsheet"). Strong candidate for the same parameterization.

The `RegionDrawingStep` and `ReviewStep` are wrappers around `modules/RegionEditor` — already provider-agnostic. We could probably collapse the per-provider step components into a single `SpreadsheetRegionDrawingStep` and `SpreadsheetReviewStep` shared between connectors, but that's a refactor that pays back at three connectors, not two — defer.

The container hook (`useMicrosoftExcelWorkflow`) wraps `useSpreadsheetWorkflow` (the shared core in `workflows/_shared/spreadsheet/`) the same way `useGoogleSheetsWorkflow` does. The only difference is the `loadWorkbook` callback (calls `sdk.microsoftExcel.selectWorkbook` instead of `sdk.googleSheets.selectSheet`).

---

## Sync Model: Manual Replay (v1)

Identical to Google Sheets: manual sync only, no scheduled cadence. The shared sync route (`POST /api/connector-instances/:id/sync`) dispatches via `ConnectorAdapterRegistry` to `microsoftExcelAdapter.syncInstance`. Sync steps:

1. **Eligibility gate.** `assertSyncEligibility` — same rules as Google. The only hard refusal is missing `LayoutPlan`. `rowPosition` regions surface as advisory `identityWarnings`; the frontend renders a non-blocking banner.
2. **Fresh access token.** `MicrosoftAccessTokenCacheService.getOrRefresh(ciId)` — handles refresh-token rotation as described above.
3. **Re-fetch workbook.** `MicrosoftExcelConnectorService.fetchWorkbookForSync(ciId, organizationId)` — Graph `/me/drive/items/{id}/content`, parse with `xlsx.adapter`, return `WorkbookData`. Does NOT write to the workbook cache (sync wants fresh data; the cache is editor-session-scoped).
4. **Replay + upsert.** `LayoutPlanCommitService.commit(...)` with `{ workbook, syncedAt: runStartedAt, skipDriftGate: true }`. Identical call shape to Google's adapter.
5. **Reap.** `entityRecords.softDeleteBeforeWatermark(connectorEntityId, runStartedAt, userId)` per entity — anything not touched by the run is soft-deleted.
6. **Mark instance synced.** `lastSyncAt = Date.now()`, `lastErrorMessage = null`.

Result shape (`{ recordCounts: { created, updated, unchanged, deleted } }`) is unchanged.

The watermark + soft-delete approach scales; we re-use the discussion in `GOOGLE_SHEETS_CONNECTOR.discovery.md` rather than restate.

---

## Large Spreadsheet Handling

The hard pressure point is different from Google's:

- **Google Sheets** can hold 10M cells in one workbook; the per-fetch danger was "the whole grid arrives in one HTTP response."
- **Excel files** are physically capped — `.xlsx` is ZIP-of-XML and our pipeline already enforces `FILE_UPLOAD_MAX_BYTES` (≈ 50 MB) for file uploads. The Excel cloud connector inherits the same cap by reusing the `xlsx.adapter`.

So large-sheet handling for Excel mostly inherits file-upload's existing safeguards. New considerations:

| Stage | Risk on a 50 MB workbook | Existing safeguard |
|---|---|---|
| Download | 50 MB streaming download from Graph | Streamed; bounded by `FILE_UPLOAD_MAX_BYTES`; short-circuit on `Content-Length` header pre-fetch |
| In-memory `WorkbookData` | hundreds of MB of cell strings | `inflateSheetPreview` already returns `sliced: true` and `cells: []` for sheets above `FILE_UPLOAD_INLINE_CELLS_MAX` |
| Editor cell loads | viewport-driven slice fetches | reuse `/instances/:id/sheet-slice` pattern (against the cached workbook, no Graph round-trip) |
| Replay | per-region; bounded by `MAX_ROWS_PER_REGION = 250_000` | already enforced by `LayoutPlanCommitService` |
| Upsert | Postgres bind-param ceiling | `WRITE_BATCH_ROWS = 500` chunking already in commit service |
| Sync wall-clock | minutes-long sync | already enqueues a BullMQ job; client polls |

The only Excel-specific large-file concern is the download itself: Graph `/content` redirects to a pre-signed URL and streams the bytes. We MUST short-circuit on `Content-Length` exceeding `FILE_UPLOAD_MAX_BYTES` before consuming the body — otherwise a 1 GB workbook passes through the API process before we refuse. This is a one-line pre-flight: read the response headers, abort if oversized, return a clean `MICROSOFT_EXCEL_FILE_TOO_LARGE` error.

The "drawing a region whose bounds exceed the loaded rectangle" UX problem flagged in the Google Sheets discovery applies identically here — and is no worse, because Excel's hard byte cap is tighter than Google's cell cap. Defer to the same Open Question already on the books.

---

## Database & Schema

Minimal additions:

| Change | Reason |
|---|---|
| Insert `microsoft-excel` row in `connector_definitions` (slug, display "Microsoft Excel" or "Microsoft 365 Excel", category "File-based", `auth_type: "oauth2"`, `capability_flags: { sync: true, read: true, write: false, push: false }`, `config_schema: {}`, icon URL). | Seeded via `seed.service.ts` alongside sandbox + file-upload + google-sheets. |
| Add `MicrosoftExcelConnectorDefinition{Schema,Model,ModelFactory}` to `packages/core/src/models/connector-definition.model.ts` (parallel to `GoogleSheetsConnectorDefinition*`). | Maintains the dual-schema pattern. |
| Optional repository helper `connectorInstances.findByOrgDefinitionAndUpn(orgId, definitionId, upn)` — narrower equivalent of `findByOrgAndDefinition` to avoid the O(N) decrypt-and-match scan that Google's flow does. | Only worth it once instance counts grow; v1 can do the same linear scan Google does. |

No changes to `entity_records`, `connector_entities`, `connector_instance_layout_plans`, `field_mappings`. Same tables, same shape, same indices.

The `auth_type` column is already `text` (not an enum) — `"oauth2"` is reused, not introduced.

---

## API Surface

New routes, parallel to Google Sheets, mounted under `/api/connectors/microsoft-excel/...`:

| Route | Purpose |
|---|---|
| `POST /api/connectors/microsoft-excel/authorize` | Mints `state`, returns Microsoft consent URL. JWT-protected. |
| `GET  /api/connectors/microsoft-excel/callback`   | Receives `code+state`, exchanges, creates pending `ConnectorInstance`. Returns the standard popup-postMessage HTML. **JWT-unprotected** (signed `state` is the security boundary). |
| `GET  /api/connectors/microsoft-excel/workbooks?connectorInstanceId=&search=` | Lists the user's `.xlsx` files via Graph search. JWT-protected. |
| `POST /api/connectors/microsoft-excel/instances/:id/select-workbook` | Sets `config.driveItemId` + `name`, downloads + parses workbook, caches it, returns the same `parseSession`-shaped payload `RegionEditor` consumes. JWT-protected. |
| `GET  /api/connectors/microsoft-excel/instances/:id/sheet-slice` | Cell-rectangle endpoint backed by the cached workbook. Identical contract to the file-upload + google-sheets equivalents. JWT-protected. |

Interpret + commit endpoints stay where they are. The shared sync route (`POST /api/connector-instances/:id/sync`) dispatches via the adapter registry — no Excel-specific sync route.

The router file (`apps/api/src/routes/microsoft-excel-connector.router.ts`) follows the same two-router pattern as Google's: a protected router for everything but `callback`, and a public router with just `callback`. Register the public router under the app, the protected one under `protectedRouter`.

---

## Frontend SDK

New SDK group under `apps/web/src/api/sdk.ts`, parallel to `googleSheets`:

```ts
sdk.microsoftExcel.authorize()                              // useAuthMutation, POST → consent URL
sdk.microsoftExcel.searchWorkbooks()                        // useAuthMutation, method:GET, body:undefined
sdk.microsoftExcel.selectWorkbook()                          // useAuthMutation, POST, body { driveItemId }
sdk.microsoftExcel.sheetSlice()                              // useAuthMutation, method:GET — for RegionEditor's loadSlice
```

The interpret + commit calls reuse `sdk.layoutPlans.*`, identical to Google. No Excel-specific layout-plan endpoints.

The popup hook is shared (per "Refactors before duplication") — both connectors call the same `useOAuthPopupAuthorize({ slug: "microsoft-excel" })`.

---

## Migration & Rollout

Sliced into phases that mirror Google Sheets'. Each is independently shippable behind the connector definition's `is_active` flag (seed `is_active: false` until Phase C lands the workflow shell).

- **Phase A — OAuth client + credential plumbing.**
  1. Refactor: hoist `useGooglePopupAuthorize` → `useOAuthPopupAuthorize` (parameterized by slug). Hoist `renderCallbackHtml` → `oauth-callback-html.util.ts`. Rename `gsheets:wb:` / `gsheets:access:` cache keys → `connector:wb:<slug>:` / `connector:access:<slug>:`.
  2. New `MicrosoftAuthService` (consent URL, exchange, refresh **with rotation persistence**, `/me` userinfo).
  3. New `MicrosoftAccessTokenCacheService` — reads + writes the rotated refresh token back to `connector_instances.credentials`.
  4. New `MicrosoftExcelConnectorService.handleCallback` — find-or-update by `(org, upn)`.
  5. Seed `microsoft-excel` connector definition (`is_active: false`).
  6. Wire the public + protected routers.
  7. Verifiable via curl/Postman: run the full OAuth dance; observe a `connector_instances` row with encrypted `credentials` and `config: null`.

- **Phase B — Workbook listing + download + cache.**
  1. `searchWorkbooks` route + service (Graph `/me/drive/search` + post-filter).
  2. `selectWorkbook` route + service (Graph `/content` → `xlsx.adapter` → cache).
  3. `sheet-slice` route + service (cache-only, no Graph round-trip).
  4. UI: still no workflow shell — verifiable via a debug page.

- **Phase C — Region-editing workflow shell.**
  1. `workflows/MicrosoftExcelConnector/` folder with the four step components and the workflow hook.
  2. Add `microsoft-excel` to `WORKFLOW_REGISTRY` in `Connector.view.tsx`.
  3. Flip the connector definition `is_active: true`.

- **Phase D — Manual sync.**
  1. `microsoftExcelAdapter.syncInstance` + `assertSyncEligibility`.
  2. Register adapter in `adapters/register.ts` under slug `"microsoft-excel"`.
  3. `lastSyncAt` updates; counts include `created/updated/unchanged/deleted`.
  4. Verify `rowPosition` regions surface as `identityWarnings` (not blocked).

- **Phase E — Reconnect / error recovery.**
  1. `invalid_grant` from Microsoft → mark `status="error"`, surface Reconnect button (UI is already provider-agnostic; mirrors the Google Reconnect flow).
  2. Refresh-token rotation failures (e.g. concurrent process raced) → surface a clear retry-once error, fall through to `status="error"` if the second attempt also fails.

**Deferred (post-v1):**
- SharePoint document library support (additional scope `Sites.Read.All`, lookup via `/sites/{id}/drives`).
- Scheduled cadence (same as Google — needs identity-strategy guard, then `addRepeatable` BullMQ + `syncCadence` config).
- Microsoft Graph webhook subscriptions for change-driven sync.
- Picker-based file selection (Microsoft's File Picker SDK, narrows scope to per-file consent).

---

## Decisions

The following are settled going in:

- **Direct OAuth2 against Microsoft identity platform.** No Auth0 IdP federation; same rationale as Google's discovery.
- **Multi-tenant `common` by default; single-tenant via env var.** No UI for the org admin to choose; deployment-time only.
- **Per-(org, UPN) instance scoping.** Mirrors Google's per-(org, email). UPN over email because email is null for some account types.
- **Refresh-token rotation persisted to the credentials column.** Microsoft-specific; the cache layer owns the persistence, not the adapter.
- **Workbook acquisition via `/me/drive/items/{id}/content` + existing XLSX adapter.** Rejected the Workbook API for v1 — see "Workbook Acquisition" above.
- **`.xlsx` only.** No `.xlsm`, `.xlsb`, `.csv`. Aligned with the existing XLSX adapter's surface.
- **OneDrive only.** No SharePoint. Follow-up.
- **Manual sync only.** No cadence. Mirrors Google.
- **Refactor first, duplicate second.** The popup hook, callback HTML renderer, and cache key prefix get generalized in Phase A. No "we'll do it later when we have three connectors" — we already have three (file-upload, google-sheets, microsoft-excel) and the third is what makes the generalization pay back.

## Open Questions

1. **Step components: parameterize or duplicate?** `AuthorizeStep` and `SelectSheet/Workbook` step are 95% identical between Google and Excel (button copy + icon + label). Worth parameterizing into a shared `OAuthAuthorizeStep` and `SelectSpreadsheetStep` now, or wait until a third connector? My read: parameterize the `AuthorizeStep` (genuinely cosmetic difference); leave `SelectWorkbookStep` and `SelectSheetStep` separate for v1 because the SDK calls and label vocabulary differ enough that two thin components read more clearly than one heavily-parameterized one.
2. **Workbook size cap.** v1 inherits `FILE_UPLOAD_MAX_BYTES` (≈ 50 MB). Excel-on-OneDrive workbooks rarely exceed this for our target users, but enterprise users with months of merged-financial-data tabs can. Do we (a) raise the cap, (b) keep the cap and surface a clear error, or (c) fall back to Graph Workbook API range-scoped fetches above the cap? Recommendation: (b) for v1, revisit on first customer report.
3. **Personal vs. work-account UPN ambiguity.** Personal Microsoft accounts have UPNs like `firstname_lastname@outlook.com` and a tenant id of `9188040d-…` (the personal-MSA tenant). A work account might have the same email aliased into a corporate Entra tenant. The (org, UPN) scoping treats these as one instance, which would surprise a user with both. Mitigation: include `tenantId` in the credentials blob and key uniqueness on `(org, tenantId, UPN)`. Cheap to add now; expensive to retrofit. Recommend doing it during Phase A.
4. **OAuth state TTL.** Currently 5 minutes (matches Google). Microsoft's consent flow is occasionally slower (work-account MFA + admin-consent prompts can stall). Possibly bump the TTL to 10 minutes for `microsoft-excel`, or leave at 5 and let users retry. Recommend leaving at 5; the popup timeout (5 min) already aligns with the state TTL and bumping one without the other is asymmetric.
5. **Display name in the connector definition.** "Microsoft Excel" or "Microsoft 365 Excel" or "Excel (OneDrive)" or "OneDrive Excel"? "Microsoft Excel" is shortest and matches users' mental model; "Microsoft 365 Excel" is more precise for the source. Defer to product/design.

---

## Summary

The Microsoft Excel cloud connector is a **second instance of the same template** the Google Sheets connector instantiated. Same 4-step workflow, same RegionEditor, same interpret/commit pipeline, same manual-sync model with the same watermark-based reaping. The only meaningfully new code surface is (a) the Microsoft identity platform OAuth client — including the refresh-token-rotation handling that Google doesn't need, (b) Graph file-listing service, and (c) a workbook acquisition service that does an HTTP download rather than a JSON parse, then hands the bytes to our existing XLSX adapter. The workbook adapter — usually the largest per-connector investment — is **zero new code** because we already parse XLSX for file uploads. Phase A also folds in a small generalization pass on the OAuth popup hook, callback HTML, and cache-key prefixes so the third connector lands on truly shared infrastructure rather than two parallel branches that drift.
