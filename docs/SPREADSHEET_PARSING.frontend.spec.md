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
  RegionEditor.component.tsx                     # container + pure UI component
  RegionDrawingStep.component.tsx                # the visual overlay + side panel
  ReviewStep.component.tsx                       # confidence + warnings + inline edits
  DriftCoordinator.component.tsx                 # reads 409 drift payload, seeds plan state, delegates to RegionDrawingStep + ReviewStep
  utils/
    plan-state.util.ts                           # client-side plan draft state (seedable with empty / interpreter-proposed / prior+drift inputs)
    region-drawing.util.ts                       # hit-testing, selection, resize
    a1-notation.util.ts                          # parse/format A1 ↔ numeric
    sheet-renderer.util.ts                       # canvas rendering + cell lookups
    region-editor-validation.util.ts             # per-step Zod schemas
    use-plan-mutation.util.ts                    # React Query mutations
  __tests__/
    RegionEditor.test.tsx
    RegionDrawingStep.test.tsx
    ReviewStep.test.tsx
    DriftCoordinator.test.tsx
  stories/
    RegionEditor.stories.tsx
    RegionDrawingStep.stories.tsx
    ReviewStep.stories.tsx
```

The module exports pure, props-only step components plus the plan-state hook via its `index.ts` barrel. Consumers seed it with inputs and read back emitted edits; the module itself issues no connector-specific API calls.

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

- Tab cycles through existing regions. `Enter` opens the side panel for the focused region.
- Arrow keys move the focused region; `Shift+Arrow` resizes.
- `N` starts a new-region selection mode: arrow keys move the anchor, `Space` commits the first corner, arrow keys extend, `Enter` commits the region.
- All keyboard actions are mirrored by screen-reader announcements via `aria-live="polite"` region labels.

### A1 / numeric fallback input

A secondary "Enter bounds manually" form is always available:

- `Sheet` dropdown, `Range` input accepting A1 notation (`B2:N4`) or numeric (`startRow, startCol, endRow, endCol`).
- Same side-panel config as visual regions.
- This path is required for accessibility and for users who prefer typed input; it is not a legacy or degraded mode.

Utility: `a1-notation.util.ts` exports `parseA1(input): {start, end}` and `formatA1({start, end}): string`.

## Per-region configuration side panel

When a region is selected (by click, keyboard, or creation), a side panel opens to the right of the canvas. Fields:

| Field | Control | Required | Notes |
|---|---|---|---|
| `proposedLabel` | `TextField` | no | User-friendly region name, shown as a badge on the canvas |
| `targetEntityDefinitionId` | `AsyncSearchableSelect` | yes | Queries `EntityDefinition`s via existing SDK; shared across regions that merge |
| `orientation` | `ToggleButtonGroup` | yes | `rows-as-records` / `columns-as-records` |
| `headerAxis` | `ToggleButtonGroup` | yes | `row` / `column` |
| `recordsAxisName` | `TextField` with AI suggestion | conditional | Required when orientation's record axis differs from the header axis (pivoted region) |
| `drift` knobs | collapsible advanced panel | no | `headerShiftRows`, `addedColumns` (halt/auto-apply), `removedColumns` max + action |

### Validation

`spreadsheet-parser-validation.util.ts` exports per-step Zod schemas matching backend `RegionHint`. Each region must pass validation before the user can advance from the drawing step. Errors display inline on the side panel; invalid regions are outlined red on the canvas.

### AI-suggested records-axis name

When `orientation` + `headerAxis` indicate a pivoted region and the user has left `recordsAxisName` blank, the side panel displays a call-to-action: **"Suggest a name."** Clicking triggers a backend call (`POST /api/spreadsheet-parsing/recommend-records-axis-name` with the axis labels). Response: `{ name, confidence }`. The suggestion populates the field with a badge reading "AI suggestion — confirm" and a high-contrast border. The user edits or confirms before the region is valid.

- `recordsAxisName.source` is set to `"ai"` on the plan if the user accepted the suggestion without editing, `"user"` if the user typed or edited the value.
- If the user leaves the field blank and confidence is low, validation blocks advancing and displays the `PIVOTED_REGION_MISSING_AXIS_NAME` blocker copy.

### Merge affordances

When the user sets `targetEntityDefinitionId` on a second region to match an existing region, the side panel shows a confirmation banner: "This region will merge into entity `<Name>` (N other regions contribute to it). AI field mapping runs once across all merged regions." This makes the merge model explicit at the point of decision. The banner includes a link to the legend.

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

**Drift resolution is not a separate UI.** When a scheduled sync's `replay()` returns `DriftReport.severity >= "blocker"` or `identityChanging: true`, the backend halts and returns `409` with the drift report. The hosting cloud-spreadsheet connector workflow surfaces a banner on the connector detail view and routes the user into the **same `RegionDrawingStep` + `ReviewStep` used during that connector's initial setup**, via `DriftCoordinator`, seeded with:

- The **current workbook** rendered on the canvas — specifically, the workbook the halting `replay()` ran against, pinned by the backend and returned alongside the drift report. The user is editing regions against the actual data the next sync will extract, not a snapshot from when the plan was first drawn. Timestamp and "Re-fetch latest" affordance per §Region-drawing canvas → Rendering → Freshness.
- The **prior plan** as the editable starting state — regions, bindings, orientation, and identity strategies are all pre-drawn on the canvas. The user can edit any of them using the same affordances as during initial upload (drag to resize, side-panel to rebind, A1 fallback input, etc.).
- **Drift-flagged regions highlighted** on the canvas with a drift badge. Clicking focuses the region and opens its side panel with a "Drift" section showing the prior value vs the replay's observation, keyed by warning code and locator.
- The interpreter's **proposed revision** (when the consumer has called `interpret(workbook, priorPlan, driftReport)` to get one) rendered as a **per-region diff overlay** — acceptable via a "Use new" / "Keep old" toggle in the side panel, not a global accept/reject modal.

Identity-changing drift is rendered **inside the editor**, not as a bespoke confirmation dialog. The affected region's side panel expands its identity section to show prior strategy, observed/proposed strategy, and the reason (warning code + locator). Resolution happens in place:

- **Accept the proposed identity** — editor updates the region's `identityStrategy`; the side panel surfaces the `source_id` derivation change so the user sees what will break.
- **Keep the prior identity** — editor leaves the region unchanged; replay will continue with the legacy mapping and the drift report is acknowledged without a plan revision.
- **Re-draw or re-bind** — standard canvas edits on the region; same affordances as initial setup.

Commit from the Review step follows the initial-setup commit path; on success the backend writes a new plan version, links the sync history entry to it, and resumes the sync.

`DriftCoordinator.component.tsx` is therefore a **thin coordinator**: it reads the drift report from the `409` payload, seeds `plan-state.util.ts` with `{ workbook, priorPlan, driftReport, proposedPlan? }` (where `workbook` is the pinned fetch from the halting replay), and delegates rendering to the shared `RegionDrawingStep` + `ReviewStep`. It renders no region fields of its own and lives in the shared editor module, not in any single connector workflow.

Consequence: any capability needed for drift resolution (e.g., side-by-side identity comparison, per-binding diff) must exist on the shared editor. If a drift class can't be expressed there, treat it as a plan-schema or editor gap and close it — do not fork a parallel UI per connector.

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

Per the project's dialog/form test checklist adapted to multi-step workflow steps:

- **Region Drawing step**: renders canvas, creates/resizes/deletes regions, validates config panel, shows per-region errors.
- **Review step**: renders confidence chips and warnings, disables commit on blocker, calls commit mutation.
- **`DriftCoordinator`**: seeds shared editor state from a `409` drift-report payload and delegates to `RegionDrawingStep` + `ReviewStep`; verifies prior-plan regions are pre-drawn, drift-flagged regions carry the drift badge, and identity-change resolution updates `identityStrategy` in place rather than opening a modal.
- `aria-invalid` set on invalid fields; `required` attribute present on required fields.
- Server errors render `<FormAlert>`; absence of errors hides it.
- Mutation success invalidates the documented query keys (verified via `jest.spyOn(queryClient, "invalidateQueries")` in `test-utils.tsx`).

Stories cover:

- Empty sheet (no regions drawn yet).
- Single region, well-formed.
- Multiple regions bound to the same entity (merge demo).
- Pivoted region with AI-suggested axis name.
- Review with mixed confidence (green / yellow / red).
- Blocker in review preventing commit.
- Drift review: identity-changing drift halt.

## Open questions (frontend-owned)

- Renderer choice: HTML Canvas vs WebGL vs a library (`react-spreadsheet`, `glide-data-grid`). Tradeoff: perf on large workbooks vs implementation speed.
- Sampling strategy for large workbooks: how to preview 100k-row sheets without transferring the full dataset. Backend must support a sampling endpoint.
- Copy/UX for the "fix the file and re-upload" CTA on blockers: do we surface a "download a fix-up template" action, or only text guidance?
- Color palette sizing for entity coloring: 12 colors cover most cases, but enterprise workbooks may exceed that. Acceptable to cycle patterns?
- Per-consumer threshold overrides for confidence bands (architecture OQ5): if Mode B first-time setup uses stricter cutoffs, where does the override live — URL param, container prop, connector definition?
