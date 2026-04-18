# Spreadsheet Parsing — Frontend Spec

Implementation spec for the region-drawing UX, the interpretation-review flow, and drift handling in `apps/web`.

Read `SPREADSHEET_PARSING.architecture.spec.md` first for the conceptual model and `SPREADSHEET_PARSING.backend.spec.md` for types (`LayoutPlan`, `RegionHint`, `DriftReport`, warning codes) that the frontend consumes.

## Summary

The frontend lets a user visually define regions on an uploaded or linked spreadsheet, bind each region to an entity definition, configure orientation and pivoted-axis metadata, and review the interpreter's proposed plan (confidence + warnings) before committing. The same UI serves Mode A (snapshot upload) and Mode B (connector first-sync setup and drift review), with mode-specific entry and exit points.

## Shared editor module

The region editor is a **module** in the `apps/web/src/modules/` sense (see `CLAUDE.md` §Module Pattern and `apps/web/README.md` §Modules): a large-scale, context-agnostic building block embedded by multiple connector workflows. It is not itself a user-facing workflow — it does not own an upload, source-connect, or commit step — and it knows nothing about connectors, auth, or routing.

```
apps/web/src/modules/RegionEditor/
  index.ts                                       # public barrel — the surface consumers embed
  RegionEditor.component.tsx                     # Stepper shell — renders drawing step and review step
  RegionDrawingStep.component.tsx                # canvas + side panel; runs click-time validation on Interpret
  ReviewStep.component.tsx                       # post-interpret confidence/warnings review
  SheetCanvas.component.tsx                      # rendered grid with click-drag drawing, selection, and resize
  RegionOverlay.component.tsx                    # per-region selection + resize handles rendered over the grid
  RegionConfigurationPanel.component.tsx         # side-panel — Identity / Shape / Extent sections
  SkipAndTerminatorEditor.component.tsx          # skip-rule list + until-empty terminator count
  FieldNameEditor.component.tsx                  # headerless override editor (auto-generated field names)
  CellPositionInput.component.tsx                # row/column picker used by skip rules
  NewEntityDialog.component.tsx                  # inline entity-creation dialog ("+ Create new entity")
  EntityLegend.component.tsx                     # color-legend chips above the canvas
  DriftBanner.component.tsx                      # drift-halt banner rendered above the drawing step
  RegionReviewCard.component.tsx                 # per-region card rendered inside the review step
  WarningRow.component.tsx                       # single-warning row used by review cards
  ConfidenceChip.component.tsx                   # green/yellow/red confidence pill
  ToggleRow.component.tsx                        # labelled toggle-button-group wrapper
  SectionHelp.component.tsx                      # help-icon-with-tooltip primitive reused across section headings
  utils/
    a1-notation.util.ts                          # parse/format A1 ↔ numeric
    region-editor.types.ts                       # `RegionDraft`, `SkipRule`, `Workbook`, `EntityOption`, etc.
    region-editor-validation.util.ts             # Zod-backed `validateRegion` / `validateRegions` / `RegionEditorErrors`
    region-editor-colors.util.ts                 # deterministic entity-color palette and confidence bands
    region-editor-decorations.util.ts            # header / axis-label / skipped-row overlay computation
    region-editor-fixtures.util.ts               # fixture workbook and regions used by tests + stories
    region-orientation.util.ts                   # arrow glyphs / aria text derived from orientation
  __tests__/
    a1-notation.util.test.ts
    region-editor-colors.util.test.ts
    region-editor-decorations.util.test.ts
    region-editor-validation.util.test.ts
    EntityLegend.test.tsx
    NewEntityDialog.test.tsx
    RegionConfigurationPanel.test.tsx
    RegionDrawingStep.test.tsx
    SectionHelp.test.tsx
    SheetCanvas.test.tsx
  stories/
    RegionEditor.stories.tsx
    RegionDrawingStep.stories.tsx
    RegionConfigurationPanel.stories.tsx
    ReviewStep.stories.tsx
    SheetCanvas.stories.tsx
```

