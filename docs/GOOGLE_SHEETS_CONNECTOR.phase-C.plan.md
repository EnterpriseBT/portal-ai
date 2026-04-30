# Google Sheets Connector — Phase C Implementation Plan

Companion to `GOOGLE_SHEETS_CONNECTOR.discovery.md` and `.phase-{A,B}.plan.md`. Phase C scope:

> **Phase C** — Region-editing workflow shell (steps 1 & 2: authorize + select). Reuses RegionEditor for steps 3 & 4 unchanged. Review step surfaces the `rowPosition`-identity banner.

Concretely: a frontend workflow that walks a user from "Connect Google Sheets" to a committed `LayoutPlan`, mirroring `FileUploadConnector` end-to-end and reusing every server-side path Phase A/B already proved against real Google APIs.

## What already exists (do not rebuild)

Phase C is mostly a frontend assembly. Heavy reuse:

- **All Phase A/B endpoints** — `/authorize`, `/callback`, `/sheets`, `/instances/:id/select-sheet`, `/instances/:id/sheet-slice`. Manually verified against live Google APIs in the previous phase. No new server work in Phase C.
- **`apps/web/src/modules/RegionEditor/`** — workbook-shape-agnostic. Takes a `Workbook` plus a `loadSlice` callback that the container provides, emits region drafts/bindings via callbacks. Confirmed during Phase B that the slice fetcher is wired at the *workflow* level (`FileUploadConnectorWorkflow.component.tsx:383-397`), not inside the module — so swapping pipelines is a one-callback change, not a module audit.
- **`apps/web/src/workflows/FileUploadConnector/`** — the reference shape: 4 steps (Upload, RegionDrawing, Review, commit), barrel `index.ts`, container/UI pair, `utils/`, `__tests__/`, `stories/`. Phase C mirrors this structure with steps Upload → AuthorizeStep + SelectSheetStep at the front.
- **`apps/web/src/api/layout-plans.api.ts`** — `sdk.layoutPlans.interpret()` + `sdk.layoutPlans.commit()`. Both consume the same shape regardless of source pipeline; the workflow calls them directly.
- **Connector definition + redaction** — `sdk.connectorInstances.get(id)` already returns `accountInfo` on the redacted shape (Phase A Slice 9). The connector card chip and any post-auth UI can render `accountInfo.identity` without an extra fetch.
- **MUI v7 + AsyncSearchableSelect + DetailCard + DialogAlert + the form-validation utils** — all the building blocks the workflow assembles. No new design-system primitives needed.
- **Seed state** — `is_active: false` on `google-sheets` is the Phase A gate. Phase C flips this to `true` so the connector definition surfaces in the connector list. One-line seed change.

## What's net-new for Phase C

| Piece | File | Purpose |
|---|---|---|
| `sdk.googleSheets.*` | `apps/web/src/api/google-sheets.api.ts` (new) | Authorize, searchSheets, selectSheet, sheetSlice — mirrors how `sdk.fileUploads.*` shape works. |
| `useGooglePopupAuthorize` | `apps/web/src/workflows/GoogleSheetsConnector/utils/google-sheets-workflow.util.ts` (new) | Opens the consent URL in a popup; listens for the `google-sheets-authorized` postMessage; resolves to `{ connectorInstanceId, accountInfo }`. |
| `AuthorizeStep` | new component | Pure UI: idle → connecting → success/error. |
| `SelectSheetStep` | new component | `AsyncSearchableSelect` against `searchSheets`; `onSelect` triggers `selectSheet` and advances. |
| `GoogleSheetsRegionDrawingStep` | new component | Thin wrapper around `<RegionEditor>` that provides a google-sheets-specific `loadSlice`. |
| `GoogleSheetsReviewStep` | new component | Mirrors `FileUploadReviewStep`. Adds the rowPosition-identity banner. |
| `GoogleSheetsConnectorWorkflow` | new component (container + UI pair) | Assembles the four steps with the stepper, manages workflow state. |
| Route + entry | `apps/web/src/routes/...` + connector list "Connect" handler | Mounts the workflow when a user picks Google Sheets from the connector definition list. |
| Seed flip | `apps/api/src/services/seed.service.ts` | `isActive: false` → `true` on the `google-sheets` definition. |

