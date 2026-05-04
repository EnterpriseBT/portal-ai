# Microsoft Excel Cloud Connector — Phase C Plan

**Region-editing workflow shell.**

Spec: `docs/MICROSOFT_EXCEL_CONNECTOR.phase-C.spec.md`. Discovery: `docs/MICROSOFT_EXCEL_CONNECTOR.discovery.md`.

Tests-first per slice. Run with `cd apps/web && npm run test:unit`.

---

## Slice 1 — Refactor: parameterized `OAuthAuthorizeStep`

**Files**

- New: `apps/web/src/components/OAuthAuthorizeStep.component.tsx`.
- New: `apps/web/src/components/__tests__/OAuthAuthorizeStep.test.tsx`.
- Delete: `apps/web/src/workflows/GoogleSheetsConnector/AuthorizeStep.component.tsx` (no compat alias).
- Delete: `apps/web/src/workflows/GoogleSheetsConnector/__tests__/AuthorizeStep.test.tsx` (its cases move to the new test file as the Google-parameterized variant).
- Edit: `apps/web/src/workflows/GoogleSheetsConnector/GoogleSheetsConnectorWorkflow.component.tsx` — import from `components/OAuthAuthorizeStep.component` and pass the Google props.

**Steps**

1. Write the seven `OAuthAuthorizeStep.test.tsx` cases per spec §test-plan-#1-7. Use Google props (label "Google Sheets", `<GoogleIcon />`) for one block and Microsoft props for another so both parameterizations are covered before either workflow consumes the component. Run; verify failures.
2. Implement `OAuthAuthorizeStep` by lifting today's `AuthorizeStep` body and replacing the hard-coded copy/icon/scope-description with the new props.
3. Update `GoogleSheetsConnectorWorkflow.component.tsx` to render `<OAuthAuthorizeStep providerLabel="Google Sheets" providerIcon={<GoogleIcon />} scopesDescription="…" {...stateProps} />`. Keep the `AuthorizeStepState` type local to the workflow (or move it onto `OAuthAuthorizeStep` — easier).
4. Delete the old AuthorizeStep file + its test file.
5. Re-run `cd apps/web && npm run test:unit`. Green.

**Done when:** `OAuthAuthorizeStep` is in `components/`; the Google workflow consumes it with the Google branding; tests cover both branding sets.

---

## Slice 2 — Microsoft contracts + SDK leftovers

