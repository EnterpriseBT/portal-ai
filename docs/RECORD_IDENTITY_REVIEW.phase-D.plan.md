# Phase D — Identity Selector UI in the Review Step

The user-facing override. Adds a per-region "Identity" panel inside `RegionReviewCardUI` (used by the gsheets review step and any other workflow that mounts the RegionEditor's review surface). Surfaces the auto-detected locator with a header label and confidence chip; lets the user pick from any column (records-are-rows) or row (records-are-columns) inside the region's bounds, plus a sentinel "Use position-based ids" option. Selecting an option writes `identityStrategy.source = "user"` on the draft so subsequent interpret passes preserve the choice (Phase A).

Depends on Phase A (the `source: "user"` round-trip). Independent of Phase B and C, but lands cleanest after them so the warning copy and sync gate are already aligned with what the panel does.

## D.1 Goals

1. A new pure-UI component `IdentityPanelUI` renders inside `RegionReviewCardUI`, one panel per region.
2. The panel shows the current locator with the header value at that index plus a confidence chip (or a "Set by you" badge when `source === "user"`).
3. The panel's dropdown lists every column (records-are-rows) or row (records-are-columns) inside the region's bounds, labeled by the header value at that coord. Each entry carries one of three tags: `unique`, `may have duplicates`, or `all blank`.
4. A trailing dropdown entry — "Use position-based ids — every sync recreates records" — maps to `kind: "rowPosition"`.
5. Picking an option calls a new `onIdentityUpdate(regionId, identity)` callback that updates `region.identityStrategy` with `source: "user"` set.
6. The `RegionReviewCardUI`'s existing extracted-record preview re-derives `source_id` from the new locator on selection, so the user sees the consequence of their pick before committing.
7. The new info banner from Phase C and the dropdown stay in sync — the banner disappears the moment a non-`rowPosition` identity is picked.
8. An inline warning renders under the dropdown when the picked option is non-unique. Commit is not blocked.

## D.2 Non-goals

- Composite identity construction in the dropdown (single-locator only for v1; spec §9 Q2).
- Editing identity from the main region editor canvas (review-step only for v1; spec §10 follow-up).
- Telemetry on overrides (deferred per spec §9 Q4).
- Auto-discovery of "id"-flavored column names beyond uniqueness (spec §10 follow-up).

## D.3 Pre-decision: live vs pre-computed uniqueness

Spec §9 Q3 asked whether to pre-compute uniqueness during interpret or compute it live in the editor. **Decision for Phase D**: live in the editor.

Rationale:
- The editor already holds the workbook in memory (the canvas reads cells live for previews).
- Pre-computing through interpret + plan persistence is more code and a schema migration; ship-shape benefit is small for v1.
- A focused helper `computeUniquenessByLocator(region, sheet): Map<string, "unique" | "non-unique" | "all-blank">` keyed by locator string is cheap to call once per region during the panel's render.

Memoize via `useMemo` keyed on `region.bounds` + `region.headerStrategyByAxis` + `region.id` so the map only recomputes when the region's data extent changes.

## D.4 TDD plan

Tests run via `npm run test:unit` from `apps/web` (or from workspace root). Storybook visual checks: `npm run storybook`.

### D.4.1 Pure helper: `computeUniquenessByLocator`
File: `apps/web/src/modules/RegionEditor/utils/identity-uniqueness.util.test.ts` (new)

1. **Records-are-rows: unique column flagged unique.** Region with `headerAxes: ["row"]`; col 1 contains `["a-1", "a-2", "a-3"]` → map["col-1"] = "unique".
2. **Records-are-rows: non-unique column flagged.** col 2 contains `["alice", "alice", "bob"]` → map["col-2"] = "non-unique".
3. **Records-are-rows: all-blank column flagged.** col 3 contains `["", "", ""]` → map["col-3"] = "all-blank".
4. **Records-are-columns: rows flagged symmetrically.** Mirror the three cases with `headerAxes: ["column"]`.
5. **2D crosstab returns empty map.** No single-locator candidates apply.

### D.4.2 Pure UI: `IdentityPanelUI`
File: `apps/web/src/modules/RegionEditor/__tests__/IdentityPanel.test.tsx` (new)

1. **Renders current locator with header label.** Props include `currentLocator: { kind: "column", col: 1 }`, `locatorOptions: [{ key: "col-1", label: "id", uniqueness: "unique" }, ...]`. Title row shows `Record identity: id`.
2. **Renders confidence chip when source = heuristic.** Props with `confidence: 0.7, source: "heuristic"` show the existing `ConfidenceChipUI`.
3. **Renders "Set by you" when source = user.** Replaces the confidence chip.
4. **Dropdown lists all locator options plus position sentinel.** Open the dropdown; assert option labels include `(unique)`, `(may have duplicates)`, `(all blank)` tags as appropriate, and a final `Use position-based ids — every sync recreates records` entry.
5. **Selecting a single-locator option fires `onIdentityChange` with kind: "column" + sourceLocator + source: "user".**
6. **Selecting position sentinel fires `onIdentityChange` with kind: "rowPosition" + source: "user".**
7. **Inline warning shows for non-unique pick.** Pick a `(may have duplicates)` option; expect a sub-`Alert severity="warning"` with text matching `/duplicate values/i`.
8. **No warning for unique pick.** Pick a `(unique)` option; warning is absent.

### D.4.3 Integration: `RegionReviewCard`
File: `apps/web/src/modules/RegionEditor/__tests__/RegionReviewCard.test.tsx`

1. **Identity panel is rendered.** Existing tests assert other panels — add a similar one for IdentityPanel.
2. **`onIdentityUpdate` propagates.** Render with a spy callback; pick an option; spy is called with `(regionId, { kind, sourceLocator, source: "user", confidence })`.
3. **Preview re-derives source_id.** When a different locator is picked, the preview row's `source_id` cell text changes to the value at the new locator. Use a fixture sheet with two distinct unique columns to keep the assertion deterministic.

### D.4.4 ReviewStep wiring + workflow harness
Files:
- `apps/web/src/modules/RegionEditor/__tests__/ReviewStep.test.tsx` (or wherever)
- `apps/web/src/workflows/FileUploadConnector/__tests__/file-upload-workflow.util.test.ts`
- `apps/web/src/workflows/GoogleSheetsConnector/__tests__/...` (add identity test alongside existing ones)

1. **Workflow's onIdentityUpdate writes the draft.** Fire the callback; assert the draft list now contains a region whose `identityStrategy.source === "user"`.
2. **Round-trip with Phase A's mapping.** Commit the draft; the persisted plan's region has `identityStrategy.source === "user"`. (Asserts Phase A wiring is intact end-to-end.)

### D.4.5 Storybook
File: `apps/web/src/modules/RegionEditor/stories/IdentityPanel.stories.tsx` (new)

Stories cover:
1. `Default` — heuristic-picked unique column.
2. `UserOverride` — user-picked column, "Set by you" badge.
3. `RowPosition` — sentinel selected, banner-style warning rendered (the banner copy comes from Phase C; assert visual coherence).
4. `RecordsAreColumns` — row-locator variant with mirrored options.
5. `WithDuplicates` — user picked a non-unique option; inline warning visible.

## D.5 Implementation steps

### Step 1 — Pure helper `computeUniquenessByLocator`
File: `apps/web/src/modules/RegionEditor/utils/identity-uniqueness.util.ts` (new)

```ts
export type Uniqueness = "unique" | "non-unique" | "all-blank";

export interface LocatorOption {
  key: string;          // e.g. "col-3" or "row-2"
  label: string;        // header value at the locator
  uniqueness: Uniqueness;
  axis: "row" | "column"; // which axis the locator points at (col-locator on rows-as-records → axis="column")
  index: number;
}

export function computeLocatorOptions(
  region: RegionDraft,
  sheet: WorkbookSheet
): LocatorOption[];
```

Reuse `recordsAxisOf(region)` to decide records-are-rows vs records-are-columns. Reuse the heuristic's `isUnique` predicate (extract it into the same util module so the editor and `detectIdentity` share one definition — minor refactor of `packages/spreadsheet-parsing/src/interpret/stages/detect-identity.ts:isUnique` into an exported helper from a shared spot, e.g. `packages/spreadsheet-parsing/src/identity/uniqueness.ts`).

### Step 2 — Pure UI `IdentityPanelUI`
File: `apps/web/src/modules/RegionEditor/IdentityPanel.component.tsx` (new)

Single-component file (no implementation/container split — the panel is fed entirely from props). Pattern follows the existing `BindingEditorPopover.component.tsx` for chip + dropdown behavior.

```tsx
export interface IdentityPanelUIProps {
  regionId: string;
  currentLocator: IdentityLocatorView; // { kind: "column" | "rowPosition", sourceLocator?, label?, confidence?, source }
  locatorOptions: LocatorOption[];
  onIdentityChange: (regionId: string, next: IdentityChange) => void;
}
```

Render order:
1. Title row: `Record identity: <label>` plus chip (heuristic confidence vs "Set by you").
2. `<Select>` (MUI; or `SearchableSelect` from `@portalai/core/ui` if option count is large) with labeled options.
3. Inline `<Alert>` warning when the selected option's uniqueness is `non-unique`.

### Step 3 — Wire into `RegionReviewCardUI`
File: `apps/web/src/modules/RegionEditor/RegionReviewCard.component.tsx`

Add an `IdentityPanelUI` mount before the existing extracted-record preview. Pass in:
- `currentLocator` derived from `region.identityStrategy`.
- `locatorOptions` from `computeLocatorOptions(region, sheet)` (memoized).
- `onIdentityChange` from the new prop on `RegionReviewCardUIProps`.

Lift the `onIdentityChange` prop one level up (`ReviewStepUIProps` adds `onIdentityUpdate`). Mirrors how `onUpdateBinding` flows today.

Update the preview-records helper (`apps/web/src/modules/RegionEditor/utils/preview-records.util.ts`) to honor the current `region.identityStrategy` when rendering the `source_id` column. The replay code already does this at extract-time; mirror it in the editor preview.

### Step 4 — Wire workflows
Files:
- `apps/web/src/workflows/FileUploadConnector/...` — accept `onIdentityUpdate` in the workflow hook; persist into draft list.
- `apps/web/src/workflows/GoogleSheetsConnector/...` — same.

Each workflow already exposes `onRegionUpdate` for partial draft patches; reuse that to set `identityStrategy: { ...next, source: "user" }`.

### Step 5 — Banner coordination
File: `apps/web/src/workflows/GoogleSheetsConnector/GoogleSheetsReviewStep.component.tsx` (touched in Phase C)

The banner from Phase C still fires when any region is `rowPosition`. After Phase D the banner copy can include a CTA: `Pick an identity field above` (anchor link to the IdentityPanel via the region card's id). Wire if anchor scrolling is supported.

### Step 6 — Storybook stories
File: `apps/web/src/modules/RegionEditor/stories/IdentityPanel.stories.tsx` (new) — fixtures listed in D.4.5.

## D.6 Files touched

```
apps/web/src/modules/RegionEditor/IdentityPanel.component.tsx                          (new)
apps/web/src/modules/RegionEditor/__tests__/IdentityPanel.test.tsx                     (new)
apps/web/src/modules/RegionEditor/stories/IdentityPanel.stories.tsx                    (new)
apps/web/src/modules/RegionEditor/utils/identity-uniqueness.util.ts                    (new)
apps/web/src/modules/RegionEditor/utils/identity-uniqueness.util.test.ts               (new)
apps/web/src/modules/RegionEditor/RegionReviewCard.component.tsx
apps/web/src/modules/RegionEditor/__tests__/RegionReviewCard.test.tsx
apps/web/src/modules/RegionEditor/ReviewStep.component.tsx
apps/web/src/modules/RegionEditor/utils/preview-records.util.ts
apps/web/src/modules/RegionEditor/index.ts                                             (re-export IdentityPanelUI + types)
apps/web/src/workflows/FileUploadConnector/...                                         (workflow harness)
apps/web/src/workflows/GoogleSheetsConnector/...                                       (workflow harness)
packages/spreadsheet-parsing/src/identity/uniqueness.ts                                (new; extracted from detect-identity.ts)
packages/spreadsheet-parsing/src/interpret/stages/detect-identity.ts                   (use the extracted helper)
```

## D.7 Verification (acceptance for Phase D)

1. `npm run test:unit` clean in `apps/web` and `packages/spreadsheet-parsing`. Type-check + lint clean.
2. Storybook stories render the panel in all five fixtures (D.4.5).
3. End-to-end in browser:
   - File-upload connector: upload a CSV with multiple unique columns. The review step shows a panel per region with the auto-detected pick. Override to a different unique column. Commit. Reload the connector; the editor reads back the user's choice (`source: "user"` round-trip via Phase A).
   - Re-run sync: verify the source_ids reflect the user-picked locator (not the heuristic's pick).
4. End-to-end with rowPosition: pick the position sentinel, commit, sync. Sync proceeds (Phase B) and the soft banner from Phase C is consistent with the dropdown's selection.
5. Pick a non-unique option; commit anyway; trigger sync. Upsert returns a duplicate-key error; the toast surfaces it. Re-edit the panel; pick a unique option; sync recovers.

## D.8 Risks and mitigations

- **Live uniqueness compute on large regions.** Walking every cell across all columns/rows in the region every render could lag. Mitigation: memoize on `region.bounds + region.id`; the map's complexity is `O(rows × cols)` per region but only recomputed on draft mutation. Profile if a region exceeds 10k cells; revisit pre-compute (spec §9 Q3).
- **Dropdown option explosion.** A region with 200 columns produces 200 options. Mitigation: use the searchable variant (`SearchableSelect` from `@portalai/core/ui`) when option count exceeds a threshold (e.g. 20).
- **Coupling between editor preview and replay.** The preview reads `region.identityStrategy` via a helper that mirrors `replay/identity.ts`. If the two diverge, the user sees a different `source_id` in the preview than at sync-time. Mitigation: extract a shared `deriveSourceIdLite` into the spreadsheet-parsing package's main entry (browser-safe) and call it from both the preview helper and the Node-only `replay/identity.ts`. Add a test that locks the two outputs together.
- **Composite-locator regions.** The heuristic emits a composite candidate when no single column suffices. The dropdown shows the composite as a read-only entry tagged `composite`. Picking a single-locator override replaces it; the user cannot construct a new composite from this UI. Out of scope per D.2.