The module exports pure, props-only (`*UI`) components via its `index.ts` barrel, along with type contracts, validation helpers, and decoration/color utilities. Consumers seed the components with inputs and read back emitted edits; the module itself issues no connector-specific API calls and owns no plan-state hook — region-list state lives in the consuming workflow (see `workflows/FileUploadConnector` for the current implementation).

There is no dedicated `DriftCoordinator` component: drift is surfaced by the embedding workflow via the `DriftBannerUI` above the drawing step and by per-region `drift` state on each `RegionDraft`. The drawing step's config panel renders inline drift affordances ("Accept proposed identity" / "Keep prior") when `region.drift.flagged` is true.

### Consumers

Each consumer is a separate workflow under `apps/web/src/workflows/` that embeds the editor's steps at the appropriate position:

| Consumer workflow | Uses | When |
|---|---|---|
| `workflows/FileUploadConnector/` | `RegionDrawingStep`, `ReviewStep` | Mode A — after upload, before commit |
| `workflows/GoogleSheetsConnector/` *(future)* | `RegionDrawingStep`, `ReviewStep`, `DriftCoordinator` | Mode B — first connection (initial); resync drift halt (re-entry) |
| `workflows/ExcelOnlineConnector/` *(future)* | `RegionDrawingStep`, `ReviewStep`, `DriftCoordinator` | Mode B — first connection (initial); resync drift halt (re-entry) |

Consumer workflows own their own `UploadStep` / `SourceConnectStep`, their own commit mutation call, and their own post-commit navigation. They do not fork the editor; they seed it with different inputs (`{ hints }`, `{ proposedPlan }`, or `{ priorPlan, driftReport, proposedPlan? }`) and route users into the same components.

Each step exports a props-only pure component for Storybook.

## Region-drawing canvas

Primary UX. A rendered sheet preview with a grid overlay; the user click-drags (or click + shift-click) to draw rectangular regions. Selected regions are visible, colored, labeled, and directly editable.

### Rendering

- **Renderer**: HTML-Canvas-based grid. Cell text is rendered by the canvas; frozen top-row header and left-column header display column letters (A, B, …) and row numbers (1, 2, …). Scroll virtualization required — real files often exceed 10k rows.
- **Data source**: the parsed `Workbook` is the input. For large sheets, the backend returns a sampled preview (first ~200 rows + last ~50 rows + anchor cells) so the canvas can render without downloading the full workbook; the full workbook stays server-side.
- **Freshness — the canvas always renders the workbook the edits will apply to.** This means the **latest** data from the source at the time the editor opens, not a snapshot cached when the plan was originally drawn. Per-consumer sourcing:
  - Mode A (`FileUploadConnector`): the just-uploaded file — no freshness concern.
  - Mode B initial setup: workbook fetched from the cloud source at the moment the user enters `RegionDrawingStep`.
  - Mode B drift resolution (`DriftCoordinator`): the workbook is the same one the halting `replay()` ran against — the backend pins that fetch and returns it alongside the drift report, so the user sees the exact data that triggered the halt. The UI shows a timestamp (`"Data as of <fetched_at>"`) and a "Re-fetch latest" action; if the user re-fetches, the backend re-runs `replay()` and returns a refreshed drift report before the user resumes editing.
  - Mid-session plan edits (e.g., tweaking the plan on a live Mode B connector): workbook re-fetched on entry; never read from a stale session snapshot.

  Rationale: editing regions against stale grid content is silently wrong — cell coordinates and header labels the user sees may no longer exist in the data the next sync will extract. The editor must fail loud (pinned timestamp, explicit re-fetch) rather than silently diverge.
- **Sheet tabs**: a tab strip at the top of the canvas lists each sheet. Switching tabs swaps the canvas content; drawn regions persist per-sheet. Tabs whose sheet has no drawn regions display a muted indicator.

### Selection and region creation