(Most landed in Phase B. This slice exists to verify the workflow's three-mutation surface is callable without sync.)

**Files**

- Confirm `apps/web/src/api/microsoft-excel.api.ts` exposes `authorize/searchWorkbooks/selectWorkbook/sheetSlice`. If anything's missing from Phase B, complete it here as a small follow-up.

**Steps**

- Run the existing SDK tests; if they pass, move on.

**Done when:** `sdk.microsoftExcel.{authorize, searchWorkbooks, selectWorkbook, sheetSlice}` are all callable.

---

## Slice 3 — `useMicrosoftExcelWorkflow` hook

**Files**

- New: `apps/web/src/workflows/MicrosoftExcelConnector/utils/microsoft-excel-workflow.util.ts`.
- New: `apps/web/src/workflows/MicrosoftExcelConnector/utils/__tests__/microsoft-excel-workflow.util.test.tsx`.

**Steps**

1. Write the hook test per spec §test-plan-#12. Use `renderHook` + a mock `loadWorkbook` callback; assert that `selectWorkbook(driveItemId)` calls it and forwards the workbook to the shared `useSpreadsheetWorkflow`.
2. Run; verify failure (module doesn't exist).
3. Implement by templating `google-sheets-workflow.util.ts`. The differences:
   - Renames: `selectSpreadsheet` → `selectWorkbook`, `spreadsheetId` → `driveItemId`, `loadSheet` → `loadWorkbook`.
   - Same `MICROSOFT_EXCEL_WORKFLOW_STEPS` constant (`["Authorize", "Choose workbook", "Draw regions", "Review & commit"]`).
   - Re-export the surface needed by the container.
4. Re-run; green.

**Done when:** the hook's tests pass; calling `selectWorkbook` triggers `loadWorkbook` with the right args.

---

## Slice 4 — Step components (pure UI)

**Files**

- New: `apps/web/src/workflows/MicrosoftExcelConnector/SelectWorkbookStep.component.tsx`.
- New: `apps/web/src/workflows/MicrosoftExcelConnector/MicrosoftExcelRegionDrawingStep.component.tsx`.
- New: `apps/web/src/workflows/MicrosoftExcelConnector/MicrosoftExcelReviewStep.component.tsx`.
- New: `apps/web/src/workflows/MicrosoftExcelConnector/__tests__/SelectWorkbookStep.test.tsx`.
- New: `apps/web/src/workflows/MicrosoftExcelConnector/__tests__/MicrosoftExcelRegionDrawingStep.test.tsx`.
- New: `apps/web/src/workflows/MicrosoftExcelConnector/__tests__/MicrosoftExcelReviewStep.test.tsx`.

**Steps**

1. Write the three step tests per spec §test-plan-#8-10. Mirror the Google tests; rename labels/IDs.
2. Run; verify failures.
3. Implement each step as a pure UI component (per the Component File Policy, single export per file, no hooks). Copy the corresponding Google component verbatim and rename labels: "spreadsheet" → "workbook", `spreadsheetId` → `driveItemId`.
4. Re-run; green.

**Done when:** all three step components render cleanly in their tests.

---

## Slice 5 — `MicrosoftExcelConnectorWorkflow` container

**Files**

- New: `apps/web/src/workflows/MicrosoftExcelConnector/MicrosoftExcelConnectorWorkflow.component.tsx` (container + UI pair per the Component File Policy).
- New: `apps/web/src/workflows/MicrosoftExcelConnector/index.ts` (barrel export).
- New: `apps/web/src/workflows/MicrosoftExcelConnector/__tests__/MicrosoftExcelConnectorWorkflow.test.tsx`.

**Steps**

1. Write the container integration test per spec §test-plan-#11. Mock `sdk.microsoftExcel.*` and `sdk.layoutPlans.*` via `jest.unstable_mockModule` (mirror `GoogleSheetsConnectorWorkflow.test.tsx`'s setup if present). Mock `useOAuthPopupAuthorize` so a single `start()` resolves with a fake `{ connectorInstanceId, accountInfo }`.
2. Run; verify failures (container doesn't exist).
3. Implement the container by templating `GoogleSheetsConnectorWorkflow.component.tsx`. Diffs:
   - Modal title: `"Connect Microsoft 365 Excel"`.
   - SDK group: `sdk.microsoftExcel.*`.
   - Popup hook: `useOAuthPopupAuthorize({ slug: "microsoft-excel", allowedOrigin: apiOrigin() })`.
   - Render `<OAuthAuthorizeStep providerLabel="Microsoft 365" providerIcon={<MicrosoftIcon />} scopesDescription="…" {...stateProps} />` from `components/`.
   - Use `SelectWorkbookStep` (not `SelectSheetStep`).
   - `loadWorkbook` callback wraps `selectWorkbookMutate({ connectorInstanceId, driveItemId })`.
   - Workbook title falls back to "Microsoft 365 Excel" instead of "Google Sheets".
4. Implement `index.ts` exporting the container, the UI component, props type, and the hook (mirror the Google barrel export).
5. Re-run `cd apps/web && npm run test:unit`. Green.

**Done when:** container test passes; the workflow renders end-to-end against mocked SDK calls.

---

## Slice 6 — Workflow registry + activation

**Files**

- Edit: `apps/web/src/views/Connector.view.tsx` — add the `microsoft-excel` entry to `WORKFLOW_REGISTRY` (and the corresponding import).
- Edit: `apps/api/src/services/seed.service.ts` — flip `microsoft-excel`'s `isActive: false` → `true`.
- Edit (optional): `apps/web/src/__tests__/views/Connector.view.test.tsx` — assert the new entry resolves.

**Steps**

1. Add the registry test asserting `WORKFLOW_REGISTRY["microsoft-excel"]` is the new container.
2. Run; verify failure.
3. Update the registry + the seed.
4. Re-run web + api tests; green.
5. Re-seed the dev DB so the connector definition flips to active (`cd apps/api && npm run db:seed`).

**Done when:** the new connector card appears in the Connectors view in the local dev environment.

---

## Slice 7 — Storybook story

**Files**

- New: `apps/web/src/workflows/MicrosoftExcelConnector/stories/MicrosoftExcelConnectorWorkflow.stories.tsx`.

**Steps**

1. Render the pure UI component (the workflow's `…UI` half) across three stories: `Idle`, `Authorized`, `Committing`. Provide mock props for each state.
2. Run `cd apps/web && npm run storybook` and visually verify.

**Done when:** stories render without console errors.

---

## Cross-slice checklist before declaring Phase C complete

- [ ] `npm run test:unit` green in `apps/web`.
- [ ] `npm run lint && npm run type-check && npm run build` green at the monorepo root.
- [ ] Manual UX walkthrough completes successfully end-to-end (Authorize → Select Workbook → Draw → Review → Commit), tested in a browser per the project's UI testing rule.
- [ ] The connector card displays "Microsoft 365 Excel" with the Microsoft icon.
- [ ] The post-commit redirect lands on `/connectors/$connectorInstanceId` and the chip shows the UPN.
- [ ] The "Sync now" button is **not** visible (Phase D enables sync capability).
- [ ] Storybook story renders cleanly.
- [ ] No `AuthorizeStep` symbol remains under `workflows/GoogleSheetsConnector/`.
