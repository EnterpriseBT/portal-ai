# Overhang and missing-sheet replay warnings — Plan

**This plan implements the replay warnings for a plan that no longer fits its source, TDD-sequenced. Each slice adds one layer: the parser's drift signal, the summary on the commit and sync results, the sync feedback, the editor's overhang warning with Fit to sheet, and the editor's handling of a missing sheet.**

Spec: `docs/OVERHANG_REPLAY_WARNING.spec.md`. Discovery: `docs/OVERHANG_REPLAY_WARNING.discovery.md`. Issue: #1009. It builds on #1008 (interpret refuses an out-of-sheet hint) and leaves reaping to #1012.

5 slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/1009-overhang-replay-warning`**: one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly):

```bash
cd packages/spreadsheet-parsing && npm run test:unit
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit        # and npm run test:integration for slice 2
cd apps/web && npm run test:unit
```

Each slice:
1. write failing tests;
2. make the smallest change that turns them green;
3. run them;
4. at the boundary, run `npm run lint && npm run type-check` in each touched package, after rebuilding any dependency it reads from `dist`;
5. move to the next slice.

Sequencing rationale:
1. **Parser first.** It's the leaf: every other layer reads its drift kinds and `ReplayWarning`.
2. **Core + API next.** The schemas and the commit summary need slice 1's types, and they produce the field the web reads.
3. **Sync feedback.** It needs the job-result schema from slice 2.
4. **Editor overhang.** It's independent of 2–3 at runtime, but sits after them so the web package changes land together. It needs nothing new from the server.
5. **Missing sheets in the editor, then the FAQ.** The FAQ describes all of the above, so it goes last.

---

## Slice 1 — parser: drift kinds, severity, `ReplayWarning`

Replay emits `bounds-overflow` and `sheet-missing` at `info`, and the parser exports the typed summary.

**Files**

- Edit: `src/plan/drift.schema.ts` (`"sheet-missing"` appended to `DRIFT_KINDS`); `src/plan/region.schema.ts` (export `BoundsSchema`); `src/replay/drift.ts` (`DriftDetail.boundsOverflow` / `sheetMissing`, the overflow check in `detectRegionDrift`, `info` in `kindSeverity`, `missingSheetDrift`); `src/replay/index.ts` (push `missingSheetDrift` instead of a bare `continue`); `src/warnings/codes.ts` (`BOUNDS_OVERFLOW: "info"`); `src/index.ts` (exports).
- New: `src/warnings/replay-warnings.ts` (`REPLAY_WARNINGS_MAX`, `ReplayWarningSchema`, `summarizeReplayWarnings`).

**Steps**

1. **Tests (spec, Parser ≈ 14 cases).**
   - `src/replay/__tests__/drift.test.ts`: past row, past column, both, inside; `info` severity; not identity-changing; tolerance unaffected.
   - `src/replay/__tests__/orchestration.test.ts`: a missing sheet → `sheet-missing` drift, no records, `info`; the other regions are unaffected.
   - New `src/replay/__tests__/warnings.test.ts`: both kinds mapped, in plan order; one entry per region; the cap at 20 with `omitted`; empty when clean; the schema round-trips.

   Run; fail.
2. **Implement** as in the spec's "Parser" surface. Green.
3. Run the whole parser suite: other drift and severity tests must hold, and a `warn` assertion on `BOUNDS_OVERFLOW` (if any) changes to `info`. Lint, type-check, then `npm run build` so core and the API see the new exports.

**Done when:** the parser suite is green; replay of a shrunken sheet yields `bounds-overflow`; a missing sheet yields `sheet-missing`; `summarizeReplayWarnings` is exported. Nothing outside the parser references it yet.

**Risk:**
- A consumer that switches exhaustively over `DriftKind` fails type-check on the new kind. Grep `DriftKind` / `DRIFT_KINDS` across packages and handle each case.
- Web's `RegionDriftState.kind` is its own union, so it isn't affected.

---

## Slice 2 — core + API: the summary on commit and sync results

Commit returns `replayWarnings`, and the Google Sheets and Microsoft Excel syncs put it on the job result.

**Files**

- Edit, core: `src/contracts/spreadsheet-parsing.contract.ts` (re-exports); `src/contracts/connector-instance-layout-plans.contract.ts` (`LayoutPlanCommitResultSchema` + the 2 optional fields); `src/models/job.model.ts` (`ConnectorSyncResultSchema` + the 2 optional fields).
- Edit, api: `src/services/layout-plan-commit.service.ts` (`summarizeReplayWarnings` after replay, spread into the result); `src/adapters/adapter.interface.ts` (`SyncInstanceResult` + the fields); `src/adapters/google-sheets/google-sheets.adapter.ts`, `src/adapters/microsoft-excel/microsoft-excel.adapter.ts` (spread them).

**Steps**

1. **Tests (spec, Core ≈ 4 of 6, API ≈ 7).**
   - `packages/core/src/__tests__/models/job.model.test.ts`: both kinds accepted; 21 rejected; `replayWarningsOmitted: 0` rejected; a result without them still accepted.
   - `apps/api/src/__tests__/adapters/google-sheets.adapter.test.ts` and `microsoft-excel.adapter.test.ts`: warnings spread when present, keys absent otherwise.
   - Integration: `connector-instance-layout-plans.router.integration.test.ts` (a recommit whose plan overhangs → 200 with `replayWarnings`, not halted; a missing sheet → `sheet-missing`); `google-sheets-sync.integration.test.ts` (a shrunken workbook → in-sheet records only, plus `replayWarnings` on the job result).

   Run; fail.
2. **Implement** the core fields (then `npm run build` in core), then the commit summary and the adapters. Green.
3. Lint + type-check core and api; `npm run test:integration` in api for the touched suites.

**Done when:** a sync or recommit against a plan that overhangs, or whose sheet is missing, completes, carries the summary, and isn't halted. Clean runs have no new keys.

**Risk:**
- The integration fixtures must build a workbook smaller than the stored plan. Use the existing seeded plan with a trimmed workbook rather than a new fixture file.
- Partial module mocks of core in API unit tests may miss a new export. Grep the mocks before pushing.

---

## Slice 3 — web: sync feedback

A sync with warnings ends as a warning, naming the regions, with a "Modify layout plan" link for editors.

**Files**

- New: `apps/web/src/utils/replay-warning.util.ts` (`formatReplayWarning`, `formatMoreCount`).
- Edit: `utils/use-connector-instance-sync.util.ts` (`replayWarnings`, `replayWarningsOmitted`, `extractReplayWarnings` via `safeParse`); `components/ConnectorInstanceSyncFeedback.component.tsx` (props, the warning variant, the `RouterLink` action); `views/ConnectorInstance.view.tsx` (pass the fields and `editLayoutPlanLink` under the menu item's condition).

**Steps**

1. **Tests (spec, Web ≈ 13 of the sync cases).**
   - New `src/__tests__/replay-warning.util.test.ts`: copy for rows, columns, both, and a missing sheet.
   - `src/__tests__/use-connector-instance-sync.util.test.tsx`: kept from a completed stream; `null` when absent; `null` when malformed.
   - `src/__tests__/ConnectorInstanceSyncFeedback.test.tsx`: warning severity and copy; "+N more" includes the omitted count; the link only with `editLayoutPlanLink`; no warnings → today's success; `expectNoAxeViolations` on the open Snackbar.

   Run; fail.
2. **Implement** the util, the hook fields, the component variant and the view wiring. Green.
3. Lint + type-check web.

**Done when:** feeding the feedback component a completed result with warnings renders the warning, the regions and the link (for editors). Today's success and error paths are unchanged.

**Risk:**
- The Snackbar is a recorded exception to the toast rule. Extend it in place; don't add a toast.
- The link must be a router `Link` (navigation is a link), never an `onClick` navigate.

---

## Slice 4 — web editor: overhang warning and Fit to sheet

An overhanging region shows its warning and a PAST SHEET badge. Fit to sheet trims it, and Interpret refuses it as a validation error until it fits.

**Files**

- New: `modules/RegionEditor/utils/region-overhang.util.ts` (`regionOverhang`, `fitBoundsToSheet`).
- Edit: `modules/RegionEditor/RegionConfigurationPanel.component.tsx` (`overhang`, `onFitToSheet`, the warning box); `RegionDrawingStep.component.tsx` (compute the overhang for the selected region; `onFitToSheet` through `handleBoundsChange`; add overhanging regions to `invalidRegionIds` with their error text); `RegionOverlay.component.tsx` (`overhanging` → the "PAST SHEET" badge); `SheetCanvas.component.tsx` (pass `overhanging`).

**Steps**

1. **Tests (spec, Web ≈ 11 of the editor cases).**
   - New `modules/RegionEditor/__tests__/region-overhang.util.test.ts`: inside → `null`; past rows; past columns; `fitBoundsToSheet` clamps.
   - `RegionConfigurationPanel.test.tsx`: the box and its copy; the button calls `onFitToSheet`; no box when `null`.
   - `RegionDrawingStep.test.tsx`: Fit to sheet → `onRegionUpdate` with clamped bounds and re-aligned segments; Interpret with an overhanging region shows the validation alert naming it and doesn't call `onInterpret`; after Fit to sheet it does.

   Run; fail.
2. **Implement** per the spec's "Web — editor" surface. Green.
3. Lint + type-check web. Run the RegionEditor suites (`--testPathPattern "RegionEditor|SheetCanvas|region-"`).

**Done when:** in the module, an overhanging draft shows the box, the badge and the validation entry, and Fit to sheet resolves all three. Non-overhanging regions are unchanged.

**Risk:** the badge sits in the region tab. Check the RegionEditor stories still render (`a11y:stories` runs over them) and that the badge text reads well beside DRIFT and Selected.

---

## Slice 5 — web editor: missing sheets, and the FAQ

Edit layout opens a plan whose region's sheet is gone, lists it with Move to sheet… / Delete, and refuses Interpret until it's resolved. The FAQ explains all of #1009.

**Files**

- New: `apps/web/src/components/OrphanedRegionsNotice.component.tsx` (`OrphanedRegionsNoticeUI`).
- Edit: `workflows/FileUploadConnector/utils/layout-plan-mapping.util.ts` (`splitPlanRegionsBySheet`, `OrphanedRegion`, `orphanToDraft`, with `planRegionsToDrafts` reimplemented over the shared converter, its throw kept); `views/EditLayoutPlan.view.tsx` (hydrate via the split, `orphans` state, the notice, Move/Delete, refuse Interpret while orphans remain and focus the notice); `packages/core/src/content/faq.util.ts` (the new entry).

**Steps**

1. **Tests (spec, Web ≈ 12 + Core ≈ 2).**
   - `workflows/FileUploadConnector/__tests__/layout-plan-mapping.util.test.ts`: orphans split out; `orphanToDraft` keeps settings on the new sheet; `planRegionsToDrafts` still throws.
   - New `src/__tests__/OrphanedRegionsNotice.test.tsx`: renders each orphan; Move → `onMove(regionId, sheetId)`; Delete → `onDelete`; `attempted` adds the instruction; axe clean.
   - `src/__tests__/EditLayoutPlanView.test.tsx`: a missing-sheet region opens (no crash) and shows the notice; Move and Delete resolve it; Interpret with an orphan left focuses the notice and sends no request.
   - `packages/core/src/__tests__/content/faq.util.test.ts`: the entry exists and passes content purity.

   Run; fail.
2. **Implement.** Green.
3. Lint + type-check web and core. Run the EditLayoutPlan, layout-plan-mapping and core content suites.

**Done when:** every acceptance criterion in the spec holds in unit tests, and Edit layout no longer throws on a missing sheet.

**Risk:**
- `layout-plan-mapping.util.ts` is imported by the Google Sheets, Excel and File Upload workflows. Their tests must stay green on the unchanged `planRegionsToDrafts`.
- Partial module mocks of this util in web tests may miss the new exports. Grep the fakes.

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 | drift kinds + `info` severity + `ReplayWarning` (parser) | parser suite green; `npm run build` |
| 2 | schemas + commit summary + adapters (core, api) | core/api unit + touched integration suites |
| 3 | sync feedback warning + link (web) | sync util/feedback suites, axe |
| 4 | overhang util, panel box, badge, Fit to sheet, validation (web) | RegionEditor suites |
| 5 | missing sheets in Edit layout + FAQ (web, core) | mapping, EditLayoutPlan, notice, FAQ suites |

## Cross-slice notes

- **Stale `dist`:** web and API read core and the parser from `dist`. Rebuild the parser after slice 1 and core after slices 2 and 5 before type-checking downstream; 15 unrelated type errors mean stale `dist`.
- **Prettier** runs on commit (lint-staged). Run `npm run format:check` per package before pushing; CI enforces it.
- **Doc sync:** the FAQ entry is the user-facing doc (slice 5), and `faq.util.ts` also feeds the marketing site's FAQ JSON-LD, so keep the wording product-level. No README, `CLAUDE.md` or tool-contract surface changes.
- **Smoke:** Google Sheets / Excel syncs need a real vendor account, so the smoke doc's sync steps will be `— manual`. The editor steps can be agent-walked only where a connector instance exists; otherwise they're manual too. Storybook can show the editor states for evidence.

## Next step

Implementation begins on this branch with slice 1, tests first, one commit per slice, once discovery, spec and plan are confirmed.
