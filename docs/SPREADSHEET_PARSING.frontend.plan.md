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

## Phase 6 — Wire API placeholders (TODO anchors only)

Leave explicit, greppable `// TODO(API wiring):` comments at every async boundary, each naming:

1. The backend endpoint (from `SPREADSHEET_PARSING.backend.spec.md`).
2. The SDK method to call (or to add — `sdk.connectorInstanceLayoutPlans.interpret`, `.commit`, `sdk.fileUploads.parse`).
3. The query keys to invalidate on success, per `CLAUDE.md` §Mutation Cache Invalidation:
   - `parseFile` → none (ephemeral).
   - `runInterpret` → `connectorInstanceLayoutPlans.root`.
   - `runCommit` → `connectorInstances.root`, `connectorEntities.root`, `stations.root`, `fieldMappings.root`, `portals.root`, `portalResults.root`, `connectorInstanceLayoutPlans.root`.

No actual SDK code lands in this PR — just the anchors. Follow-up PR owns the wiring.

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