- **Click-drag**: press on a cell, drag to another cell, release. The enclosed rectangle becomes a new pending region.
- **Click + shift-click**: click one cell, shift-click another to extend the selection.
- **Escape**: cancels an in-progress selection.
- **Undo/Redo**: `Cmd/Ctrl+Z` / `Cmd/Ctrl+Shift+Z`. Undoable operations: create, resize, move, delete, label.

### Editing existing regions

- **Resize**: drag any edge or corner handle. Holding `Shift` resizes symmetrically.
- **Move**: drag from inside the region body.
- **Delete**: select a region, press `Delete` or `Backspace`, or use the side-panel trash icon.
- **Relabel / rebind**: open the side panel (see next section).

### Entity coloring

Regions that share a `targetEntityDefinitionId` render with the same color. A legend in the sidebar lists each bound entity and its color. This makes the merge model visible at a glance: two regions bound to the same entity are clearly parts of the same whole.

Colors are assigned deterministically from a fixed palette (MUI theme tokens) based on the order entities are first bound; up to 12 distinct colors. Additional entities cycle with a patterned outline to remain distinguishable.

### Keyboard and accessibility

The visual overlay is the primary path but must be keyboard-accessible:

- `Delete` / `Backspace` on the selected region removes it (v1 — already implemented). Key events originating from `INPUT`, `TEXTAREA`, `SELECT`, or `contenteditable` targets are ignored so deletes never fire while the user is typing in a side-panel field.
- `Escape` with a region selected clears the selection (`onSelectRegion(null)`), mirroring the drawing step's "deselect" affordance.
- A **Jump to region** `Select` above the canvas lists every region as `${label} · ${sheet} · ${entity}` and switches the active sheet + selection on change; this is the current accessible equivalent of tab-cycling through regions and works for both mouse and keyboard users.
- All icon-only controls (delete, close skip rule, resize handles, help icons) carry descriptive `aria-label`s.
- Validated fields set `aria-invalid` via the MUI pattern documented in `CLAUDE.md` §Accessibility Requirements.

Additional keyboard affordances (Tab-cycle between regions, arrow-key move/resize, N-to-draw) are documented but not yet implemented in v1.

### A1 / numeric fallback input

A secondary "Enter bounds manually" form is not yet implemented in v1. The **Jump to region** select and the config panel's numeric `CellPositionInputUI` (used inside skip rules) cover accessibility for reading bounds and for picking absolute row/column indices; explicit A1 entry remains a planned addition.

Utility: `a1-notation.util.ts` already exports `colIndexToLetter`, `letterToColIndex`, `formatCell`, `formatBounds`, `normalizeBounds`, and `coordInBounds` so the A1 form — once added — can wire directly into the existing helpers.

## Per-region configuration side panel

When a region is selected (by click, keyboard, or creation), `RegionConfigurationPanelUI` renders the side panel. On `lg` viewports (≥1200px) the panel sits to the right of the grid in a fixed-width (~440px) side rail with its own `overflowY: auto`; on smaller viewports it stacks below the grid and uses a two-column internal grid. The panel is organised into three sections with horizontal dividers: **Identity**, **Shape**, and **Extent & skip rules**.

### Identity

| Field | Control | Required | Notes |
|---|---|---|---|
| `proposedLabel` | `TextInput` | no | User-friendly region name; also appears as the region badge on the canvas and in the invalid-region list |
| `targetEntityDefinitionId` | `Select` (searchable) + **+ Create new entity** button | yes | Opens `NewEntityDialog` to stage a new `EntityOption` with `source: "staged"`; staged options render with a "— new" suffix until the consuming workflow persists them |
| Merge banner | inline caption | — | Rendered when another selected region already targets the same entity; explains that AI field mapping runs once across the merged regions |

### Shape

