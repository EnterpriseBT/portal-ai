# Record Identity Review and Override

Specification for letting users confirm or override the auto-detected per-region identity strategy in the layout-plan review step, removing the hard sync gate on `rowPosition` identity, and surfacing a non-blocking warning when a region commits without a stable identity.

## 1. Background

The interpret stage of `@portalai/spreadsheet-parsing` runs a heuristic (`detectIdentity`) that picks the first column (records-are-rows) or row (records-are-columns) whose values are non-empty and unique, and emits an `IdentityStrategy` of `kind: "column"` with a column- or row-locator. When no such locator is found, it falls back to `kind: "rowPosition"`.

Two failure modes have surfaced in real use:

1. **Wrong locator picked.** A region with header columns `[region, active, id, count]` had every column unique, including `count`. The heuristic picked the first unique candidate, which happened not to be the semantic identifier (`id`). Editing the value in the picked column changed the record's `source_id`, so the next sync reaped the old record and inserted a new one (`1 added, 0 updated, 14 unchanged, 1 removed`) instead of a clean update.

2. **Hard sync gate.** When the heuristic falls back to `rowPosition`, `assertSyncEligibility` (in `apps/api/src/adapters/google-sheets/google-sheets.adapter.ts`) refuses sync entirely with `LAYOUT_PLAN_SYNC_INELIGIBLE_IDENTITY`. The user can commit the plan once but cannot keep it in sync — even when reap-and-recreate every cycle would be acceptable for their data.

The review step (`apps/web/src/modules/RegionEditor/ReviewStep.component.tsx` and the gsheets-specific wrapper at `apps/web/src/workflows/GoogleSheetsConnector/GoogleSheetsReviewStep.component.tsx`) has no UI for confirming or overriding the identity choice. The user only sees the consequence at sync time.

## 2. Goals

1. Surface the auto-detected identity locator per region during review, with the header label of the chosen cell and the heuristic's confidence.
2. Let the user override with any column (records-are-rows) or row (records-are-columns) in the region — including a sentinel "no stable identity" choice that maps to `rowPosition`.
3. Persist the user's choice on the committed plan and prevent later interpret runs from overwriting it.
4. Allow sync on plans whose regions use `rowPosition`. The reaper already produces correct end-state (every record reaped + re-created each cycle); only the eligibility gate needs to relax.
5. Replace the current "One-shot import only" hard banner with a non-blocking warning that explains the reap-and-recreate consequence.

## 3. Non-goals

- Composite identity selection from the override UI. Composite (multi-locator) strategies remain auto-detected only for v1.
- Improvements to the heuristic itself. The current "first unique column/row" rule stays; the override is the user-facing fix for cases where it picks badly.
- Cross-region identity (e.g. one identity locator shared by two regions). Each region picks independently.
- New entitlement / role gates on who can commit `rowPosition` plans.

## 4. Domain model changes

### 4.1 `IdentityStrategy.source` (new field)

`packages/spreadsheet-parsing/src/plan/strategies.schema.ts` — add an optional `source` discriminator on every variant of `IdentityStrategySchema`:

```ts
source: z.enum(["heuristic", "user"]).default("heuristic"),
```

Semantics:
- `"heuristic"` (default; matches all pre-existing persisted plans on read) — the value came from `detectIdentity` and may be replaced on the next interpret pass.
- `"user"` — the user explicitly confirmed or overrode this choice in the review step. Subsequent interpret runs MUST NOT replace it.

The default keeps the schema backwards-compatible: prior plans parse cleanly and behave as today (heuristic-overwriteable).

### 4.2 `RegionDraft.identityStrategy`

`apps/web/src/modules/RegionEditor/utils/region-editor.types.ts` already carries an `identityStrategy?` field on the draft. Extend its inline shape to mirror the persisted `source` field, plus a stable string locator key for the dropdown's selection state:

```ts
identityStrategy?: {
  kind: IdentityStrategyKind;
  sourceLocator?: string;       // existing; kept for backward compat
  source?: "heuristic" | "user";
  confidence?: number;
};
```

The `sourceLocator?: string` field today is a normalized string the editor already understands; the panel reuses it as the dropdown value.

### 4.3 Mapping plumbing

`apps/web/src/workflows/FileUploadConnector/utils/layout-plan-mapping.util.ts`:
- `regionDraftsToHints` — write `identityStrategy.source` into the hint when the draft carries `source: "user"`.
- `planRegionsToDrafts` — read `identityStrategy.source` (default `"heuristic"`) back so an override survives reload.

The same mapping helpers serve the gsheets workflow.

## 5. Frontend changes (apps/web)

### 5.1 Review step — Identity panel per region

Add a per-region "Identity" section to `RegionReviewCardUI` (`apps/web/src/modules/RegionEditor/RegionReviewCard.component.tsx`) so the panel renders inside each region's existing card.

Contents:

