# Spreadsheet Parsing — Frontend Implementation Plan (FileUploadConnector)

Step-by-step, TDD-driven plan to rewire `apps/web/src/workflows/FileUploadConnector/` to embed the shared `apps/web/src/modules/RegionEditor/` module per **`SPREADSHEET_PARSING.frontend.spec.md` §Mode A**. The plan ships pure-UI components only; real API wiring is deferred and left as a follow-up with explicit TODO anchors.

## Scope

Mode A only. We rebuild the `FileUploadConnector` workflow with three visible stages:

1. **Upload** — keep and simplify the existing step.
2. **Region drawing** — wrap `RegionDrawingStepUI`.
3. **Review & commit** — wrap `ReviewStepUI`, ending in a commit action.

Everything is renderable in Storybook via fixtures and fake async callbacks.

## Non-goals

- Backend implementation (see `SPREADSHEET_PARSING.backend.spec.md`).
- Mode B connectors (`GoogleSheetsConnector`, `ExcelOnlineConnector`).
- `DriftBannerUI` / drift affordances (not needed for Mode A).
- Real SDK wiring for `parse` / `interpret` / `commit` — stubbed with callbacks; see Phase 6.
- The legacy CSV entity / column-mapping steps — deleted.

## Source of truth

- `docs/SPREADSHEET_PARSING.frontend.spec.md` (authoritative UX spec)
- `docs/SPREADSHEET_PARSING.architecture.spec.md` (domain model)
- `docs/SPREADSHEET_PARSING.backend.spec.md` (payload shapes)
- `apps/web/src/modules/RegionEditor/index.ts` (public surface we embed)
- `CLAUDE.md` §Workflow Module Pattern, §Component File Policy, §Form & Dialog Pattern, §Mutation Cache Invalidation

## Target folder layout (post-plan)

```
apps/web/src/workflows/FileUploadConnector/
  index.ts
  FileUploadConnectorWorkflow.component.tsx   # container + pure UI
  UploadStep.component.tsx                    # simplified; pure UI
  FileUploadRegionDrawingStep.component.tsx   # thin wrapper; pure UI
  FileUploadReviewStep.component.tsx          # thin wrapper; pure UI
  SampleFiles.component.tsx                   # unchanged
  utils/
    file-upload-workflow.util.ts              # rewritten state hook (pure, UI-only)
    file-upload-fixtures.util.ts              # new — reused by stories + tests
  __tests__/
    UploadStep.test.tsx
    FileUploadRegionDrawingStep.test.tsx
    FileUploadReviewStep.test.tsx
    FileUploadConnectorWorkflow.test.tsx
    file-upload-workflow.util.test.ts
    file-upload-fixtures.util.test.ts
  stories/
    FileUploadConnectorWorkflow.stories.tsx   # re-authored
    UploadStep.stories.tsx                    # new
    FileUploadRegionDrawingStep.stories.tsx   # new
    FileUploadReviewStep.stories.tsx          # new
    SampleFiles.stories.tsx                   # unchanged
```

Deleted: `EntityStep.component.tsx`, `ColumnMappingStep.component.tsx`, legacy `ReviewStep.component.tsx`, `file-upload-validation.util.ts`, and their tests/stories.

## TDD rhythm

Every phase follows the same cycle — and **no phase finishes until all four states are green**:

1. **Red** — write the failing test(s) first. Tests render the pure `*UI` component or invoke the util directly; no SDK mocks, no router, no providers.
2. **Green** — smallest implementation that makes the tests pass.
3. **Refactor** — tighten types, extract shared helpers, clean naming.
4. **Storybook** — add/update the story once the component compiles and tests pass.

Run after each phase:

```bash
npm run type-check
npm --workspace apps/web run test:unit -- --testPathPattern="FileUploadConnector|file-upload"
```

(per the `use npm test scripts` feedback memory — never invoke jest directly).

---

## Phase 0 — Fixtures and legacy cleanup prep

**Goal**: have a stable fixture set the rest of the plan can rely on; mark legacy files for deletion (do not delete yet).

### 0.1 Red — `utils/file-upload-fixtures.util.test.ts`

Assertions:
- `DEMO_WORKBOOK` imports and matches `Workbook` from `@/modules/RegionEditor`.
- `ENTITY_OPTIONS` is a non-empty `EntityOption[]`.
- `SAMPLE_REGIONS` contains at least one valid `RegionDraft` with a bound entity; `validateRegions(SAMPLE_REGIONS)` returns an empty error map.
- `POST_INTERPRET_REGIONS` has `columnBindings` with mixed confidences (one green, one yellow) so the review stories can exercise bands.
- `SAMPLE_FILE` is a `File` instance with the expected name and MIME type.

### 0.2 Green — `utils/file-upload-fixtures.util.ts`

Re-export `DEMO_WORKBOOK` / `ENTITY_OPTIONS` from `modules/RegionEditor/stories/utils/region-editor-fixtures.util.ts` (do not duplicate), plus:

- `SAMPLE_FILE: File` — a 1-sheet dummy File for the upload step.
- `IDLE_STATE`, `UPLOADING_STATE`, `PARSED_STATE`, `DRAWING_STATE`, `REVIEW_STATE` — snapshots typed as the hook return from Phase 4.
- `SAMPLE_REGIONS: RegionDraft[]` — at least one valid per orientation to cover Drawing-step story variants.
- `POST_INTERPRET_REGIONS: RegionDraft[]` — includes `columnBindings`, `warnings`, `confidence`, `overallConfidence` for Review-step stories.

### 0.3 Legacy cleanup marker

Add a top-of-file banner comment to each legacy file (`EntityStep`, `ColumnMappingStep`, legacy `ReviewStep`, `file-upload-validation.util.ts`) noting they are scheduled for removal in Phase 5. Do **not** delete until Phase 5 proves the replacement flow is green — premature deletion risks breaking the workflow container mid-phase.

---

## Phase 1 — UploadStep refactor (pure UI)

**Goal**: keep the file-pick + progress UI, drop CSV-specific copy, expose a clean prop contract.

### 1.1 Red — `__tests__/UploadStep.test.tsx`

- Renders the drop zone and accepts `.xlsx`, `.xls`, `.ods`, `.csv`, `.tsv`.
- Shows an empty state when `files.length === 0`.
- Lists the files + `FileUploadProgress` rows when files are present.
- Calls `onFilesChange` on file-select; blocks duplicate filenames.
- Disables the drop zone + "Upload" affordance when `uploadPhase === "uploading"` or `"parsing"`.
- Renders `<FormAlert serverError={...} />` when `serverError` is set; does not render it otherwise.
- File-picker input carries `aria-invalid="true"` when `errors.files` is set.

### 1.2 Green — `UploadStep.component.tsx`

