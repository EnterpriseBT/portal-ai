# A11Y_REGION_EDITOR — Smoke Suite

Manual smoke test for [#795](https://github.com/EnterpriseBT/portal-ai/issues/795): the RegionEditor works without a pointer and for a screen reader. Choosing the file, moving on the sheet, creating regions by keyboard selection or typed range, configuring and reviewing them, editing bindings (now also on Modify Layout Plan), and committing all work from the keyboard. Regions are described and announced, and state shows in text. **Branch under test:** `feat/795-a11y-region-editor` (PR [#995](https://github.com/EnterpriseBT/portal-ai/pull/995)).

Run **Preflight** once. §1–§7 walk one import end to end, so do them in order; §8–§10 are independent after that. Steps tagged `— manual` need a human (a real screen reader, visual judgment, or a real Google or Microsoft account); the rest are agent-walkable with `/smoke-walk`. In the agent walk, "press" means a real key press in the browser (Playwright `keyboard.press`), never a click, unless the step says click.

Filing bugs: open an issue against `EnterpriseBT/portal-ai`, type `Bug`, linking this file's section (template at the bottom).

---

## Preflight

### Environment

- [ ] `git checkout feat/795-a11y-region-editor && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/core` (core changed: the grid-cell focus ring, `FileUploader`). No migration.
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`). Local uploads go to s3mock (`:9092`).
- [ ] Signed in as the e2e owner (`npm run --workspace @portalai/e2e e2e:auth`), in the `e2e-fixture` org.

### Fixtures

- [ ] The sample workbook `supported_layouts.xlsx`, served by the app at `http://localhost:3000/samples/supported_layouts.xlsx`, with one layout per sheet. Save it locally for the upload.
- [ ] Name §7's connector `a11y-795-smoke` in Commit so it's easy to find and delete.
- [ ] §8 and §9 need a **Google Sheets or Microsoft Excel** connector with a committed plan: Modify Layout Plan is offered only for those (`EDIT_PLAN_SLUGS` in `ConnectorInstance.view.tsx`), never for a file upload. That means signing in to a real Google or Microsoft account.

### Reset between runs

- [ ] Delete the `a11y-795-smoke` connector instance (Connectors → it → Delete) to re-run §1–§7.

## §1 — Choose the file by keyboard (slice 7)

- [ ] Open Connectors and start a **File Upload** connection. Press Tab until the drop zone has focus.
- [ ] The drop zone is a **button** named "Choose files or drop them here". Its description includes "Accepted formats:" and "Maximum file size:".
- [ ] With it focused, press **Enter**: the browser's file chooser opens. Agent walk: Playwright reports a `filechooser` event. Choose `supported_layouts.xlsx`.
- [ ] The file is listed and the upload and parse finish. The step moves on to drawing regions.
- [ ] While the upload runs, the drop zone is disabled. Dropping a file on it then doesn't open the file in the tab, and the app stays put. — manual (needs a real OS drag)

## §2 — The sheet is a grid you can move on (slice 3)

- [ ] The sheet is a `grid` named by the active sheet's name. Its `aria-rowcount` and `aria-colcount` are the sheet's size + 1.
- [ ] Press Tab into the grid: focus lands on cell A1 (`data-cell-coord="0:0"`), the grid's only tab stop. The focused cell shows a 2 px ring in both themes. — the ring check is manual
- [ ] Press ArrowRight, ArrowDown: focus is on B2. Home goes to A2 and End to the row's last column. Ctrl+End reaches the last cell and Ctrl+Home A1. PageDown moves about a screenful.
- [ ] After Ctrl+End, the focused cell is scrolled into view, and the column headers stay stuck at the top.
- [ ] Each cell's accessible name is its value. A row header names the row number and a column header its letter.

## §3 — Create a region by keyboard (slices 2 and 4)

- [ ] **Typed range:** with no region selected, the panel says "Draw a region on the sheet, or type its range:" and shows a **Range** field. Type `A1:C5`, press Enter. A region appears over A1:C5, the step's Interpret does **not** run, and focus moves into the new region's form.
- [ ] **Bad input:** clear the selection (Escape), type `hello` in Range, press Enter. The field is invalid and reads "Enter a range like A1:D20". Focus stays in the field. `A1:ZZ9999` reads "Outside the sheet (A1:<last cell>)".
- [ ] **Selection:** focus a cell outside the first region, press Shift+ArrowRight twice and Shift+ArrowDown twice. A dashed marquee covers the selection, and those cells are `aria-selected="true"`. Press Enter: a second region is created from those bounds and the marquee clears.
- [ ] **Bands:** Shift+Space selects the active row, Ctrl+Space the column, Ctrl+A the whole sheet (the marquee shows each). Escape clears it.
- [ ] **Corner:** Tab to "Select entire sheet" (the corner button) and press Enter. A whole-sheet region draft is created.

## §4 — Selecting, Escape and Delete (slice 4)

- [ ] On a cell inside a region, press Enter: that region is selected and the panel shows it.
- [ ] With a region selected, make a selection on the sheet (Shift+Arrow). Press Escape: the marquee clears and the region **stays** selected. Press Escape again: the region is deselected.
- [ ] Select a region and press Delete with focus on the grid: the region is deleted (undo by recreating it, or keep the whole-sheet draft out of the way).
- [ ] On an empty cell with nothing selected, press Enter. The status region says "Select cells with Shift and the arrow keys, then press Enter to add a region", only the first time.

## §5 — What a screen reader gets (slice 5)

- [ ] A cell inside a region has an accessible description like "Region <entity or Unbound>, A1:C5, records by row".
- [ ] The hidden status region (`role="status"`) reads "Region created: …" after a create, "… selected" after selecting, "Region deleted" after a delete, and "Bounds A1:C6" after changing a region's End row in the panel.
- [ ] Shift-selecting from A1 to C3 announces "A1 to C3 selected" about half a second after the last key.
- [ ] With VoiceOver or NVDA: moving on the grid reads each cell's value and position. On a region's cells it reads the region description, and region changes are spoken. — manual

## §6 — State in words, not only colour (slice 5)

- [ ] The selected region's label tab shows the text "Selected".
- [ ] Press Interpret with a region that has no entity: the region's tab shows "Needs attention", and its cells' description ends ", needs attention: <the first error>".
- [ ] The badges are legible against the region colour. — manual (visual)

## §7 — Review, bindings and commit by keyboard (slices 1 and 6)

- [ ] Give each region an entity (panel → Target entity), then Interpret (Enter on the step's primary). The Review step loads.
- [ ] Each region's chips are in a group named "Column bindings for <region>". Each chip's name reads "Edit binding: <source> (bound to <label>)", "(unbound)", "(excluded)" or "(invalid: <reason>)", and bound chips show a **label**, never a UUID.
- [ ] Tab to a chip and press Enter: a dialog "Edit column binding" opens with focus inside, its first field focused where it has one. Escape closes it.
- [ ] In the panel, open the extent ("Grow until terminator") popover: focus lands on its checkbox.
- [ ] Name the connector `a11y-795-smoke` and Commit by keyboard. The connector is created and its page shows its entities.

## §8 — Modify Layout Plan's binding editor (slice 6) — manual (real Google or Microsoft account)

A file-upload connector has no Modify Layout Plan (its file was a one-off; the fix for its layout is a re-upload), so this section runs on a cloud-spreadsheet connector.

- [ ] Create a **Google Sheets** (or Microsoft Excel) connector over a copy of the sample workbook, draw a region, Interpret and Commit.
- [ ] On its page, open **Modify Layout Plan** from the menu beside the primary action. Interpret again to reach Review.
- [ ] Chips show column-definition labels (not UUIDs). Pressing Enter on one opens "Edit column binding". Before #795 these chips did nothing.
- [ ] Check "Omit this column from the entity" on one binding and close the editor. Its chip now reads "… (excluded)".
- [ ] Commit. Reopen Modify Layout Plan and go to Review: the same chip still reads "(excluded)", so the edit was saved.
- [ ] On a pivoted region with a cell-value chip, omit it the same way, commit and reopen: it's still excluded. — if no layout yields a cell-value chip, record it

## §9 — Edges from the code review

- [ ] **Sheet switch:** make a Shift-selection on one sheet, then switch to another sheet tab. No marquee carries over, and Enter on a cell doesn't create a region on the new sheet.
- [ ] **Read-only:** on a Google Sheets or Microsoft Excel connector the e2e member can read but not write, Modify Layout Plan is hidden or disabled (unchanged behaviour), so no keyboard path creates a region. — manual (needs §8's cloud connector, shared Read with the member)
- [ ] **No console errors** during §2–§8 (browser console shows no React warnings about hook order or keys).

## §10 — Audit

- [ ] `docs/A11Y_AUDIT.md`'s "#795 RegionEditor spreadsheet canvas" section reads "No automated findings.", and KB-08 starts "**Closed:**".
- [ ] `npm run a11y:lint -w @portalai/web` writes `apps/web/a11y-results/eslint.json` with zero messages.

## Sign-off

- [ ] Every section above verified
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/job/entity ids):
