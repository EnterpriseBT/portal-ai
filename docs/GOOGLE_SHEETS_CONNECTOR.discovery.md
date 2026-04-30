# Google Sheets Connector — Discovery

## Goal

Add a `google-sheets` connector that lets a user authorize Portal.ai against their Google account, pick one or more sheets to bring in, run the same region-editing workflow that file uploads use, and let them **manually re-sync** the data into `entity_records` from the source sheet on demand.

Concretely, this means:

1. **OAuth2 authorization flow.** The user grants Portal.ai read access to their Google Drive/Sheets. We persist refresh-token-bearing credentials per `ConnectorInstance`.
2. **Sheet discovery + selection.** After auth, the user picks a Google Drive sheet (single or multiple) from their authorized scope. Each selected workbook becomes the input to the region-drawing step.
3. **Region editing — same UX as file upload.** We reuse the `modules/RegionEditor` (and the shared interpret/commit pipeline) so the user can draw regions, get an LLM-interpreted plan, and review/commit bindings exactly like the file-upload workflow.
4. **Manual re-sync.** Once committed, the user can hit a "Sync now" affordance on the connector. The server re-fetches the source sheet, replays the persisted `LayoutPlan` against the new bytes, and upserts into `entity_records`. Liveness is sync invocation, not a mode flag (per project's connector model — see `feedback_connector_domain_model`). **No scheduled cadence in v1** — see "Sync Model" below for the rationale.

Non-goals for this discovery:

- Two-way write-back to Sheets (we only `read`/`sync`, not `write`/`push`).
- Scheduled / repeating sync (hourly, daily, weekly). v1 ships manual-only; a cadence option can be layered in once the identity-strategy requirements (below) are enforced and we have signal that automatic sync is wanted.
- Cell-level real-time push (Google's push notifications via webhook).
- Office 365 / Excel Online — same shape, separate definition slug; out of scope here.

---

## Existing State

### What we have already

- **Connector primitives.**
  - `connector_definitions` table (slug, display, category, `auth_type`, `capability_flags`, `config_schema`, `is_active`, `version`, `icon_url`).
  - `connector_instances` table (`config: jsonb`, `credentials: text` — already meant to hold encrypted secrets, `lastSyncAt`, `lastErrorMessage`, `enabled_capability_flags`, `status` enum: active/inactive/error/pending).
  - `ConnectorAdapter` interface (`queryRows`, `syncEntity`, `discoverEntities`, `discoverColumns`) and `ConnectorAdapterRegistry` (slug → adapter).
  - Two adapters exist: `sandbox` (no-op sync, reads from `entity_records`) and the file-upload connector definition (no adapter — committed plan replays from a stored `LayoutPlan`).
  - `SyncService.syncEntity(entityKey)` chain: entity → instance → definition slug → adapter.
- **Spreadsheet pipeline (the part we want to reuse).**
  - `@portalai/spreadsheet-parsing` package — workbook schema, replay, parsing helpers. Already a runtime dep of `@portalai/core`.
  - File-upload pipeline: `presign → S3 → confirm → parseSession → workbook cached in Redis → interpret (LayoutPlan) → commit (persists plan, writes records)`. Endpoints in `file-uploads.router.ts`; orchestration in `services/file-upload-session.service.ts`, `layout-plan-interpret.service.ts`, `layout-plan-commit.service.ts`.
  - `connector_instance_layout_plans` table — already persists the committed `LayoutPlan` against a `ConnectorInstance`. This is what enables sync replay.
  - `modules/RegionEditor` — sheet canvas, region overlays, binding popovers, review card, etc. Workbook-shape-agnostic: it takes a `Workbook` and emits region drafts/bindings.
  - `workflows/FileUploadConnector` — the reference workflow. Three steps: Upload → Draw regions → Review/commit. Container wires SDK calls, pure UI is props-only.
- **Auth.**
  - User authentication is Auth0 (login, JWT). Includes a Google identity-provider connection (`connection: "google-oauth2"` in `auth.api.ts`), but **only for sign-in** — no third-party API access tokens are persisted.
- **Encryption.**
  - `ENCRYPTION_KEY` env var already wired through `backend.yml` Secrets. `connector_instances.credentials` is a `text` column intended for encrypted storage. No connector currently writes to it (sandbox is `auth_type: none`).
- **Background work.**
  - BullMQ queue + worker (`queues/jobs.queue.ts`, `jobs.worker.ts`) with one-shot job processors (revalidation, system-check). No repeating/cron jobs exist yet.

### What does NOT exist yet

- An OAuth2 authorization-code flow that the API can drive (i.e., redirect the user to Google's consent screen, receive the callback, exchange the code for tokens, and persist the refresh token against a `ConnectorInstance`). Auth0's social-login flow doesn't expose Google access tokens to the application.
- Encrypted credential read/write for `connector_instances.credentials`. The column exists; the helpers don't.
- A "list my Google sheets" / "fetch a sheet's bytes" service.
- Any repeating BullMQ schedule; we'd add the first one here, or accept on-demand sync only for v1.
- A second region-editing entrypoint — `modules/RegionEditor` has only ever had `FileUploadConnector` as a consumer, so the module's prop surface may bake in some upload-specific assumptions worth auditing (see "Open questions").

---

## Authentication Approach: Google OAuth2 (per-instance refresh token)

This is the meatiest new piece. Two designs were considered.

### Option A — Auth0 IdP federation (rejected)

Use Auth0's "social IdP" mechanism to ask for Drive/Sheets scopes during login and read the IdP access token via the Auth0 Management API. **Rejected** because:

- It conflates *user identity* with *connector authorization*. A user might want to connect more than one Google account (personal + work); Auth0 social federation is one-account-per-user.
- Forces every login to re-prompt for the broader Drive scopes, even for users who never use the connector.
- Auth0 Management API rate limits become a hard ceiling on how often we can refresh access tokens.

### Option B — Direct OAuth2 against Google (chosen)

Portal.ai becomes its own OAuth2 client against Google. Per-instance flow:

1. User clicks "Connect Google Sheets" in the new connector workflow.
2. Frontend hits `POST /api/connectors/google-sheets/authorize` → API mints a `state` token (signed, short-lived, scoped to the user/org) and returns Google's consent URL with `access_type=offline` and `prompt=consent` (so we always get a refresh token).
3. User consents in Google's popup/redirect. Google redirects to our registered callback `https://api-{env}.portalsai.io/api/connectors/google-sheets/callback?code=...&state=...`.
4. API verifies `state`, exchanges `code` for `{ access_token, refresh_token, expiry }`.
5. API creates a *pending* `ConnectorInstance` (status `pending`, no `LayoutPlan` yet) and stores the encrypted credential blob in `credentials`. The `refresh_token` lives in this blob; access tokens are refreshed on demand and not persisted.
6. Frontend polls (or receives a postMessage from the popup) for the new `connectorInstanceId` and proceeds to sheet selection.

**Scopes**: `https://www.googleapis.com/auth/drive.readonly` + `https://www.googleapis.com/auth/spreadsheets.readonly`. Drive scope is needed to *list* the user's sheets; Sheets scope is needed to *read* their cells. We can narrow to `drive.file` later if we adopt the Google Picker UI (only files the user explicitly picks via Google's own picker are visible to us).

**Token exchange**: the API speaks to Google directly (`https://oauth2.googleapis.com/token`) using `googleapis` (or a thin `fetch` wrapper). No Auth0 Action in the path — Auth0 stays a sign-in concern; the connector dependency graph stays clean.

**Credential storage**: encrypt the credential JSON (`{ refresh_token, scopes, googleAccountEmail }`) using AES-GCM keyed off `ENCRYPTION_KEY`, store base64 in `connector_instances.credentials`. Decrypt on demand inside the adapter when a sync runs. We **do not** store access tokens. `googleAccountEmail` is also surfaced in the connector instance's API response (out of the credentials blob — read once at decrypt, returned alongside non-secret config) so the UI can render an account chip on the connector card.

**Account scoping**: one `ConnectorInstance` per `(organization, googleAccountEmail)`. A user with personal + work Google accounts gets two instances; the chip on each card disambiguates which account a sheet is being read from. The OAuth callback enforces this — if the just-authorized email matches an existing instance for the org, we update its credentials instead of creating a duplicate.

**Workbook scoping**: one `ConnectorInstance` per Drive workbook (a workbook = potentially many tabs, but one Drive file). One persisted `LayoutPlan` describes regions across all tabs in that workbook. We do not split per-tab — a per-tab model would force the user to re-auth and re-pick a sheet for every tab they care about, and the plan schema already happily spans multiple sheets in one workbook.

**Refresh**: a small `GoogleAuthService` lazily refreshes the access token (using `refresh_token`) and caches it in Redis under `gsheets:access:{connectorInstanceId}` for ~50 min (Google's tokens last 60 min). Concurrent syncs share the cached token.

**Revocation handling**: if Google returns `invalid_grant` on a refresh attempt, we mark the instance `status="error"` with `lastErrorMessage` and surface a "Reconnect" button in the UI. The user reauthorizes with the same instance id (preserving the persisted plan and committed records) — we just replace the credentials blob.

### New env vars / secrets

| Name | Where | Why |
|------|-------|-----|
| `GOOGLE_OAUTH_CLIENT_ID` | SSM parameter `/portalai/{env}/google-oauth-client-id` | Public, but env-specific so dev/prod are separate Google projects. |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Secrets Manager `portalai/{env}/google-oauth-client-secret` | Required by the token exchange. |
| `GOOGLE_OAUTH_REDIRECT_URI` | env, derived from `api-{env}.portalsai.io` | Must match Google Cloud Console exactly. |

`backend.yml` and `deploy-dev.yml` need additions matching the existing pattern (SSM parameter for non-secret, Secrets Manager full-ARN for secret, then a new `SecretArnGoogleOauthClientSecret` parameter override).

---

## Sheet Discovery & Selection

After authorization, before region drawing, the user needs to pick which sheet(s) to ingest. **Decision: Option B (API-driven list).**

### Option B — API-driven list (chosen)

After auth, hit Google Drive's `files.list` endpoint server-side and stream a paginated list of `mimeType = 'application/vnd.google-apps.spreadsheet'` files into the workflow UI. Render an `AsyncSearchableSelect` (already a `modules/` primitive) with debounced search.

Why this over Option A: simpler, no extra Google JS dependency, and the `AsyncSearchableSelect` pattern is already idiomatic in the app (per `feedback_use_include_joins`). Implication: v1 ships with the broader `drive.readonly` scope (we can list every spreadsheet in the user's Drive, not just files the user picked); narrowing to `drive.file` is the main reason to revisit Option A later.

The selected sheet's `spreadsheetId` (and a snapshot of its title) gets stored in `ConnectorInstance.config: { spreadsheetId, title, fetchedAt }`.

### Option A — Google Picker iframe (deferred)

Google ships a JS library that renders an authorized file picker against the user's Drive. Pros: the user sees their real Drive folder structure; we only see the files they explicitly pick (lets us narrow to `drive.file` scope). Cons: requires loading Google's JS, an extra API key, and an additional OAuth scope just for the picker. Revisit if/when scope narrowing becomes a customer ask or a security requirement.

---

## Reusing the Region-Editing Workflow

The existing pipeline has clean seams for a non-upload source. Concretely:

| Stage | File-upload version | Google-sheets version |
|-------|---------------------|------------------------|
| Get bytes | `presign → S3 PUT → confirm` | `Sheets API spreadsheets.get?includeGridData=true` (server-side) |
| Build `Workbook` | `parseSession` (csv/xlsx adapter → `WorkbookData`) | New `gsheets.adapter` that maps Sheets API response → `WorkbookData` |
| Cache | Redis under `uploadSessionId` (TTL `FILE_UPLOAD_CACHE_TTL_SEC`) | Same Redis cache, key like `gsheets:wb:{connectorInstanceId}` |
| Interpret | `layout-plan-interpret.service` over the cached workbook | **Identical** — service takes a `WorkbookData`, doesn't care about source |
| Commit | `layout-plan-commit.service` writes `connector_instance_layout_plans` row + `entity_records` | **Identical** — but the `ConnectorInstance` already exists (created at OAuth callback) so the commit path needs to *update* a pending instance, not create one |
| Sync (re-run) | N/A — file uploads are one-shot | New: `gsheets.adapter.syncEntity` re-fetches sheet → replays plan → upserts records |

**Workflow shape** (mirrors `FileUploadConnectorWorkflow`):

```
workflows/
  GoogleSheetsConnector/
    index.ts
    GoogleSheetsConnectorWorkflow.component.tsx        # container + UI pair
    AuthorizeStep.component.tsx                         # "Connect Google" → popup → status
    SelectSheetStep.component.tsx                       # AsyncSearchableSelect of user's Sheets
    GoogleSheetsRegionDrawingStep.component.tsx         # thin wrapper around modules/RegionEditor
    GoogleSheetsReviewStep.component.tsx                # mirrors FileUploadReviewStep
    utils/
      google-sheets-workflow.util.ts                    # the hook (auth → select → fetch → interpret → commit)
    __tests__/
    stories/
```

Steps:

1. **Authorize** — present "Connect Google Sheets" button. On success, the workflow now has a `connectorInstanceId` (pending status).
2. **Select sheet** — searchable list of the user's spreadsheets. On select, kick off server-side fetch + parse → cached `Workbook` → advance to draw step.
3. **Draw regions** — `modules/RegionEditor` consumed identically.
4. **Review** — same review step. On commit, the pending `ConnectorInstance` flips to `active` and the plan is persisted.

**Reuse-by-construction.** The `RegionEditor` module already takes a `Workbook` + region-edit callbacks; it has zero coupling to file uploads. The interpret + commit services already operate on workbook + region drafts. The bulk of new work is the **before** (auth + fetch) and **after** (sync cadence) of region editing — the editing itself is a drop-in.

---

## Sync Model: Manual Replay (v1)

v1 ships **manual sync only**. The user clicks "Sync now" on the connector instance; the server re-fetches the spreadsheet, replays the persisted `LayoutPlan` against the new bytes, upserts records, and soft-deletes records whose source rows have disappeared. No background cadence, no repeating BullMQ job.

- **No `syncCadence` config**. `ConnectorInstance.config` carries `{ spreadsheetId, title }` only. If/when scheduled sync ships later, it adds a `syncCadence` field — but only after the identity-strategy guard below is in place.
- **On-demand only** — `POST /api/connector-instances/:id/sync` enqueues a one-shot BullMQ job (no `addRepeatable` wiring needed) and returns a job id the UI polls. The connector detail view exposes the trigger button + a "last synced at" timestamp.
- **Per-sync work** (inside `gsheets.adapter.syncEntity`):
  1. Guard: refuse to run if the persisted `LayoutPlan` has any region with a `rowPosition` identity strategy — see "Sync identity requirement" below.
  2. Decrypt credentials → get fresh access token.
  3. Re-fetch the spreadsheet via `spreadsheets.get?includeGridData=true`.
  4. Build a `WorkbookData`.
  5. Load the persisted `LayoutPlan` from `connector_instance_layout_plans`.
  6. Run replay (`@portalai/spreadsheet-parsing/replay`) against the new `WorkbookData` to materialize `ExtractedRecord[]`.
  7. Per `connectorEntityId`: upsert via `entityRecords.upsertManyBySourceId`, then soft-delete the diff (see "Disappeared-records reconciliation" below).
  8. Update `lastSyncAt`, clear `lastErrorMessage`, or set `status="error"` + message on failure.

**Drift handling.** The persisted `LayoutPlan` is anchored to specific cells/headers. If the user reshapes the sheet (renamed columns, moved a region), the next sync may produce drift warnings or zero rows. Same drift surface that already exists for file uploads after re-interpret is reused; the UI surfaces a "Re-edit regions" affordance from the connector detail view.

### Sync identity requirement

The existing commit pipeline (`apps/api/src/services/layout-plan-commit.service.ts:writeRecords`) upserts `entity_records` on `(connector_entity_id, source_id)`. `source_id` is derived during replay by `deriveSourceId()` from the region's `IdentityStrategy`, which interpret picks per region:

| Strategy | sourceId | Sync-safe? |
|---|---|---|
| `column` | value of one identifier column (e.g. `id`, `email`) | ✅ stable across syncs |
| `composite` | `col1.value + "|" + col2.value` for two columns that together are unique | ✅ stable across syncs |
| `rowPosition` | synthesized: `cell-{r}-{c}` / `col-{c}` / `row-{r}` | ❌ shifts on row insert/delete — every sync looks like full churn |

**Therefore: a region whose chosen `identityStrategy.kind === "rowPosition"` is not eligible for sync.** Two enforcement points:

1. **Commit-time UX**. The review step inspects the plan; for any region landing on `rowPosition`, surface a banner ("This region uses positional row IDs — it can be imported once but not re-synced. Add an identifier column to enable sync.") and either block the commit or let the user proceed with a one-shot import. Decision: let them proceed with one-shot import; just disable the "Sync now" button for that connector instance.
2. **Adapter-time guard**. `gsheets.adapter.syncEntity` re-checks the loaded `LayoutPlan` and refuses with a clear `LAYOUT_PLAN_SYNC_INELIGIBLE_IDENTITY` error if any region is `rowPosition`. Belt-and-suspenders: prevents stale UI state from triggering a churn-storm.

The persisted `LayoutPlan` already carries the chosen `identityStrategy` per region (`packages/spreadsheet-parsing/src/plan/region.schema.ts`), so both checks are pure reads against the plan — no extra schema work.

This guard is also why scheduled cadence is deferred: enabling per-cadence config without the guard would let a single committed plan with `rowPosition` identity churn `entity_records` indefinitely.

### Disappeared-records reconciliation (watermark)

Today's `writeRecords` only inserts/updates — there is no path that removes records whose source rows have been deleted from the spreadsheet. Sync needs a new step, and the implementation has to scale to large sheets where holding two sets of `sourceId`s in memory is not OK.

Use the existing `entity_records.syncedAt` column as a **per-run watermark** — it's already `notNull`, already updated on every upsert, and already indexed via `entity_records_entity_synced_at_idx (connector_entity_id, synced_at)`:

1. At sync entry, capture `runStartedAt = Date.now()`.
2. Every record the run touches (upsert) sets `syncedAt = runStartedAt`.
3. After the upsert phase completes for the entity, issue a single indexed soft-delete:
   ```sql
   UPDATE entity_records
   SET deleted = $now, deleted_by = $userId
   WHERE connector_entity_id = $entityId
     AND synced_at < $runStartedAt
     AND deleted IS NULL
   ```
   New repository method: `softDeleteBeforeWatermark(connectorEntityId, watermark, deletedBy)`.
4. Tally `deleted` (the `UPDATE`'s rowcount) alongside `created/updated/unchanged` in `recordCounts` so the sync result UI can render "X added, Y updated, Z removed".

Why this beats a set-diff: no `SELECT` of all live `sourceId`s, no in-memory set arithmetic, one indexed `UPDATE`. Works identically at 100 rows or 100 million.

Why soft-delete over hard-delete: `entity_records` is referenced by analytics queries and entity-group membership; a hard-delete during sync would create dangling references. Soft-delete preserves history and matches how every other entity in the system handles removal.

Failure semantics: the watermark UPDATE only runs if the upsert phase succeeded. Partial upsert failures abort the whole sync (the BullMQ job throws, no records get reaped, the next retry redoes the upsert phase from scratch with a new watermark). Result: never a partial-delete state.

The same logic could later be lifted into `layout-plan-commit.service.ts` and reused by any future sync-capable connector (Airtable, Notion, etc.); for v1 it lives inside `gsheets.adapter.syncEntity` until a second consumer materializes.

---

## Large Spreadsheet Handling

Sheets that hit Google's per-workbook limit (currently 10M cells) will arrive eventually. The pipeline has to assume that, not assume it away. The good news: the file-upload pipeline already solved most of the same problem set — `apps/api/src/environment.ts:74-85` defines `FILE_UPLOAD_INLINE_CELLS_MAX = 1_000_000` (sheets above the cap are returned with `cells: []` + `sliced: true` and the client pulls rectangles via `/api/file-uploads/sheet-slice`, capped at `FILE_UPLOAD_SLICE_CELLS_MAX = 50_000` cells per request). Google Sheets fits the same shape; reuse the pattern rather than inventing one.

### Where size hurts

| Stage | Risk on a 10M-cell sheet | Existing safeguard |
|---|---|---|
| Fetch | `spreadsheets.get?includeGridData=true` returns the whole grid in one HTTP response → OOM / response-size failure | none (yet) |
| In-memory `WorkbookData` | gigabytes of strings held in the API process | none (yet) |
| Redis workbook cache | exceeds Redis' 512 MB per-key ceiling | inline-or-sliced model already exists for file uploads |
| LLM classifier sample | none — the parser caps at 200 rows × 30 cols (`MAX_SHEET_SAMPLE`) | already bounded |
| Replay materialization | `ExtractedRecord[]` holding millions of records | none (yet) |
| Single SQL upsert | Postgres' 65 535 bind-parameter limit hits at ~5 000 rows × 12 cols | none (yet) |
| Disappeared-records diff | pulling every live `source_id` into memory | superseded by the watermark approach above |
| Sync wall-clock | minutes-long sync timing out the HTTP request | already enqueues a BullMQ job; client polls |

### Recommended approach

1. **Range-scoped fetch.** Sync never asks Google for the whole grid. After auth, hit `spreadsheets.get?fields=sheets.properties` once for cheap dimension metadata, then `spreadsheets.values.batchGet` with one range per persisted region (the plan already carries region bounds — `region.bounds.startRow/endRow/startCol/endCol`). For replay we only ever pull cells the user actually bound; cells outside drawn regions are ignored.
2. **Reuse the inline-or-sliced cache pattern for the editor.** During the interpret/commit flow (when the user is drawing regions), the API caches a parsed `WorkbookData` in Redis under `gsheets:wb:{connectorInstanceId}` — same shape as `uploadSessionId` keys. Sheets ≤ `FILE_UPLOAD_INLINE_CELLS_MAX` come inline; over-cap sheets come back with `sliced: true` and the editor fetches via a new `GET /api/connectors/google-sheets/instances/:id/sheet-slice` that proxies `spreadsheets.values.get` for the requested rectangle (≤ `FILE_UPLOAD_SLICE_CELLS_MAX` cells per call). The shared `FILE_UPLOAD_*` env vars apply to both pipelines — rename them to `WORKBOOK_*` if a second consumer feels worth the rename, otherwise leave as-is.
3. **Chunked replay during sync.** Replay is already per-region, but a single region can dwarf process memory. Walk each region in row-bands of e.g. `INTERPRET_REPLAY_BAND_ROWS = 5_000`: pull the band's range from Google → build a band-scoped `WorkbookData` → run replay → batch-upsert → discard → next band. Peak memory is bounded regardless of total region size. The parser already supports replay against a sub-bounded workbook because the plan's `bounds` are the only contract.
4. **Batched upserts.** Cap each `entityRecords.upsertManyBySourceId` call at e.g. `WRITE_BATCH_ROWS = 500` (with ~12 columns per insert that's ~6 000 bind params, well under Postgres' 65 535). The repository can stay as-is; the chunking lives in `gsheets.adapter.syncEntity`.
5. **Watermark reconciliation.** Use `synced_at` as the run watermark — see "Disappeared-records reconciliation (watermark)" above. This is the piece that wouldn't scale with the in-memory diff.
6. **Per-region row guard.** Hard-cap individual regions at `MAX_ROWS_PER_REGION = 250_000` and refuse the commit (or the sync, on pre-flight) above it with a clear error. A user with a 1M-row table can decompose into multiple regions or talk to us about lifting the cap; either is better than silently OOMing the worker. The cap is policy, easy to relax once the pipeline has empirical headroom.

### Interpret-time UX caveat

The RegionEditor renders cells the user can click. For a 10M-cell sheet, the inline-or-sliced model means the editor only renders cells inside the current viewport rectangle (already how the file-upload editor works at scale). The new bit is: drawing a region whose bounds exceed the loaded rectangle. v1 answer — let the user type explicit row/col bounds in the binding popover instead of dragging across off-screen cells; the slice endpoint handles the visual render. This may require a small RegionEditor enhancement (numeric bounds inputs); flagging in Open Questions rather than committing to scope here.

---

## Database & Schema

Minimal schema additions:

| Change | Reason |
|--------|--------|
| Insert `google-sheets` row in `connector_definitions` (slug, display "Google Sheets", category "File-based" or new "Spreadsheet" category, `auth_type: "oauth2"`, `capability_flags: { sync: true, read: true, write: false, push: false }`, `config_schema` describing `{ spreadsheetId, title }` (manual-only sync; no `syncCadence` until scheduled cadence ships), icon URL). | Seeded via `seed.service.ts` alongside sandbox + file-upload. |
| New ENUM value `oauth2` in `auth_type` column? — currently `text`, no enum. ✓ no migration. | — |
| `connector_instances.credentials` already exists. | We start using it; adapt repository to expose encrypted-blob helpers. |
| Optional: add `last_sync_started_at` to `connector_instances` for in-flight sync indication. | Not required for v1; can derive from job state. |

No changes to `entity_records`, `connector_entities`, or `field_mappings` — they already serve materialized rows from a connector instance.

---

## API Surface (proposed)

New routes (group under `/api/connectors/google-sheets/...` for OAuth flow; reuse existing connector-instance routes for everything else):

| Route | Purpose |
|-------|---------|
| `POST /api/connectors/google-sheets/authorize` | Mints `state`, returns Google consent URL. |
| `GET  /api/connectors/google-sheets/callback`   | Receives `code+state`, exchanges, creates pending `ConnectorInstance`. Returns HTML that postMessages the new id to the opener and closes. |
| `GET  /api/connectors/google-sheets/sheets?search=` | Lists the user's spreadsheets (Drive `files.list`). Query-only; uses the instance's refresh token. Takes `connectorInstanceId` to identify which credentials to use. |
| `POST /api/connectors/google-sheets/instances/:id/select-sheet` | Sets `config.spreadsheetId` + `title`, fetches + parses workbook, caches it, returns the same `parseSession`-shaped payload `RegionEditor` already consumes. |
| `POST /api/connector-instances/:id/sync` (existing-or-new) | Kicks off an on-demand sync job. |

Interpret + commit endpoints stay where they are; the workflow just calls them with the cached `Workbook` and the pending `connectorInstanceId`. The commit service should be made to accept "update existing pending instance" rather than always creating one — small refactor; backed by `feedback_api_no_assumptions` (the handler should accept the instance id from the payload, not derive it from session).

---

## Frontend SDK

New SDK groupings under `apps/web/src/api/sdk.ts` (`feedback_sdk_helpers_for_api` — every call routes through `sdk.*`):

```ts
sdk.googleSheets.authorize()                  // useAuthMutation → returns consent URL
sdk.googleSheets.completeAuthorization()       // mutateAsync, takes a code (or relies on popup postMessage)
sdk.googleSheets.searchSheets(connInstId)      // useAuthMutation method:GET — async-search pattern
sdk.googleSheets.selectSheet(connInstId, sId)  // useAuthMutation
sdk.connectorInstances.sync(id)                // useAuthMutation — works for any cadenced connector
```

The interpret + commit calls reuse `sdk.layoutPlans.*` (or whatever they're named today).

---

## Migration & Rollout

- **Phase A** — OAuth2 client + credentials encryption + seed `google-sheets` definition. No UI yet. Verifiable by running the OAuth dance in Postman/curl and seeing a `connector_instances` row with encrypted credentials.
- **Phase B** — Sheet listing + workbook fetch + cache. UI: just a debug page that lets a developer connect, list sheets, and inspect the cached workbook JSON.
- **Phase C** — Region-editing workflow shell (steps 1 & 2: authorize + select). Reuses RegionEditor for steps 3 & 4 unchanged. Review step surfaces the `rowPosition`-identity banner.
- **Phase D** — Manual sync. Adds the disappeared-records reconciliation, the identity-strategy guard in `gsheets.adapter.syncEntity`, and the "Sync now" UI affordance. `lastSyncAt` updates; counts include `created/updated/unchanged/deleted`.
- **Phase E** — Reconnect / error recovery flow (handles `invalid_grant` from Google).

**Deferred (post-v1):** scheduled cadence. Requires the identity-strategy guard from Phase D to be in place and would add an `addRepeatable` BullMQ job + a `syncCadence` field to `ConnectorInstance.config`. Not on this discovery's roadmap.

Each phase is independently shippable behind the connector definition's `is_active` flag.

---

## Decisions

The following were open during discovery and have since been confirmed:

- **Token exchange goes direct to Google.** No Auth0 Action in the path. Folded into the Auth section above.
- **One `ConnectorInstance` per Google account.** Multi-account per user is supported by treating each `(organization, googleAccountEmail)` as its own instance; the UI shows an account chip sourced from the decrypted credentials blob. Folded into the Auth section above.
- **One `ConnectorInstance` per workbook.** Tabs are addressed inside a single plan; we do not split per-tab. Folded into the Auth section above.
- **Sync vs active edit is a non-issue.** Manual-only sync means the user is the one triggering both the edit and the sync — there's no background process that could mutate state under them. The Redis snapshot taken at "select sheet" time still scopes the editor's view; on commit, replay re-reads the live sheet.
- **API quota is a non-issue for v1.** No cadence means no fan-out of background calls; per-user manual syncs are far below Google's 300 read req/min/project default.
- **No inbound webhooks.** Drive push notifications are not on the roadmap. If manual sync proves too coarse later, this is the path to revisit.

## Open Questions

1. **`modules/RegionEditor` audit.** It's only ever had one consumer. Worth a quick pass to confirm there are no upload-only assumptions in the prop surface (e.g., it doesn't expect a `File`, it doesn't reach for upload-specific keys). Discovery suggests it's clean (workbook-shape-only), but should be verified.
2. **RegionEditor numeric-bounds input for large sheets.** Today the editor expects the user to drag across cells to define a region. For sheets that exceed the inline cell cap, regions may extend past the loaded rectangle. v1 likely needs a small editor enhancement (typed row/col bounds in the binding popover) so the user can specify a region's `endRow` without scrolling there. Confirm with the design owner of `modules/RegionEditor` whether this is in-scope or a separate ticket.

---

## Summary

The Google Sheets connector is a **thin shell around an existing pipeline**: OAuth2 + Drive listing + sheet-bytes fetch on the front end of the workflow, and a manual-sync job on the back. The region-editing core (`modules/RegionEditor` + interpret/commit services) is reused unchanged. Large-sheet handling reuses the inline-or-sliced cache shape that file uploads already established and the existing `synced_at` column as a reconciliation watermark — so the new infra is bounded to the OAuth client, encrypted credentials, range-scoped Sheets API calls, and chunked replay. The OAuth2 client + encrypted-credential plumbing is the largest new investment and is worth doing well because it's also the foundation for any future third-party connector (Dropbox, Notion, Airtable…).