- Strip the copy of CSV-specific language; generic "spreadsheet" messaging.
- Props reduced to: `files`, `onFilesChange`, `uploadPhase`, `fileProgress`, `overallUploadPercent`, `serverError`, `errors`, `onRetry?`.
- Keep the file-progress presentation; remove the CSV-specific parse-job panel (the new flow parses server-side into a `Workbook` and transitions straight to step 1).
- Pure UI only. No SDK imports.

### 1.3 Refactor

- Pull the accepted-extensions list into a `const SPREADSHEET_FILE_EXTENSIONS` exported from `utils/file-upload-fixtures.util.ts` (shared between component + validator).

### 1.4 Storybook — `stories/UploadStep.stories.tsx`

Variants: `Idle`, `OneFileSelected`, `Uploading` (progress), `Parsing`, `ErrorState` (server error).

---

## Phase 2 — Region drawing step wrapper

**Goal**: a thin consumer-specific wrapper around `RegionDrawingStepUI` that adds workflow-level chrome (server-error alert) and nothing else. Per the Component File Policy, this file exports a single pure UI component.

### 2.1 Red — `__tests__/FileUploadRegionDrawingStep.test.tsx`

- Renders `RegionDrawingStepUI` seeded with `workbook`, `regions`, `entityOptions`, `selectedRegionId`, `activeSheetId`.
- Forwards `onRegionDraft`, `onRegionUpdate`, `onRegionDelete`, `onSelectRegion`, `onActiveSheetChange`, `onCreateEntity` unchanged.
- Calls `onInterpret` when the inner step fires it (via the `Interpret` button).
- `isInterpreting` prop disables Interpret (asserted via `aria-disabled` / `disabled`).
- Renders `<FormAlert serverError={...} />` above the canvas when `serverError` is provided.
- Renders no alert when `serverError === null`.
- Propagates `errors` (validation errors keyed by region id) into the inner step.

### 2.2 Green — `FileUploadRegionDrawingStep.component.tsx`

- Single-component file. Exports `FileUploadRegionDrawingStepUI` + `FileUploadRegionDrawingStepUIProps`.
- Renders `FormAlert` + `RegionDrawingStepUI` inside a `Stack`.
- Forwards every RegionEditor prop by passthrough. No hooks.

### 2.3 Storybook — `stories/FileUploadRegionDrawingStep.stories.tsx`

Variants:
- `Empty` — just-parsed workbook, no regions.
- `OneRegion_Valid` — one bound region; Interpret enabled.
- `MultipleRegions_MergedEntity` — two regions bound to the same entity (shows merge banner).
- `InvalidRegion_AttemptedInterpret` — invalid region with `errors` prop; banner visible after simulated Interpret click.
- `ServerError` — uploads the `serverError` prop.

Each story passes `fn()` handlers so Storybook's Actions panel captures interactions.

---

## Phase 3 — Review step wrapper

**Goal**: thin wrapper around `ReviewStepUI` that adds `<FormAlert>` and nothing else.

### 3.1 Red — `__tests__/FileUploadReviewStep.test.tsx`

- Renders `ReviewStepUI` with `regions`, `overallConfidence`, `commitDisabledReason`.
- `onBack` fires when the Back button is clicked.
- `onCommit` fires when the Commit button is clicked.
- Commit button is disabled when `isCommitting` is true or `commitDisabledReason` is non-null.
- Commit button is disabled when any region has a `blocker` warning (derived inside `ReviewStepUI`, but asserted here to lock the behaviour in).
- `onJumpToRegion(regionId)` fires when a region card's jump affordance is clicked.
- `onEditBinding(regionId, sourceLocator)` fires when a binding chip is clicked.
- Renders `<FormAlert serverError={...} />` above the commit actions when `serverError` is set.

### 3.2 Green — `FileUploadReviewStep.component.tsx`

- Single-component file exporting `FileUploadReviewStepUI` + props.
- Renders `Stack` of `FormAlert` + `ReviewStepUI`.
- Pure passthrough.

### 3.3 Storybook — `stories/FileUploadReviewStep.stories.tsx`

Variants: `AllGreen`, `MixedConfidence`, `BlockerPresent` (commit disabled), `Committing` (spinner), `ServerError`.

---

## Phase 4 — `useFileUploadWorkflow` hook (pure state machine)

**Goal**: one hook owns all workflow state; it is pure in the sense that every async boundary is an injectable callback, so the Storybook harness can drive the flow with fakes and the future container swaps real SDK hooks in with no shape change.

### 4.1 Red — `utils/file-upload-workflow.util.test.ts`

Harness: a thin `TestHarness` component that consumes the hook and exposes its state + callbacks via `data-testid` nodes + buttons. All async injections are jest `fn()` stubs returning pre-fabricated payloads.

Assertions:
- Initial state — `step: 0`, `files: []`, `workbook: null`, `regions: []`, `overallConfidence: undefined`, `serverError: null`.
- `addFiles([f])` sets `files` and leaves `step` at 0.
- `startParse()` sets `uploadPhase: "uploading" → "parsing" → "parsed"`, calls the injected `parseFile` stub with the files, stores the returned `Workbook`, and auto-advances to `step: 1`.
- `startParse()` on failure sets `serverError` to the error's ServerError shape, stays at `step: 0`.
- `onRegionDraft(...)` appends a `RegionDraft` with a fresh id; newly drafted region becomes `selectedRegionId`.
- `onRegionUpdate(id, patch)` merges the patch; missing id is a no-op.
- `onRegionDelete(id)` removes and clears selection if the deleted id was selected.
- `onInterpret()` blocks when `regions.length === 0` (no callback fired).
- `onInterpret()` calls the injected `runInterpret` stub with `regions`, replaces local regions with the returned plan's (containing `columnBindings`/`warnings`/`confidence`), sets `overallConfidence`, advances to `step: 2`.
- `onInterpret()` failure sets `serverError` and stays at `step: 1`.
- `goBack()` from step 2 decrements to step 1, preserving regions.
- `goBack()` from step 1 decrements to step 0, preserving parsed `workbook`.
- `onCommit()` calls the injected `runCommit` stub, on success fires `onCommitSuccess` callback (exposed to the container for navigation + cache invalidation).
- `reset()` returns to initial state.

### 4.2 Green — `utils/file-upload-workflow.util.ts`

Replace the legacy hook. Key shapes:

