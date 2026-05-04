# Microsoft Excel Cloud Connector — Phase D Spec

**Manual sync (the "Sync now" button).**

This spec covers the connector adapter for `microsoft-excel`: `toPublicAccountInfo`, `assertSyncEligibility`, and `syncInstance`. After Phase D ships, the user can click "Sync now" on a connector instance card; the API re-fetches the workbook from OneDrive, replays the persisted `LayoutPlan` against the new bytes, upserts into `entity_records`, and watermark-reaps anything that wasn't touched by the run. The user gets a toast (per `feedback_job_triggers_use_toasts`) confirming completion with `created/updated/unchanged/deleted` counts.

The shape mirrors `googleSheetsAdapter` 1:1 — the only divergences are (a) the workbook fetch path uses Graph `/content` + `xlsx.adapter` rather than `spreadsheets.get`, and (b) the access-token cache layer (Phase A) handles refresh-token rotation transparently.

Discovery doc reference: §"Sync Model: Manual Replay (v1)".

---

## Scope

### In scope

1. **`microsoftExcelAdapter`** (`apps/api/src/adapters/microsoft-excel/microsoft-excel.adapter.ts`):
   - Implements the `ConnectorAdapter` interface (`apps/api/src/adapters/adapter.interface.ts`).
   - `toPublicAccountInfo(credentials)` returns `{ identity: microsoftAccountUpn, metadata: { email, displayName, tenantId } }`. Returns `EMPTY_ACCOUNT_INFO` when credentials are missing or malformed.
   - `assertSyncEligibility(instance)` — same eligibility model as Google: missing layout plan is the only hard refusal (`LAYOUT_PLAN_NOT_FOUND`); `rowPosition` regions surface as advisory `identityWarnings` via `assertSyncEligibleIdentity`.
   - `syncInstance(instance, userId, progress?)` follows the six-step pipeline:
     1. **Defensive eligibility re-check** — same as Google's adapter; the shared sync route pre-flights but the BullMQ processor can be reached from elsewhere.
     2. **Re-fetch workbook** via `MicrosoftExcelConnectorService.fetchWorkbookForSync(instance.id, instance.organizationId)`. Reads `config.driveItemId`; refreshes access token via the cache layer (which transparently handles refresh-token rotation); pre-flights size; downloads + parses. Does **not** write to the workbook cache (sync wants fresh data).
     3. **Replay** via `LayoutPlanCommitService.commit(instance.id, planRow.id, organizationId, userId, { workbook }, { syncedAt: runStartedAt, skipDriftGate: true })`.
     4. **Per-entity reap:** for each `connectorEntityId`, `entityRecords.softDeleteBeforeWatermark(connectorEntityId, runStartedAt, userId)`.
     5. **Mark synced:** `connectorInstances.update(instance.id, { lastSyncAt: Date.now(), lastErrorMessage: null, updatedBy: userId })`.
     6. **Return result** `{ recordCounts: { created, updated, unchanged, deleted } }`.
   - `queryRows`, `discoverEntities`, `discoverColumns` throw "not implemented" stubs (matching Google).
   - Progress reporting matches Google's shape (10/40/80/95/100 milestones).
2. **`MicrosoftExcelConnectorService.fetchWorkbookForSync`** (added to the service from Phases A/B):
   - Reads the instance, validates ownership.
   - Pulls `driveItemId` from `config`. Refuses with `MICROSOFT_EXCEL_INVALID_PAYLOAD` (or a sync-specific code) when missing.
   - Refreshes access token. Calls `MicrosoftGraphService.headWorkbook` — if size > cap, throws `ApiError(413, MICROSOFT_EXCEL_FILE_TOO_LARGE, …)` (the sync surfaces the same clear error as the editor flow; this is what Open Question 2 asked for).
   - Validates the file extension is still `.xlsx`. Refuses otherwise (covers the "user replaced the file with a `.xlsm`" path).
   - Downloads, parses through `xlsx.adapter`, returns `WorkbookData`. **Does not write the workbook cache.**
3. **Adapter registration** (`apps/api/src/adapters/register.ts`):

   ```ts
   ConnectorAdapterRegistry.register("microsoft-excel", microsoftExcelAdapter);
   ```

4. **Frontend wiring** — already exists from Google's Phase D. The shared `sdk.connectorInstances.sync()` mutation and the toast-triggering feedback in the Connector detail view already dispatch by slug. No frontend changes beyond verifying the existing Sync button renders for `microsoft-excel` instances (it will, because the seed sets `capability_flags.sync: true`).

### Out of scope

- Scheduled / cadence sync (deferred — same posture as Google).
- Range-scoped fetch via the Graph Workbook API (deferred; whole-file download is the v1 strategy).
- Reconnect on `invalid_grant` UX — Phase E. Phase D's adapter merely propagates the error; the cache layer (from Phase A) already flips the instance to `status="error"`.

---

## Test plan (TDD ordering)

### Unit tests (`apps/api/src/__tests__/adapters/microsoft-excel.adapter.test.ts`)

Mirror the structure of `google-sheets.adapter.test.ts`.

1. **`toPublicAccountInfo`**:
   - Returns `{ identity: upn, metadata: { email, displayName, tenantId } }` for a complete credentials blob.
   - Returns `EMPTY_ACCOUNT_INFO` for `null` credentials or credentials missing UPN.
   - `email` field passes through `null` for personal MSAs (asserts the metadata holds `email: null`, not `""`).