## TDD discipline

Same as Phases A/B: red → green → refactor, run via `npm run test:unit` from the repo root. Apps/web uses the project's existing pattern — pure UI components rendered by tests with props (no SDK, no router, no provider mocks); container components exercised through workflow-level integration tests. See `feedback_sdk_helpers_for_api`: every API call routes through `sdk.*`, never `fetch` directly.

Per the project's [Component File Policy](../CLAUDE.md): every new file in this plan exports either one pure UI component (`*UI`) or a container + its UI pair. No inline helper components.

---

## Slice 1 — SDK methods for google-sheets

### Goal

`sdk.googleSheets.{authorize, searchSheets, selectSheet, sheetSlice}` exposing the four Phase A/B endpoints through the project's standard `useAuthMutation` / `useAuthQuery` helpers (per `feedback_sdk_helpers_for_api`).

### Red

- New file `apps/web/src/__tests__/api/google-sheets.api.test.ts` mirroring the shape of `connector-instances.api.test.ts` / `layout-plans.api.test.ts`:
  1. `authorize()` mutation calls `POST /api/connectors/google-sheets/authorize` with no body.
  2. `searchSheets({ connectorInstanceId, search, pageToken })` builds the query string correctly: `connectorInstanceId` always present, `search` only when non-empty, `pageToken` only when supplied. Method `GET`.
  3. `selectSheet({ connectorInstanceId, spreadsheetId })` calls `POST /api/connectors/google-sheets/instances/{id}/select-sheet` with the right path interpolation and JSON body.
  4. `sheetSlice` query shape matches what `RegionEditor`'s `LoadSliceFn` expects: `{ connectorInstanceId, sheetId, rowStart, rowEnd, colStart, colEnd }` → `GET /instances/:id/sheet-slice?...`.
  5. Error responses surface `ApiError` with `code` + `message` (the `useAuthMutation` helper handles this — verify it bubbles correctly).

### Green

- New file `apps/web/src/api/google-sheets.api.ts`. Reuse `useAuthMutation` for write calls and the imperative-GET pattern that file-upload's `sheetSlice` uses (per `feedback_sdk_helpers_for_api`).
- Add `googleSheets: googleSheetsApi` to `apps/web/src/api/sdk.ts`.
- Re-export `searchSheets` as the second arg to an `AsyncSearchableSelect`-shaped hook so the SelectSheetStep can plug it in directly without re-mapping the response.

### Refactor

- The pagination cursor pattern is shared with future Drive-style connectors. If Phase D (sync) introduces a similar paginated list call, lift to a shared `usePaginatedSearch` helper. Don't pre-extract.

---

## Slice 2 — OAuth popup hook

### Goal

`useGooglePopupAuthorize()` opens the consent URL in a popup, listens for the `postMessage` the callback HTML emits (`{ type: "google-sheets-authorized", connectorInstanceId, accountInfo }`), and resolves to that payload. Rejects on popup-closed-without-message + on origin/shape mismatch.

### Red

- New file `apps/web/src/workflows/GoogleSheetsConnector/utils/__tests__/google-sheets-workflow.util.test.ts`:
  1. Calling `start(consentUrl)` opens a popup pointed at the URL (mock `window.open`).
  2. When the popup `postMessage`s the right shape from a recognized origin, the hook's promise resolves with `{ connectorInstanceId, accountInfo }`.
  3. Origin mismatch (message from `evil.example.com`) → ignored, popup stays open.
  4. Wrong message type (`{ type: "something-else" }`) → ignored.
  5. Popup closed without a message → promise rejects with a `PopupClosedError` so the AuthorizeStep can render "Auth cancelled" rather than a generic error.
  6. Cleanup — `window.removeEventListener("message", ...)` runs whether the promise resolves OR rejects.

