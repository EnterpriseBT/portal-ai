# Interpret keeps the selected region — Condensed design (#999)

**Issue:** [EnterpriseBT/portal-ai#999](https://github.com/EnterpriseBT/portal-ai/issues/999) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc). Epic child of #791 (follow-up from #795).

**Why.** Interpret replaces every region draft with one built from the returned plan (`planRegionsToDrafts`), and the plan's region ids differ from the drafts' (`sheet_0_…-r57i76f` → `region-1-…`). The selected region id isn't remapped, so after Interpret → Back to regions nothing is selected, and the RegionEditor's "Jump to region" `Select` holds an id none of its options carry (MUI's out-of-range warning, three times). The Edit layout page swaps its regions the same way and has the same bug. This change is `apps/web` only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Shared interpret | `workflows/_shared/spreadsheet/use-spreadsheet-workflow.util.ts:667` | sets `regions: nextRegions`, leaves `selectedRegionId` alone |
| File upload / Sheets / Excel `runInterpret` | `FileUploadConnectorWorkflow.component.tsx:538`, `GoogleSheetsConnectorWorkflow.component.tsx:150`, `MicrosoftExcelConnectorWorkflow.component.tsx:151` | all return `planRegionsToDrafts(plan, workbook)`, ids = plan region ids |
| Draft ↔ plan pairing | `FileUploadConnector/utils/layout-plan-mapping.util.ts:201` (`preserveUserRegionConfig`), `:316` (`regionDraftsToHints`) | drafts without a target entity are skipped, and the rest line up with the plan's regions **by index** |
| Edit layout re-interpret | `views/EditLayoutPlan.view.tsx:716` | `setRegions(planRegionsToDrafts(nextPlan, workbook))`, own `selectedRegionId` state at `:520` |
| Delete clears a dangling selection | `use-spreadsheet-workflow.util.ts:629` | the precedent: the selection never names a region that isn't there |

## Decision — remap by the existing pairing rule, in one helper

The options:
- **Clear the selection on interpret.** This is trivial, but the user loses the region they were working on, and a returning keyboard user lands on nothing.
- **Have the callbacks return an id map.** That changes three callers and the `SpreadsheetWorkflowCallbacks` contract to carry what the index rule already implies.
- **Remap with the rule interpret already follows (chosen).** A pure `remapSelectedRegionId(selectedId, priorDrafts, nextRegions)` lives beside `preserveUserRegionConfig`, so the pairing rule stays in one file.

Its rules, in order:
1. `null` stays `null`.
2. An id that's still in `nextRegions` is kept (a re-interpret whose ids didn't change).
3. If the selected draft had a target entity, it maps to `nextRegions[i]`, where `i` is its index among the drafts that have one. The pairing is used only when the counts match; otherwise the result is `null`, so a mismatch never selects the wrong region.
4. Anything else is `null`. That includes a draft without a target entity, which interpret drops, the same as a delete.

## Plan — 1 slice

**Files**
- edit `workflows/FileUploadConnector/utils/layout-plan-mapping.util.ts`: add and export `remapSelectedRegionId`.
- edit `workflows/_shared/spreadsheet/use-spreadsheet-workflow.util.ts`: the interpret success `setState` sets `selectedRegionId: remapSelectedRegionId(prev.selectedRegionId, <drafts sent>, nextRegions)`.
- edit `views/EditLayoutPlan.view.tsx`: the same remap next to `setRegions` in the interpret handler.

**Tests** (`npm run test:unit -- --testPathPattern …` from `apps/web`)
- `FileUploadConnector/__tests__/layout-plan-mapping.util.test.ts`: cover the four rules, plus a mismatched count.
- `FileUploadConnector/__tests__/file-upload-workflow.util.test.ts`: draw two regions with entities, select the second, Interpret (stub ids differ), and assert `selectedRegionId` is the second plan region's id. Also cover a selected region without an entity → `null`.
- Edit layout: no test renders the `EditLayoutPlan` container (`EditLayoutPlanView.test.tsx` renders only the UI, which never sees interpret), so its one-line wiring through the tested helper is covered by Smoke step 5.

## Smoke (manual, against your dev stack)

1. Connectors → File Upload → upload `supported_layouts.csv`. Draw two regions, bind both to an entity, and select the **second**. Interpret.
2. Click Back to regions. The second region is still selected (outlined, "Selected" badge), and "Jump to region" shows it.
3. The browser console has no "out-of-range value … for the select component" warning at any point in steps 1–2.
4. Draw a third region with no entity and click Interpret. Interpret refuses ("1 region has validation errors — fix them before interpreting."), so a draft without an entity never reaches interpret from the UI. The remap's rule for that case (clear the selection) is covered by `layout-plan-mapping.util.test.ts` and `file-upload-workflow.util.test.ts`.
5. On a Google Sheets or Excel connector (Edit layout doesn't support file-upload connectors), open Edit layout, draw and bind a new region, select it, re-interpret, and go back to drawing. The new region is still selected and the console is clean. — manual (needs a real vendor account)

## Out of scope

- Interpret dropping regions that have no target entity (existing behaviour, unchanged).
- The pivot-table interpret 500 (#1002).
