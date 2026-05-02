# Microsoft Excel Cloud Connector — Phase C Spec

**Region-editing workflow shell.**

This spec covers the user-facing 4-step workflow (Authorize → Select Workbook → Draw Regions → Review & Commit). It also lands the parameterized `OAuthAuthorizeStep` resolved by Open Question 1 — the AuthorizeStep is genuinely cosmetic difference between Google and Microsoft, so it gets shared. The `SelectWorkbook`/`SelectSheet` step stays separate per the discovery doc's recommendation (different SDK calls, different vocabulary).

After Phase C: the connector definition's `is_active` flag is flipped to `true`; the user can complete the entire flow up to commit; sync is still Phase D so the "Sync now" button is hidden by the connector capability flags.

Resolved open questions used by this spec:

- **Q1 (parameterize step components):** parameterize `AuthorizeStep` only. Leave the workbook selector per-connector for v1.
- **Q5 (display name):** "Microsoft 365 Excel". Used in the Modal title, the AuthorizeStep copy, and elsewhere user-facing.

Discovery doc reference: §"Reusing the Region-Editing Workflow".

---

## Scope

### In scope

1. **Parameterized `OAuthAuthorizeStep`** — shared component:
   - **New file:** `apps/web/src/components/OAuthAuthorizeStep.component.tsx` (per the Component File Policy — pure UI, single file).
   - Props (mirrors today's `AuthorizeStepUIProps` plus parameterizable bits):

     ```ts
     interface OAuthAuthorizeStepUIProps {
       state: "idle" | "connecting" | "authorized" | "error";
       accountIdentity?: string | null;
       error?: string;
       onConnect: () => void;
       providerLabel: string;        // e.g. "Google Sheets" or "Microsoft 365"
       providerIcon: React.ReactNode; // e.g. <GoogleIcon /> or <MicrosoftIcon />
       scopesDescription: string;     // e.g. "Authorize Portal.ai to read your Google Drive and Sheets…"
     }
     ```

   - Button copy: `Connect ${providerLabel}` in idle state, `Retry` on error, disabled when connecting/authorized.
   - **Removed:** `apps/web/src/workflows/GoogleSheetsConnector/AuthorizeStep.component.tsx` — the Google workflow imports `OAuthAuthorizeStep` directly with the Google props.
   - Per `feedback_no_compat_aliases`: no thin wrapper; the workflow renders `<OAuthAuthorizeStep providerLabel="Google Sheets" providerIcon={<GoogleIcon />} … />` directly.
2. **`workflows/MicrosoftExcelConnector/`** folder, mirroring `GoogleSheetsConnector/`:

   ```
   workflows/
     MicrosoftExcelConnector/
       index.ts
       MicrosoftExcelConnectorWorkflow.component.tsx
       SelectWorkbookStep.component.tsx
       MicrosoftExcelRegionDrawingStep.component.tsx
       MicrosoftExcelReviewStep.component.tsx
       utils/
         microsoft-excel-workflow.util.ts
       __tests__/
         MicrosoftExcelConnectorWorkflow.test.tsx
         SelectWorkbookStep.test.tsx
         MicrosoftExcelRegionDrawingStep.test.tsx
         MicrosoftExcelReviewStep.test.tsx
       stories/
         MicrosoftExcelConnectorWorkflow.stories.tsx
   ```

   - `MicrosoftExcelConnectorWorkflow.component.tsx` — the container + UI pair per the Component File Policy. The container owns:
     - `sdk.microsoftExcel.{authorize, searchWorkbooks, selectWorkbook, sheetSlice}` mutations.
     - `sdk.layoutPlans.{interpret, commit}` (shared).
     - `useOAuthPopupAuthorize({ slug: "microsoft-excel", allowedOrigin: apiOrigin() })`.
     - `useSpreadsheetWorkflow` via the new `useMicrosoftExcelWorkflow` wrapper hook.
   - `SelectWorkbookStep.component.tsx` — pure UI step. Same `AsyncSearchableSelect` pattern as `SelectSheetStep`; props differ only in vocabulary (label "Workbook" vs. "Spreadsheet").
   - `MicrosoftExcelRegionDrawingStep.component.tsx` and `MicrosoftExcelReviewStep.component.tsx` — wrappers around `modules/RegionEditor`; near-identical to the Google wrappers (only difference is the Modal title's branded label).
   - `microsoft-excel-workflow.util.ts` — exports `useMicrosoftExcelWorkflow(callbacks)` that wraps `useSpreadsheetWorkflow` the same way `useGoogleSheetsWorkflow` does. The single divergence is `loadWorkbook` calls `sdk.microsoftExcel.selectWorkbook` and reads back `{ title, sheets }`.
3. **`Connector.view.tsx`** — register the new workflow in `WORKFLOW_REGISTRY`:

   ```ts
   const WORKFLOW_REGISTRY = {
     "file-upload": FileUploadConnectorWorkflow,
     "google-sheets": GoogleSheetsConnectorWorkflow,
     "microsoft-excel": MicrosoftExcelConnectorWorkflow,
     sandbox: SandboxConnectorWorkflow,
   };
   ```

4. **Connector definition seed** — flip `is_active: true` for the `microsoft-excel` row (same one-line edit Phase C did for Google).

### Out of scope

- Sync (Phase D); the "Sync now" button on the connector card stays hidden via the `enabledCapabilityFlags.sync` gate that Phase D enables when the adapter registers.
- Parameterizing `SelectWorkbookStep` / `SelectSheetStep` into a single shared component — deferred per the discovery doc and Open Question 1; the third connector is the trigger to parameterize.
- Reconnect UX (Phase E).

---

## UX details

- **Modal title:** "Connect Microsoft 365 Excel" (matches the seeded display name).
- **AuthorizeStep:**
  - `providerLabel: "Microsoft 365"` (the button reads "Connect Microsoft 365"; the Modal title carries the more specific "Excel" qualifier).
  - `providerIcon: <MicrosoftIcon />` from `@mui/icons-material/Microsoft`.
  - `scopesDescription: "Authorize Portal.ai to read your Microsoft 365 Excel files in OneDrive. We only ever request read access — no writes, no deletions."`
- **SelectWorkbookStep:** label reads "Choose a workbook"; the search placeholder is "Search workbooks…"; empty-search state shows "Recent workbooks" header above the dropdown.
- **Region drawing + review steps:** identical UX to Google.
- **Connector instance name:** sourced from `selectWorkbook` response's `title` (workbook name without the `.xlsx` extension), stored on commit. Falls back to `"Microsoft 365 Excel"` when title is missing.

---

## Test plan (TDD ordering)

Frontend tests use `jest.unstable_mockModule` for SDK mocks per `apps/web/src/__tests__/test-utils.tsx`.

### Component tests (`apps/web/src/components/__tests__/OAuthAuthorizeStep.test.tsx`)

1. Renders `Connect ${providerLabel}` button.
2. State `connecting` disables the button, shows the spinner.
3. State `authorized` shows the success Alert with `Connected as ${accountIdentity}` (or just `Connected` when null).
4. State `error` shows the error Alert with the supplied message and the button reads `Retry`.
5. `onConnect` fires on click in `idle` state; not when disabled.
6. Custom `providerIcon` is rendered (test the icon node by `data-testid`).
7. `scopesDescription` is rendered as the body copy.

### Workflow tests (`apps/web/src/workflows/MicrosoftExcelConnector/__tests__/`)

8. **`SelectWorkbookStep.test.tsx`** — pure UI. Mirror of `SelectSheetStep.test.tsx`:
   - Renders the searchable select with the supplied `value`.
   - `searchFn` is invoked on input typing; results render as options.
   - Selecting an option fires `onSelect(driveItemId)`.
   - Loading state shows spinner.
   - `serverError` renders `<FormAlert>` per `apps/web` form pattern.
9. **`MicrosoftExcelRegionDrawingStep.test.tsx`** — copy of the Google wrapper test, swap props labels.
10. **`MicrosoftExcelReviewStep.test.tsx`** — copy of the Google wrapper test, swap labels.
11. **`MicrosoftExcelConnectorWorkflow.test.tsx`** — container-level integration test:
    - Initial render shows the OAuth step with `providerLabel: "Microsoft 365"` and the Microsoft icon.
    - Clicking "Connect Microsoft 365" calls `sdk.microsoftExcel.authorize` and the popup hook is invoked with `slug: "microsoft-excel"`.
    - On the popup `microsoft-excel-authorized` postMessage (mocked), the workflow advances to "Select workbook".
    - Searching invokes `sdk.microsoftExcel.searchWorkbooks` with the typed query.
    - Selecting a workbook invokes `sdk.microsoftExcel.selectWorkbook` and advances to the drawing step with the returned workbook hydrated.
    - Drawing → interpret invokes `sdk.layoutPlans.interpret`; review → commit invokes `sdk.layoutPlans.commit`.
    - Commit success invalidates the standard query keys (per the Mutation Cache Invalidation rules) and navigates to `/connectors/$id`.
    - Closing the modal calls `workflow.reset` and clears refs (mirror of the Google test's reset assertions).

### Hook tests (`apps/web/src/workflows/MicrosoftExcelConnector/utils/__tests__/microsoft-excel-workflow.util.test.tsx`)

12. `useMicrosoftExcelWorkflow` exposes the same surface as `useGoogleSheetsWorkflow`. Test that selecting a workbook calls the supplied `loadWorkbook` callback and `setWorkbook` is forwarded to `useSpreadsheetWorkflow`.

### View test

13. **`apps/web/src/__tests__/views/Connector.view.test.tsx`** — extend the existing test (or add one) asserting the new entry in `WORKFLOW_REGISTRY` resolves to the new workflow component for slug `microsoft-excel`.

### Storybook story

14. `MicrosoftExcelConnectorWorkflow.stories.tsx` — renders the pure UI component with mock callbacks across the three states (idle / authorized / committed) so the visual review covers the new branding.

### Manual verification

After the slice ships:

1. Local web at `http://localhost:3000`. Log in. Navigate to Connectors.
2. The "Microsoft 365 Excel" card shows in the available-connectors list.
3. Click "Connect" → OAuth popup opens against `login.microsoftonline.com`.
4. Complete consent in the popup. The popup closes; the workflow advances to "Select workbook".
5. Search "Q3" or similar. Pick a workbook. The drawing step renders the workbook.
6. Draw regions → interpret → review → commit. The commit redirects to the connector detail page; the chip shows the UPN.
7. Open Connector Storybook (`npm run storybook -- --filter=web`) and verify the new story renders cleanly across the three states.

---

## Risks

- **Popup blocked.** `useOAuthPopupAuthorize` uses the click-handler-synchronous `window.open` pattern. Same risk as Google; same mitigation (the `error` state surfaces "Failed to open OAuth popup (blocked?)").
- **Workbook size 413.** Phase B returns `MICROSOFT_EXCEL_FILE_TOO_LARGE` with `details: { sizeBytes, capBytes }`. The workflow's serverError surfacing must render this clearly — the existing `FormAlert` in `SelectWorkbookStep` will pick up the message; consider a custom error rendering that includes the size + cap. Not in this phase's scope unless a quick win — the default rendering is acceptable.
- **Title collision.** Two users in the same org might pick a workbook with the same name. The connector instance name is the workbook title; nothing forces uniqueness at the org level. Same posture as Google — acceptable; the chip's UPN disambiguates.
