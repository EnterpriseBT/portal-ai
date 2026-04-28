# Google Sheets Connector — Discovery

## Goal

Add a `google-sheets` connector that lets a user authorize Portal.ai against their Google account, pick one or more sheets to bring in, run the same region-editing workflow that file uploads use, and have the data **periodically sync** into `entity_records` from those source sheets.

Concretely, this means:

1. **OAuth2 authorization flow.** The user grants Portal.ai read access to their Google Drive/Sheets. We persist refresh-token-bearing credentials per `ConnectorInstance`.
2. **Sheet discovery + selection.** After auth, the user picks a Google Drive sheet (single or multiple) from their authorized scope. Each selected workbook becomes the input to the region-drawing step.
3. **Region editing — same UX as file upload.** We reuse the `modules/RegionEditor` (and the shared interpret/commit pipeline) so the user can draw regions, get an LLM-interpreted plan, and review/commit bindings exactly like the file-upload workflow.
4. **Cadenced sync.** Once committed, the connector instance has a sync cadence. A scheduled job re-fetches the source sheet, replays the persisted `LayoutPlan` against the new bytes, and upserts into `entity_records`. Liveness is the cadence, not a mode flag (per project's connector model — see `feedback_connector_domain_model`).

Non-goals for this discovery:

- Two-way write-back to Sheets (we only `read`/`sync`, not `write`/`push`).
- Cell-level real-time push (Google's push notifications via webhook). Polling cadence first; webhooks can come later as an optimization.
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

**Credential storage**: encrypt the credential JSON (`{ refresh_token, scopes, googleAccountEmail }`) using AES-GCM keyed off `ENCRYPTION_KEY`, store base64 in `connector_instances.credentials`. Decrypt on demand inside the adapter when a sync runs. We **do not** store access tokens.

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

After authorization, before region drawing, the user needs to pick which sheet(s) to ingest. Two UX options:

### Option A — Google Picker iframe (best UX, more setup)

Google ships a JS library that renders an authorized file picker against the user's Drive. Pros: the user sees their real Drive folder structure; we only see the files they explicitly pick (lets us narrow to `drive.file` scope). Cons: requires loading Google's JS, an extra API key, and an additional OAuth scope just for the picker.

### Option B — API-driven list (simpler v1)

After auth, hit Google Drive's `files.list` endpoint server-side and stream a paginated list of `mimeType = 'application/vnd.google-apps.spreadsheet'` files into the workflow UI. Render an `AsyncSearchableSelect` (already a `modules/` primitive) with debounced search.

**Recommendation: ship Option B for v1.** Simpler, no extra Google JS dependency, and the `AsyncSearchableSelect` pattern is already idiomatic in the app (per `feedback_use_include_joins`). Picker can come later if users want narrower scope.

The selected sheet's `spreadsheetId` (and a snapshot of its title) gets stored in `ConnectorInstance.config: { spreadsheetId, title, fetchedAt }`.

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

## Sync Model: Cadenced Replay

Per the project's connector model, liveness is a sync cadence, not a separate mode. Sync model:

- **Cadence on `ConnectorInstance.config.syncCadence`**: `"manual" | "hourly" | "daily" | "weekly"`. Default `daily` for v1; `manual`-only is fine for the first ship.
- **A repeating BullMQ job** `gsheets-sync` (this would be our first repeat job — adds `addRepeatable` wiring to `jobs.queue.ts`) ticks every hour and looks up due instances. Or — simpler and cheaper — a single `gsheets-sync-tick` cron (every 15 min) that queries instances where `lastSyncAt + cadence < now()` and enqueues them individually.
- **Per-sync work** (inside `gsheets.adapter.syncEntity`):
  1. Decrypt credentials → get fresh access token.
  2. Re-fetch the spreadsheet via `spreadsheets.get?includeGridData=true`.
  3. Build a `WorkbookData`.
  4. Load the persisted `LayoutPlan` from `connector_instance_layout_plans`.
  5. Run replay (`@portalai/spreadsheet-parsing/replay`) against the new `WorkbookData` to materialize records.
  6. Diff against existing `entity_records` for this instance — `upsertManyBySourceId` handles the upsert; we delete records whose source rows no longer exist.
  7. Update `lastSyncAt`, clear `lastErrorMessage`, or set `status="error"` + message on failure.
- **On-demand sync** — a `POST /api/connector-instances/:id/sync` route enqueues the same job immediately and returns a job id the UI can poll.

**Drift handling.** The persisted `LayoutPlan` is anchored to specific cells/headers. If the user reshapes the sheet (renamed columns, moved a region), the next sync may produce drift warnings or zero rows. Same drift surface that already exists for file uploads after re-interpret is reused; the UI surfaces a "Re-edit regions" affordance from the connector detail view.

---

## Database & Schema

Minimal schema additions:

| Change | Reason |
|--------|--------|
| Insert `google-sheets` row in `connector_definitions` (slug, display "Google Sheets", category "File-based" or new "Spreadsheet" category, `auth_type: "oauth2"`, `capability_flags: { sync: true, read: true, write: false, push: false }`, `config_schema` describing `{ spreadsheetId, title, syncCadence }`, icon URL). | Seeded via `seed.service.ts` alongside sandbox + file-upload. |
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
- **Phase C** — Region-editing workflow shell (steps 1 & 2: authorize + select). Reuses RegionEditor for steps 3 & 4 unchanged.
- **Phase D** — On-demand sync (manual cadence only). `lastSyncAt` updates; we can manually re-trigger and see records re-materialize.
- **Phase E** — Repeating cadence (the first repeating BullMQ job in the codebase). Daily default, configurable per instance.
- **Phase F** — Reconnect / error recovery flow (handles `invalid_grant` from Google).

Each phase is independently shippable behind the connector definition's `is_active` flag.

---

## Open Questions

1. **`modules/RegionEditor` audit.** It's only ever had one consumer. Worth a quick pass to confirm there are no upload-only assumptions in the prop surface (e.g., it doesn't expect a `File`, it doesn't reach for upload-specific keys). Discovery suggests it's clean (workbook-shape-only), but should be verified.
2. **Token-exchange surface.** Does the API speak to Google directly, or via an Auth0 Action? Direct keeps Auth0 out of the connector dependency graph (preferred); confirm with infra owner.
3. **Multiple Google accounts per user.** The flow above supports it (one `ConnectorInstance` per Google account), but the UI needs to make it clear which account a sheet is being read from. Probably a chip on the connector card showing the `googleAccountEmail` we capture during callback.
4. **Sheet-level vs workbook-level instance.** Today's design: one `ConnectorInstance` per workbook (a workbook = many tabs, but one Drive file). Alternative: one instance per tab. Workbook-level is simpler and matches the current `LayoutPlan` shape (one plan describes regions across all sheets in one workbook). Going with workbook-level unless a stakeholder objects.
5. **Sync collision with active region-edit session.** If a sync runs while the user is mid-edit, the cached workbook may change under them. v1 answer: editing operates on a *snapshot* taken at "select sheet" time (already cached in Redis); syncs work against a fresh fetch and don't touch the active session's snapshot.
6. **Quota.** Google Sheets API has a default 300 read req/min/project. Daily-cadence sync against tens of thousands of instances eventually pinches; quota uplift is straightforward but should be tracked once usage is measurable. Not a v1 blocker.
7. **Inbound webhooks (push).** Google Drive supports push notifications for file changes. Skipping for v1 — if cadence becomes the bottleneck, add a webhook receiver and use it as a "wake the sync now" signal rather than replacing the polling job entirely.

---

## Summary

The Google Sheets connector is a **thin shell around an existing pipeline**: OAuth2 + Drive listing + sheet-bytes fetch on the front end of the workflow, and a cadenced sync job on the back. The region-editing core (`modules/RegionEditor` + interpret/commit services) is reused unchanged. The largest new investment is the OAuth2 client + encrypted-credential plumbing, which is worth doing well because it's also the foundation for any future third-party connector (Dropbox, Notion, Airtable…).