| Field | Control | Required | Notes |
|---|---|---|---|
| `orientation` | `ToggleRowUI` | yes | `rows-as-records` / `columns-as-records` / `cells-as-records`. A `SectionHelpUI` icon next to the heading explains each option |
| `headerAxis` | `ToggleRowUI` | yes, when not crosstab | `row` / `column` / `none`. Hidden when orientation is `cells-as-records` (a crosstab has two header axes by definition). A `SectionHelpUI` icon explains each option |
| Field names (`columnOverrides`) | `FieldNameEditorUI` | no | Rendered when `headerAxis === "none"` and orientation is not crosstab. Auto-generates names from position (`columnA`, `columnB`, …); user may override any |
| `recordsAxisName` | `TextInput` + **Suggest** button | conditional | Required for pivoted regions (`headerAxis` opposite the record axis) and for crosstab. Copy flips to **Row-axis name** for crosstab. Suggest button calls `onSuggestAxisName` (consumer-wired) |
| `secondaryRecordsAxisName` | `TextInput` | yes, crosstab only | Names the column dimension of a crosstab (e.g. `Region`). Validation enforces presence. Has a `SectionHelpUI` tooltip |
| `cellValueName` | `TextInput` | yes, crosstab only | Names the field that holds each cell's value (e.g. `Revenue`). Helper text previews the resulting record shape once all three names are filled |

### Extent & skip rules

| Field | Control | Required | Notes |
|---|---|---|---|
| `boundsMode` | `ToggleRowUI` | yes (defaults to `absolute`) | `absolute` (the drawn rectangle), `untilEmpty` (expand until a terminator), `matchesPattern` (stop at the first row/column whose identity cell matches a regex) |
| `boundsPattern` | `TextInput` | required when `boundsMode === "matchesPattern"` | Validated as a regular expression; empty or invalid values are blocked at Interpret time |
| `skipRules` | `SkipAndTerminatorEditorUI` (checkbox + repeatable rows) | no | See below |
| `untilEmptyTerminatorCount` | numeric `TextInput` | defaults to 2 | Only rendered when `boundsMode === "untilEmpty"`; must be ≥1 |

#### Skip rules

Each row in the editor is one of:

- **Blank** (`kind: "blank"`) — a single checkbox: "Skip blank rows/columns". Wording mirrors the orientation's record axis.
- **Cell matches** (`kind: "cellMatches"`) — a repeatable rule with:
  - `crossAxisIndex` — row or column picker (`CellPositionInputUI`). Starts unselected; Interpret blocks until the user picks a row or column. Range is limited to the region's own bounds.
  - `pattern` — regex `TextInput`. Kept as a non-deferred text input (not a debounced/deferred field) because the canvas decoration for the rule updates live on every keystroke.
  - `axis` (optional) — only meaningful for crosstab regions, where the rule can target row labels or column labels.

### Validation

`region-editor-validation.util.ts` exposes `validateRegion(region): RegionErrors` and `validateRegions(regions): RegionEditorErrors` (keyed by region id). The drawing step computes both on every render:

- `computedErrors = validateRegions(regions)` — always current.
- `effectiveErrors = merge(computedErrors, props.errors?)` — optional prop lets consumers layer server-side errors.

Per-field error keys use dot-notation (`bounds.endRow`, `recordsAxisName`, `skipRules.{i}.pattern`, `skipRules.{i}.crossAxisIndex`, `untilEmptyTerminatorCount`). The panel only surfaces the keys it knows about via `error` / `helperText` / `aria-invalid` on each field.

**Progressive disclosure.** The panel pre-emptively flags axis-name requirements inline the moment a region becomes pivoted, but field-level validation errors from `effectiveErrors` (skip-rule patterns, missing skip-rule position, bounds patterns, etc.) only surface after the user first clicks Interpret — tracked via `attemptedInterpret` state inside the drawing step.

### Interpret guard

`RegionDrawingStepUI` owns click-time enforcement. The Interpret button stays enabled whenever there is at least one region (it is only disabled while interpreting is pending). On click:

1. `attemptedInterpret` is set to `true`.
2. If `invalidRegionIds.length > 0`:
   - The step auto-switches to the first invalid region's sheet and selects it.
   - An `role="alert"` banner renders above the button: "`N` region(s) have validation errors — fix them before interpreting." The banner lists every invalid region as a clickable chip (`${label} · ${sheet} · ${entity}`). Clicking a chip jumps to that region.
   - `onInterpret` is not called.