### Green

- Implement as a custom hook returning `{ start, status, accountInfo, error, reset }`.
- Origin allowlist comes from `import.meta.env.VITE_API_BASE_URL`'s origin (the callback runs on the API host, not the web app's host) — wildcard origin is **not** acceptable for v1 even though the message contains no secrets, because we'll harden this surface for Phase E and want the discipline now.
- Polling-based "popup closed" detection: 500 ms `setInterval` checking `popup.closed`. Reject if true with no prior message.

### Refactor

- The hook is connector-specific by virtue of the message-type string. If Phase D introduces a Dropbox/Notion connector with the same OAuth popup pattern, extract a generic `useOAuthPopupHandshake({ messageType, allowedOrigin })`. Not yet.

---

## Slice 3 — AuthorizeStep (UI + container)

### Goal

Component-file pair: `AuthorizeStep.component.tsx` exporting `AuthorizeStepUI` (pure) and `AuthorizeStep` (container that wires `sdk.googleSheets.authorize` + `useGooglePopupAuthorize`). Per the project's Component File Policy.

### Red

- `__tests__/AuthorizeStep.test.tsx` — renders `AuthorizeStepUI` only (props-driven, no SDK):
  1. Renders the "Connect Google Sheets" CTA when state is `idle`.
  2. Renders the loading state when state is `connecting`.
  3. Renders `accountInfo.identity` (the email) when state is `authorized`.
  4. Renders the error banner with a Retry button when state is `error`.
  5. CTA click invokes the `onConnect` callback exactly once.
  6. Retry click invokes `onConnect` (same handler), not a separate one.
  7. ARIA — CTA is a real `<button>` with an accessible label; the success state has `role="status"` for the screen-reader announcement.
- `stories/AuthorizeStep.stories.tsx` — one story per state (`idle`, `connecting`, `authorized`, `error`). No SDK mocks needed.

### Green

- `AuthorizeStepUI` — pure component, takes `{ state, accountInfo?, error?, onConnect }`.
- `AuthorizeStep` (container) — wires `sdk.googleSheets.authorize().mutateAsync()` to fetch the consent URL, `useGooglePopupAuthorize` to drive the popup, hands the result to a parent-supplied `onAuthorized` callback. Pure UI gets all rendering responsibility.

### Refactor

- `accountInfo` rendering — render `accountInfo.identity` when present; future-proof that the metadata bag will be displayed by the connector card later (Phase E may want a small `<AccountInfoChip>` shared component). Don't pre-extract.

---

## Slice 4 — SelectSheetStep (UI + container)

### Goal

Component pair that lets the user pick a spreadsheet via a debounced search.

### Red

- Pure UI tests:
  1. Renders an `AsyncSearchableSelect` whose options come from a `searchFn` prop the test injects. (The pure UI component takes a search function, not the SDK directly.)
  2. Selecting an option triggers `onSelect(spreadsheetId)`.
  3. Disabled state — when `loading=true`, the select is disabled and a spinner shows.
  4. Empty-results message reads "No spreadsheets found — make sure the right Google account is connected" so the user knows to reconnect (vs. think the API broke).
  5. Selected-value persists across re-renders driven by parent state changes.

- Container-level tests live alongside the workflow integration test in Slice 7.

### Green

- `SelectSheetStepUI` props: `{ searchFn, value, onSelect, loading, disabled }`.
- Container `SelectSheetStep` wires `sdk.googleSheets.searchSheets`. On `onSelect`, calls `sdk.googleSheets.selectSheet({ connectorInstanceId, spreadsheetId })`, awaits the parseSession-shape response, hands it to a parent-supplied `onSelected({ workbook, sliced })` callback.

### Refactor

- The "search by name + paginate via cursor" shape is identical to how `connector-instances.api.ts:searchInstances` works for in-app search. If Phase D adds a third such caller, the option mapping is worth extracting; for now leave inline.

