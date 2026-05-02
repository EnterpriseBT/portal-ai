# Microsoft Excel Cloud Connector — Phase D Plan

**Manual sync.**

Spec: `docs/MICROSOFT_EXCEL_CONNECTOR.phase-D.spec.md`. Discovery: `docs/MICROSOFT_EXCEL_CONNECTOR.discovery.md`.

Tests-first per slice. Run with `cd apps/api && npm run test:unit` and `npm run test:integration`.

---

## Slice 1 — `MicrosoftExcelConnectorService.fetchWorkbookForSync`

**Files**

- Edit: `apps/api/src/services/microsoft-excel-connector.service.ts` — add `fetchWorkbookForSync(connectorInstanceId, organizationId)`.
- New: `apps/api/src/__tests__/services/microsoft-excel-connector.service.fetchWorkbookForSync.test.ts`.

**Steps**

1. Write the test file. Mirror Google's `fetchWorkbookForSync` test cases:
   - Instance not found → 404.
   - Wrong org → 403.
   - Missing `config.driveItemId` → 400 `MICROSOFT_EXCEL_INVALID_PAYLOAD`.
   - Oversize at sync time → `ApiError(413, MICROSOFT_EXCEL_FILE_TOO_LARGE)`.
   - Wrong extension at sync time → `ApiError(415, MICROSOFT_EXCEL_UNSUPPORTED_FORMAT)`.
   - Happy path: returns `WorkbookData` and asserts the workbook cache was **not** written (sync wants fresh data).
2. Run; verify failures.
3. Implement: read the instance, validate ownership and config, get a fresh access token, head + extension validate, download + parse, return.
4. Re-run; green.

**Done when:** `fetchWorkbookForSync` mirrors Google's contract and the cache-write-skip is verified.

---

## Slice 2 — `microsoftExcelAdapter`

**Files**

- New: `apps/api/src/adapters/microsoft-excel/microsoft-excel.adapter.ts`.
- New: `apps/api/src/adapters/microsoft-excel/index.ts` (barrel).
- New: `apps/api/src/__tests__/adapters/microsoft-excel.adapter.test.ts`.

**Steps**

1. Write the adapter unit tests per spec §test-plan-#1-7. Mock `LayoutPlanCommitService.commit`, `entityRecords.softDeleteBeforeWatermark`, `connectorInstances.update`, `connectorInstanceLayoutPlans.findCurrentByConnectorInstanceId`, and `MicrosoftExcelConnectorService.fetchWorkbookForSync` via `jest.unstable_mockModule`.
2. Run; verify failures (adapter doesn't exist).
3. Implement the adapter by templating `googleSheetsAdapter`. Diffs:
   - Logger module name `microsoft-excel-adapter`.
   - `toPublicAccountInfo` returns the richer metadata object (email, displayName, tenantId).
   - `assertSyncEligibility` is a direct copy.
   - `syncInstance` swaps the workbook fetch call to `MicrosoftExcelConnectorService.fetchWorkbookForSync`.
4. Re-run; green.

**Done when:** all unit tests pass.

---

## Slice 3 — Adapter registration

**Files**

- Edit: `apps/api/src/adapters/register.ts` — register `microsoftExcelAdapter` under slug `"microsoft-excel"`.

**Steps**

1. Add a registration test (or extend the existing register-tests file): `ConnectorAdapterRegistry.get("microsoft-excel")` returns the adapter.
2. Run; verify failure.
3. Add the import + register call.
4. Re-run; green.

**Done when:** the adapter is dispatchable through the shared sync route.

---

## Slice 4 — Integration tests

**Files**

- New: `apps/api/src/__tests__/__integration__/services/microsoft-excel-sync.integration.test.ts`.

**Steps**

1. Write the four integration test cases per spec §test-plan-#8-11. Re-use the patterns from `google-sheets-sync.integration.test.ts`:
   - Seed schema. Mock `MicrosoftAuthService.refreshAccessToken` and the Graph fetch (head + content). Provide a small fixture `.xlsx`.
   - Run sync via the shared sync route + the adapter directly (test both paths).
2. Run; verify failures.
3. Adjust adapter / service code if needed to make them pass — most likely just wiring.
4. Re-run `npm run test:integration` from `apps/api`; green.

**Done when:** all integration tests pass; the refresh-token rotation persistence is verified end-to-end.

---

## Slice 5 — Manual verification + observability

**Files**

- No code changes; this slice is the manual run.

**Steps**

1. Re-seed the dev DB so the connector definition picks up `capability_flags.sync: true` (already seeded in Phase C, but re-confirm `sync: true` is set).
2. From the dev environment's web app, complete a workflow against a real OneDrive `.xlsx`.
3. From the connector detail page, click "Sync now".
4. Observe the toast (per `feedback_job_triggers_use_toasts`) showing `created/updated/unchanged/deleted` counts.
5. Modify the source workbook on OneDrive: add a row, edit a row, delete a row.
6. Click "Sync now" again. Verify the toast shows `created: 1, updated: 1, deleted: 1`.
7. Tail API logs and confirm:
   - `mexcel.sync.completed` log line (or the equivalent named event) with the `recordCounts` payload.
   - `mexcel.access.refreshed` log line on the first sync after the access token expired.
   - Refresh-token rotation: a `lastRefreshedAt` field updates in the DB row's `credentials` after a sync that triggered a refresh.

**Done when:** all manual checks pass.

---

## Cross-slice checklist before declaring Phase D complete

- [ ] `npm run test:unit && npm run test:integration` green in `apps/api`.
- [ ] `npm run lint && npm run type-check && npm run build` green at the monorepo root.
- [ ] `ConnectorAdapterRegistry.get("microsoft-excel")` returns `microsoftExcelAdapter`.
- [ ] Manual sync against a real OneDrive workbook completes; counts are correct after a delta.
- [ ] Refresh-token rotation persists on the first sync after access-token expiry (verified via DB query).
- [ ] Oversize / wrong-extension errors at sync time surface cleanly (no silent failures, no partial state).
- [ ] Sync of an instance whose layout plan has `rowPosition` regions completes and returns `identityWarnings` (the UI banner is already wired from Google's Phase D).