```ts
export const WORKFLOW_STEPS: StepConfig[] = [
  { label: "Upload", description: "Select a spreadsheet" },
  { label: "Draw regions", description: "Outline records on each sheet" },
  { label: "Review", description: "Confirm bindings and commit" },
];

export interface FileUploadWorkflowCallbacks {
  parseFile: (files: File[]) => Promise<Workbook>;
  runInterpret: (regions: RegionDraft[]) => Promise<{
    regions: RegionDraft[];
    overallConfidence: number;
  }>;
  runCommit: (regions: RegionDraft[]) => Promise<{ connectorInstanceId: string }>;
  onCommitSuccess?: (connectorInstanceId: string) => void;
}

export interface UseFileUploadWorkflowReturn {
  step: 0 | 1 | 2;
  files: File[];
  uploadPhase: "idle" | "uploading" | "parsing" | "parsed" | "error";
  workbook: Workbook | null;
  regions: RegionDraft[];
  selectedRegionId: string | null;
  activeSheetId: string | null;
  overallConfidence?: number;
  serverError: ServerError | null;
  isInterpreting: boolean;
  isCommitting: boolean;

  addFiles: (files: File[]) => void;
  removeFile: (filename: string) => void;
  startParse: () => Promise<void>;
  onActiveSheetChange: (sheetId: string) => void;
  onSelectRegion: (regionId: string | null) => void;
  onRegionDraft: (draft: { sheetId: string; bounds: CellBounds }) => void;
  onRegionUpdate: (regionId: string, updates: Partial<RegionDraft>) => void;
  onRegionDelete: (regionId: string) => void;
  onInterpret: () => Promise<void>;
  onCommit: () => Promise<void>;
  goBack: () => void;
  reset: () => void;
}

export function useFileUploadWorkflow(
  cb: FileUploadWorkflowCallbacks
): UseFileUploadWorkflowReturn { /* ... */ }
```

Implementation notes:
- Region-id minting: ``${sheetId}-r${nanoid(6)}`` via `nanoid` (already a dep).
- `serverError` conversion uses `toServerError(e)` from `utils/api.util.ts`.
- Auto-advance after parse is intentional — matches the spec's "Entry: user uploads a file … 2. RegionDrawingStep" copy; users never need to click Next from Upload once parse succeeds.
- Hook does **not** call TanStack Query directly; the container (Phase 5) wraps real `sdk.*` mutations and passes them into the hook.

### 4.3 Refactor

- Extract the region-draft insertion + id minting into a pure helper the test can cover directly.
- Ensure re-entering `reset()` while an in-flight Promise is pending cancels its effect (ignore stale resolution).

---

## Phase 5 — `FileUploadConnectorWorkflow` container + UI

**Goal**: wire the three step wrappers together behind a single Modal, fed by `useFileUploadWorkflow`. UI is pure and Storybook-drivable; container injects faked async callbacks for now.

### 5.1 Red — `__tests__/FileUploadConnectorWorkflow.test.tsx`

All tests render `FileUploadConnectorWorkflowUI` (the pure component) with explicit props.

- Renders the Modal when `open={true}`; does not render when `open={false}`.
- Step 0 renders `UploadStep`; step 1 renders `FileUploadRegionDrawingStep` with `workbook`; step 2 renders `FileUploadReviewStep`.
- The stepper nav: Back button on step 0 fires `onClose`; on step ≥ 1 fires `onBack`. Next button on step 0 fires `onStartParse` (label: "Upload"); on step 1 fires `onInterpret` (label: "Interpret"); step 2 has no global Next (Review step owns its own Commit button).
- `isInterpreting` / `isCommitting` disable the appropriate actions.
- `serverError` flows into the active step's wrapper.

### 5.2 Green — `FileUploadConnectorWorkflow.component.tsx`

Structure:

```tsx
export interface FileUploadConnectorWorkflowUIProps {
  open: boolean;
  onClose: () => void;
  step: 0 | 1 | 2;
  stepConfigs: StepConfig[];

  // Upload
  files: File[];
  onFilesChange: (files: File[]) => void;
  uploadPhase: UploadPhase;
  fileProgress: Map<string, FileUploadProgress>;
  overallUploadPercent: number;

  // Region drawing
  workbook: Workbook | null;
  regions: RegionDraft[];
  selectedRegionId: string | null;
  activeSheetId: string | null;
  entityOptions: EntityOption[];
  onActiveSheetChange: (sheetId: string) => void;
  onSelectRegion: (regionId: string | null) => void;
  onRegionDraft: (draft: { sheetId: string; bounds: CellBounds }) => void;
  onRegionUpdate: (regionId: string, updates: Partial<RegionDraft>) => void;
  onRegionDelete: (regionId: string) => void;
  onCreateEntity?: (key: string, label: string) => string;

  // Review
  overallConfidence?: number;
  onJumpToRegion: (regionId: string) => void;
  onEditBinding: (regionId: string, sourceLocator: string) => void;

  // Nav
  onStartParse: () => void;
  onInterpret: () => void;
  onCommit: () => void;
  onBack: () => void;

  // Status
  errors?: RegionEditorErrors;
  serverError: ServerError | null;
  isInterpreting: boolean;
  isCommitting: boolean;
}

export const FileUploadConnectorWorkflowUI: React.FC<...>;
export const FileUploadConnectorWorkflow: React.FC<FileUploadConnectorWorkflowProps>;
```

Container body:
- Uses `useFileUploadWorkflow({ parseFile, runInterpret, runCommit })` where each callback is a **temporary stub** that resolves a fixture payload with a small `setTimeout` delay so the real flow is visible in dev. Mark each with a `// TODO(API wiring):` comment naming the SDK method to plug in.
- `entityOptions` comes from a synchronous fixture for now (`ENTITY_OPTIONS`). A TODO points at `sdk.entityDefinitions.list`.
- `onJumpToRegion` switches active sheet + selection via the hook; `onEditBinding` TODOs out until binding edit is implemented.

### 5.3 Storybook — `stories/FileUploadConnectorWorkflow.stories.tsx`

Replace existing stories. Add:

- `Step0_Idle` — modal open, no files.
- `Step0_FilesSelected` — files staged, not yet uploaded.
- `Step0_Uploading` — phase=`"uploading"`, progress > 0.
- `Step1_Empty` — parsed workbook, no regions.
- `Step1_RegionsDrawn_Valid` — bound regions, ready to Interpret.
- `Step1_InvalidRegion` — shows the `role="alert"` invalid-region banner.
- `Step2_AllGreen` — review with high confidence.
- `Step2_BlockerPresent` — commit disabled.
- `Interactive` — full click-through harness using `useFileUploadWorkflow` with fake async callbacks (mirrors `RegionEditor.stories.tsx → Interactive`). On commit, shows a small modal with the final regions + committed payload as pretty-printed JSON. This story is the **primary reviewer demo** for the revised workflow.

---

## Phase 6 — Wire the API to the FileUpload workflow