- **Header line** — "Record identity: <header-label>" (the cell value at the locator's index — e.g. "id" for a column locator at col 1) plus a small `ConfidenceChipUI` when `source === "heuristic"`. When `source === "user"` the chip text is "Set by you" with no numeric confidence.
- **Override dropdown** (`SelectOption[]`) listing:
  - One option per data column (records-are-rows) or data row (records-are-columns) inside the region's bounds, labeled by the header value at that index. Options corresponding to the heuristic's candidate set carry a `(unique)` tag; non-unique options carry a `(may have duplicates)` warning tag rendered inline.
  - A trailing **"Use position-based ids — every sync reaps and recreates records"** option, mapping to `kind: "rowPosition"`.
- **Live source-id preview** — the existing review card preview pane already renders extracted records. When the user changes the dropdown, the `source_id` column re-renders with values derived from the new locator.

The dropdown always picks **a single locator** (not composite). Composite candidates emitted by the heuristic stay applied silently if the user doesn't override (the dropdown shows the composite entry as `composite (col 1 + col 2)` with no override allowed beyond switching to a single locator or to `rowPosition`).

When the user picks an option:
- `region.identityStrategy.kind` updates to `"column"` (single locator) or `"rowPosition"`.
- `region.identityStrategy.sourceLocator` updates to the picked locator's normalized key.
- `region.identityStrategy.source` is set to `"user"`.

Validation: when the picked option is non-unique on the current preview, render an inline warning under the dropdown — "This locator has duplicate values; sync will fail with a unique-key conflict during upsert. Pick another field or use position-based ids." The Commit button is not blocked by this warning (the user may still commit at their own risk; the upsert error is recoverable by re-editing).

### 5.2 GoogleSheetsReviewStep banner

`apps/web/src/workflows/GoogleSheetsConnector/GoogleSheetsReviewStep.component.tsx` — replace the current `"One-shot import only"` hard banner with a softer advisory:

> **No stable identity for this region.** Records will be reaped and re-created on every sync. Pick an identity field above to keep records stable across syncs.

The banner is shown when `region.identityStrategy.kind === "rowPosition"`. It is informational (`severity="info"`), does not gate Commit, and disappears the moment the user picks a single-locator identity.

### 5.3 Sync button + tooltip

`apps/web/src/components/ConnectorInstanceSyncButton.component.tsx` — drop the `syncEligible: false` disable case for the rowPosition reason. Replace its tooltip text with an advisory that fires when the connector instance carries any `rowPosition` region:

> Re-sync recreates all records in the affected region(s).

The button stays enabled. Other sync-eligibility reasons (e.g. `LAYOUT_PLAN_NOT_FOUND`) keep their existing disable behavior.

### 5.4 Test coverage (apps/web)

- `RegionReviewCard.test.tsx` — renders the Identity panel; dropdown shows expected options; selecting an option calls the update callback with the right shape; "(may have duplicates)" tag renders for non-unique picks.
- `GoogleSheetsReviewStep.test.tsx` — banner copy reflects the new advisory; banner disappears when no region is `rowPosition`.
- `ConnectorInstanceSyncButton.test.tsx` — button is enabled when `syncEligible` is `true` even with rowPosition warnings; tooltip matches the new copy.
- `layout-plan-mapping.util.test.ts` — `regionDraftsToHints` + `planRegionsToDrafts` round-trip `identityStrategy.source`.

## 6. Backend changes (apps/api)

### 6.1 Drop the `rowPosition` sync gate

`apps/api/src/services/sync-eligibility.util.ts`:
- Rename the helper's return shape to `SyncEligibilityCheck { ok: true; identityWarnings: { regionId: string }[] }` — the `ok: false` branch goes away for the rowPosition reason. The helper now returns `ok: true` always but with a populated `identityWarnings` when any region is `rowPosition`.

`apps/api/src/adapters/google-sheets/google-sheets.adapter.ts`:
- `assertSyncEligibility` no longer returns `ok: false, reasonCode: LAYOUT_PLAN_SYNC_INELIGIBLE_IDENTITY` for rowPosition regions.
- The function still returns `{ ok: false, reasonCode: LAYOUT_PLAN_NOT_FOUND }` when there's no plan.
- It returns `{ ok: true, identityWarnings: [...] }` when rowPosition regions exist.

`apps/api/src/adapters/adapter.interface.ts`:
- Extend `SyncEligibility` with `identityWarnings?: { regionId: string }[]`. Existing adapters that don't populate it remain valid.

### 6.2 Skip detection for user-locked identity

`packages/spreadsheet-parsing/src/interpret/stages/detect-identity.ts`:
- When the input region (i.e. an existing region read from a prior plan and being re-interpreted) carries `identityStrategy.source === "user"`, the stage MUST emit a single candidate that round-trips the user's choice unchanged, with a synthetic rationale `"User-locked identity; heuristic skipped."`. `propose-bindings.ts:pickIdentity` then picks that candidate and the user's choice survives.

### 6.3 Connector-instance serializer

`packages/core/src/contracts/connector-instance.contract.ts` (consumed by `apps/web` for the `ConnectorInstanceSyncButton`'s `syncEligible` prop):
- `syncEligible` keeps its current semantics — `false` only when the instance has no plan, `true` otherwise. The rowPosition case no longer flips it to `false`.
- Optionally extend the contract with `identityWarnings?: { regionId: string }[]` so the UI can render a tooltip without an extra round-trip.

### 6.4 API code

`apps/api/src/constants/api-codes.constants.ts`:
- `LAYOUT_PLAN_SYNC_INELIGIBLE_IDENTITY` is no longer emitted by gsheets after this change. Keep the enum entry to preserve numeric ordering and avoid breaking downstream consumers; mark with a comment "(deprecated as of <PR>; no current emitter)".

### 6.5 Test coverage (apps/api)

- `sync-eligibility.util.test.ts` — assert `ok: true` with populated `identityWarnings` for a plan whose regions use `rowPosition`; the existing `ok: false` test for the same input flips to assert `ok: true`.
- `google-sheets.adapter.test.ts` (existing integration test) — assert that `assertSyncEligibility` returns `ok: true` for a rowPosition plan and that the sync run completes with the expected reap+create deltas.
- `interpret/stages/detect-identity.test.ts` — new test: `source: "user"` on the input region preserves the strategy unchanged through interpret.

## 7. Sync semantics (no functional change required)

The sync pipeline's behavior with `rowPosition` is already well-defined and does not need code changes:

- `replay/identity.ts:deriveSourceId` returns `row-{n}` (records-are-rows), `col-{n}` (records-are-columns), or `cell-{r}-{c}` (2D crosstabs).
- `LayoutPlanCommitService.commit` upserts on `(connector_entity_id, source_id)`. Records whose synthetic id is unchanged across syncs match `prev` and update; records whose id is new insert.
- The watermark reaper (`softDeleteBeforeWatermark`) soft-deletes any row whose `synced_at < runStartedAt`. After a row reorder/insert/delete, the prior synthetic ids are absent from the new fetch, so they get reaped.
- Net delta on a row reorder: `added = N, updated = 0, unchanged = K, removed = N`. The user sees this in the toast and understands the trade-off they accepted at commit time via the advisory banner.

## 8. Acceptance criteria

1. **Auto-detected identity is visible.** A user committing a freshly-detected region sees the auto-detected identity in the review card with the header label and a confidence chip.
2. **Override persists.** A user changes the dropdown to a different column. The committed plan stores `identityStrategy.source = "user"` and `sourceLocator` pointing at the new column. Re-fetching the plan and replaying interpret leaves the user's choice intact.
3. **Position-based opt-in.** A user picks "Use position-based ids". Plan commits with `identityStrategy.kind = "rowPosition"` and `source = "user"`. The connector-instance `syncEligible` flag stays `true`.
4. **Sync proceeds for rowPosition.** Triggering a sync on the plan above completes successfully (no `LAYOUT_PLAN_SYNC_INELIGIBLE_IDENTITY` 409). The toast shows non-zero `added` and `removed` counts when rows have shifted between syncs.
5. **Banner is non-blocking.** The review-step banner explaining reap+recreate is `severity="info"`, does not block Commit, and disappears once any single-locator identity is chosen.
6. **Sync-button advisory.** A connector instance whose plan includes a `rowPosition` region shows the advisory tooltip on the Sync button. The button is enabled.
7. **Duplicate warning.** A user picks a non-unique column from the dropdown. An inline warning appears under the dropdown. The Commit button stays enabled. Sync attempts fail at upsert with a clear duplicate-key error code; this is acceptable (recoverable by re-editing).

## 9. Open questions

1. **Granularity of override candidates.** Should the dropdown list every column/row in the region, or only the heuristic's candidate set? *Proposal: list every column/row with appropriate "(unique)" / "(may have duplicates)" tags. Hides nothing; the user gets full visibility.*
2. **Composite override.** Should the user be able to construct a composite key (two locators)? *Proposal: out of scope for v1; revisit if heuristic mis-detection on composite is a recurring complaint.*
3. **Live duplicate detection.** Should the inline "may have duplicates" tag be computed from the live preview, or pre-computed during interpret and persisted on the draft? *Proposal: pre-compute during interpret as a `uniquenessByColumn: Record<colKey, "unique" | "non-unique" | "all-blank">` map on the candidate set. The dropdown reads it without re-walking the workbook.*
4. **Telemetry.** Should we log when the user overrides the heuristic so we can tune `detectIdentity`? *Proposal: yes, fire `interpret.identity.overridden` with the heuristic's pick vs. the user's pick and the region shape. Useful for tightening the heuristic over time.*

## 10. Out-of-scope follow-ups (informational)

- A second pass on `detectIdentity` to prefer columns/rows whose header label matches common identifier names (`id`, `email`, `slug`) before purely-positional uniqueness.
- A "lock all to column 1" bulk action for users with many same-shape regions in one workbook.
- Extending the override surface from review-step into the region editor's main canvas (currently the editor has no `identityStrategy` editor; only review surfaces it). Once the spec lands, moving the panel earlier in the workflow becomes a small follow-up.