3. If no errors: `onInterpret()` fires and the stepper advances.

The consuming workflow's `onInterpret` is responsible for the actual backend call and the step transition.

### AI-suggested records-axis name

When a pivoted region has no `recordsAxisName`, the side panel surfaces a **Suggest** button next to the TextInput. The module does not call the backend itself; it fires `onSuggestAxisName(regionId)` and expects the consumer to populate `recordsAxisName: { name, source: "ai", confidence }` (rendered with a warning-colored "AI suggestion — confirm before continuing" caption until the user edits or confirms the field).

### Merge affordances

When the user binds a region to an entity that another region already targets, the side panel shows a caption under the entity select: "Merges into entity with `N` other regions. AI field mapping runs once across all merged regions." The `EntityLegendUI` above the canvas lists every bound entity with its color and region count — clicking a legend entry is the consumer's hook for "jump to one of these regions".

## Review step

After the user finishes drawing regions and clicks "Interpret," the backend runs `interpret()` and returns the full `LayoutPlan`. The Review step renders:

### Layout

- Left pane: the sheet canvas, still interactive, with regions highlighted and confidence badges overlaid.
- Right pane: a collapsible list of entities. Each entity shows:
  - Its merged regions (sheet + bounds + label).
  - Proposed column bindings with per-binding confidence (color-coded chip: green / yellow / red).
  - Warnings scoped to that entity.
- Bottom: aggregate confidence, blocker summary, commit/cancel actions.

### Confidence bands

Fixed at the frontend level, kept in sync with backend `WarningPolicy`:

- `green` — `score >= 0.85`. No UI prompt.
- `yellow` — `0.60 <= score < 0.85`. Yellow chip, expanded row showing the warning and `suggestedFix`.
- `red` — `score < 0.60`. Red chip, row expanded by default, commit disabled until either the warning is resolved (edit in place) or the blocker is dismissed (if policy allows).

### Inline edits

For each column binding: a chip showing the source column → target `ColumnDefinition`. Clicking opens a popover to rebind. Edits mark the plan as dirty; the user must re-confirm before commit. (Edits do not re-run the interpreter — they mutate the plan directly.)

Region bounds and identity strategy are edited by clicking the warning's row → opens the drawing step with that region focused.

### Warnings and suggestedFix