**Goal**: replace the three stubs in `FileUploadConnectorWorkflow.component.tsx` (`stubParseFile`, `stubRunInterpret`, `stubRunCommit`) with real SDK calls against the backend shipped in `SPREADSHEET_PARSING.backend.plan.md` Phases 5–9. Ship the missing `POST /api/file-uploads/parse` endpoint. Wire cache invalidation per `CLAUDE.md` §Mutation Cache Invalidation. Preserve the container + pure-UI split per `CLAUDE.md` §Component File Policy — **no SDK, TanStack Query, or router calls leak into `FileUploadConnectorWorkflowUI`**. After this phase, `apps/web/src/` contains zero references to `sdk.uploads.*`, closing the frontend side of `FILE_UPLOAD_DEPRECATION.plan.md` Phase 1.

### Source of truth

- `docs/SPREADSHEET_PARSING.backend.spec.md` §"Sync integration with FileUploadConnector" — the contract this phase implements.
- `CLAUDE.md` §Mutation Cache Invalidation — the full invalidation list for a connector-cascade commit.
- `CLAUDE.md` §Form & Dialog Pattern — `serverError` handling via `toServerError()` on every mutation.
- `CLAUDE.md` §Component File Policy — the container stays in the same file as the UI component; all new async wiring lives in the container half.

### Scope boundary

This phase wires the **happy path** plus the existing 409-drift gate documented in the backend spec. It does **not** add:

- Binding-edit via `PATCH /api/connector-instances/:id/layout-plan/:planId` — still a TODO on `onEditBinding`.
- A dedicated presign/S3 round-trip for very large workbooks — inline multipart is acceptable for the file sizes already gated by the backend Phase 1 adapters.
- A replay-only "re-sync against the stored plan" flow — the workflow always interprets, per Mode A.
- Staged entities — `useFileUploadWorkflow` can track them but the backend does not yet accept them; this is explicitly deferred in §Risks.

### TDD rhythm

Every sub-phase follows red → green → refactor → Swagger (where a route changes) → Storybook (where UI changes are visible). Commands after each sub-phase:

```bash
npm run type-check
npm --workspace apps/api run test:unit
npm --workspace apps/api run test:integration
npm --workspace apps/web run test:unit
```

### Ordered sub-phases

Each sub-phase is independently reviewable. They land in this order because later sub-phases depend on the SDK surface and contracts shipped by the earlier ones.

---

### 6.0 — Contracts: `file-uploads.contract.ts`

**Goal**: canonical Zod schemas for the new parse endpoint's request/response live in `@portalai/core/contracts` so API + web share one validation site.

#### 6.0.1 Red — `packages/core/src/__tests__/contracts/file-uploads.contract.test.ts`

