# A11Y_REGION_EDITOR — Adversarial Review

Adversarial probes for [#795](https://github.com/EnterpriseBT/portal-ai/issues/795): the RegionEditor driven from the keyboard and read by a screen reader (the APG grid, Shift-selection and typed ranges, Escape/Delete ordering, region descriptions and announcements, review chips and the binding editor, the upload button). **Branch under test:** `feat/795-a11y-region-editor` (PR [#995](https://github.com/EnterpriseBT/portal-ai/pull/995)).

The change is frontend-only, with no new endpoint or request field (see the security row on the PR). So the probes aim at what keyboard use makes routine: keys that reach the wrong handler, input the range field and the sheet's cells feed into names and announcements, repeated keys, and the editor's state going stale under them. Untagged probes are agent-walkable; `— manual` needs a human.

## Preflight

### Environment

- [ ] `git checkout feat/795-a11y-region-editor && git pull --ff-only`, `npm install && npm run build --workspace=packages/core`, `npm run dev` (web :3000, API :3001, s3mock :9092)
- [ ] Playwright MCP available; signed in as the e2e owner in `e2e-fixture`

### Fixtures

- [ ] `supported_layouts.xlsx` (from `http://localhost:3000/samples/supported_layouts.xlsx`)
- [ ] `big.csv`: 5,000 rows × 30 columns of plain values (any generator; the walk writes one to the scratchpad)
- [ ] `hostile.csv`: a header row plus rows whose cells hold `<img src=x onerror=alert(1)>`, `<b>bold</b>`, `=HYPERLINK("http://example.com")`, `"; DROP TABLE x; --`, a 5,000-character string, an emoji string and a right-to-left string (`שלום`)

### Reset between runs

- [ ] Nothing commits unless a probe says so; close the wizard (Cancel) between files. Delete any connector a probe created.

## §1 — Boundary & limit inputs

- [ ] **Range field edges** (on a 12 × 6 sheet), one at a time, each followed by Enter:
  - `A1`: one-cell region A1:A1.
  - `c5:a1`: reversed and lower case, normalized to A1:C5.
  - `A:C`: the whole columns.
  - `2:4`: the whole rows.
  - `F12`: the last cell.

  Expected SAFE: each creates exactly that region, and the panel shows those bounds.
- [ ] **Range field limits:**
  - `A0`, `A1:A0`, `1:`, `:B2`, `A`, `5`: each reads "Enter a range like A1:D20".
  - `G1`, `A13`, `A1:ZZZZZZZZZZZZZZZZZZZZ9`, `A1:A99999999999999999999`: each reads "Outside the sheet (A1:F12)".

  Expected SAFE: no region is created, no console error, focus stays in the field.
- [ ] **Big sheet movement** (`big.csv`): press Ctrl+End, then PageDown, then ArrowDown and ArrowRight at the last cell. Then Ctrl+Home, then ArrowUp and ArrowLeft at A1. Expected SAFE: focus stops at the edges (no wrap, no lost focus). The focused cell is always rendered and in view, and the grid keeps exactly one `tabindex="0"`.
- [ ] **Big sheet bands** (`big.csv`): press Ctrl+A, then Enter. Then Ctrl+Space on column AD, then Enter. Expected SAFE: the regions are A1:AD5001 and AD1:AD5001. The page stays responsive (no frame lasting over about 2 s). Only rendered cells carry `aria-selected`; there are no 150,000 DOM nodes.

## §2 — Malformed & injection input

- [ ] **Hostile range text:** type each of these in Range and press Enter, one at a time:
  - `<img src=x onerror=alert(1)>`
  - `=SUM(A1)`
  - `A1:B2:C3`
  - `A1;C5`
  - `Ａ１:Ｃ５` (full-width)
  - `A 1 : C 5`

  Expected SAFE: no script runs and no dialog appears. Full-width and unknown text read "Enter a range like A1:D20". `A 1 : C 5` (whitespace) is accepted as A1:C5. The status region holds plain text only.
- [ ] **Hostile cell values** (`hostile.csv`): Tab into the grid and move over each hostile cell, Shift-select across them and press Enter. Then press Enter on a cell inside the new region. Expected SAFE:
  - no script runs and no element is injected;
  - each cell's accessible name is its literal text (`<b>bold</b>` reads as those characters);
  - the region description and every status message are plain text;
  - the 5,000-character cell's name doesn't freeze the page.
- [ ] **Hostile entity and binding labels:** create a new entity from the panel named `<img src=x onerror=alert(1)>`, give it to a region and Interpret. Tab through the review chips and open the binding editor. Expected SAFE:
  - the cell description ("Region <name>, …"), the chip group name ("Column bindings for …") and the chip names render the label as text;
  - nothing executes.

## §3 — Concurrency & races

- [ ] **Double Enter on a selection:** Shift-select B2:C3, then press Enter twice in one burst (`keyboard.press` twice with no wait). Expected SAFE: exactly one region B2:C3. The second Enter selects that region (the cell is now inside it), and there are no duplicates.
- [ ] **Double Enter in Range:** type `A1:C5` and press Enter twice in one burst. Expected SAFE: one region. The Range field has gone, so the second Enter lands in the new region's form and doesn't submit Interpret.
- [ ] **Corner button bursts:** focus "Select entire sheet" and press Enter three times in one burst. Expected SAFE: one whole-sheet region (the 1 s draft window). A fourth Enter after 2 s is allowed to make a second region.
- [ ] **A key while Interpret runs:** with a valid region, press Enter on Interpret. While "Interpreting…" shows, press Delete, Escape, then Shift+Arrow and Enter on the grid. Expected SAFE:
  - the wizard stays open (a pending wizard can't be dismissed);
  - the interpret request is sent once;
  - the Review step that loads matches the regions as they were when Interpret was pressed, and no region is deleted underneath it.

## §4 — Auth & permission boundaries

- N/A — no new endpoint, request field or affordance gate. Binding edits reach the server only through the existing commit, with its authorization unchanged (security row on #995). The read-only member path was waived at smoke (it needs a cloud connector).

## §5 — Multi-tenant isolation

- N/A — no new request. The catalog and entity lookups behind the chip labels are the existing org-scoped `columnDefinitions.listAll`/`search` and `connectorEntities.search`.

## §6 — State & lifecycle abuse

- [ ] **Backspace on a non-text control:** select a region. Focus, in turn, the panel's **Target entity** select (closed), the **Grow until terminator** checkbox, the **+ Add row axis** button and the region's label tab on the sheet. On each, press Backspace, then Delete. Expected SAFE: the region is deleted only where deleting is what the key means (the grid, the region's own overlay). Watch for a Backspace on a form control removing the region, along with its bindings, with no undo. Record which controls delete it.
- [ ] **Escape inside a popup:** with a region selected, open each of these and press Escape once:
  - the Target entity menu;
  - the extent popover;
  - the "Jump to region" select;
  - (on Review) the binding editor.

  Expected SAFE: only the popup closes. The region stays selected, the wizard stays open, and focus returns to the control that opened the popup.
- [ ] **Delete the region under focus:** Enter on a cell inside region R (selects it), then Delete. Expected SAFE: R is gone; focus stays on that cell, which is still the grid's single tab stop; its `aria-describedby` no longer names R; the status says "Region deleted".
- [ ] **Stale selection after a sheet switch:** Shift-select on sheet 1. Switch to sheet 2 with the keyboard: Tab to the sheet tabs, then Arrow and Enter. Press Enter on the grid, switch back to sheet 1 and press Enter again. Expected SAFE: no region is created on either sheet from the old selection, and no marquee shows on sheet 1 after returning.
- [ ] **Back from Review:** reach Review, press Back, then Escape on the grid three times. Expected SAFE: the regions are intact, the wizard stays open, and focus is in the grid or on Back, not lost to `body`.
- [ ] **Review after a region changes:** on Review, open a chip's binding editor and set a binding. Go Back, shrink that region by one column with End column in the panel, and Interpret again. Expected SAFE:
  - no chip keeps a binding for the removed column;
  - no chip names a UUID;
  - Commit isn't left enabled over a plan the server refuses, other than through #998's known path.

## §7 — Misuse sequences

- [ ] **Overlapping regions:** create A1:C5, then type `B2:D6`. Expected SAFE:
  - both regions exist (the editor allows overlap);
  - a cell in the overlap (C3) is described by both regions;
  - Enter on C3 selects one of them deterministically, and Escape then deselects it.
- [ ] **Hint spam:** on an empty cell with nothing selected, press Enter ten times. Move to another empty cell and press Enter ten times. Expected SAFE: the hint is announced once (the status region doesn't fill with repeats), no region is created and no error appears.
- [ ] **Escape spam on the sheet:** with nothing selected, press Escape twenty times on a grid cell. Expected SAFE: the wizard stays open and the drawn regions are intact.
- [ ] **Escape from the panel after work:** draw two regions, Tab into the panel's Start row field and press Escape. Expected SAFE: record the outcome. Escape from outside the sheet still closes the wizard by design (smoke finding 2 was narrowed to the sheet), so a closed wizard is the known residual risk, not a new finding. Note whether the drawn work is lost.
- [ ] **Screen reader flood** — manual (VoiceOver or NVDA): hold Shift+ArrowRight across a whole row, then hold ArrowDown down a column on `big.csv`. Expected SAFE: the reader speaks the final extent once after the pause. It doesn't queue an announcement per key, and doesn't stay seconds behind.

## Findings

| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk; empty when every probe held)_ | | low / med / high | fixed-in-PR / waived: <reason> |

## Sign-off

- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org/job/entity ids):