---

## Slice 5 — GoogleSheetsRegionDrawingStep (thin wrapper around RegionEditor)

### Goal

A workflow-shaped wrapper over `<RegionEditor>` that provides a google-sheets-specific `loadSlice` callback. Mirrors `FileUploadRegionDrawingStep` so the only meaningful difference is the slice endpoint.

### Red

- Test renders `GoogleSheetsRegionDrawingStepUI` with a fake `loadSlice` and asserts:
  1. The `loadSlice` prop forwards to `<RegionEditor>` and receives `{ sheetId, rowStart, rowEnd, colStart, colEnd }` arguments.
  2. Container builds the `loadSlice` from `sdk.googleSheets.sheetSlice` closing over `connectorInstanceId` (this part lives in the container test).
  3. Region drafts emitted by RegionEditor flow up via the `onRegionsChanged` prop unchanged.

### Green

- New file. The pure UI is mostly `<RegionEditor {...props} loadSlice={loadSlice} />` — its job is to enforce the Google-Sheets-specific `loadSlice` source while keeping every other prop transparent.
- Container closes over `connectorInstanceIdRef` so the closure is stable across step transitions.

### Refactor

- If `GoogleSheetsRegionDrawingStepUI` ends up identical to `FileUploadRegionDrawingStepUI` modulo the loadSlice closure, lift to a shared `RegionDrawingStepUI`. Two callsites isn't yet the bar; a third (Dropbox, etc.) is.

---

## Slice 6 — GoogleSheetsReviewStep + rowPosition-identity banner

### Goal

Mirrors `FileUploadReviewStep`. Adds a banner when the interpreted plan has any region whose `identityStrategy.kind === "rowPosition"`.

The banner text is settled in the discovery doc:

> "This region uses positional row IDs — it can be imported once but not re-synced. Add an identifier column to enable sync."

The banner does **not** block commit. The user can proceed with a one-shot import; the connector instance will simply be ineligible for sync until they edit the region with an identifier column. Per the discovery's "Sync identity requirement" §.

### Red

- Pure UI test cases:
  1. Renders the same metadata + per-region cards `FileUploadReviewStep` does, given the same plan props.
  2. **No banner** when every region's `identityStrategy.kind` is `"column"` or `"composite"`.
  3. **Banner present** for any region with `kind === "rowPosition"`, naming each affected region (`region.name` or fallback to bounds).
  4. **Commit not blocked** — the banner sits above the commit button; clicking commit still calls `onCommit`. Banner has `severity="warning"`, `role="status"`.
  5. **Banner identifies the path forward** — text mentions "Add an identifier column" so the user knows what to do.

### Green

- New `GoogleSheetsReviewStepUI` taking `{ plan, regions, identityStrategiesByRegionId, onCommit, isPending, serverError }`.
- Banner is its own small inline JSX block (still no helper component — three lines).
- Container reads the interpret response's `regions[].identityStrategy` to feed into the UI prop. If the interpret service doesn't currently include `identityStrategy` in its response, this slice extends the contract — flag in Refactor.

### Refactor

- **Audit `LayoutPlanInterpretDraftResponsePayload`** to confirm `regions[].identityStrategy` is on the wire. Most likely it is (the parser owns it and the schema would carry it), but verify; if missing, this slice grows by one additional API change. Discovery doc claimed "The persisted `LayoutPlan` already carries the chosen `identityStrategy` per region" — same data should flow through interpret too.

---

## Slice 7 — Workflow container + UI + barrel

### Goal

`GoogleSheetsConnectorWorkflow.component.tsx` exporting the workflow's container + UI pair, mirroring `FileUploadConnectorWorkflow`. Drives a 4-step stepper: AuthorizeStep → SelectSheetStep → RegionDrawingStep → ReviewStep.

### Red