- `FileUploadParseResponsePayloadSchema.safeParse({ workbook: { sheets: [{...}] } })` succeeds for a minimal `Workbook`.
- Missing `workbook` → fails.
- `workbook.sheets` empty → fails (reuses the parser's `WorkbookSchema.min(1)`).
- Re-exported from `packages/core/src/contracts/index.ts`.

#### 6.0.2 Green — `packages/core/src/contracts/file-uploads.contract.ts`

```ts
export const FileUploadParseResponsePayloadSchema = z.object({
  workbook: WorkbookSchema,
});
export type FileUploadParseResponsePayload = z.infer<
  typeof FileUploadParseResponsePayloadSchema
>;
```

Re-export from the barrel. No request-body schema — the parse endpoint takes a multipart `file` field, which the router enforces outside Zod.

#### 6.0.3 Refactor

None expected. Schema is one line.

---

### 6.1 — Backend: `POST /api/file-uploads/parse`

**Goal**: a server-side endpoint that accepts a multipart-uploaded CSV/XLSX and returns the adapted `Workbook`. Reuses the existing `apps/api/src/services/workbook-adapters/*` module shipped by backend-plan Phase 1.

#### 6.1.1 Red — `apps/api/src/__tests__/__integration__/routes/file-uploads.router.integration.test.ts`

- `POST /api/file-uploads/parse` with a multipart `file` field carrying a small CSV → 200, `body.payload.workbook.sheets.length === 1`, cells match fixture.
- XLSX fixture with two sheets → 200, `sheets.length === 2`, names match.
- Empty file → 400 with `ApiCode.FILE_UPLOAD_PARSE_EMPTY`.
- Unsupported extension (e.g. `.pdf`) → 400 with `ApiCode.FILE_UPLOAD_PARSE_UNSUPPORTED`.
- File exceeding `FILE_UPLOAD_PARSE_MAX_BYTES` (default 25 MB) → 413 with `ApiCode.FILE_UPLOAD_PARSE_TOO_LARGE`.
- No file field → 400 with `ApiCode.FILE_UPLOAD_PARSE_INVALID_PAYLOAD`.
- Non-UTF-8 CSV (Latin-1) → 200, cells decoded per the adapter's chardet fallback.
- Missing bearer token → 401 (auth middleware already runs).
- Response validates against `FileUploadParseResponsePayloadSchema`.

#### 6.1.2 Green

1. Add `ApiCode` entries: `FILE_UPLOAD_PARSE_EMPTY`, `FILE_UPLOAD_PARSE_UNSUPPORTED`, `FILE_UPLOAD_PARSE_TOO_LARGE`, `FILE_UPLOAD_PARSE_INVALID_PAYLOAD`, `FILE_UPLOAD_PARSE_FAILED`.
2. Add `environment.FILE_UPLOAD_PARSE_MAX_BYTES` (default `25 * 1024 * 1024`).
3. Install/configure `multer` as multipart middleware if not already present (check existing `app.ts`; the legacy path used presigned S3 so multer may be absent — add it under `express.Router()`-level middleware scoped to this route only, memory storage, size cap).
4. New router `apps/api/src/routes/file-uploads.router.ts` with the single handler:
   - Resolves the adapter by file extension (`.csv`, `.tsv`, `.xlsx`, `.xls`).
   - Streams the buffered upload into the adapter, awaits `WorkbookData`.
   - Validates the result against `WorkbookSchema` before returning.
   - Returns `{ workbook }`.
5. Mount under `/api/file-uploads` in `apps/api/src/app.ts`, behind `jwtCheck` + `getApplicationMetadata` (org scoping is cosmetic for this endpoint — parse is stateless — but consistency with the rest of `/api/*` matters for audit logs).
6. New service `apps/api/src/services/file-upload-parse.service.ts` wraps the adapter dispatch so the router stays thin, matching §API Style Guide.

#### 6.1.3 Refactor

- Consolidate the extension-dispatch table with backend-plan Phase 1's inline check, if one exists.
- Log `file.size`, `file.mimetype`, `durationMs`, `sheetCount` as a structured line on success.

#### 6.1.4 Swagger

Add an `@openapi` JSDoc block above the handler. `requestBody` uses `multipart/form-data` with the `file` field; `responses.200` references `#/components/schemas/FileUploadParseResponsePayload`. Register the schema in `apps/api/src/config/swagger.config.ts` via `z.toJSONSchema(FileUploadParseResponsePayloadSchema, { unrepresentable: "any" })`. Extend the swagger round-trip test to include the new schema name.

---

### 6.2 — Frontend SDK surfaces + query keys

**Goal**: two new API modules — `file-uploads.api.ts` and `connector-instance-layout-plans.api.ts` — expose the hooks the container will consume. Query keys live in `apps/web/src/api/keys.ts`.

#### 6.2.1 Red — `apps/web/src/__tests__/api/connector-instance-layout-plans.api.test.tsx`

Render a small harness component that exercises each hook with mocked `useAuthFetch`/`useAuthMutation`. Assert:

- `sdk.connectorInstanceLayoutPlans.interpret(connectorInstanceId)` mutates against `POST /api/connector-instances/:id/layout-plan/interpret` and sends the `InterpretRequestBody` payload unchanged.
- `sdk.connectorInstanceLayoutPlans.getCurrent(connectorInstanceId, options)` queries `GET /api/connector-instances/:id/layout-plan` and threads the `?include=` query string through `buildUrl`.
- `sdk.connectorInstanceLayoutPlans.patch(connectorInstanceId, planId)` mutates `PATCH /api/connector-instances/:id/layout-plan/:planId`.
- `sdk.connectorInstanceLayoutPlans.commit(connectorInstanceId, planId)` mutates `POST /api/connector-instances/:id/layout-plan/:planId/commit` with the `CommitLayoutPlanRequestBody` payload.
- `sdk.fileUploads.parse()` mutates `POST /api/file-uploads/parse` with `FormData` carrying the `file` field; `Content-Type` is **not** hand-set (browser sets the boundary).

Also assert query keys:

- `queryKeys.connectorInstanceLayoutPlans.root` equals `["connectorInstanceLayoutPlans"]`.
- `queryKeys.connectorInstanceLayoutPlans.detail(id)` equals `["connectorInstanceLayoutPlans", "detail", id]`.
- `queryKeys.fileUploads.root` equals `["fileUploads"]`. (No `list` or `get` — parse is a mutation; no cached reads.)

#### 6.2.2 Green

1. `apps/web/src/api/connector-instance-layout-plans.api.ts`:
   ```ts
   export const connectorInstanceLayoutPlans = {
     interpret: (connectorInstanceId: string) =>
       useAuthMutation<InterpretResponsePayload, InterpretRequestBody>({
         url: `/api/connector-instances/${encodeURIComponent(connectorInstanceId)}/layout-plan/interpret`,
       }),
     getCurrent: (
       connectorInstanceId: string,
       params?: { include?: string },
       options?: QueryOptions<LayoutPlanResponsePayload>,
     ) =>
       useAuthQuery<LayoutPlanResponsePayload>(
         queryKeys.connectorInstanceLayoutPlans.detail(connectorInstanceId),
         buildUrl(`/api/connector-instances/${encodeURIComponent(connectorInstanceId)}/layout-plan`, params),
         undefined,
         options,
       ),
     patch: (connectorInstanceId: string, planId: string) =>
       useAuthMutation<LayoutPlanResponsePayload, PatchLayoutPlanBody>({
         url: `/api/connector-instances/${encodeURIComponent(connectorInstanceId)}/layout-plan/${encodeURIComponent(planId)}`,
         method: "PATCH",
       }),
     commit: (connectorInstanceId: string, planId: string) =>
       useAuthMutation<LayoutPlanCommitResult, CommitLayoutPlanRequestBody>({
         url: `/api/connector-instances/${encodeURIComponent(connectorInstanceId)}/layout-plan/${encodeURIComponent(planId)}/commit`,
       }),
   };
   ```
2. `apps/web/src/api/file-uploads.api.ts`:
   ```ts
   export const fileUploads = {
     parse: () =>
       useAuthMutation<FileUploadParseResponsePayload, File>({
         url: "/api/file-uploads/parse",
         body: (file) => {
           const fd = new FormData();
           fd.append("file", file);
           return fd;
         },
       }),
   };
   ```
3. Extend `api/keys.ts`:
   ```ts
   connectorInstanceLayoutPlans: {
     root: ["connectorInstanceLayoutPlans"] as const,
     detail: (connectorInstanceId: string) =>
       [...queryKeys.connectorInstanceLayoutPlans.root, "detail", connectorInstanceId] as const,
   },
   fileUploads: {
     root: ["fileUploads"] as const,
   },
   ```
4. Re-export both modules from `api/sdk.ts`:
   ```ts
   export const sdk = { ..., connectorInstanceLayoutPlans, fileUploads };
   ```
5. **Do not** touch `api/uploads.api.ts` yet — its removal is §6.8.

#### 6.2.3 Refactor

- Confirm `useAuthMutation` supports a `body:` mapper returning `FormData`. If it doesn't, widen the type before shipping (`body` can already return `unknown`; confirm the fetch path forwards `FormData` without JSON-stringifying). Adjust `api.util.ts` if needed and unit-test the `FormData` branch.

---

### 6.3 — Mapping helpers: `RegionDraft ↔ RegionHint`, plan → region drafts

**Goal**: two pure functions convert the frontend `RegionDraft[]` into backend `RegionHint[]` input, and the backend `LayoutPlan.regions` back into `RegionDraft[]` the review step renders. Isolated from the hook so tests can exercise them directly.

#### 6.3.1 Red — `utils/layout-plan-mapping.util.test.ts`

- `regionDraftsToHints(workbook, drafts)`:
  - Returns `[]` for empty drafts.
  - Maps `sheetId` (frontend stable id) to backend `sheet` (sheet name) via the workbook.
  - Only includes drafts with `targetEntityDefinitionId !== null`; drops unbound drafts silently (they are tracked separately; see §Risks).
  - Forwards optional `recordsAxisName`, `secondaryRecordsAxisName`, `cellValueName`, `axisAnchorCell`, `proposedLabel` unchanged.
  - Throws on malformed bounds (covers a defensive check — surface as caller error).
- `planRegionsToDrafts(plan, workbook)`:
  - Length matches `plan.regions.length`.
  - Each output has `id` stable-hashed from `(sheet, startRow, startCol, endRow, endCol)` so drafts survive round-trips without regenerating react-keys.
  - Copies `columnBindings`, `warnings`, `confidence` through unchanged.
  - Maps `plan.region.sheet` (name) back to `sheetId` via the workbook.
- `overallConfidenceFromPlan(plan)` returns `plan.confidence.overall`.

#### 6.3.2 Green — `utils/layout-plan-mapping.util.ts`

Three exported pure functions. No hooks, no SDK, no React.

#### 6.3.3 Refactor

- Move sheet-id ↔ sheet-name lookup into a single `SheetIndex` type computed once per workbook; both mappers share it.

---

### 6.4 — Connector-instance bootstrap

**Goal**: the workflow currently receives `{ organizationId, connectorDefinitionId }` but never creates the `ConnectorInstance` those IDs are meant to scope. Interpret + commit both require a `:connectorInstanceId` path segment. We create it lazily — **after** parse succeeds, **before** the first interpret call — using a name derived from the uploaded filename.

#### 6.4.1 Red — `utils/file-upload-workflow.util.test.ts` (additions)

Extend the existing test harness:

- `startParse()` success path no longer auto-advances to step 1 until `ensureConnectorInstance()` resolves; the injected `createConnectorInstance` stub is called once with `{ organizationId, connectorDefinitionId, name: string }` where `name` falls back to `files[0]?.name ?? "Upload"` after stripping the extension.
- If `createConnectorInstance` rejects, `serverError` is set and `step` stays at 0.
- Once set, `connectorInstanceId` is exposed on the hook return and is **not** recomputed on subsequent `onInterpret` calls (idempotent re-interpret in the same session reuses the same instance).
- `reset()` clears `connectorInstanceId`.

#### 6.4.2 Green — hook additions

- Extend `FileUploadWorkflowCallbacks`:
  ```ts
  createConnectorInstance: (args: {
    organizationId: string;
    connectorDefinitionId: string;
    name: string;
  }) => Promise<{ connectorInstanceId: string }>;
  ```
- Extend state: `connectorInstanceId: string | null`, `planId: string | null`.
- Reshape `startParse`: parse → `createConnectorInstance` → advance. On either failure, set `serverError` and stay.
- The container (§6.5) injects `createConnectorInstance` as `sdk.connectorInstances.create()` wrapped to narrow the response.

#### 6.4.3 Refactor

- Consider whether to split `ensureConnectorInstance` into its own callback so a re-analyze flow can call it without re-parsing. For this phase, keep it inlined in `startParse`; surface the extraction as a TODO for the backend-plan's follow-up re-sync work.

---

### 6.5 — Replace the three stubs

**Goal**: the container wires real SDK mutations into `useFileUploadWorkflow`. All work lives below `FileUploadConnectorWorkflowUI`'s import line; the UI component props do not change.

#### 6.5.1 Red — `__tests__/FileUploadConnectorWorkflow.container.test.tsx`

A new container-level test (integration-style, still pure-render). Mocks the SDK modules via `jest.unstable_mockModule` per the `use npm test scripts` memory. Each test renders `<FileUploadConnectorWorkflow />` (the container) inside a real `QueryClientProvider`.

- **Parse**: selects a file and clicks Upload → `sdk.fileUploads.parse` is called with the `File`; on resolve, the workflow advances to step 1 and the returned `workbook.sheets` render in the RegionEditor.
- **Connector-instance create**: parse success → `sdk.connectorInstances.create` is called once with `{ organizationId, connectorDefinitionId, name }` and the `connectorInstanceId` is stored.
- **Interpret**: clicks Interpret → `sdk.connectorInstanceLayoutPlans.interpret(connectorInstanceId)` is called with `{ workbook, regionHints }` produced by `regionDraftsToHints`. Response's `plan` and `planId` land in state; the review step shows mapped regions.
- **Commit**: clicks Commit → `sdk.connectorInstanceLayoutPlans.commit(connectorInstanceId, planId)` is called with `{ workbook }`. On 200, `onCommitSuccess` fires with `connectorInstanceId` and all cascade keys are invalidated (`jest.spyOn(queryClient, "invalidateQueries")` asserts each call).
- **Server errors**: each mutation's `.error` surfaces through `toServerError()` into `serverError`; `<FormAlert>` in the active step wrapper renders it.
- **409 drift**: commit's `.error` with `code: "LAYOUT_PLAN_DRIFT_*"` renders through the review step's `<FormAlert>`; workflow stays on step 2, commit button re-enabled.

#### 6.5.2 Green — `FileUploadConnectorWorkflow.component.tsx` (container body only)

Replace the three `stub*` functions plus the `callbacks` literal with real mutation hooks. Shape:

```tsx
export const FileUploadConnectorWorkflow: React.FC<
  FileUploadConnectorWorkflowProps
> = ({ open, onClose, organizationId, connectorDefinitionId }) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { mutateAsync: parseMutate } = sdk.fileUploads.parse();
  const { mutateAsync: createInstanceMutate } = sdk.connectorInstances.create();

  // interpret + commit are bound lazily because they take IDs derived at runtime.
  const { fetchWithAuth } = useAuthFetch();

  const parseFile = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file) throw new Error("No file");
    const res = await parseMutate(file);
    return res.payload.workbook;
  }, [parseMutate]);

  const createConnectorInstance = useCallback(
    async (args: { organizationId: string; connectorDefinitionId: string; name: string }) => {
      const res = await createInstanceMutate(args);
      return { connectorInstanceId: res.payload.connectorInstance.id };
    },
    [createInstanceMutate],
  );

  const runInterpret = useCallback(
    async (
      regions: RegionDraft[],
      workbook: Workbook,
      connectorInstanceId: string,
    ) => {
      const body: InterpretRequestBody = {
        workbook: workbookToBackend(workbook),
        regionHints: regionDraftsToHints(workbook, regions),
      };
      const res = await fetchWithAuth<ApiSuccessResponse<InterpretResponsePayload>>(
        `/api/connector-instances/${encodeURIComponent(connectorInstanceId)}/layout-plan/interpret`,
        { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } },
      );
      await queryClient.invalidateQueries({
        queryKey: queryKeys.connectorInstanceLayoutPlans.root,
      });
      return {
        regions: planRegionsToDrafts(res.payload.plan, workbook),
        overallConfidence: overallConfidenceFromPlan(res.payload.plan),
        planId: res.payload.plan.id,
      };
    },
    [fetchWithAuth, queryClient],
  );

  const runCommit = useCallback(
    async (regions: RegionDraft[], workbook: Workbook, ids: { connectorInstanceId: string; planId: string }) => {
      const res = await fetchWithAuth<ApiSuccessResponse<LayoutPlanCommitResult>>(
        `/api/connector-instances/${encodeURIComponent(ids.connectorInstanceId)}/layout-plan/${encodeURIComponent(ids.planId)}/commit`,
        {
          method: "POST",
          body: JSON.stringify({ workbook: workbookToBackend(workbook) }),
          headers: { "Content-Type": "application/json" },
        },
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.connectorInstances.root }),
        queryClient.invalidateQueries({ queryKey: queryKeys.connectorEntities.root }),
        queryClient.invalidateQueries({ queryKey: queryKeys.stations.root }),
        queryClient.invalidateQueries({ queryKey: queryKeys.fieldMappings.root }),
        queryClient.invalidateQueries({ queryKey: queryKeys.portals.root }),
        queryClient.invalidateQueries({ queryKey: queryKeys.portalResults.root }),
        queryClient.invalidateQueries({ queryKey: queryKeys.connectorInstanceLayoutPlans.root }),
      ]);
      return { connectorInstanceId: ids.connectorInstanceId, recordCounts: res.payload.recordCounts };
    },
    [fetchWithAuth, queryClient],
  );

  const callbacks: FileUploadWorkflowCallbacks = {
    parseFile,
    createConnectorInstance,
    runInterpret: (regions) => runInterpret(regions, workflow.workbook!, workflow.connectorInstanceId!),
    runCommit: (regions) =>
      runCommit(regions, workflow.workbook!, {
        connectorInstanceId: workflow.connectorInstanceId!,
        planId: workflow.planId!,
      }),
    onCommitSuccess: (connectorInstanceId) => {
      navigate({ to: "/connectors/$connectorInstanceId", params: { connectorInstanceId } });
      handleClose();
    },
  };
  // ...
};
```

Notes:

- `runInterpret` and `runCommit` are regular async functions — not `useMutation` calls — because the hook already owns the pending/error state and the cascade invalidation is the only React-Query side effect we need. Using `useAuthFetch` directly keeps the callback signature identical to the stub's.
- `workbookToBackend(workbook)` exists because the frontend `Workbook` uses `cells: CellValue[][]` (dense 2-D array) while the backend `WorkbookSchema` expects `cells: WorkbookCell[]` (sparse). Ship the conversion as a fourth pure helper in `layout-plan-mapping.util.ts` — tested in §6.3.
- On a non-2xx response, `fetchWithAuth` throws `ApiError`; the hook's existing `toServerErrorFromUnknown` surfaces it.

#### 6.5.3 Refactor

- Collapse the two inline `fetchWithAuth` call sites into the SDK module if the shape settles — moving them later is cheap.
- Ensure in-flight tokens in the hook (§Phase 4 refactor) still cancel a stale commit response if the user closes the modal mid-flight.

---

### 6.6 — Navigate on commit success

**Goal**: after a successful commit, route the user to `/connectors/:connectorInstanceId` (existing connector detail view) and close the modal. Deleted IDs no longer need the `ci_demo` placeholder.

#### 6.6.1 Red — `__tests__/FileUploadConnectorWorkflow.container.test.tsx` (addition)

- Mock `useNavigate`. On commit 2xx, assert `navigate` is called with `{ to: "/connectors/$connectorInstanceId", params: { connectorInstanceId: "ci_real_123" } }`.
- After navigate, `onClose` runs (ensures the modal isn't left mounted after route change).

#### 6.6.2 Green

Pull `useNavigate` from `@tanstack/react-router` into the container; wire in §6.5's `onCommitSuccess`. No UI component change.

#### 6.6.3 Refactor

- Confirm the route path matches the current route tree in `apps/web/src/routes/`. If the tree uses a different param name (e.g. `$id`), align and update tests.

---

### 6.7 — Error surfacing + UX polish

**Goal**: a single layer converts backend `ApiError` into the `ServerError` shape every step wrapper already renders through `<FormAlert>`. Drift 409s and blocker-warning 409s both render with their codes visible so users see *why* commit was blocked.

#### 6.7.1 Red

Extend `__tests__/FileUploadConnectorWorkflow.container.test.tsx`:

- Parse failure (`ApiError` with `code: "FILE_UPLOAD_PARSE_UNSUPPORTED"`) → `<FormAlert>` in the Upload step renders the message + code. Workflow stays on step 0.
- Interpret failure (`500`) → `<FormAlert>` in the region-drawing step. Workflow stays on step 1.
- Commit failure (`409` with `code: "LAYOUT_PLAN_DRIFT_IDENTITY_CHANGED"` and a `DriftReport` body) → `<FormAlert>` in the review step. Workflow stays on step 2, commit button re-enabled, `isCommitting=false`.
- Commit failure (`409` with `code: "LAYOUT_PLAN_BLOCKER_WARNINGS"`) → same handling as drift; verifies the blocker-warnings gate shipped by backend Phase 9.

#### 6.7.2 Green

The hook already calls `toServerErrorFromUnknown` on every mutation failure — no new code beyond wiring. Verify that `api.util.ts::ApiError` preserves `response.data` (or equivalent) so the Drift report body can be inspected by future binding-edit work; if not, extend `ApiError` to include a `details?: unknown` field. The test covers the extension.

#### 6.7.3 Refactor

- If the DriftReport is useful to display beyond just the code, plumb it into a second prop on `FileUploadReviewStepUI` — **but only if a test drives the need**. Default for this phase: code + message via `<FormAlert>` only.

---

### 6.8 — Cleanup + legacy removal

**Goal**: remove all `TODO(API wiring):` anchors; demote fixtures to Storybook-only; delete the legacy `sdk.uploads` consumer in `apps/web/src/utils/file-upload.util.ts`. This closes `FILE_UPLOAD_DEPRECATION.plan.md` Phase 1 on the frontend side.

#### 6.8.1 Red — `__tests__/file-upload.legacy.audit.test.ts`

- AST scan `apps/web/src/`:
  - No file (except `api/uploads.api.ts` itself) imports from `../api/uploads.api` or references `sdk.uploads`.
  - No file references `useFileUpload` (the legacy `utils/file-upload.util.ts` export).
  - No file in `apps/web/src/workflows/FileUploadConnector/` contains the substring `TODO(API wiring):`.
- Re-runs in CI to prevent regressions.

#### 6.8.2 Green

1. Delete the legacy `useFileUpload` hook and its helpers from `apps/web/src/utils/file-upload.util.ts`. Preserve only the `FileUploadProgress` + `UploadPhase` types; move them into `apps/web/src/workflows/FileUploadConnector/utils/file-upload-workflow.util.ts` as adjacent exports and delete the old file. Per the `no_compat_aliases` memory, do **not** re-export from the old path.
2. Update every consumer of `FileUploadProgress` / `UploadPhase` (the tests, stories, and step components grepped from `apps/web/src/`) to import from the workflow util.
3. Remove the three `stub*` functions and their `DEMO_WORKBOOK` / `POST_INTERPRET_REGIONS` imports from the container. Those fixtures stay in `utils/file-upload-fixtures.util.ts` for Storybook consumption.
4. Delete all `TODO(API wiring):` JSDoc blocks from `FileUploadConnectorWorkflow.component.tsx`.
5. Do **not** delete `apps/web/src/api/uploads.api.ts` yet — it is removed in `FILE_UPLOAD_DEPRECATION.plan.md` Phase 4, after the two-week bake window following the 410-gate. Add a one-line JSDoc banner on `uploads.api.ts` pointing at the deprecation plan (matches the backend-side banner already in place).

#### 6.8.3 Refactor

- Audit Storybook `Interactive` story — if it still uses the stub callbacks, keep it; the story is the reviewer demo and does not ride the real SDK. Inject the same stubs used in the test harness so the story is independent of the network.
- Verify no import cycle has formed between `workflows/FileUploadConnector/utils/*.util.ts` and `modules/RegionEditor/*`.

---

### Exit criteria for Phase 6

- `npm run type-check` — clean.
- `npm --workspace apps/api run test:unit` + `test:integration` — green; the new `file-uploads.router.integration.test.ts` is part of the default suite.
- `npm --workspace apps/web run test:unit` — green; the new container test, mapping util tests, SDK tests, and audit test all pass.
- `npm run storybook` — loads every story; `Interactive` still click-throughs end-to-end via the test-style stubs.
- `GET /api/docs/spec` lists `/api/file-uploads/parse` with the correct multipart request and typed response.
- `grep -r "TODO(API wiring):" apps/web/src/workflows/FileUploadConnector` returns nothing.
- `grep -r "sdk\.uploads\|useFileUpload" apps/web/src/` returns **only** the single intentional line inside `apps/web/src/api/uploads.api.ts` (deferred to deprecation-plan Phase 4).
- Visible in a dev environment: uploading a CSV from the modal routes the user to `/connectors/<id>` with new `ConnectorEntity` rows and records populated.
- Deprecation dashboard query from `FILE_UPLOAD_DEPRECATION.plan.md` §Phase 0 shows the `legacy.uploads.hit` counter at zero for the web app's user-agent — the proof required by deprecation-plan §Phase 2 bake.

### Risks and open questions (Phase 6)

- **Workbook shape mismatch**: frontend vs backend workbook types differ (dense vs sparse cells). The `workbookToBackend` helper resolves this, but adapters on the backend must not double-sparse. Phase 6.3's tests assert the round trip; extend them with a CSV fixture where cells contain legitimate empty strings vs true nulls.
- **Sheet identity across parse and commit**: the frontend mints sheet IDs at parse time and passes them into region drafts; the backend addresses sheets by `name`. If two sheets share a name (possible in malformed XLSX), the mapping is ambiguous. Document as a §backend-spec concern; surface a warning at parse time.
- **Staged entities**: `NewEntityDialogUI` supports `source: "staged"`, but the interpret endpoint does not yet accept a "create-on-interpret" entity definition. Explicit TODO on the container with a link to the backend follow-up; test asserts that staged entities never reach the SDK payload (they sit in local workflow state until resolved).
- **Large-file UX**: the parse endpoint's 25 MB cap means worst-case multipart posts of 25 MB. Retain the existing per-file progress UI but note it will only report the upload leg — server-side parse is atomic and returns a single response.
- **Re-analyze flow**: Mode A per-upload always creates a new `ConnectorInstance`, so re-uploading the same file opens a second instance rather than overwriting. If product wants "update existing instance" semantics later, §6.4 is the extension point.

### Phase 6 sub-phase PR breakdown

| PR | Sub-phases | Depends on |
|---|---|---|
| **6-A** | 6.0 contracts + 6.1 parse endpoint + 6.2 SDK surfaces | backend-plan merged |
| **6-B** | 6.3 mapping helpers + 6.4 connector-instance bootstrap + 6.5 stub replacement + 6.6 navigation + 6.7 error surfacing | 6-A |
| **6-C** | 6.8 cleanup + legacy removal + audit test | 6-B in staging, `legacy.uploads.hit` counter at zero for 1 day |

PR 6-A lands without user-visible behaviour change — the workflow still runs against stubs. PR 6-B is the cutover. PR 6-C deletes the dead imports and wires the audit guard that prevents reintroduction. Each PR ends green on type-check, `test:unit`, `test:integration`, and Storybook.

---

## Exit criteria

- `npm run type-check` — clean across the monorepo.
- `npm --workspace apps/web run test:unit` — green; every new test suite passes; no failing reference to deleted legacy files.
- `npm run storybook` — loads every new story; the `Interactive` story clicks through Upload → Draw → Review → Commit end-to-end.
- `FileUploadConnector/__tests__/FileUploadConnectorWorkflow.test.tsx` asserts step transitions for every step; the Dialog & Form checklist (`CLAUDE.md` §Dialog & Form Test Checklist) is satisfied for each wrapper that hosts a `<FormAlert>`.
- No reference to `EntityStep`, `ColumnMappingStep`, the legacy `ReviewStep`, or `file-upload-validation.util.ts` remains in `apps/web/src`.
- Spec §Mode A is matched 1:1 — three steps, `RegionEditor`-owned draw + review UIs, no forked UI.

## Risks and open questions

- **Parse strategy** (who produces `Workbook`): the current CSV hook parses server-side into `recommendations`. Mode A expects a typed `Workbook` (`SPREADSHEET_PARSING.frontend.spec.md` §Shared editor module). Phase 6 decides — likely server-side `POST /api/file-uploads/parse` returning `Workbook` — but the Phase 4 hook only consumes an injected callback, so either choice lands cleanly.
- **Staged entities**: `NewEntityDialogUI` already supports `source: "staged"`. The hook in Phase 4 owns staged-entity tracking so the commit call can forward them. If scope tightens, staged entities can be deferred to the API-wiring PR with a TODO; the shared module still renders them.
- **Commit → navigate**: Phase 4's `onCommitSuccess(connectorInstanceId)` is the hand-off. The container's stub currently calls `onClose()` after a fake delay; real wiring will `navigate(/connectors/:id)` instead.
- **Progress UI detail**: the current `UploadStep` renders rich per-file progress rows; Mode A's copy is sparser. Phase 1 trims the copy but retains the structure to avoid rebuilding progress UX later.
- **Large-workbook sampling**: Storybook fixtures use small sheets, so sampling is out of scope. The spec flags this as a backend + performance concern; the `Workbook` shape already supports per-sheet sampled cells, so no frontend change is needed until real data lands.

## Appendix — ordered PRs

To keep reviews bounded, ship in this order:

1. **PR A — Phase 0 + Phase 1**: fixtures, UploadStep refactor, its story. No behaviour change visible in the workflow yet.
2. **PR B — Phase 2 + Phase 3**: the two step wrappers, their tests and stories. Still no workflow change.
3. **PR C — Phase 4 + Phase 5 + Phase 6**: hook rewrite, workflow container + UI, Interactive story, legacy deletions, TODO anchors. This is the cutover PR.

Each PR ends green on type-check + test:unit + Storybook.
