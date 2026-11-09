# Accessible RegionEditor — Plan

**This is the test-first order for #795's contract:**
- audit role fixes;
- typed ranges;
- an APG grid on the virtualized sheet;
- keyboard selection that creates regions;
- region descriptions and announcements;
- review chips and EditLayoutPlan's binding editor;
- keyboard upload;
- the regenerated audit.

Spec: `docs/A11Y_REGION_EDITOR.spec.md`. Discovery: `docs/A11Y_REGION_EDITOR.discovery.md`. Issue: #795, a child of epic #791. Builds on #794's `StatusMessage` `visuallyHidden`, `REANNOUNCE_GAP_MS` and `VisuallyHidden`, #793's `Modal`/`useDialogAutoFocus`, and #789's step rules, all on `epic/a11y-conformance`.

There are 8 slices. Each sits behind a green test suite and leaves the repo compilable. Each lands as a commit on `feat/795-a11y-region-editor` (PR #995).

Run tests from each package (never jest directly):

```bash
cd apps/web && npm run test:unit -- --testPathPattern <pattern>
cd packages/core && npm run test:unit -- --testPathPattern <pattern>
cd packages/core && npm run build   # before web runs that need a core change
```

Each slice:
1. write the failing tests;
2. make the smallest change that turns them green;
3. run the focused tests;
4. run `npm run lint && npm run type-check && npm run format:check` in each touched package;
5. move to the next slice.

**Sequencing rationale.** The leaf pieces come first, the canvas core in the middle, the wiring last:

| Slice | Why it sits here |
|---|---|
| 1 | The audit's role fixes are independent markup changes. Doing them first means later slices build on clean overlays and a real corner button. |
| 2 | `parseRange` is pure. The Range field gives a keyboard create path before the canvas keyboard exists. |
| 3 | Grid semantics and movement are the riskiest part, the virtualized focus. They come before selection, which needs an active cell. |
| 4 | Keyboard selection and creation build on slice 3. They settle the Escape ordering with the step's capture listener. |
| 5 | Descriptions, text cues and announcements read the region and selection state slices 3–4 produce. |
| 6 | Review step and EditLayoutPlan: separate files, no dependency on the canvas. |
| 7 | Upload: separate files (workflow and core). |
| 8 | The audit regeneration has to run last, when the area is clean. |

---

## Slice 1 — Audit role fixes

**Files**
- Edit: `SheetCanvas.component.tsx`:
  - the corner becomes `<div role="columnheader">` holding a `<button aria-label="Select entire sheet">` (click → whole-sheet `onRegionDraft`);
  - segment overlays (:1355), non-editable intersections (:1535) and dividers (:1682) become `aria-hidden` with no `aria-label`.
- Edit: `RegionOverlay.component.tsx`: the root is `aria-hidden`, and the `aria-label`s at :183, :205 and :251 are removed.
- Edit: `SegmentStrip.component.tsx:134`: the wrapper is `aria-hidden`; its chips stay buttons outside it, or the wrapper becomes a labelled `group` if the chips live inside it. Check the markup.
- Edit: `BindingEditorPopover.component.tsx`:
  - the paper is `role: "dialog"` plus `aria-label`, with no `component: "form"`;
  - an inner `<form>` keeps `handleOwnSubmit` and `FormDefaultButton`;
  - the status icon is `role="img"`.
- Edit: `eslint.a11y.config.js`: `no-noninteractive-element-interactions` allows `onKeyDown` on a `<form>`, with its reason, covering `RegionDrawingStep.component.tsx:387` and `ReviewStep.component.tsx:509` (a per-line disable would fail the main `lint`).
- Edit the tests: `SheetCanvas.test.tsx`, `RegionOverlay.test.tsx`, `BindingEditorPopover.test.tsx`.

**Steps**
1. **Tests** (spec Layer 2):
   - the corner is a button that drafts the whole sheet;
   - overlays are `aria-hidden` with no `aria-label`;
   - the editable intersection is still a named button;
   - the popover is a `dialog` containing a `form`, and its icon is an `img`;
   - axe on the canvas-with-regions and popover stories (via the tests).

   Run them; they fail.
2. **Implement.** Green. Check that `npm run a11y:lint -w @portalai/web` no longer reports the two form rows.
3. Lint and type-check.

**Done when:** axe passes on `SheetCanvas`, `RegionOverlay` and `BindingEditorPopover` in tests, with every existing pointer test green.

**Risk:** existing tests that query overlays by `aria-label` ("Resize …", orientation labels) must switch to `data-testid` or role queries. Update them, don't delete them.

---

## Slice 2 — Typed ranges create regions

**Files**
- Edit: `utils/a1-notation.util.ts` (`parseRange`, `ParseRangeResult`), plus the `a1-notation.util.test.ts` cases.
- New: `RegionRangeInput.component.tsx` and `__tests__/RegionRangeInput.test.tsx`.
- Edit: `RegionConfigurationPanel.component.tsx`: the empty state renders `RegionRangeInputUI` through the new `onCreateRegionFromRange` prop.
- Edit: `RegionDrawingStep.component.tsx`: passes `(bounds) => onRegionDraft({ sheetId, bounds })`.
- Edit: the panel and step tests, and the panel story's empty state.

**Steps**
1. **Tests:**
   - spec Layer 1 `parseRange` (9 cases);
   - Layer 2 `RegionRangeInput` (5 cases), including that Enter doesn't submit the step form;
   - panel empty state (2 cases);
   - a step test: type "A1:C4", press Enter, and the step's `onRegionDraft` gets the sheet id and bounds.

   Run them; they fail.
2. **Implement.** Green.
3. Lint and type-check.

**Done when:** a region can be created without a pointer. This is KB-08's core.

**Risk:** the step form's #789 Enter handling. The field's Enter `preventDefault`s, and a test pins that Interpret doesn't run.

---

## Slice 3 — The sheet as a grid; keyboard movement

**Files**
- New: `utils/use-sheet-keyboard.util.ts` (movement, the active cell and focus-after-scroll; no selection yet) and `__tests__/use-sheet-keyboard.util.test.tsx`.
- Edit: `SheetCanvas.component.tsx`:
  - `gridProps` on the grid div, labelled by the sheet name;
  - `role="row"` plus `aria-rowindex` on rows;
  - `columnheader`/`rowheader` with indices;
  - `cellProps` on cells;
  - `scrollToRow` → `rowVirtualizer.scrollToIndex(row)`;
  - `pageRows` from the viewport height.
- Edit: `packages/core/src/ui/ThemeProvider.tsx` (`a11yComponents`): the `[role=gridcell]:focus-visible` ring. Then rebuild core.
- Edit: `SheetCanvas.test.tsx`.

**Steps**
1. **Tests:**
   - spec Layer 1 movement cases: arrows, edges, Home/End, Ctrl+Home/End, PageUp/PageDown, scrolling to an unrendered row then focusing it, one tab stop;
   - Layer 2: grid roles, counts and indices, and a cell's name is its value;
   - unloaded cells are `aria-busy` with "Loading…".

   Run them; they fail.
2. **Implement** the hook against a harness grid first, then wire it into `SheetCanvas`. Green.
3. Lint and type-check, in web and core.

**Done when:** a keyboard user can reach and read any cell of a 1,000-row fixture, and focus survives virtualization.

**Risk:**
- **Focus after `scrollToIndex`:** the cell renders a frame later. The hook's effect depends on the virtualizer's items and focuses once the element exists. The harness test models the delay.
- **The pointer path:** `handleGridPointerDown` must ignore the focus a click now gives a cell. Keep the pointer tests green.

---

## Slice 4 — Keyboard selection creates regions

**Files**
- Edit: `utils/use-sheet-keyboard.util.ts`:
  - the anchor and `selection`;
  - Shift-extend, Shift+Space, Ctrl+Space and Ctrl+A;
  - Enter to create, select or hint; Escape to clear;
  - `data-has-selection`, `aria-selected` and `setSelection`;
  - `readOnly`.
- Edit: `SheetCanvas.component.tsx`:
  - a pointer draw calls `setSelection` while dragging, so there's one marquee;
  - the marquee renders from `selection`;
  - new props `onSelectionChange` and `onKeyboardHint`;
  - `regionAt` built from `regions`.
- Edit: `RegionDrawingStep.component.tsx`: the capture Escape listener skips targets inside `[role="grid"][data-has-selection]`.
- Edit: the hook test, `SheetCanvas.test.tsx`, `RegionDrawingStep.test.tsx`.

**Steps**
1. **Tests:**
   - spec Layer 1 selection cases: Shift-extend, bands, Ctrl+A, Enter create/select/hint, Escape, `readOnly`, `data-has-selection`, `aria-selected`;
   - `SheetCanvas`: pointer and keyboard share the marquee;
   - `RegionDrawingStep`: with a selection on the grid, Escape clears it and leaves the region selected; a second Escape deselects it; Delete/Backspace still delete the selected region.

   Run them; they fail.
2. **Implement.** Green.
3. Lint and type-check.

**Done when:** a region can be created and selected from the sheet by keyboard alone, and Escape behaves as the spec says in both orders.

**Risk:** the 350 ms touch long-press shares the marquee. Keep its tests green.

---

## Slice 5 — Region descriptions, text cues, announcements

**Files**
- New: `utils/use-region-announcements.util.ts` and its test.
- Move: `REANNOUNCE_GAP_MS` to a shared location (`apps/web/src/utils/live-region.util.ts`), re-exported where #794's announcer imports it.
- Edit: `SheetCanvas.component.tsx`: one hidden description span per region; cells get `aria-describedby`; the `regionDescriptions` prop.
- Edit: `RegionOverlay.component.tsx`: the `invalid` prop, and "Selected" / "Needs attention" text chips styled through the theme.
- Edit: `packages/core/src/ui/ThemeProvider.tsx` or the theme JSONs: the region-tab chip style, if one is needed.
- Edit: `RegionDrawingStep.component.tsx`:
  - computes descriptions and `invalid`;
  - mounts the persistent hidden `StatusMessage`;
  - wires `onSelectionChange` and `onKeyboardHint`.
- Edit: the tests.

**Steps**
1. **Tests:**
   - spec Layer 1 announcements (8 cases);
   - `SheetCanvas`: a cell in a region is described by the region's text;
   - `RegionOverlay`: the text cues appear;
   - `RegionDrawingStep`: "Region created: …" after a keyboard create, "… selected", "Region deleted"; descriptions include "needs attention: <error>" and "drift detected"; axe with regions and errors.

   Run them; they fail.
2. **Implement.** Green.
3. Lint and type-check.

**Done when:** a screen reader hears region context on its cells and every region change, and no region state depends on colour alone.

**Risk:** announcement noise on a pointer drag. The selection extent is debounced, and a drag's creation says it once.

---

## Slice 6 — Review chips, popovers, EditLayoutPlan's binding editor

**Files**
- Edit: `RegionReviewCard.component.tsx`: chip names with their state, and labelled chip groups.
- Edit: `RecordAxisTerminatorPopover.component.tsx`: `useDialogAutoFocus(open)`.
- Edit: `RegionEditor.component.tsx`: forward the review popover props.
- Edit: `views/EditLayoutPlan.view.tsx`:
  - `onUpdateBinding` and `onToggleBindingExcluded` via `patchBinding({ regions })`;
  - `columnDefinitionSearch` and the resolver props (reusing the file-upload workflow's helpers);
  - remove the no-op `onEditBinding`.
- Edit: the tests (`RegionReviewCard`, `RecordAxisTerminatorPopover`, `RegionEditor`, the EditLayoutPlan view test).

**Steps**
1. **Tests:**
   - chip names carry bound/unbound/excluded/invalid;
   - groups are named;
   - the terminator popover focuses its field;
   - `RegionEditor` forwards the props (the chip opens the popover);
   - EditLayoutPlan: a chip opens the editor, and saving patches the region's binding.

   Run them; they fail.
2. **Implement.** Green.
3. Lint and type-check.

**Done when:** every review chip says its state and opens a working editor, on the wizard and on EditLayoutPlan.

**Risk:** **the resolver props EditLayoutPlan needs** (reference options and the column type). Reuse the workflow's builders. If one depends on workflow-only state, derive it from the page's regions and connector entities. A genuine gap gets recorded and its prop omitted; the popover tolerates that.

---

## Slice 7 — Upload by keyboard

**Files**
- Edit: `workflows/FileUploadConnector/UploadStep.component.tsx`: the dropzone becomes a native `button` (named "Choose a file or drop it here", described by the accepted types) that opens the hidden input; drop is kept.
- Edit: `packages/core/src/ui/FileUploader.tsx`: the same pattern.
- Edit: the tests (`UploadStep`, core `FileUploader`), and the workflow test's axe.

**Steps**
1. **Tests:**
   - a focusable button with the name;
   - Enter and Space open the file input (spy on the input's `click`);
   - a drop still delivers files;
   - axe.

   Run them; they fail.
2. **Implement.** Rebuild core. Green.
3. Lint and type-check, in web and core.

**Done when:** choosing a file needs no pointer.

**Risk:** a button containing the file list or other interactive children is invalid. Keep the list outside the button.

---

## Slice 8 — Regenerate the audit; doc sync

**Files**
- Regenerated: `docs/A11Y_AUDIT.md` via `npm run a11y:report` (the dev stack running; refresh `e2e:auth:all` first).
- Edit: `docs/A11Y_AUDIT.md` KB-08 → "**Closed:**", citing slices 2 and 4.
- Edit: `CLAUDE.md`, only if the new sheet keyboard model is a convention others should follow: one sentence pointing at `use-sheet-keyboard.util.ts` for virtualized grids, beside #794's grid bullet.

**Steps**
1. Run the full web and core unit suites for the touched packages.
2. Run `npm run a11y:report`. #795's section must be empty, and no other owner may gain a row. If anything remains, fix it in the slice that owns it (an extra commit), then regenerate.
3. Write the docs.

**Done when:** the audit's #795 section reads "No automated findings." and KB-08 is closed.

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 | Corner button, `aria-hidden` overlays, popover dialog/form, reasoned disables | Canvas/overlay/popover tests and axe |
| 2 | `parseRange`, the Range field, the panel's empty state | Parser and field tests; step create test |
| 3 | Grid roles, the active cell, virtualized focus | Hook harness and canvas role tests |
| 4 | Keyboard selection, bands, Enter create/select, Escape ordering | Hook selection tests and step Escape tests |
| 5 | Region descriptions, text cues, the announcer | Announcer tests; canvas descriptions; step axe |
| 6 | Chip names and groups, popover focus, EditLayoutPlan binding editor | Review and EditLayoutPlan tests |
| 7 | Keyboard dropzone (workflow and core) | Upload and `FileUploader` tests and axe |
| 8 | Audit regenerated, KB-08 closed, docs | `npm run a11y:report` |

## Cross-slice notes

- **Core rebuild:** before web runs that need core changes (slices 3, 5, 7).
- **Partial module mocks:** RegionEditor tests mock pieces of `@portalai/core/ui`. A new core import (the `StatusMessage` `visuallyHidden` path, `VisuallyHidden`) must be in those fakes. Grep before pushing.
- **Stories:** the story sweep runs every RegionEditor story, so update the stories whose props change (the panel's empty state, the canvas) in the slice that changes them.
- **Styling:** text cues and focus rings go in the theme (`a11yComponents` or the theme JSONs), never an ad hoc `sx` in web.
- **Merge gate:** after slice 8, run the full chain: code-review, security (likely clean: presentation, plus EditLayoutPlan's in-memory binding edits, no new API), smoke (a keyboard-only upload to commit) and adversarial.

## Next step

Once this plan is confirmed, implementation starts on this branch with slice 1, tests first, one commit per slice.
