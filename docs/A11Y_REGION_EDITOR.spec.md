# Accessible RegionEditor — Spec

**Issue:** [EnterpriseBT/portal-ai#795](https://github.com/EnterpriseBT/portal-ai/issues/795) · **Epic:** #791 · **Discovery:** `docs/A11Y_REGION_EDITOR.discovery.md`

This spec pins the grid roles, key map, typed-range parser, region descriptions, announcements and component props that give the RegionEditor a full keyboard and screen-reader path. It lives in `apps/web` (`modules/RegionEditor`, the connector workflows and EditLayoutPlan), plus core's `FileUploader`. No API, schema or data change.

## Key decisions (flag for review)

1. **The sheet is an APG grid on the virtualized canvas.**
   - A new `utils/use-sheet-keyboard.util.ts` owns a **logical** active cell and selection.
   - Moving scrolls the row virtualizer to the target and focuses the cell after it renders.
   - #794's `useGridNavigation` isn't reused, because it finds cells in the DOM and most rows aren't rendered. The key meanings are the same.
2. **Spreadsheet keys create regions.**
   - Shift extends.
   - Shift+Space / Ctrl+Space select a row or column band; Ctrl+A selects the sheet.
   - Enter on a selection creates a region (`onRegionDraft`), and Enter on a cell inside a region selects it (`onRegionSelect`).
   - Escape clears the selection, falling back to the existing deselect.
   - Enter with no selection outside any region does nothing except a one-time hint (discovery Q2).
3. **Typed ranges create.** `parseRange` in `a1-notation.util.ts` and a new `RegionRangeInputUI` sit in the panel's empty state ("Range" + "Add region"). Resize and move stay on the existing four bounds fields.
4. **Overlays are decorative.** `RegionOverlay` and the canvas's segment, divider and non-editable intersection elements are `aria-hidden`; this clears the `aria-prohibited-attr` rows. Each region renders one hidden description that its cells reference with `aria-describedby`. The editable pivot intersection stays a named button outside any `aria-hidden` ancestor.
5. **Announcements go through one persistent hidden `StatusMessage`** (#794's `visuallyHidden`) in the drawing step. It announces created, selected, deleted, resized, the selection's extent (debounced 400 ms), and the one-time hint.
6. **Text cues.** A region's label tab shows "Selected" and "Needs attention" as text, not only a shadow or colour.
7. **Audit rows.**
   - The corner is a `button`.
   - The two step forms keep `preventToggleEnterSubmit`, since it's event delegation for #789. The a11y lint config allows `onKeyDown` on a `<form>` with the reason (implementation note: a per-line `eslint-disable` would fail the main `lint`, which doesn't load jsx-a11y).
   - The binding popover's paper is a `dialog` wrapping a `form`, and its status icon gets `role="img"`.
8. **EditLayoutPlan's binding chips work.** `RegionEditorUI` forwards the popover props, and the page supplies them with the shared `patchBinding` over its own region state plus `sdk.columnDefinitions.search()` (discovery Q5 resolved: no follow-up needed).
9. **Upload by keyboard.** The upload step's dropzone and core `FileUploader` are native buttons that open the file dialog; drag-and-drop stays.
10. **Out of scope, recorded:** column virtualization for very wide sheets (discovery Q1) and Google's and Microsoft's own pickers.

## Scope

### In scope

1. `SheetCanvas`:
   - grid roles and counts;
   - the active cell and keyboard;
   - selection by keyboard (sharing the pointer marquee);
   - the corner button;
   - `aria-hidden` decorative overlays;
   - region descriptions.
2. `use-sheet-keyboard.util.ts` (new).
3. `parseRange` and `RegionRangeInputUI` (new), and the panel's empty state.
4. `RegionDrawingStep`: the announcer (`use-region-announcements.util.ts`, new), descriptions passed to the canvas, and the reasoned disable.
5. `RegionOverlay`: `aria-hidden`, plus the "Selected" and "Needs attention" text.
6. Review:
   - `RegionReviewCard` chip names and groups;
   - `BindingEditorPopover` dialog/form/img;
   - `RecordAxisTerminatorPopover` focus;
   - the `ReviewStep` reasoned disable.
7. `RegionEditorUI` popover forwarding, and EditLayoutPlan's binding editor.
8. `UploadStep` dropzone and core `FileUploader`.
9. Regenerating `docs/A11Y_AUDIT.md`; closing KB-08.

### Out of scope

- Visual canvas redesign.
- Column virtualization.
- Third-party pickers.
- CI gates (#799).

## Surface

### `parseRange` (`modules/RegionEditor/utils/a1-notation.util.ts`)

```ts
export type ParseRangeResult =
  | { ok: true; bounds: CellBounds }
  | { ok: false; error: string };

export function parseRange(
  input: string,
  sheet: { rowCount: number; colCount: number }
): ParseRangeResult;
```

**Accepted forms** (case-insensitive, whitespace trimmed, 1-based rows and lettered columns):

| Input | Meaning |
|---|---|
| `A1:D20` | A rectangle |
| `D20:A1` | The same rectangle (normalized) |
| `B3` | One cell |
| `A:D` | Full-height columns |
| `3:10` | Full-width rows |

**Errors:**

| Message | When |
|---|---|
| `"Enter a range like A1:D20"` | Empty input, or nothing it can parse |
| `"Outside the sheet (A1:<lastCol><lastRow>)"` | Any edge beyond the sheet |

The result is 0-based `CellBounds`, matching `normalizeBounds`.

### `RegionRangeInputUI` (new: `modules/RegionEditor/RegionRangeInput.component.tsx`)

```ts
export interface RegionRangeInputUIProps {
  sheet: { rowCount: number; colCount: number };
  onCreate: (bounds: CellBounds) => void;
  disabled?: boolean;
}
```

- **Field:** a `TextField` labelled "Range", with helper "e.g. A1:D20 or A:D".
- **Submit:** Enter in the field (`preventDefault`, no form submit) or the "Add region" button (`type="button"`) runs `parseRange`.
- **On success:** calls `onCreate` and clears the field.
- **On error:** shows `error`, `aria-invalid` and `helperText` = the parser's message, and focus stays in the field.
- **Placement:** rendered by `RegionConfigurationPanelUI` in its no-selection state (`:253–273`), with copy reading "Draw a region on the sheet, or type its range:". The panel gets new props `onCreateRegionFromRange?: (bounds) => void` and `activeSheet?: { rowCount; colCount }` (the parser needs the sheet's extent, which the panel had no way to know with nothing selected); it offers the field only when it has both. The step passes `activeSheet` and `(bounds) => onRegionDraft({ sheetId, bounds })`.

### `use-sheet-keyboard.util.ts` (new)

```ts
export interface SheetKeyboardOptions {
  rowCount: number;
  colCount: number;
  /** Rows per viewport, for PageUp/PageDown. */
  pageRows: number;
  /** Scroll the virtualizer so `row` renders. */
  scrollToRow: (row: number) => void;
  /** The region (if any) containing a cell. */
  regionAt: (coord: CellCoord) => string | null;
  onCreate: (bounds: CellBounds) => void;          // → onRegionDraft
  onSelectRegion: (regionId: string) => void;      // → onRegionSelect
  onSelectionChange?: (bounds: CellBounds | null) => void;
  onHint?: () => void;                             // Enter with nothing to do
  readOnly?: boolean;
}

export interface SheetKeyboard {
  active: CellCoord;
  selection: CellBounds | null;
  /** Spread on the grid element. */
  gridProps: {
    role: "grid";
    "aria-rowcount": number;   // rowCount + 1 (header row)
    "aria-colcount": number;   // colCount + 1 (row-header column)
    "aria-multiselectable": true;
    "data-has-selection"?: "";  // present while `selection` is non-null
    onKeyDown: React.KeyboardEventHandler;
    onFocus: React.FocusEventHandler;
  };
  /** Spread on a body cell. */
  cellProps: (coord: CellCoord) => {
    role: "gridcell";
    "aria-colindex": number;   // col + 2
    "aria-selected": boolean;  // inside `selection`
    tabIndex: 0 | -1;          // 0 for `active`
    "data-cell-coord": string; // `${row}:${col}`
  };
  /** Pointer selection drives the same state (one marquee). */
  setSelection: (bounds: CellBounds | null, active?: CellCoord) => void;
}
```

**Rows and headers.**
- Rows carry `role="row"` and `aria-rowindex` = `row + 2`; the header row is 1.
- Column headers are `columnheader` with `aria-colindex` = `col + 2`.
- Row headers are `rowheader`.
- The corner cell is a `columnheader` with `aria-colindex` 1, containing the corner button.

**Key map.** On a cell; ignored when the event target isn't a cell.

| Key | Effect |
|---|---|
| ←/→/↑/↓ | Move one cell, stopping at the edges, and clear the selection |
| Home / End | First / last column of the row |
| Ctrl+Home / Ctrl+End | A1 / last cell |
| PageUp / PageDown | ± `pageRows` rows |
| Shift + any of the above | Extend `selection` from an anchor (the active cell when the selection began) |
| Shift+Space | Select the active row (full width) |
| Ctrl/Cmd+Space | Select the active column (full height) |
| Ctrl/Cmd+A | Select the whole sheet |
| Enter | With a selection larger than one cell: `onCreate(selection)`, then clear it. Otherwise, if the active cell is in a region: `onSelectRegion`. Otherwise: `onHint` |
| Escape | With a selection: clear it. Otherwise it's left to the step's handler (deselect region) |

- With `readOnly`, Enter does nothing and selection keys don't select; movement still works.
- Any move calls `scrollToRow(row)`. An effect focuses `[data-cell-coord="row:col"]` once it's in the DOM.
- `onSelectionChange` fires on each selection change.

### `SheetCanvasUI` (`SheetCanvas.component.tsx`)

**New props:**

```ts
  /** One hidden description per region, read by its cells (#795). Default: label + bounds. */
  regionDescriptions?: Record<string, string>;
  onSelectionChange?: (bounds: CellBounds | null) => void;
  onKeyboardHint?: () => void;
```

**Structure:**
- The grid element is the existing grid div (`:1188`), spreading `gridProps` and labelled by the sheet's name (`aria-label={sheet.name}`).
- Rows and cells spread the row and cell props above. Unloaded cells keep `aria-busy` and render "Loading…" as visually hidden text.
- **The corner** (`:1048`) becomes `<div role="columnheader" aria-colindex={1}><button type="button" aria-label="Select entire sheet" data-corner-header …/></div>`. A click keeps today's behaviour (a whole-sheet draft).
- **Descriptions:**
  - Each region renders `<span id={descId(region.id)} hidden>{regionDescriptions?.[id] ?? defaultDescription(region)}</span>` once.
  - A cell inside one or more regions gets `aria-describedby` listing those ids.
  - Default description: `Region <label>, <A1:D20>`.
- **Decorative elements get `aria-hidden="true"` and lose their `aria-label`:** segment overlays (:1355), non-editable intersections (:1535), dividers (:1682), and `SegmentStrip`'s wrapper (:134).
- **The editable intersection keeps its button role and name.** It isn't under an `aria-hidden` ancestor.
- **The pointer marquee and keyboard selection share state.** A pointer draw calls `setSelection` while dragging. On release it calls `onRegionDraft`, then clears the selection.
- **Selected cells** use the existing marquee fill. The theme handles focus: the active cell shows the 2 px ring from `a11yComponents` (an `&:focus-visible` rule on `[role=gridcell]` added there).

### `RegionOverlayUI` (`RegionOverlay.component.tsx`)

**New props:**

```ts
  /** The region has validation errors (#795): its tab says "Needs attention". */
  invalid?: boolean;
```

**Behaviour:**
- The root and all its children are `aria-hidden="true"`, and the `aria-label`s at :183, :205 and :251 are removed. Resize handles stay pointer-only; keyboard resize is the bounds fields.
- The label tab adds a "Selected" text chip when `selected`, and "Needs attention" when `invalid`. The theme styles them; no ad hoc `sx` in web, so the variant goes in `a11yComponents` or the theme JSONs.

### `useRegionAnnouncements` (new: `modules/RegionEditor/utils/use-region-announcements.util.ts`)

```ts
export function useRegionAnnouncements(input: {
  regions: RegionDraft[];
  selectedRegionId: string | null;
  describe: (r: RegionDraft) => string;   // "Customers, A1:D20"
}): {
  announcement: string;
  announceSelection: (bounds: CellBounds | null) => void;  // debounced 400 ms
  announceHint: () => void;                                 // once per mount
};
```

It diffs `regions` and `selectedRegionId` between renders and says:

| Change | Announcement |
|---|---|
| A region was added | "Region created: <describe>" |
| A region was removed | "Region deleted" |
| A region's bounds changed | "Bounds <A1:D20>" |
| `selectedRegionId` changed | "<describe> selected" (nothing on deselect) |
| `announceSelection` called | "<A1> to <D9> selected", or "<B3> selected" for one cell |
| `announceHint` called (first time only) | "Select cells with Shift and the arrow keys, then press Enter to add a region" |

Repeats are re-announced with #794's clear-then-write gap (`REANNOUNCE_GAP_MS`, which moves to a shared location).

### `RegionDrawingStepUI` (`RegionDrawingStep.component.tsx`)

- **The announcer.** It mounts `<StatusMessage visuallyHidden message={announcement} />` for the step's lifetime.
- **Descriptions.** It computes `regionDescriptions`: `"Region <entity label or 'unbound'>, <A1:D20>, records by <row|column>"`, plus `", needs attention: <first error>"` when the region has errors and `", drift detected"` when drifted. It also passes `invalid` per region to the overlays.
- **Canvas wiring.** It passes `onSelectionChange={announceSelection}` and `onKeyboardHint={announceHint}` to the canvas.
- **The Escape listener** (:296–343) is a document listener in capture phase, so it runs *before* the canvas. It skips an Escape whose target is inside `[role="grid"][data-has-selection]`. The canvas sets `data-has-selection` on its grid element while a keyboard or pointer selection exists, so the canvas's "clear selection" wins, and a second Escape deselects the region.
- **The step form** (:387) keeps `onKeyDown={preventToggleEnterSubmit}`. `eslint.a11y.config.js` gives `jsx-a11y/no-noninteractive-element-interactions` the option `form: ["onKeyDown"]`, with the reason (#789's Enter-submit delegation; the form is never the key's target). A per-line disable would fail the main `lint`, which doesn't load the plugin.

### Review step

| Component | Change |
|---|---|
| `RegionReviewCard` | A chip's `aria-label` becomes `Edit binding: <source> (<state>)`, where `<state>` ∈ {`bound to <column label>`, `unbound`, `excluded`, `invalid: <reason>`}. Display-only chips keep `role="status"`. Each chip list is wrapped in `role="group"` with `aria-label="Column bindings for <region label>"`. |
| `ReviewStep` (:509) | Covered by the same lint-config allowance as the drawing step's form. |
| `BindingEditorPopoverUI` (:226–251) | The paper's slot props become `role: "dialog"` plus `aria-label` (no `component: "form"`). The content's first child is `<form onSubmit=…>`, holding the existing fields and keeping `handleOwnSubmit` / `FormDefaultButton`. The status icon `span` becomes `role="img"` with its existing `aria-label`. |
| `RecordAxisTerminatorPopoverUI` | Focuses its first field on open via `useDialogAutoFocus(open)`. |

### `RegionEditorUI` (`RegionEditor.component.tsx`) and EditLayoutPlan

`RegionEditorUIProps` gains the review popover's props and forwards them to `ReviewStepUI`:
- `onUpdateBinding?`, `onToggleBindingExcluded?`, `columnDefinitionSearch?`;
- `resolveReferenceOptions?`, `resolveReferenceFieldOptions?`, `resolveColumnDefinitionType?`, `resolveColumnDefinitionDescription?`.

The types are the same as `ReviewStepUIProps`'.

`EditLayoutPlan.view.tsx` passes:
- `onUpdateBinding={(id, loc, patch) => setRegions((prev) => patchBinding({ regions: prev }, id, loc, patch).regions)}`;
- the same shape for `onToggleBindingExcluded`;
- `columnDefinitionSearch={sdk.columnDefinitions.search()}`;
- the resolver props the file-upload workflow builds, reusing its helpers.

`onEditBinding={() => undefined}` is removed.

### Upload

**`UploadStepUI` (:119–160).** The dropzone becomes a native `<button type="button">` with:
- `aria-label="Choose a file or drop it here"`, and `aria-describedby` → the accepted-types hint;
- Enter/Space (native) calling the hidden input's `click()`;
- `onDrop` and `onDragOver` kept.

**Core `FileUploader` (:110–150).** The same pattern: the drop area is a native `button` that opens the file input. Its props are unchanged.

## Migration

None.

## Seed

None.

## TDD test plan

Run from each package with `npm run test:unit -- --testPathPattern <pattern>`, never jest directly. Run the audit with `npm run a11y:report` from the root.

### Layer 1 — utils (`apps/web/src/modules/RegionEditor/__tests__/`)

| Test file | Cases |
|---|---|
| `a1-notation.util.test.ts` | ~9 |
| `use-sheet-keyboard.util.test.tsx` (new) | ~16 |
| `use-region-announcements.util.test.ts` (new) | ~8 |

- **`a1-notation.util.test.ts` (`parseRange`):**
  - `A1:D20`, reversed, a single cell, `A:D`, `3:10`;
  - lowercase and whitespace;
  - empty or garbage input → the error;
  - beyond the sheet → "Outside the sheet (A1:Z200)".
- **`use-sheet-keyboard.util.test.tsx`** (a harness renders a fake grid with a fake `scrollToRow` that renders rows on demand):
  - arrows, edges, Home/End, Ctrl+Home/End, PageUp/PageDown;
  - a move to an unrendered row calls `scrollToRow`, then focuses the cell once rendered;
  - Shift-extend from an anchor;
  - Shift+Space row band, Ctrl+Space column band, Ctrl+A whole sheet;
  - Enter on a selection → `onCreate` with normalized bounds, then cleared;
  - Enter in a region → `onSelectRegion`; Enter with nothing → `onHint`;
  - Escape with a selection clears it; without one it does nothing (the step owns it);
  - `data-has-selection` is set exactly while a selection exists;
  - `readOnly` blocks create and select;
  - `aria-selected` follows the selection;
  - exactly one `tabIndex=0`.
- **`use-region-announcements.util.test.ts`:** created, deleted, bounds changed, selected; nothing on deselect; the selection extent debounced; the hint only once; repeats re-announced.

### Layer 2 — components (`apps/web/src/modules/RegionEditor/__tests__/`, workflow tests)

| Test file | Cases |
|---|---|
| `SheetCanvas.test.tsx` | ~8 |
| `RegionRangeInput.test.tsx` (new) | ~5 |
| `RegionConfigurationPanel.test.tsx` | ~2 |
| `RegionDrawingStep.test.tsx` | ~6 |
| `RegionOverlay.test.tsx` | ~3 |
| `RegionReviewCard.test.tsx` | ~3 |
| `BindingEditorPopover.test.tsx` | ~3 |
| `RecordAxisTerminatorPopover.test.tsx` | ~1 |
| `RegionEditor.test.tsx` and `EditLayoutPlan` view test | ~3 |
| `UploadStep.test.tsx` and core `FileUploader.test.tsx` | ~5 |

- **`SheetCanvas.test.tsx`:**
  - grid roles, `aria-rowcount`/`aria-colcount` and indices;
  - a cell's name is its value;
  - a cell in a region is described by that region's text;
  - the corner is a button that drafts the whole sheet;
  - overlays are `aria-hidden` with no `aria-label`;
  - the editable intersection is still a named button;
  - pointer draw and keyboard share the marquee (`aria-selected`);
  - axe on a sheet with regions.
- **`RegionRangeInput.test.tsx`:** a typed range plus Enter → `onCreate`; the button does the same; invalid → `aria-invalid` plus message; outside the sheet → message; Enter doesn't submit the surrounding form.
- **`RegionConfigurationPanel.test.tsx`:** the empty state shows the Range field and creates through `onCreateRegionFromRange`.
- **`RegionDrawingStep.test.tsx`:**
  - the status says "Region created: …" after a keyboard create, "… selected" on select and "Region deleted" on Delete;
  - with a selection on the grid, Escape clears it and leaves the region selected; a second Escape deselects it;
  - axe on the step with regions and errors;
  - the existing #789 tests still pass.
- **`RegionOverlay.test.tsx`:** `aria-hidden`; "Selected" and "Needs attention" text appear.
- **`RegionReviewCard.test.tsx`:** chip names carry their state; groups are labelled.
- **`BindingEditorPopover.test.tsx`:** a `dialog` containing a `form`; axe clean (no `aria-allowed-role`); the status icon is an `img`.
- **`RecordAxisTerminatorPopover.test.tsx`:** the first field is focused on open.
- **`RegionEditor.test.tsx` / the EditLayoutPlan view test:** binding chips open the popover, and saving patches the binding.
- **`UploadStep.test.tsx` / core `FileUploader.test.tsx`:** the dropzone is a focusable button named "Choose a file or drop it here"; Enter and Space open the file input; drop still works; axe.

### Layer 3 — the audit (root)

- `npm run a11y:report`: #795's section has no rows, and no other owner gains a row.
- KB-08 is closed by hand.

**Totals:** about 82 cases. No migration or seed test.

## Acceptance criteria

- [ ] **Keyboard, no pointer.** A keyboard-only user can take a sheet from upload to a committed layout plan without a pointer. That covers choosing the file, moving on the sheet, creating regions by selection or typed range, configuring them, reviewing and editing bindings, Interpret, and Commit.
- [ ] **Screen reader.** A screen-reader user hears each cell's value and position as they move. They hear a region's entity, range, status and errors when on its cells, and hear regions created, selected, deleted and resized.
- [ ] **Not colour-only.** Selected and invalid regions show text, not only colour or shadow.
- [ ] **Typed ranges.** A region can be created by typing its range ("A1:D20", "A:D", "3:10").
- [ ] **EditLayoutPlan.** Its binding chips open the binding editor and save.
- [ ] **Audit.** `npm run a11y:report` shows no findings in #795's section, and axe passes in the RegionEditor component tests; KB-08 is closed.

## Risks & rollback

- **Keyboard events colliding with the step's capture-phase listener.**
  - **Risk:** the step's document listener sees keys first, in capture phase.
  - **Mitigation:** for Escape, the listener checks the grid's `data-has-selection`, which doesn't depend on event order. Delete/Backspace on the grid still delete the selected region, which is the documented key (discovery Q4).
  - **Detection:** `RegionDrawingStep` tests cover both Escape orders.
- **Virtualized focus.**
  - **Risk:** focusing a cell that hasn't rendered.
  - **Mitigation:** the hook's effect waits for the element (retrying on the virtualizer's next items).
  - **Detection:** the harness test; the smoke walk with a long fixture.
- **Wide sheets.**
  - **Risk:** grid attributes on every rendered cell add DOM weight.
  - **Detection:** measured at the smoke walk.
  - **Rollback:** grid attributes can be dropped per column range without changing behaviour.
- **Overlays turning `aria-hidden`.**
  - **Risk:** a control left inside an overlay would be hidden.
  - **Mitigation:** the only interactive one (the editable intersection) is kept outside, and a test asserts it's still reachable.
- **Fail mode:** presentation only. The visible editor is unchanged except the text cues.

## Files touched

**New**

`apps/web/src/modules/RegionEditor/`:
- `RegionRangeInput.component.tsx`
- `utils/use-sheet-keyboard.util.ts`
- `utils/use-region-announcements.util.ts`

Their tests under `__tests__/`.

**Edit (`apps/web/src/modules/RegionEditor/`)**
- `SheetCanvas.component.tsx`
- `RegionOverlay.component.tsx`
- `SegmentStrip.component.tsx`
- `RegionDrawingStep.component.tsx`
- `RegionConfigurationPanel.component.tsx`
- `ReviewStep.component.tsx`
- `RegionReviewCard.component.tsx`
- `BindingEditorPopover.component.tsx`
- `RecordAxisTerminatorPopover.component.tsx`
- `RegionEditor.component.tsx`
- `utils/a1-notation.util.ts`
- `index.ts`
- Stories touched as props change, and the existing tests above.

**Edit (elsewhere)**
- `apps/web/src/views/EditLayoutPlan.view.tsx`
- `apps/web/src/workflows/FileUploadConnector/UploadStep.component.tsx`
- `apps/web/src/utils/results-announcer.util.ts` (export the shared gap, if moved)
- `packages/core/src/ui/FileUploader.tsx`
- `packages/core/src/ui/ThemeProvider.tsx` (`a11yComponents`: gridcell focus ring, region tab chip)
- Their tests

**Docs**
- `docs/A11Y_AUDIT.md` (regenerated, KB-08 closed)
- `CLAUDE.md` if the new grid hook warrants a note (checked in the final slice)

## Next step

`docs/A11Y_REGION_EDITOR.plan.md` sequences this into 8 TDD slices on this branch:
1. Audit role fixes.
2. `parseRange` and the Range field.
3. Grid semantics and keyboard movement.
4. Keyboard selection and region creation, including the capture-phase interplay.
5. Region descriptions, text cues and announcements.
6. Review chips, popovers and EditLayoutPlan's binding editor.
7. Keyboard upload.
8. The audit regeneration and docs.