- `__tests__/GoogleSheetsConnectorWorkflow.test.tsx`:
  1. Initial render → AuthorizeStep is active, others greyed out.
  2. After successful authorize (mocked `onAuthorized` callback fires) → step advances to SelectSheetStep, `connectorInstanceId` is in workflow state, AuthorizeStep step indicator shows complete.
  3. After successful selectSheet → step advances to RegionDrawingStep with the workbook from the response.
  4. After region edits emit drafts and user clicks Next → triggers `interpret` (mocked SDK), advances to ReviewStep with the plan.
  5. Commit button on ReviewStep → triggers `commit` (mocked SDK), workflow closes.
  6. **Back button on a later step** → previous step is shown, but workflow state for the current step is preserved (regions don't disappear when you back-step out of RegionDrawing into SelectSheet and forward again, as long as you didn't change the spreadsheetId).
  7. **Spreadsheet change resets downstream state** — selecting a different spreadsheetId clears any pending region drafts / interpret result.
- `stories/GoogleSheetsConnectorWorkflow.stories.tsx` — story per workflow state, not per-step (those have their own stories).

### Green

- Container holds workflow state in `useState` slots. Mirrors `FileUploadConnectorWorkflow.component.tsx` structure:
  - `connectorInstanceIdRef`, `accountInfoRef`, `spreadsheetIdRef`, `workbookRef`, `regionDraftsRef`, `planRef`.
  - Step transitions via `currentStep` state.
  - `loadSlice` closure built once, reads from the ref each call (per file-upload's pattern).
- Pure UI takes the four step-component instances as children plus props for the stepper headers (active step index, completion indicators).
- Mutation cache invalidation per `feedback_sdk_helpers_for_api` — the commit's `onSuccess` invalidates `queryKeys.connectorInstances.root`, `queryKeys.portals.root`, `queryKeys.portalResults.root` (matching `FileUploadConnectorWorkflow`).

### Refactor

- If the four-step stepper container is byte-for-byte the same as `FileUploadConnectorWorkflow`'s stepper component (excluding the step-component props), extract a shared `<ConnectorWorkflowStepper>`. This is highly likely — both workflows hand off identical step navigation patterns. Defer to a third connector if the diff is small enough that two copies isn't yet pain.

---

## Slice 8 — Route + entry point + seed flip

### Goal

Wire the workflow into the app so users can actually launch it. Three changes:

1. **Seed flip** — `is_active: false` → `true` on the `google-sheets` connector definition row.
2. **Connector definition list** — clicking "Connect" on the `google-sheets` definition card opens `GoogleSheetsConnectorWorkflow` in a dialog/route. The existing connector definition list view is `apps/web/src/views/Connector.view.tsx` (or similar).
3. **Route** (optional) — if the connector workflow is a full-screen flow, register a TanStack Router file-based route under `_authorized`. If it's a dialog, no new route — just a modal in the existing connector list view.

Decision: **dialog** for v1, matching `FileUploadConnectorWorkflow`'s mounting pattern. Reduces scope and keeps the back-button UX consistent across connectors.

### Red

- `__tests__/Connector.view.gsheets.test.tsx`:
  1. Connector definition list renders the `google-sheets` card alongside the other definitions.
  2. Clicking the card's "Connect" action opens the `GoogleSheetsConnectorWorkflow` dialog with the right `connectorDefinitionId` prop.
  3. Closing the dialog (escape or X) does **not** trigger commit.

### Green

- Update `apps/api/src/services/seed.service.ts`: `isActive: true` for `google-sheets`. The integration test asserting `isActive: false` (Phase A Slice 6) needs updating in lockstep — flip its assertion too.
- Wire the connector list's onConnect handler: a slug-based switch already exists for `file-upload` (likely); add a `google-sheets` branch that opens the new workflow dialog.

### Refactor

- The slug-based switch in `Connector.view.tsx` is the kind of thing that grows linearly with connectors. Promote to a registry (`connectorWorkflowRegistry: Record<slug, WorkflowComponent>`) once the third connector lands. For two, keep it explicit.

---

## End-to-end verification gate

After Slices 1-8 land, run the full user flow in a browser against local dev:

1. `npm run dev` (web on :3000, api on :3001).
2. Sign in as a user. Navigate to the Connectors view.
3. Click **Connect** on the Google Sheets card. Workflow dialog opens at the AuthorizeStep.
4. Click **Connect Google Sheets**. Popup opens to Google. Consent.
5. Popup closes. AuthorizeStep shows your email. Stepper advances to SelectSheetStep.
6. Type to search; pick a spreadsheet. SelectSheetStep advances to RegionDrawingStep with the workbook rendered.
7. Draw a region with an identifier column. **No** rowPosition banner on review step.
8. Back-step, redraw the region without an identifier column. Review step shows the rowPosition banner naming the region. Commit button still works.
9. Click **Commit**. Workflow closes. Connector list now shows a `google-sheets` instance with `accountInfo.identity` chip and "active" status.
10. Open the connector instance detail. Records are present. Plan is committed.

If all 10 checks pass, Phase C is done. Phase D (manual sync) consumes the same persisted `LayoutPlan` rows and `gsheets:wb:{id}` cache keys.

---

## Out of scope for Phase C

- **Manual sync** (Phase D) — including the `synced_at` watermark reconciliation and the rowPosition-identity guard at sync time.
- **Reconnect / `invalid_grant` recovery flow** (Phase E). When a user's refresh token is revoked, the access-token cache will mark the instance `status="error"` (Phase B Slice 3 behavior). Phase C does **not** add the "Reconnect" button — the user sees the error status; surfacing the reconnect-without-losing-records flow is its own UX work.
- **Multi-account chip styling** beyond what the existing connector card already does. Phase A added `accountInfo.identity` to the response shape; the card chip just renders `identity ?? "Connected"`. Anything richer is Phase E.
- **Numeric-bounds input on RegionEditor for very large sheets** (Open Question #2 in discovery). Out of scope; if a tester hits this it becomes a Phase D/E item.
- **Server changes**. Phase A/B already shipped every endpoint Phase C needs.

## Risks specific to Phase C

- **`identityStrategy` may not currently appear in the interpret response.** Slice 6's banner depends on it. Verify before starting Slice 6; if missing, the slice grows to add it to `LayoutPlanInterpretDraftResponsePayload` and the interpret service's serializer. Discovery claimed it's already on the persisted plan — same data should flow on interpret.
- **OAuth popup blockers.** Some browsers block popups from non-user-initiated `window.open`. The `start()` call must run **synchronously** in the click handler (no awaiting before `window.open`). Slice 2 needs an explicit test that the open call is synchronous from the click.
- **PostMessage cross-origin headers.** The callback HTML's `postMessage(payload, "*")` was Phase A's deliberate choice (no secrets in the payload). Slice 2's hook tightens the receive side to a specific origin. If `import.meta.env.VITE_API_BASE_URL` isn't set in any env this hook runs against tests, default to a known dev origin and document. Dev-mode `*` allowlist is acceptable for local-only.
- **Spreadsheet permission boundary.** A user can list every Drive spreadsheet they have read access to (even ones owned by other people). On select-sheet the API call may 403 if the file is shared but with `commenter` rather than `viewer` scope (Drive nuance). Test with a shared sheet to confirm; if it 403s, the SelectSheetStep should surface a clear error rather than a generic "fetch failed" — flag for handling in Slice 4 if it appears.
- **Workflow back-button + cache TTL.** `gsheets:wb:{id}` has a 1-hour TTL. If a user lands on RegionDrawing then walks away for >1h before committing, the cache is gone and slice fetches 404. Two options: (a) extend TTL for active workflows, (b) re-call `selectSheet` on RegionDrawing-mount when the cache miss surfaces. Plan: (b) — rebuild from source rather than over-extending Redis lifetime. Implement in Slice 7's container.
