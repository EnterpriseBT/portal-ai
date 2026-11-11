# Overhang and missing-sheet replay warnings — Spec

**Issue:** [EnterpriseBT/portal-ai#1009](https://github.com/EnterpriseBT/portal-ai/issues/1009) · **Discovery:** `docs/OVERHANG_REPLAY_WARNING.discovery.md`

This spec pins the contract for telling the user when a stored layout plan no longer fits its source:
- **Replay:** emits `bounds-overflow` and `sheet-missing` drift at `info` severity.
- **Sync:** commit and sync carry a typed, capped `replayWarnings` summary to the job result.
- **Sync feedback:** shows it, with a link to the layout editor.
- **Layout editor:** computes each region's overhang live and offers **Fit to sheet**, and holds regions whose sheet is gone aside (Move to sheet… / Delete) instead of crashing.

## Key decisions (flag for review)

1. **Signal in replay drift** (D1). `detectRegionDrift` emits `bounds-overflow`; the replay loop emits a new `sheet-missing` kind instead of `continue`.
2. **`info` severity, not identity-changing** (D2). Commit, recommit and sync never halt on either. `bounds-overflow`'s `kindSeverity` and `BOUNDS_OVERFLOW`'s default change from `warn` to `info`. Nothing emitted them before.
3. **A narrow typed summary** (D3). `ReplayWarningSchema` lives in `@portalai/spreadsheet-parsing`, since core depends on the parser, not the reverse. Core re-exports it. It's capped at 20 entries, with `replayWarningsOmitted` counting the rest.
4. **One Snackbar** (D4). A sync with warnings completes as a **warning-severity** success. It names up to 3 regions plus "+N more" and offers a "Modify layout plan" router link, shown only to a caller who passes the edit gate.
5. **Editor overhang is computed, not stored** (D5). It's derived each render from the draft's bounds and its sheet's `rowCount` / `colCount`, so Fit to sheet or a drag clears it at once.
6. **Interpret refuses an overhanging or orphaned region in the editor** *(inferred, to confirm)*. The server would refuse it anyway (`UNSUPPORTED_LAYOUT_SHAPE` / `UNKNOWN_SHEET`), so catching it locally turns a round-trip 400 into an explanation next to its fix. It follows the editor's existing pattern:
   - **Overhang:** a validation error in the "N regions have validation errors — fix them before interpreting" alert, with its jump chip (`RegionDrawingStep.component.tsx:647-680`). There's no new disabled state; Interpret stays a plain button, as today.
   - **Orphans:** they live outside the module, so the view refuses Interpret while any remain and moves focus to their notice.
7. **Reaping is unchanged.** A missing sheet's records go stale or are reaped as today, and the warning says "weren't refreshed". The fix is #1012.

## Scope

### In scope
1. Parser: the `sheet-missing` drift kind; `bounds-overflow` emission with typed details; severity changes; `ReplayWarningSchema` + `summarizeReplayWarnings`.
2. Core: re-export; `replayWarnings` / `replayWarningsOmitted` on `ConnectorSyncResultSchema` and `LayoutPlanCommitResultSchema` (optional).
3. API: commit returns the summary; the Google Sheets and Microsoft Excel adapters put it on `SyncInstanceResult`.
4. Web sync: the hook keeps the summary; the feedback renders the warning and the link.
5. Web editor:
   - the overhang util;
   - the panel warning + Fit to sheet;
   - the canvas tab badge;
   - an orphan-tolerant hydration helper and the orphan notice (Move to sheet… / Delete);
   - refusing Interpret for overhangs (as a validation error) and orphans (in the view).
6. FAQ entry.

### Out of scope
- Reap semantics for a missing sheet's records (#1012).
- Warnings for other drift kinds; `DriftBannerUI` wiring.
- Clamping stored bounds without a user action.
- The draft-commit path's own bounds check (it now warns through the same summary).

## Surface

### Parser — drift kinds and details (`packages/spreadsheet-parsing/src/plan/drift.schema.ts`, `src/replay/drift.ts`)

`DRIFT_KINDS` gains `"sheet-missing"`. The order is append-only, after `"duplicate-identity-values"`.

`DriftDetail` (`replay/drift.ts:30-38`) gains two optional fields:

```ts
boundsOverflow?: {
  sheetLastRow: number;   // sheet.dimensions.rows
  sheetLastCol: number;   // sheet.dimensions.cols
  rowsPast: number;       // max(0, bounds.endRow - sheetLastRow)
  colsPast: number;       // max(0, bounds.endCol - sheetLastCol)
};
sheetMissing?: { sheet: string };
```

- **`detectRegionDrift(region, sheet)`** pushes `"bounds-overflow"` and sets `detail.boundsOverflow` when `region.bounds.endRow > sheet.dimensions.rows` or `region.bounds.endCol > sheet.dimensions.cols`. It uses the stored bounds, not the terminator-extended ones. `withinTolerance` is unaffected.
- **The other drift checks read only the part inside the sheet** (found in slice 1). They run on the resolved bounds clamped to `sheet.dimensions`. Read as data, the overhang's blank identity cells counted as `identity-column-has-blanks`, which is identity-changing, so the identity gate would have halted every sync of a shrunken sheet with a 409. A region wholly past the sheet reports `bounds-overflow` alone.
- **The module lives in `src/warnings/`, not `src/replay/`** (found in slice 1). The package's forbidden-deps guard keeps main-entry code from importing the `replay/` subtree (it pulls in `node:crypto`), and core and web need the schema from the main entry.
- **`kindSeverity`:** `"bounds-overflow"` and `"sheet-missing"` → `"info"`. `kindIsIdentityChanging` is false for both.
- **New `missingSheetDrift(region: Region): RegionDrift`** returns `{ regionId: region.id, kinds: ["sheet-missing"], details: { severity: "info", identityChanging: false, addedColumns: [], removedColumns: [], identityBlanks: 0, duplicateIdentityValues: 0, sheetMissing: { sheet: region.sheet } }, withinTolerance: true }`.
- **`replay()`** (`replay/index.ts:44-54`): `if (!sheet) { regionDrifts.push(missingSheetDrift(region)); continue; }`. The region still contributes no records.

`src/warnings/codes.ts:57`: `BOUNDS_OVERFLOW: "info"`.

### Parser — `ReplayWarning` (`packages/spreadsheet-parsing/src/warnings/replay-warnings.ts`, new; exported from `src/index.ts`)

```ts
export const REPLAY_WARNINGS_MAX = 20;

export const ReplayWarningSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("bounds-overflow"),
    regionId: z.string().min(1),
    sheet: z.string().min(1),
    targetEntityDefinitionId: z.string().min(1),
    bounds: BoundsSchema,               // 1-based, as stored
    sheetLastRow: z.number().int().min(0),
    sheetLastCol: z.number().int().min(0),
  }),
  z.object({
    kind: z.literal("sheet-missing"),
    regionId: z.string().min(1),
    sheet: z.string().min(1),
    targetEntityDefinitionId: z.string().min(1),
    bounds: BoundsSchema,
  }),
]);
export type ReplayWarning = z.infer<typeof ReplayWarningSchema>;

/** Plan order; first REPLAY_WARNINGS_MAX; `omitted` counts the rest. */
export function summarizeReplayWarnings(
  plan: LayoutPlan,
  drift: DriftReport
): { warnings: ReplayWarning[]; omitted: number };
```

`BoundsSchema` is exported from `plan/region.schema.ts`, which today keeps it module-private. A region with both overflows yields one entry. Plan regions with no matching drift kind are skipped.

### Core (`packages/core`)

- **`src/contracts/spreadsheet-parsing.contract.ts`** re-exports `ReplayWarningSchema`, `ReplayWarning`, `REPLAY_WARNINGS_MAX` and `summarizeReplayWarnings`.
- **`src/models/job.model.ts` `ConnectorSyncResultSchema`** gains `replayWarnings: z.array(ReplayWarningSchema).max(REPLAY_WARNINGS_MAX).optional()` and `replayWarningsOmitted: z.number().int().positive().optional()`. Both are absent on a clean run, and the JSDoc cites #1009.
- **`src/contracts/connector-instance-layout-plans.contract.ts` `LayoutPlanCommitResultSchema`** gains the same two optional fields. The recommit response therefore carries them too.

### API (`apps/api`)

- **`LayoutPlanCommitService.commit`** (`services/layout-plan-commit.service.ts:100-399`): after replay (:150-161), `const { warnings, omitted } = summarizeReplayWarnings(plan, drift)`. It returns `{ connectorEntityIds, recordCounts, ...(warnings.length ? { replayWarnings: warnings } : {}), ...(omitted ? { replayWarningsOmitted: omitted } : {}) }`. The gates are unchanged; `info` passes `assertDriftSeverityAllowsCommit`.
- **`SyncInstanceResult`** (`adapters/adapter.interface.ts:39-87`) gains `replayWarnings?: ReplayWarning[]` and `replayWarningsOmitted?: number`, documented like `mirrorDegraded`.
- **`google-sheets.adapter.ts:193-203`, `microsoft-excel.adapter.ts:196-205`** spread `commitResult.replayWarnings` and `replayWarningsOmitted` into the returned result, the same way as `nulStrippedValues`. `connector-sync.processor.ts` passes the adapter result through unchanged.
- No new `ApiCode`; no new route.

### Web — sync (`apps/web`)

- **`utils/use-connector-instance-sync.util.ts`:** `ConnectorInstanceSyncState` gains `replayWarnings: ReplayWarning[] | null` and `replayWarningsOmitted: number`. A new `extractReplayWarnings(result)` parses the stream result through `ConnectorSyncResultSchema.shape.replayWarnings` (`safeParse`). It returns `null` when absent or invalid, so a bad payload never breaks the toast.
- **`components/ConnectorInstanceSyncFeedback.component.tsx`:** `ConnectorInstanceSyncFeedbackUIProps` gains:
  - `replayWarnings?: ReplayWarning[] | null`;
  - `replayWarningsOmitted?: number`;
  - `editLayoutPlanLink?: { connectorInstanceId: string } | null`, rendered only when present.

  On `completed` with warnings, the success `Alert` renders `severity="warning"` with:
  - **title:** "Synced, but part of the layout plan no longer fits the source";
  - **one line each for the first 3** (`formatReplayWarning`, `utils/replay-warning.util.ts`):
    - `bounds-overflow`, rows: "B2:F100 on "Q3" (Contacts) runs past the sheet's last row (80): rows 81–100 replayed as blank."
    - columns: "… last column (H): columns I–K replayed as blank."
    - both: "… last row (80) and last column (H): rows 81–100 and columns I–K replayed as blank."
    - `sheet-missing`: "B2:F40 (Contacts) was on sheet "Q3", which is no longer in the workbook, so it replayed nothing. Its records weren't refreshed."
  - **then** "+N more" (the remaining shown entries plus `replayWarningsOmitted`);
  - **the tally**, unchanged;
  - **an action:** "Modify layout plan", a `RouterLink` to `/connectors/$connectorInstanceId/layout-plan/edit`.

  Without warnings it renders exactly as today.
- **`views/ConnectorInstance.view.tsx:693-705`** passes the hook's fields and `editLayoutPlanLink={gates.editLayoutPlan ... && EDIT_PLAN_SLUGS has slug ? { connectorInstanceId } : null}`, using the same condition as the "Modify Layout Plan" menu item (:420-448).

### Web — editor (`apps/web`)

- **`modules/RegionEditor/utils/region-overhang.util.ts`** (new):
  - `regionOverhang(bounds: CellBounds, sheet: Pick<SheetPreview, "rowCount" | "colCount">): { rowsPast: number; colsPast: number; lastRow: number; lastCol: number } | null`, with 0-based bounds, `null` when inside;
  - `fitBoundsToSheet(bounds, sheet): CellBounds`, which clamps `endRow` / `endCol` to `rowCount - 1` / `colCount - 1` (and the starts likewise).
- **`RegionConfigurationPanel`** gains props `overhang?: ReturnType<typeof regionOverhang>` and `onFitToSheet?: () => void`. When `overhang` is set, it renders a warning box in the drift-box position: "Rows 81–100 / columns I–K are past the sheet's last row (80) / column (H) and replay as blank; Interpret refuses a region outside its sheet." It has a **Fit to sheet** button plus "or drag its bottom/right edge back inside the sheet".
- **`RegionDrawingStep`** computes `overhang` for the selected region from its sheet in `workbook`. It passes `onFitToSheet={() => handleBoundsChange(region.id, fitBoundsToSheet(region.bounds, sheet))}`, so segments re-align through `adjustSegmentsForBoundsChange`.
- **`RegionOverlay`** gains `overhanging?: boolean` and renders a tab badge "PAST SHEET", styled like "DRIFT". `SheetCanvas` passes it.
- **Validation:** `RegionDrawingStep`'s `invalidRegionIds` (the set behind the "fix them before interpreting" alert, `:647-680`) also includes any region whose `regionOverhang` against its sheet is non-null. The region's error reads "runs past the sheet — Fit to sheet or drag its edge back inside". The panel's overhang box is that region's per-region display, and clicking its chip jumps to the region, as for other errors.
- **`workflows/FileUploadConnector/utils/layout-plan-mapping.util.ts`** gains:
  - `splitPlanRegionsBySheet(plan, workbook): { drafts: RegionDraft[]; orphans: OrphanedRegion[] }`;
  - `OrphanedRegion = { region: BackendRegion; sheetName: string; boundsA1: string; targetEntityLabel: string | null }`;
  - `orphanToDraft(orphan, sheet): RegionDraft`.

  `planRegionsToDrafts` keeps its signature and throw (its other four callers interpret fresh plans), and is reimplemented over the same per-region converter.
- **`components/OrphanedRegionsNotice.component.tsx`** (new, pure UI): `OrphanedRegionsNoticeUI` with props `{ orphans: OrphanedRegion[]; sheets: { id: string; name: string }[]; attempted: boolean; onMove: (regionId: string, sheetId: string) => void; onDelete: (regionId: string) => void }`, forwarding a ref for focus. It's a `warning` Alert, one row per orphan: "B2:F40 (Contacts) was on sheet "Q3", which is no longer in the workbook." Each row has a **Move to sheet…** `Select` (labelled "Move B2:F40 to sheet") and a **Delete** button (`aria-label` "Delete region B2:F40").
- **`views/EditLayoutPlan.view.tsx`:**
  - hydration (:497-578) uses `splitPlanRegionsBySheet` and holds `orphans` in state;
  - it renders the notice above the editor;
  - `onMove` appends `orphanToDraft` to the regions and removes the orphan; `onDelete` drops it;
  - the view's `onInterpret` refuses while orphans remain. It sets the notice's `attempted` flag, which appends "Resolve these before interpreting." to it, and moves focus to the notice (`tabIndex={-1}`). Overhangs are handled inside the step, as above.

### Content (`packages/core/src/content/faq.util.ts`)

A new entry after "What happens when I sync an entity?": "What happens when a synced sheet gets smaller or is deleted?" It says rows or columns past the sheet replay as blank, a missing sheet's region replays nothing, the sync completes with a warning, and Modify layout plan offers Fit to sheet / Move to sheet.

## Migration
None: no schema change. The job result is JSONB, and the new fields are optional.

## Seed
None.

## TDD test plan

### Parser — `packages/spreadsheet-parsing` (`npm run test:unit`)
- `src/replay/__tests__/drift.test.ts`:
  - a region past the last row emits `bounds-overflow` with `rowsPast` / `colsPast` / `sheetLastRow` / `sheetLastCol`;
  - one past the last column; one past both;
  - one inside emits nothing;
  - severity `info`, `identityChanging` false, `withinTolerance` unaffected.
- `src/replay/__tests__/orchestration.test.ts`:
  - a region on a missing sheet yields a `sheet-missing` drift, no records, `drift.severity` `info`;
  - other regions replay normally.
- `src/replay/__tests__/warnings.test.ts` (new):
  - `summarizeReplayWarnings` maps both kinds, in plan order;
  - one entry per region;
  - the cap at 20 with `omitted`;
  - empty when clean;
  - `ReplayWarningSchema` round-trips.

≈ 14 cases.

### Core — `packages/core` (`npm run test:unit`)
- `src/__tests__/models/job.model.test.ts`: `ConnectorSyncResultSchema` accepts `replayWarnings` (both kinds), rejects 21 entries, rejects `replayWarningsOmitted: 0`, still accepts a result without them.
- `src/__tests__/content/faq.util.test.ts`: the new entry exists, and passes content purity.

≈ 6 cases.

### API — `apps/api`
- `src/__tests__/adapters/google-sheets.adapter.test.ts`, `microsoft-excel.adapter.test.ts` (`npm run test:unit`): a commit result with warnings is spread onto the sync result; without them, the keys are absent. ≈ 4 cases.
- `src/__tests__/__integration__/routes/connector-instance-layout-plans.router.integration.test.ts` (`npm run test:integration`):
  - a recommit whose plan overhangs its workbook returns 200 with `replayWarnings`, and isn't halted;
  - a plan whose sheet is absent returns `sheet-missing`.

  ≈ 2 cases.
- `src/__tests__/__integration__/services/google-sheets-sync.integration.test.ts`: a sync against a shrunken workbook completes, records come only from in-sheet rows, and the job result carries `replayWarnings`. ≈ 1 case.

### Web — `apps/web` (`npm run test:unit`)
- `src/__tests__/use-connector-instance-sync.util.test.tsx`: keeps `replayWarnings` from a completed stream; `null` when absent; `null` (not a crash) when malformed. ≈ 3 cases.
- `src/__tests__/ConnectorInstanceSyncFeedback.test.tsx`:
  - warning severity with the copy for each kind;
  - "+N more" counts the omitted ones;
  - the link appears only with `editLayoutPlanLink`;
  - no warnings → today's success;
  - axe clean.

  ≈ 6 cases.
- `src/__tests__/replay-warning.util.test.ts` (new): the `formatReplayWarning` copy for rows, columns, both, and a missing sheet. ≈ 4 cases.
- `src/modules/RegionEditor/__tests__/region-overhang.util.test.ts` (new): inside → `null`; past rows; past columns; `fitBoundsToSheet` clamps. ≈ 5 cases.
- `src/modules/RegionEditor/__tests__/RegionConfigurationPanel.test.tsx`: the overhang box and its copy; Fit to sheet calls `onFitToSheet`; no box when `overhang` is null. ≈ 3 cases.
- `src/modules/RegionEditor/__tests__/RegionDrawingStep.test.tsx`: Fit to sheet updates the bounds through `onRegionUpdate`, with re-aligned segments; Interpret with an overhanging region shows the validation alert naming it and doesn't call `onInterpret`; after Fit to sheet it does. ≈ 3 cases.
- `src/workflows/FileUploadConnector/__tests__/layout-plan-mapping.util.test.ts`: `splitPlanRegionsBySheet` separates orphans; `orphanToDraft` keeps settings on the new sheet; `planRegionsToDrafts` still throws. ≈ 4 cases.
- `src/__tests__/OrphanedRegionsNotice.test.tsx` (new): it renders each orphan; Move calls `onMove` with the chosen sheet; Delete calls `onDelete`; axe clean. ≈ 4 cases.
- `src/__tests__/EditLayoutPlanView.test.tsx`:
  - a plan with a missing-sheet region opens (no crash) and shows the notice;
  - Move and Delete resolve it and unblock Interpret;
  - Interpret with an orphan left focuses the notice and sends no request; an overhanging region is refused until Fit to sheet.

  ≈ 4 cases.

**Totals ≈ 67 cases.**

## Acceptance criteria
- [ ] A sync against a sheet cut below a region's last row completes. Records come only from rows inside the sheet, and the job result's `replayWarnings` names the region with the sheet's last row.
- [ ] That sync's feedback is a warning naming the region and the rows replayed blank, with a "Modify layout plan" link for a user who can edit the plan, and no link for one who can't.
- [ ] A sync where a region's sheet was deleted completes, other regions' records land, and the feedback says that region replayed nothing.
- [ ] Commit and recommit never halt on `bounds-overflow` or `sheet-missing`.
- [ ] The layout editor opens a plan whose region's sheet is missing (no crash), lists the region with Move to sheet… / Delete, and refuses Interpret (focusing the notice) until it's resolved.
- [ ] An overhanging region shows its warning and a PAST SHEET tab badge. Fit to sheet trims it to the sheet, keeping its entity, segments and fields; the warning clears; Interpret succeeds. Dragging the edge back inside does the same.
- [ ] A plan inside its sheets shows no warning anywhere, and every flow behaves exactly as before.

## Risks & rollback
- **A stricter severity elsewhere:** if any consumer treats `info` drift as actionable, it could start reacting. Nothing reads `info` today; the gates only act on `warn` / `blocker`. Detected by the commit integration tests. Rollback: revert the parser slice; the API and web tolerate the field's absence.
- **A malformed `replayWarnings` payload in the web:** `safeParse` makes the toast fall back to today's success. Fail-open is correct for an advisory.
- **Data safety:** this ticket doesn't change reaping. A missing sheet's records behave exactly as today (#1012). The copy says "weren't refreshed" so it never promises they're kept.
- **Orphan Move to sheet** can land a region past the new sheet. The overhang warning then applies, and nothing is saved until commit.

## Files touched
- **New:**
  - parser: `src/warnings/replay-warnings.ts`, `src/replay/__tests__/warnings.test.ts`;
  - web: `utils/replay-warning.util.ts`, `modules/RegionEditor/utils/region-overhang.util.ts`, `components/OrphanedRegionsNotice.component.tsx`, plus their tests.
- **Edited:**
  - parser: `plan/drift.schema.ts`, `plan/region.schema.ts` (export `BoundsSchema`), `replay/drift.ts`, `replay/index.ts`, `warnings/codes.ts`, `index.ts`;
  - core: `contracts/spreadsheet-parsing.contract.ts`, `contracts/connector-instance-layout-plans.contract.ts`, `models/job.model.ts`, `content/faq.util.ts`;
  - api: `services/layout-plan-commit.service.ts`, `adapters/adapter.interface.ts`, `adapters/google-sheets/google-sheets.adapter.ts`, `adapters/microsoft-excel/microsoft-excel.adapter.ts`;
  - web: `utils/use-connector-instance-sync.util.ts`, `components/ConnectorInstanceSyncFeedback.component.tsx`, `views/ConnectorInstance.view.tsx`, `views/EditLayoutPlan.view.tsx`, `workflows/FileUploadConnector/utils/layout-plan-mapping.util.ts`, `modules/RegionEditor/{RegionConfigurationPanel,RegionDrawingStep,RegionOverlay,SheetCanvas}.component.tsx`;
  - existing tests as listed.

## Next step
`docs/OVERHANG_REPLAY_WARNING.plan.md` sequences this as five test-first slices on this branch:
1. parser (drift kinds, severity, `ReplayWarning`, summarizer);
2. core + api (schemas, commit summary, adapters, integration);
3. web sync feedback (hook, formatter, Snackbar, link);
4. web editor overhang (util, panel, badge, Fit to sheet, validation);
5. web editor orphans (split helper, notice, view wiring) + FAQ.
