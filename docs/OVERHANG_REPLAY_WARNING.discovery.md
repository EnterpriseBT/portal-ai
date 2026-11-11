# Overhang and missing-sheet replay warnings — Discovery

**Issue:** [EnterpriseBT/portal-ai#1009](https://github.com/EnterpriseBT/portal-ai/issues/1009)

**Why this exists.** A stored layout plan names fixed region bounds on named sheets. When the source changes under it, sync replays the plan anyway, and the user is told nothing:
- **The sheet shrinks.** Rows or columns are deleted in Google Sheets or Excel, so cells past the new last row or column read as blank and contribute nothing.
- **The sheet is deleted or renamed.** The region is skipped outright.

The drift schema even declares a `bounds-overflow` kind, but nothing emits it. #1008 made interpret refuse such a region with a 400, so the user hits a wall the moment they re-interpret, and nothing ever explained why.

This is the feature that tells them: a warning when a sync replays an overhanging or orphaned region, and a per-region warning in the layout editor with a one-click **Fit to sheet** (decided on the issue, option 2 of 3).

## The current shape

### Replay and drift (`packages/spreadsheet-parsing`)

| Piece | Location | Today |
|---|---|---|
| Replay loop | `src/replay/index.ts:44-60` | `if (!sheet) continue` at :46: a region on a missing sheet adds no records and no `RegionDrift`. Returns `{ records, drift }` |
| Region drift | `src/replay/drift.ts:124-302` | pushes kinds (removed/added columns, identity blanks/duplicates, anchor rename) into a private `DriftDetail` (:30-38), sets `withinTolerance` and `detail.severity` |
| Severity | `src/replay/drift.ts:311-331`, `rollUpDrift` :333-358 | `bounds-overflow` → **`warn`** (:326). The roll-up takes the max per-region severity |
| Kinds | `src/plan/drift.schema.ts:19-44` | `bounds-overflow` declared, never emitted; `details: z.unknown()` |
| Why it reads blank | `src/replay/resolve-bounds.ts:126-162`, `src/workbook/helpers.ts:38`, `:201` | stored bounds are used as-is (only a terminator extends them), and cells past the sheet are `undefined` |
| Warning code | `src/warnings/codes.ts:11`, `:57` | `BOUNDS_OVERFLOW`, `warn`, never emitted |

### Commit and sync (`apps/api`, `packages/core`)

| Piece | Location | Today |
|---|---|---|
| Commit | `apps/api/src/services/layout-plan-commit.service.ts:100-399` | runs replay (:150-161); the identity gate always runs (:178); severity gates (:744-760) are skipped with `skipDriftGate` (:179-181). Returns only `{ connectorEntityIds, recordCounts }` (:399) |
| Reaping scope | same file, `:225-312` | records are grouped by target. Only targets with records reach `connectorEntityIds`, which is what sync reaps |
| Sync adapters | `adapters/google-sheets/google-sheets.adapter.ts:137-203`, `adapters/microsoft-excel/microsoft-excel.adapter.ts:140-205` | commit with `{ syncedAt, skipDriftGate: true }`; return `mirrorDegraded` / `nulStrippedValues` as optional fields of `SyncInstanceResult` (`adapters/adapter.interface.ts:39-87`) |
| Job result | `apps/api/src/queues/processors/connector-sync.processor.ts:136-190`; `packages/core/src/models/job.model.ts:185-226` (`ConnectorSyncResultSchema`) | the adapter result is the job's `result`; optional degradation fields at :209, :214, pinned by `__tests__/models/job.model.test.ts:796-845` |
| Commit contract | `packages/core/src/contracts/connector-instance-layout-plans.contract.ts:133-144` | `LayoutPlanCommitResultSchema`, also the recommit response |

### Web (`apps/web`)

| Piece | Location | Today |
|---|---|---|
| Sync hook | `utils/use-connector-instance-sync.util.ts:70-165` | streams the job over SSE; on `completed` keeps only `recordCounts` (`extractRecordCounts` :35-50) |
| Sync feedback | `components/ConnectorInstanceSyncFeedback.component.tsx:69-171` | one Snackbar (a recorded exception to the toast rule): progress, success tally, or an error with an optional `action` (Reconnect) |
| Host + link | `views/ConnectorInstance.view.tsx:237`, `:393`, `:420-448`, `:693-705` | the "Modify Layout Plan" menu item navigates to `/connectors/$connectorInstanceId/layout-plan/edit`, gated by `gates.editLayoutPlan` and `EDIT_PLAN_SLUGS` |
| Layout editor | `views/EditLayoutPlan.view.tsx:386-388`, `:497-578`, `:630-672` | loads the edit context (sheet sizes as `rowCount` / `colCount`, via `previewToEditorWorkbook` :63-75), hydrates drafts, re-interprets |
| Hydration | `workflows/FileUploadConnector/utils/layout-plan-mapping.util.ts:444-453` | `planRegionsToDrafts` **throws** on a region whose sheet is missing, so the editor fails to open: a crash today, not a silent skip |
| Region panel | `modules/RegionEditor/RegionConfigurationPanel.component.tsx:285`, `~685-715` | a "Drift detected" box keyed on `driftFlagged`; `RegionDraft.drift` (`utils/region-editor.types.ts:219-225`) has a `kind: "bounds"` nothing sets |
| Bounds changes | `modules/RegionEditor/RegionDrawingStep.component.tsx:251-279` | `handleBoundsChange` → `adjustSegmentsForBoundsChange` → `onRegionUpdate`; the one path every resize takes |
| Canvas | `modules/RegionEditor/SheetCanvas.component.tsx:274-278` | an overhang is drawn past the grid and can be scrolled to; a pointer past the grid maps to the last row or column, so dragging an edge back in already works (checked in Storybook) |
| Help | `packages/core/src/content/faq.util.ts:162-166`, `glossary.util.ts:109-114` | sync is described; drift isn't |

## The design space

### Decision 1 — where the signal is produced

- **A. Replay drift.** `detectRegionDrift` emits `bounds-overflow` with details (last row and column, rows and columns past). The replay loop emits a new `sheet-missing` drift for an orphaned region instead of `continue`.
- **B. A separate `coverage` list on `ReplayResult`.** It sits beside drift.
- **C. The API compares** plan bounds with workbook dimensions after replay.

| | A | B | C |
|---|---|---|---|
| One place knows plan + workbook | yes | yes | duplicated in the API |
| Uses the designed channel | yes (the kind exists) | new concept | no |
| Commit gates see it | yes, so severity matters | no | no |

**Lean: A.** Drift is the designed channel and the kind already exists; A only needs its severity set deliberately (Decision 2).

### Decision 2 — severity, and the commit gates

- **A. `info` for both.** Commit and recommit pass `info`, so neither halts; the warning is purely advisory.
- **B. `warn`, as declared.** Recommit from the editor would then halt with `409 LAYOUT_PLAN_DRIFT_HALT`, which contradicts the issue ("commit never halts on bounds-overflow alone").

**Lean: A.** `bounds-overflow` and `sheet-missing` become `info`. Neither is identity-changing. `BOUNDS_OVERFLOW`'s warning-code default follows. Nothing emitted these before, so no existing behaviour changes.

### Decision 3 — how it reaches the sync job's result

- **A. Return the full `DriftReport` from commit.** This widens `LayoutPlanCommitResultSchema` and pushes `details: unknown` through.
- **B. A narrow, typed summary.** Commit returns `replayWarnings: [{ regionId, sheet, kind: "bounds-overflow" | "sheet-missing", bounds, sheetLastRow?, sheetLastCol? }]` (optional, absent when clean). The adapters copy it into `SyncInstanceResult` and `ConnectorSyncResultSchema`, like `mirrorDegraded`.

| | A | B |
|---|---|---|
| Typed for the web | no (`unknown` details) | yes |
| Contract growth | large, and recommit's response changes shape | one optional field |
| Bounded payload | no | capped (20 + count, as #1008's error) |

**Lean: B**, capped. The narrow summary is what the UI renders, and the job row keeps the durable record.

### Decision 4 — the sync feedback

- **A. A warning variant of the success Snackbar.** The sync still says "Synced …", in warning severity. It names up to three regions ("+N more") and has a **Modify layout plan** action, a router `Link` (navigation is a link), shown only when the caller passes `gates.editLayoutPlan`.
- **B. A separate toast** after the success Snackbar.

**Lean: A.** One message per sync, and the existing `action` slot already fits a link. `useConnectorInstanceSync` keeps `replayWarnings` from the stream result alongside `recordCounts`.

### Decision 5 — the editor's warning: computed or synced

- **A. Computed in the editor** from each draft's bounds against its sheet's `rowCount` / `colCount` (and the sheet's presence) at render time.
- **B. Read from the last sync job's result.**

**Lean: A.**
- It's always current: the edit context is fetched fresh, so it's right with no sync in between.
- It clears itself as soon as Fit to sheet or a drag brings the region inside.
- It needs no new API.

The per-region warning sits in `RegionConfigurationPanel` (the existing drift box), with a matching mark on the region's canvas tab. **Fit to sheet** calls `handleBoundsChange` with the bounds clamped to the sheet, so segments re-align and the entity, segments and fields survive. Nothing is saved until re-interpret and commit.

### Decision 6 — a region whose sheet is missing, in the editor

Today the editor crashes on open. `planRegionsToDrafts` has to stop throwing:
- **A. Orphaned regions held aside.** Hydration returns the drafts it can place plus an `orphans` list. The editor shows a banner per orphan ("Region B2:F40 (Contacts) was on sheet "Q3", which is no longer in the workbook.") with **Move to sheet…** (a sheet picker that re-homes the draft and keeps its settings) and **Delete**. Interpret stays disabled while any orphan remains, since it would 400 `UNKNOWN_SHEET`.
- **B. Drop orphans silently** and let re-interpret rewrite the plan. That loses the user's region with no notice.

**Lean: A.** If Move to sheet lands the region past the new sheet's end, the overhang warning and Fit to sheet take over.

## Tradeoff comparison

| | D1: drift | D2: info | D3: narrow summary | D4: warning Snackbar | D5: computed | D6: orphans held |
|---|---|---|---|---|---|---|
| Package | parser | parser | api + core | web | web | web |
| Contract change | drift kinds (additive) | none | job result + commit result (optional field) | none | none | none |
| Spread to spec | yes | yes | yes | yes | yes | yes |

## Recommendation

1. Replay emits `bounds-overflow` (details: the bounds, the sheet's last row and column, rows and columns past) for a region whose stored bounds run past its sheet. It emits a new `sheet-missing` drift kind for a region whose sheet is absent, instead of skipping it silently.
2. Both are `info` severity and not identity-changing, so commit, recommit and sync never halt on them. `BOUNDS_OVERFLOW`'s default severity becomes `info`.
3. `LayoutPlanCommitService.commit` returns an optional `replayWarnings` summary, capped at 20 entries plus a count. The Google Sheets and Microsoft Excel adapters put it on the sync result (`ConnectorSyncResultSchema.replayWarnings`, optional).
4. `useConnectorInstanceSync` keeps `replayWarnings`. `ConnectorInstanceSyncFeedbackUI` shows a warning-severity success naming up to three regions, with a "Modify layout plan" router link for callers who can edit the plan.
5. The layout editor computes each region's overhang from its bounds and sheet size, shows it in the region panel and on its canvas tab, and offers **Fit to sheet** through `handleBoundsChange`.
6. `planRegionsToDrafts` returns orphaned regions instead of throwing. The editor lists each with **Move to sheet…** and **Delete**, and disables Interpret until none remain.
7. The FAQ gains an entry on what happens when a synced sheet shrinks or disappears.

## Open questions

1. **Reaping around a missing sheet.** Sync reaps per entity, and only for entities that got records this run. A single-region entity whose sheet vanished therefore keeps its old records, stale. An entity with another region on a live sheet loses the missing region's records. Should a missing sheet protect its records from the reap? **Lean: not here.** The warning states the effect accurately ("its records weren't refreshed"), and changing reap semantics, which needs per-region provenance on records, is its own ticket, filed from this discovery.
2. **Overhang reaping.** Rows past a shrunken sheet's end really are gone, so their records are reaped by the normal watermark. That's correct, so the warning says "replayed as blank", not "kept". **Lean: keep**; it's the source of truth shrinking.
3. **Move to sheet scope.** Re-homing keeps the bounds, which may not fit or mean the same thing on the other sheet. **Lean:** keep the bounds and let Decision 5's warning handle any overhang; the user re-interprets anyway.
4. **Recommit after Fit to sheet.** The editor's commit replays the trimmed plan, so the overhang drift no longer appears. **Lean: no extra handling**; Decision 5 already cleared the warning before commit.
5. **Help placement.** **Lean:** a new FAQ entry next to "What happens when I sync an entity?" rather than a glossary term.

## Enterprise-scale considerations

- **Concurrency & correctness.** Sync already runs under the instance lock (`connector-sync.processor.ts:136-151`); this adds read-only signals to replay and a field to its result. Fit to sheet edits only the in-memory draft. Lean: no new locking.
- **Accuracy & auditability.** The job row's `result.replayWarnings` is the durable record of what a sync replayed blank or skipped, alongside `mirrorDegraded`. Lean: the job result is the record; the Snackbar is only its view.
- **Failure modes.** The warning is advisory and fails open: if it can't be computed, the sync proceeds as today. Data safety is open question 1 (the reap), deliberately not changed here.
- **Scale & unbounded growth.** A plan can hold many regions, so `replayWarnings` is capped at 20 plus a count, and the Snackbar names at most three.
- **Multi-tenancy.** The result is per job and readable under the existing job rules (#692 redacts `result` for non-creators). N/A beyond that.
- **Contract stability.** Additive: an optional field on the sync result and the commit result, and a new drift kind. Older jobs simply lack it.
- **Data lifecycle.** No new retention: it lives on the job row and follows its lifecycle.

## What this doesn't decide

- Reap semantics for a missing sheet's records (open question 1), which becomes its own ticket.
- Warnings for other drift kinds, or wiring `DriftBannerUI` in general.
- Clamping stored bounds without the user's action.
- The draft-commit path's own bounds check (a client plan past the sheet replays blanks, and now warns).

## Next step

`docs/OVERHANG_REPLAY_WARNING.spec.md` fixes the contracts: the drift kinds and details, `replayWarnings` on the commit and sync results, the hook's shape, and the Snackbar and panel copy. The plan slices it in four test-first commits:
1. parser (drift emission and severity);
2. api + core (commit summary, adapters, job schema);
3. web sync feedback;
4. web editor (overhang warning and Fit to sheet; orphan handling).
