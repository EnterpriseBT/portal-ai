# OVERHANG_REPLAY_WARNING — Smoke Suite

Manual smoke test for [#1009](https://github.com/EnterpriseBT/portal-ai/issues/1009): warnings when a synced layout plan runs past its sheet or loses it, Fit to sheet, and Edit layout opening a plan whose region's sheet is gone. **Branch under test:** `feat/1009-overhang-replay-warning` (PR [#1013](https://github.com/EnterpriseBT/portal-ai/pull/1013)).

Steps tagged `— manual` need a real Google Sheets (or Microsoft Excel) account, since sync and Edit layout only exist for those connectors. Everything else can be agent-walked (`/smoke-walk`), mostly in the web Storybook, which renders the same components.

## Preflight

### Environment

- [ ] `git checkout feat/1009-overhang-replay-warning && git pull --ff-only`
- [ ] `npm install`. No migration: the new fields live in the job result's JSONB and are optional.
- [ ] `npm run build --workspace @portalai/spreadsheet-parsing && npm run build --workspace @portalai/core` (the API and web read both from `dist`)
- [ ] `npm run dev` boots cleanly (API :3001, web :3000)
- [ ] `npm run storybook --workspace @portalai/web` serves :7007

### Fixtures

- [ ] Signed in to the e2e-fixture org (`npm run --workspace @portalai/e2e e2e:auth`) for the agent-walkable steps.
- [ ] For the `— manual` steps: a Google Sheets connector whose layout plan is committed, built from a sheet you control. A sheet named "Q3" with headers in row 1, an identity column (e.g. email) in column A, and ~20 data rows, drawn as one region covering all of it, is enough. Note the entity's record count after the first sync.
- [ ] A second identity with **read but not write** on that connector (e.g. the e2e member, `npm run --workspace @portalai/e2e e2e:use member`), for the no-link check.

### Reset between runs

- [ ] Restore the Google sheet (undo the deleted rows/columns, rename "Q3 (old)" back to "Q3"), then Sync once so the records match the source again. The Storybook and File Upload steps are read-only, and their wizards are discarded uncommitted.

## §1 — Sync feedback against a real sheet — manual

- [ ] Delete the sheet's last 5 data rows in Google Sheets, then click **Sync** on the connector page. — manual
- [ ] Expected: the sync completes, and its message is a warning (not the green "Sync complete") titled "Synced, but part of the layout plan no longer fits the source". It names the region, e.g. `A1:C21 on "Q3" (<entity>) runs past the sheet's last row (16): rows 17–21 are gone from the sheet, so their records were removed.`, followed by the tally. — manual
- [ ] Expected: the entity's records page shows 5 fewer records, and none is blank (the old behaviour wrote all-blank records for the gone rows). — manual
- [ ] Expected: Jobs → the sync job → Result shows `replayWarnings` with `kind: "bounds-overflow"`, `sheetLastRow: 16`, `recordsAxis: "row"` and the entity's label in `targetEntityLabel`. — manual
- [ ] Restore the rows, then delete a **non-identity** column (e.g. the last one) and Sync. Expected: the warning says `… runs past the sheet's last column (<X>): column <Y> is gone from the sheet, so it was skipped.` — manual
- [ ] Restore, then rename the sheet to "Q3 (old)" and Sync. Expected: the sync completes, and the message says `A1:C21 (<entity>) was on sheet "Q3", which is no longer in the workbook, so it replayed nothing. Its records weren't refreshed.` The entity's record count is unchanged. — manual
- [ ] On that warning, click **Modify layout plan**. Expected: it navigates to the connector's layout editor (`/connectors/<id>/layout-plan/edit`). — manual
- [ ] Signed in as the read-only identity, view the same connector after a warned sync (or trigger one if allowed). Expected: the warning shows with **no** "Modify layout plan" link. — manual
- [ ] Restore, then delete the **identity** column (A) and Sync. Expected: the sync fails with an identity-drift error rather than completing. Without its identity column every record would share an empty source id, so the halt is intended, as the FAQ says. — manual

## §2 — Sync feedback in Storybook

- [ ] Open `Components/ConnectorInstanceSyncFeedbackUI` → "Sync complete with replay warnings (#1009)".
- [ ] Expected: a warning Alert with the title above, the line `B2:F100 on "Q3" (Contacts) runs past the sheet's last row (80): rows 81–100 are gone from the sheet, so their records were removed.`, the line `B2:F40 (Deals) was on sheet "Q4", which is no longer in the workbook, so it replayed nothing. Its records weren't refreshed.`, the tally "2 added, 5 updated, 40 unchanged, 20 removed", and a "Modify layout plan" link whose href is `/connectors/ci-1/layout-plan/edit`.
- [ ] Open "Replay warnings, no edit access (#1009)". Expected: the same two lines, "+2 more", and **no** "Modify layout plan" link.
- [ ] Open "Sync complete". Expected: today's green "Sync complete: 2 added, 5 updated, 40 unchanged, 20 removed", with no warning.

## §3 — A region past its sheet in the editor

- [ ] Open `Modules/RegionEditor/RegionDrawingStepUI` → "Region past its sheet — Fit to sheet (#1009)".
- [ ] Expected: the configuration panel shows a warning region labelled "Past the sheet": `Rows 11–15 are past the sheet's last row (10).`, then "They're gone from the sheet, and Interpret refuses a region outside its sheet.", a **Fit to sheet** button, and "Or drag its bottom edge back inside the sheet." The region's canvas tab shows **PAST SHEET**.
- [ ] Click **Interpret**. Expected: it doesn't run. The step shows "1 region has validation errors — fix them before interpreting." with the region's chip.
- [ ] Click **Fit to sheet**. Expected: the panel warning and the PAST SHEET tag disappear, and the region ends at the sheet's last row (10). Clicking **Interpret** no longer shows the validation alert.
- [ ] Reload the story, scroll the canvas to the overhang, and drag the region's bottom-right handle up into the grid. Expected: the same result as Fit to sheet. A drag below the grid lands on the last row.
- [ ] On the real connector after §1's row deletion (rows still deleted): open **Modify Layout Plan**. Expected: the region shows the same panel warning and PAST SHEET tag. Fit to sheet → Interpret → Commit plan all succeed, and the commit isn't halted. — manual

## §4 — A region whose sheet is gone, in Edit layout

- [ ] Open `Components/OrphanedRegionsNoticeUI` → "Regions whose sheet is missing (#1009)". Expected: a warning region labelled "Regions whose sheet is missing", listing `B2:F40 (Contacts) was on sheet "Q3", which is no longer in the workbook.` and `A1:C9 (Deals) was on sheet "Q4 (old)", …`. Each row has a "Move B2:F40 to sheet" select (offering Q1, Q2) and a "Delete region B2:F40" button.
- [ ] Open "After a refused Interpret (#1009)". Expected: the same list plus "Resolve these before interpreting.", and the notice has focus.
- [ ] On the real connector with "Q3" renamed (§1): open **Modify Layout Plan**. Expected: the page opens (before this change it crashed), with the notice above the editor naming the region and "Q3". — manual
- [ ] Click **Interpret**. Expected: no request is sent; the notice adds "Resolve these before interpreting." and takes focus. — manual
- [ ] Choose a sheet in **Move … to sheet**. Expected: the notice clears, the region appears on that sheet (selected, entity and segments intact), and if it runs past that sheet §3's warning applies. Alternatively, **Delete** removes it. Either way, Interpret → Commit plan then succeed. — manual

## §5 — No regression for plans that fit

- [ ] File Upload → `supported_layouts.csv` → draw `B67:G71`, bind it, add a row axis, Interpret. Expected: Review loads, and no PAST SHEET tag or panel warning appears anywhere on the Draw step.
- [ ] Help → FAQ. Expected: "What happens when a synced sheet gets smaller or is deleted?" is listed under Working with Data, and its answer covers removed vs left-out lines, a whole region or sheet gone ("isn't refreshed"), the identity-column halt, and Fit to sheet / Move to sheet.
- [ ] On the real connector with the sheet restored, Sync. Expected: today's green "Sync complete" message, and no `replayWarnings` on the job result. — manual

## §6 — Error & edge cases

- [ ] Delete every data row below row 1 **and** move the region to start at row 30 in a fresh plan (or shrink the sheet below the region's first row), then Sync. Expected: `… is entirely past the sheet's last row (<n>), so it replayed nothing. Its records weren't refreshed.`, and the entity's records are untouched. — manual
- [ ] Clear the whole sheet (0 rows) and open Modify Layout Plan. Expected: the panel warning reads "This sheet is now empty, so there's nothing to fit the region to. Delete the region, or draw it on another sheet." with **no** Fit to sheet button. — manual
- [ ] A transposed region (records are columns) losing two columns. Expected: the sync warning says those columns' records were removed, and lost rows would be "skipped". — manual

## Sign-off

- [ ] Every section above verified
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/connector instance/job/entity ids):
