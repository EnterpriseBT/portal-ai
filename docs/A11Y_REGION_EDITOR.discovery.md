# Accessible RegionEditor — Discovery

**Issue:** [EnterpriseBT/portal-ai#795](https://github.com/EnterpriseBT/portal-ai/issues/795) · Feature · full. Child of epic #791; branches from and merges into `epic/a11y-conformance`.

**Why this exists.** The RegionEditor turns an uploaded or cloud spreadsheet into a layout plan. Someone outlines each table on the sheet, binds it to an entity, reviews the column bindings, and commits. Every step of that starts with a mouse drag on the sheet. The sheet is a wall of `div`s with no roles, no focus and no keyboard handling. Typed bounds exist, but only for a region that's already drawn (KB-08). Region state is mostly colour. The upload dropzone can't be reached by Tab. The audit adds 13 machine findings, ten of them `aria-prohibited-attr` on overlay elements.

The PRD was completed on 2026-11-09:
- typed bounds **and** keyboard selection on the sheet can both create regions;
- a screen reader reads cells on the virtualized sheet;
- our steps around the editor (upload, Interpret, Commit) are in scope, but Google's and Microsoft's pickers aren't.

This is the work that lets a keyboard or screen-reader user take a sheet from upload to a committed plan.

## The current shape

### The sheet (`apps/web/src/modules/RegionEditor/SheetCanvas.component.tsx`)

| Piece | Location | State today |
|---|---|---|
| Cells | :1102–1111 | A plain `div` per cell (`data-testid="cell-r-c"`) in an absolutely positioned flex row (:1113–1130). No table, grid or cell roles. Unloaded rows show "…" with `aria-busy`. |
| Virtualization | :869 | `useVirtualizer` over **rows only** (`overscan: 8`). Every rendered row draws all `colCount` cells (:1089). Lazy sheets load visible rows through `loadSlice` (:904–956). A sheet can hold up to 1,000,000 cells (`FILE_UPLOAD_INLINE_CELLS_MAX`, `apps/api/src/environment.ts:324`). |
| Headers | :1031, :1126 | Column and row headers are `div[data-col-header]` / `div[data-row-header]`, with no role and no tabindex. |
| Corner | :1048–1067 | `div[data-corner-header]` with `aria-label="Select entire sheet"` and no role: the audit's corner `aria-prohibited-attr`. A press drafts a whole-sheet region. |
| Other `aria-label` on generic elements | :1355, :1535, :1682; `RegionOverlay.component.tsx:183`, :205, :251; `SegmentStrip.component.tsx:134` | Segment overlays, non-editable intersections, dividers, the region body, the orientation span, resize handles and the segment strip. These are the audit's `.css-*` nodes. |
| Keyboard | — | The canvas has no tabindex and no `onKeyDown`. The one exception is an editable pivot intersection (`role="button"`, Enter/Space, :1479–1533). |
| Pointer model | :469–517, :692–802 | A body-cell drag → `onRegionDraft(bounds)`. A click → `onRegionSelect`. A header press → a row or column band. Handles and body → `onRegionResize`. Dividers → `onSegmentResize`. There's no "active cell" concept. |

### Regions, panel and bounds

| Piece | Location | State today |
|---|---|---|
| Region state | `workflows/_shared/spreadsheet/use-spreadsheet-workflow.util.ts:570–585`, :625 | The consumer's hook owns `regions` and `selectedRegionId`. `onRegionDraft` mints, appends and selects. `onRegionDelete` removes. |
| Typed bounds | `RegionBoundsInputs.component.tsx` | Four fields (start/end row as numbers, start/end column as letters), committed on blur or Enter. Rendered only for a selected region (`RegionConfigurationPanel.component.tsx:643`). With no selection the panel says "Draw a region on the canvas…" (:253–273). |
| A1 helpers | `utils/a1-notation.util.ts` | `formatBounds`, `normalizeBounds`, `letterToColIndex`. **No range parser.** |
| Step keys | `RegionDrawingStep.component.tsx:296–343` | A capture-phase document `keydown`: Escape deselects, Delete/Backspace delete (unless locked). Ignores inputs and open dialogs/menus. |
| Step forms | `RegionDrawingStep.component.tsx:387`, `ReviewStep.component.tsx:509` | `Stack component="form" onKeyDown={preventToggleEnterSubmit}`, the #789 Enter rule. These are the audit's two `no-noninteractive-element-interactions` rows. |

### Status, review and the steps around

| Piece | Location | State today |
|---|---|---|
| Region overlay | `RegionOverlay.component.tsx:170–243` | The entity is colour plus a label tab. Selection is only a shadow. Growth direction is only dashes and gradients. Canvas regions show no sign of being invalid. |
| Validation | `RegionDrawingStep.component.tsx:647–682` | After Interpret: a `role="alert"` box, "N regions have validation errors", with error chips. Field errors use `aria-invalid`. |
| Live regions | :716–741 | Only the interpreting panel's `role="status"`. Creating, selecting, resizing and deleting a region are silent. |
| Binding chips | `RegionReviewCard.component.tsx` ~:528–539, :152–156 | Native buttons named "Edit binding: X". Bound vs unbound appears only in a tooltip. Display-only chips are `role="status"`. |
| Binding popover | `BindingEditorPopover.component.tsx:226–251` | The paper is a `form` with `role="dialog"` (the audit's `aria-allowed-role`), plus a status icon `span` with an `aria-label`. Focus moves in on open. |
| EditLayoutPlan's review chips | `views/EditLayoutPlan.view.tsx:870` | `onEditBinding={() => undefined}`: `RegionEditorUI` doesn't forward the popover props, so these chips **do nothing**, by mouse or keyboard. |
| Other popovers | `SegmentEditPopover` :170, `IntersectionEditPopover` :57, `RecordAxisTerminatorPopover` :38 | Popover papers with `role="dialog"` and names. RecordAxisTerminator doesn't move focus in. |
| Upload | `workflows/FileUploadConnector/UploadStep.component.tsx:119–160`; core `FileUploader.tsx:110–150` | A `Box onClick` dropzone over a `display:none` file input. **Not reachable by keyboard.** |
| Pickers | `GoogleSheetsConnector/SelectSheetStep.component.tsx:89`; `MicrosoftExcelConnector/SelectWorkbookStep.component.tsx:63` | A standard Button (Google's picker is third-party). Excel uses `AsyncSearchableSelect`. |

### Tests

- 24 test files under `modules/RegionEditor/__tests__/`. `SheetCanvas.test.tsx` drives pointer events only.
- No RegionEditor test calls axe. The story sweep records the violations above, and story fixtures are 8–10-row sheets.

## The design space

### Decision 1 — Sheet semantics on a virtualized canvas

- **A. APG grid, roving focus.**
  - `role="grid"` on the sheet with `aria-rowcount`/`aria-colcount` (sheet size plus the header row and column).
  - Rows `role="row"` with `aria-rowindex`; headers `columnheader`/`rowheader`; cells `gridcell` with `aria-colindex`.
  - One active cell holds `tabindex=0`. Arrow keys move a **logical** position: the hook calls the virtualizer's `scrollToIndex` and focuses the cell once it renders.
- **B. A hidden accessible table mirror** beside the visual canvas. It's two DOM trees to keep in sync and doubles the cost of a large sheet.
- **C. No cell semantics; a "cell reader" field** that names the active cell's value. It reads cells but isn't a grid, so a screen reader's table commands don't work.

**Lean: A.** It's the APG pattern for a spreadsheet. `aria-rowcount`/`aria-rowindex` exist for exactly this virtualized case.

#794's core `useGridNavigation` can't be reused as is. It finds cells in the DOM, and here most rows aren't rendered. So the sheet gets its own logical-position keyboard hook (`utils/use-sheet-keyboard.util.ts`) with the same key meanings, so the two grids in the app behave alike.

### Decision 2 — Creating and selecting regions from the keyboard

| Key | On the sheet |
|---|---|
| Arrows, Home/End, Ctrl+Home/End, PageUp/PageDown | Move the active cell (Page moves one viewport) |
| Shift + those | Extend a selection from an anchor (spreadsheet convention) |
| Shift+Space / Ctrl+Space | Select the active row / column (a band) |
| Ctrl+A | Select the whole sheet (the corner's action) |
| Enter | With a selection of more than one cell, or a band: create a region from it (`onRegionDraft`). On a cell inside a region: select that region (`onRegionSelect`). |
| Escape | Clear the selection; with none, the existing step rule (deselect the region) |
| Delete / Backspace | The existing rule: delete the selected region (unless locked) |

The visible selection is drawn with the same marquee a drag draws.

**Lean: this key map.** It's what spreadsheet users know, and Enter is the one commit key, matching #789's "Enter runs the primary".

**Resizing and moving stay on the typed bounds, not canvas keys.** An extra modifier set (Alt+Shift+arrows) is undiscoverable and fights screen-reader shortcuts. The bounds fields are always one Tab away from the selected region.

### Decision 3 — Typed ranges that create

- **A.** A single "Range" field ("A1:D20", also "A:D", "3:10", one cell) with an "Add region" button, shown in the panel when nothing is selected. A new `parseRange` in `a1-notation.util.ts` feeds `onRegionDraft`. The four bounds fields stay for editing.
- **B.** Replace the four fields with one range field everywhere. It's less to read, but it changes the editing UI everyone uses today.

**Lean: A.** It adds the missing create path and leaves editing as it is.

### Decision 4 — Region status that isn't only colour, and announcements

- **Make the overlays decorative.** They're a visual layer over the grid, so they become `aria-hidden`, which clears their `aria-prohibited-attr`. The grid and panel carry the information instead.
- **Cells describe their region.** Each region renders one hidden description: "Region Customers, A1:D20, records by row, invalid: <first error>, drift detected". A cell inside a region points `aria-describedby` at it. One element per region, not per cell.
- **One persistent live region per step.** The drawing step mounts a visually hidden `StatusMessage` (#794's `visuallyHidden`) for what changed:
  - "Region created: A1:D20";
  - "Customers selected";
  - "Region deleted";
  - "Bounds A1:D24";
  - the current selection while Shift extends it ("B2 to D9", debounced).
- **Visible cues gain text.** The selected region's label tab gains "Selected". An invalid region's tab gains "Needs attention". Growth direction already has text.

**Lean: all four.** A screen-reader user hears where they are from focus and what changed from the live region, and sighted users stop needing colour to see invalid or selected.

### Decision 5 — The audit's interaction and role rows

- **Corner:** becomes a real `button` ("Select entire sheet"), keyboard-operable. Ctrl+A on the grid does the same.
- **Overlays:** `aria-hidden` (Decision 4). The editable pivot intersection stays a button.
- **Step forms with `onKeyDown`:** the handler is #789's `preventToggleEnterSubmit`, which must see keys bubbling from every field in the form. A keydown on a form is event delegation, not an interaction with the form.
  - **Option A:** an `eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions` with that reason in-file. CLAUDE.md allows a disable that carries its reason.
  - **Option B:** move the handler to a wrapping `div`. The rule flags that too.
  - **Lean: A.**
- **Binding popover:** the paper keeps `role="dialog"` and its name, with a `form` inside it (as `Modal` does since #793). The status icon gets `role="img"`.

### Decision 6 — Review chips and the steps around

- **Binding chips:**
  - Their name includes their state: "Edit binding: Region (bound to Region)" / "(unbound)" / "(excluded)".
  - Chip groups become a labelled `group`.
  - RecordAxisTerminatorPopover moves focus in on open, like the others.
- **EditLayoutPlan's dead chips:** `RegionEditorUI` forwards the popover props, so the chips open the binding editor on that page as on the wizard. This fixes a bug for every user, and the PRD needs the chips operable.
- **Upload dropzone:** becomes a `button` (focusable, Enter/Space opens the file dialog, named "Choose a file or drop it here"). The same fix goes in core's `FileUploader`. Drag-and-drop stays.

**Lean: all of the above.**

## Tradeoff comparison

| | D1 grid | D2 keys | D3 range | D4 status | D5 audit | D6 review/upload |
|---|---|---|---|---|---|---|
| Touches | SheetCanvas + new hook | SheetCanvas, step | panel, a1 util | overlay, step, canvas | canvas, steps, popover | review, EditLayoutPlan, upload, core FileUploader |
| New pattern | Virtualized grid | Spreadsheet keys | — | Region descriptions | — | — |
| Spread to spec | Yes | Yes | Yes | Yes | Yes | Yes |

## Recommendation

1. **The sheet is an APG grid.**
   - Roles: `role="grid"` with `aria-rowcount`/`aria-colcount`; `row`/`aria-rowindex`, `columnheader`/`rowheader`, and `gridcell`/`aria-colindex`.
   - One active cell holds `tabindex=0`.
   - A new `use-sheet-keyboard.util.ts` moves a logical position, scrolls the virtualizer to it, and focuses the cell once rendered.
2. **Spreadsheet keys create regions:**
   - Shift extends a selection.
   - Shift+Space / Ctrl+Space select a row / column.
   - Ctrl+A selects the sheet.
   - Enter turns a selection into a region, or selects the region under the active cell.
   - Escape clears the selection, then deselects.
   - Delete/Backspace delete (unchanged).
3. **A "Range" field and "Add region" button** in the panel's empty state create a region from typed A1 notation through a new `parseRange`. Resizing and moving stay on the bounds fields.
4. **Overlays are `aria-hidden`.** Each region renders one hidden description that its cells reference with `aria-describedby`.
5. **The drawing step mounts one persistent hidden `StatusMessage`.** It announces region created, selected, deleted and resized, plus the selection's extent (debounced).
6. **Selected and invalid regions show text on their label tab,** not only colour.
7. **The sheet's corner is a button.**
   - Step forms keep their #789 handler, with a reasoned `eslint-disable`.
   - The binding popover's paper is a `dialog` containing a `form`, and its status icon is `role="img"`.
8. **Binding chips name their state,** and chip groups are labelled.
   - RecordAxisTerminatorPopover moves focus in on open.
   - EditLayoutPlan's chips open the binding editor (`RegionEditorUI` forwards the popover props).
9. **The upload dropzone and core `FileUploader` are keyboard buttons** that open the file dialog.
10. **Proof:** RegionEditor component tests assert axe and the keyboard paths, and `npm run a11y:report` leaves #795's section empty, closing KB-08.

## Open questions

1. **Wide sheets.** Columns aren't virtualized, so a sheet hundreds of columns wide renders every column's cells per visible row. Grid attributes add to each cell but don't change the count. **Lean: leave column virtualization out**, record it, and measure at the smoke walk with the largest fixture.
2. **What Enter does with no selection, on a cell outside any region.** **Lean: nothing,** with the live region saying "Select cells with Shift and the arrow keys, then press Enter to add a region", once per session. Guessing a region would surprise people.
3. **Touch's long-press draw and keyboard selection share the marquee.** **Lean: one selection state** in SheetCanvas, driven by either input, so the two can't disagree.
4. **The step's Delete/Backspace while focus is on the grid.** The existing listener ignores inputs but not the grid, so Backspace on the grid deletes the selected region. **Lean: keep that** (it's the documented key), and announce "Region deleted".
5. **EditLayoutPlan's binding editor.** Wiring it might reach this ticket's limit if the page lacks the mutation the wizard uses. **Lean: forward the same popover props.** If the page has no binding update path, record a follow-up rather than build one here.

## Enterprise-scale considerations

- **Concurrency & correctness:** N/A. Client-side interaction only, with no new writes. Regions still go through the existing workflow hook and commit path.
- **Accuracy & auditability:** N/A. No record of truth is involved.
- **Failure modes:** a lazy sheet's unloaded rows stay `aria-busy`. A cell scrolled to before its slice loads reads "Loading…" until it arrives, never stale text. **Lean:** say "loading", never guess.
- **Scale & unbounded growth:**
  - Keyboard movement is O(1) per key, plus one `scrollToIndex`.
  - The per-region descriptions are O(regions), not O(cells).
  - Selection announcements are debounced.
  - Wide sheets: Open question 1. **Lean:** no new cost per row beyond attributes.
- **Multi-tenancy:** N/A. No data crosses an org boundary.
- **Contract stability:** the RegionEditor's props gain a range-create callback path and popover forwarding. Its `onRegionDraft`/`onRegionSelect` contract is reused, not changed. **Lean:** consumers (three workflows, EditLayoutPlan) need no wiring change beyond EditLayoutPlan's popover.
- **Data lifecycle:** N/A.

## What this doesn't decide

- **A visual redesign of the canvas.** It's out of scope by the PRD.
- **Google's and Microsoft's file pickers.** They're third-party; we only make sure our launch buttons work.
- **Column virtualization** (Open question 1).
- **CI gates** (#799) and the conformance report (#800).

## Next step

Write `docs/A11Y_REGION_EDITOR.spec.md` (grid roles, key map, `parseRange`, descriptions, announcements, component props) and `docs/A11Y_REGION_EDITOR.plan.md`. Slices, each a testable commit:
1. Audit role fixes (corner button, `aria-hidden` overlays, popover dialog/form, reasoned disables).
2. `parseRange` and the Range field.
3. Grid semantics and keyboard movement on the virtualized sheet.
4. Keyboard selection and region creation.
5. Region descriptions, text cues and announcements.
6. Review chips, popovers and EditLayoutPlan's binding editor.
7. Keyboard upload (workflow and core `FileUploader`).
8. The audit regeneration, KB-08 and docs.