`FormAlert`-style rendering (uses `<Alert>`; MUI's `role="alert"` applies). Each warning row shows:

- Severity icon (info / warn / blocker) and color.
- `message` and `suggestedFix` (when present).
- Action: `Jump to region` (focuses and scrolls on canvas).

Blockers show a "Cancel, fix the source file, and re-upload" CTA — the primary workflow branch the confidence design is built around.

### Commit

Button is enabled only when there are no blockers. On click: `POST /api/connector-instances/:id/layout-plan/:planId/commit`. On success, invalidate `connectorInstances.root`, `connectorEntities.root`, `stations.root`, `fieldMappings.root` query keys; navigate to the connector detail view.

### Server errors

Per the project's form/dialog pattern, the review step accepts `serverError?: ServerError | null` and renders `<FormAlert serverError={serverError} />` above the commit actions. The container converts `mutation.error` via `toServerError(...)`.

## Mode A vs Mode B flow

The shared editor (`RegionDrawingStep`, `ReviewStep`, `DriftCoordinator`) is embedded by each connector workflow. The mode is determined by the hosting workflow and how it seeds editor state, not by the editor itself.

### Mode A — `FileUploadConnector` workflow (snapshot upload)

Entry: user uploads a file. Steps owned by the connector workflow:

1. Upload (connector-owned; reuses the existing CSVConnector upload step).
2. `RegionDrawingStep` — seeded empty (no hints, no prior plan).
3. `ReviewStep`.
4. Commit → navigate to connector detail.

Every upload produces a fresh plan. The previous plan is not offered as a starting point (per architecture Mode A semantics).

### Mode B — cloud-spreadsheet connector workflow, first connection

Hosts: `GoogleSheetsConnector`, `ExcelOnlineConnector` (future). Entry: user connects a workbook.

1. Source connect (connector-owned: OAuth, workbook selection; not in this spec).
2. `RegionDrawingStep` — seeded empty.
3. `ReviewStep`.
4. Commit → schedule periodic sync.

### Mode B — drift halt (resync)

**Drift resolution is not a separate UI.** When a scheduled sync's `replay()` returns `DriftReport.severity >= "blocker"` or `identityChanging: true`, the backend halts and returns `409` with the drift report. The hosting cloud-spreadsheet connector workflow surfaces a banner on the connector detail view and routes the user into the **same `RegionDrawingStepUI` + `ReviewStepUI` used during that connector's initial setup**, seeded with:

- The **current workbook** rendered on the canvas — specifically, the workbook the halting `replay()` ran against, pinned by the backend and returned alongside the drift report. Timestamp and "Re-fetch latest" affordance per §Region-drawing canvas → Rendering → Freshness. `RegionDrawingStepUI` already renders the workbook's `fetchedAt` / `sourceLabel` and wires a `Re-fetch latest` button when the consumer supplies `onRefetchWorkbook`.
- The **prior plan** as the editable starting state — regions, bindings, orientation, and identity strategies are pre-drawn on the canvas and editable with the same affordances as during initial upload.
- **Drift-flagged regions highlighted** on the canvas with a drift border via `RegionDraft.drift.flagged`. The side panel renders a warning-styled drift card showing `prior` vs `observed` summaries; for identity-changing drift the card also shows "Accept `<proposed identity>`" and "Keep prior" buttons that fire `onAcceptProposedIdentity(regionId)` / `onKeepPriorIdentity(regionId)` on the consuming workflow.
- A **drift-report banner** rendered above the drawing step via `DriftBannerUI` — severity, `fetchedAt`, and optional notes come from `DriftReportPreview`.

Identity-changing drift is therefore resolved **inside the editor**, not via a bespoke confirmation dialog. The drift card in the side panel offers:

- **Accept the proposed identity** — consumer updates the region's `identityStrategy` in response to `onAcceptProposedIdentity`.
- **Keep the prior identity** — consumer marks the drift acknowledged via `onKeepPriorIdentity`; replay continues with the legacy mapping.
- **Re-draw or re-bind** — standard canvas edits on the region; same affordances as initial setup.

Commit from the Review step follows the initial-setup commit path; on success the backend writes a new plan version, links the sync history entry to it, and resumes the sync.

There is no `DriftCoordinator` component in v1. The consuming cloud-spreadsheet workflow reads the `409` payload, seeds its own region state (see `FileUploadConnector` for the current template), and supplies `driftReport` + `regions[].drift` + the drift callbacks to `RegionEditorUI`. The shared editor stays connector-agnostic; any capability needed for drift resolution (side-by-side identity comparison, per-binding diff) must live on the shared components. If a drift class can't be expressed there, treat it as a plan-schema or editor gap and close it — do not fork a parallel UI per connector.

## Form/dialog pattern compliance

Although the workflow steps are not dialogs, they follow the same validation/error patterns:

- Any field that accepts user input uses `validateWithSchema(Schema, data)` from `utils/form-validation.util.ts`.
- `touched`/`errors` state drives inline error display; errors appear only after blur or submit.
- `focusFirstInvalidField()` runs on step-advance attempts with invalid data.
- `<TextField>` validation includes `error`, `helperText`, and `aria-invalid`.
- Icon-only buttons (resize handles, delete, tab-close) include descriptive `aria-label`.
- The container passes `toServerError(mutation.error)` into any step rendering `<FormAlert>`.

## SDK and mutation cache invalidation

API endpoints consumed:

- `POST /api/connector-instances/:id/layout-plan/interpret` — mutation, invalidates `connectorInstanceLayoutPlans.root`.
- `POST /api/connector-instances/:id/layout-plan/:planId/commit` — mutation, invalidates `connectorInstances.root`, `connectorEntities.root`, `stations.root`, `fieldMappings.root`, `portals.root`, `portalResults.root`, `connectorInstanceLayoutPlans.root`.
- `POST /api/spreadsheet-parsing/recommend-records-axis-name` — mutation, no cache invalidation (ephemeral suggestion).
- `GET /api/connector-instances/:id/layout-plan` — query, keyed by connector instance.

New query keys added to `api/keys.ts` and re-exported from `api/sdk.ts`:

- `connectorInstanceLayoutPlans.root`
- `connectorInstanceLayoutPlans.detail(connectorInstanceId)`

## Testing

Every `*UI` pure component is tested in isolation so the consuming workflow's SDK, router, and providers are irrelevant. Current coverage:

- `a1-notation.util.test.ts` — round-trip between A1 notation and numeric indices.
- `region-editor-colors.util.test.ts` — deterministic color assignment + confidence-band cutoffs.
- `region-editor-decorations.util.test.ts` — header / axis-label / skipped-row overlay computation, including the `cellMatches` rule with an unset `crossAxisIndex` (must produce no decoration).
- `region-editor-validation.util.test.ts` — every per-field error, including: bounds inversion, missing target entity, pivoted records-axis requirement, crosstab row/column/cell-value axis requirements, `matchesPattern` regex, `untilEmpty` terminator ≥1, and skip-rule position + pattern errors surfaced simultaneously on the same rule.
- `EntityLegend.test.tsx`, `NewEntityDialog.test.tsx`, `SheetCanvas.test.tsx`, `SectionHelp.test.tsx` — per-component behavior.
- `RegionConfigurationPanel.test.tsx` — empty-state copy, label + bounds caption, merge banner, entity-required error plumbing, crosstab + pivoted field visibility, create-entity affordance, blank skip rule toggle.
- `RegionDrawingStep.test.tsx` — keyboard delete/backspace/escape (including "never hijack keys while editing text"), plus click-time validation: Interpret with a valid region calls `onInterpret`; Interpret with invalid regions blocks, shows the `role="alert"` banner with the correct count, auto-selects the first invalid region, and lets the user jump to any invalid region by clicking its chip.

Server-error plumbing, mutation cache invalidation, and commit-button enablement live on the **consuming workflow** (not the shared module) — e.g., `workflows/FileUploadConnector/__tests__/`.

Stories cover:

- `RegionEditor.stories.tsx` — Mode A empty, Mode A post-interpret review, Mode B drift halt, and an Interactive harness (draw → interpret → review → commit) that on commit shows the final `regions` + `stagedEntities` payload as pretty-printed JSON in a modal.
- `RegionDrawingStep.stories.tsx` — isolated drawing-step variants.
- `RegionConfigurationPanel.stories.tsx` — every panel variant (crosstab, pivoted, headerless, drift).
- `ReviewStep.stories.tsx` — mixed confidence and blocker-in-review variants.
- `SheetCanvas.stories.tsx` — canvas without surrounding chrome.

## Open questions (frontend-owned)

- Renderer choice: HTML Canvas vs WebGL vs a library (`react-spreadsheet`, `glide-data-grid`). Tradeoff: perf on large workbooks vs implementation speed.
- Sampling strategy for large workbooks: how to preview 100k-row sheets without transferring the full dataset. Backend must support a sampling endpoint.
- Copy/UX for the "fix the file and re-upload" CTA on blockers: do we surface a "download a fix-up template" action, or only text guidance?
- Color palette sizing for entity coloring: 12 colors cover most cases, but enterprise workbooks may exceed that. Acceptable to cycle patterns?
- Per-consumer threshold overrides for confidence bands (architecture OQ5): if Mode B first-time setup uses stricter cutoffs, where does the override live — URL param, container prop, connector definition?