2. **`assertSyncEligibility`**:
   - Missing layout plan → `{ ok: false, reasonCode: LAYOUT_PLAN_NOT_FOUND, reason: "…" }`.
   - With layout plan that uses `columnHeader` identity strategy → `{ ok: true, identityWarnings: [] }`.
   - With layout plan that uses `rowPosition` for one region → `{ ok: true, identityWarnings: [<one warning>] }` (advisory).
3. **`syncInstance`** happy path — mock `fetchWorkbookForSync` to return a small fixture workbook; mock `LayoutPlanCommitService.commit` to return `{ recordCounts: { created: 3, updated: 1, unchanged: 7 }, connectorEntityIds: ["ce-1"] }`; mock `entityRecords.softDeleteBeforeWatermark` to return `2`.
   - Asserts the final `recordCounts` is `{ created: 3, updated: 1, unchanged: 7, deleted: 2 }`.
   - Asserts `connectorInstances.update` was called with `{ lastSyncAt, lastErrorMessage: null, updatedBy: userId }`.
   - Asserts `progress` callback was invoked with `[10, 40, 80, 95, 100]` (the 0 milestone fires before the eligibility check).
   - Asserts `LayoutPlanCommitService.commit` was called with `skipDriftGate: true` and `syncedAt` equal to a value captured at sync start.
4. **`syncInstance`** missing layout plan → throws `ApiError(404, LAYOUT_PLAN_NOT_FOUND)` (the eligibility re-check inside `syncInstance`).
5. **`syncInstance`** access-token refresh fails with `invalid_grant` upstream → the error propagates; `connectorInstances.update` was NOT called with `lastSyncAt` (the sync did not complete). The cache layer's side-effect flipping `status="error"` is verified by Phase A's tests; this test asserts the adapter does not swallow the error.
6. **`syncInstance`** workbook too large at sync time → throws `ApiError(413, MICROSOFT_EXCEL_FILE_TOO_LARGE, …)` from `fetchWorkbookForSync`; the adapter does not catch it.
7. **Per-entity reap loop** — when `commit` returns multiple `connectorEntityIds`, `softDeleteBeforeWatermark` is called once per id with the same `runStartedAt`; the deleted count is summed.

### Integration tests (`apps/api/src/__tests__/__integration__/services/microsoft-excel-sync.integration.test.ts`)

Mirror `google-sheets-sync.integration.test.ts`.

8. End-to-end: seed an org, definition, instance with credentials + `config.driveItemId`, layout plan, existing `entity_records` from a prior sync.
   - Mock `MicrosoftAuthService.refreshAccessToken` and the Graph fetch + download to return a fixture `.xlsx`.
   - Run `microsoftExcelAdapter.syncInstance`.
   - Assert `entity_records` table reflects `created`/`updated`/`unchanged`/`deleted` correctly: rows present in the fresh fetch but not in the prior records → `created`; rows present in both with changed columns → `updated`; identical rows → `unchanged`; rows present prior but absent in the fresh fetch → soft-deleted (`deleted IS NOT NULL`).
   - Assert `connector_instances.lastSyncAt` is updated; `lastErrorMessage` is null.
9. **Refresh-token rotation under sync:**
   - Seed instance credentials with `refresh_token: "OLD"`.
   - Mock `refreshAccessToken` to return `{ accessToken: "fresh", refreshToken: "ROTATED-NEW", expiresIn: 3600, scope: "..." }`.
   - Run sync.
   - Assert post-sync, the DB row's decrypted `credentials.refresh_token` is `"ROTATED-NEW"` (the cache layer persisted the rotation).
10. **Workbook missing on Graph (404 from `headWorkbook`)** → sync throws; `lastSyncAt` is not updated; `lastErrorMessage` remains whatever it was (Phase E will surface this; Phase D's job is to not silently succeed).
11. **Sync via the shared route** (`POST /api/connector-instances/:id/sync`) — assert the route resolves the adapter via the registry and returns a `jobId`. Assert that polling `GET /api/connector-instances/:id/sync-status` (or whatever the existing pattern is) eventually returns `success` with the count payload.

### Manual verification

After the slice ships:

1. In the dev environment, complete a Phase C workflow against a real OneDrive workbook.
2. From the connector detail page, click "Sync now".
3. Observe the toast confirming completion with counts.
4. Modify a few rows in the source workbook on OneDrive (add one, remove one, edit one).
5. Click "Sync now" again.
6. Toast shows the expected `created: 1, updated: 1, deleted: 1` count.
7. Open the connector detail's records view; verify the rows reflect the source workbook's current state.
8. Revoke Portal.ai's access in the Microsoft account portal; click Sync; the toast shows an error and the instance card flips to `status="error"`.

---

## Risks

- **Refresh-token consumed by a prior call.** If two syncs race for the same instance from two API processes, one will win the refresh and the other will fail with `invalid_grant`. Phase D inherits Phase A's mitigation (in-process single-flight + status=error on second failure). Multi-process Redis SET NX is a follow-up if scale forces it.
- **Workbook bytes drift mid-sync.** Possible when the source workbook is being edited by the user while sync runs. Same posture as Google — the run captures whatever Graph returns at fetch time; the next sync converges. The `runStartedAt` watermark only reaps rows older than the start, so partial in-flight edits don't cause loss.
- **Long syncs and BullMQ timeouts.** Inherits the existing job-timeout posture. A 50 MB workbook with a heavy plan could exceed the default — instrument and tune in follow-up if measured.
