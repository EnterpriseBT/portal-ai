# File Upload — Lock Identity to `rowPosition` — Spec

**Lock every region's `identityStrategy` to `rowPosition`, hide the `IdentityPanel`, and suppress the `ROW_POSITION_IDENTITY` warning — file-upload workflow only.**

Discovery: `docs/FILE_UPLOAD_IDENTITY_LOCK.discovery.md`. Resolved decision points (D1–D6) from the discovery's open list, applied below:

- **D1 (helper shape):** one helper, `lockPlanIdentityToRowPosition(plan: LayoutPlan): LayoutPlan`. Does both transformations (lock identity + strip warning) in one pure pass. Tests exercise each transformation with separate cases against the same helper.
- **D2 (call site):** invoked in the workflow's `runInterpret` callback, between `preserveUserRegionConfig(...)` and `planRegionsToDrafts(...)`. Not embedded inside `planRegionsToDrafts` — that function is shared and stays generic.
- **D3 (re-interpret behavior):** existing `regionDraftsToHints` already round-trips `source: "user"` as a user-locked hint. The helper sets `source: "user"` so the re-interpret pass preserves the lock. Pinned by a test that exercises the redraw → re-interpret cycle.
- **D4 (region-shape coverage):** `rowPosition` is universally valid (`extract-records.ts` always derives from coords). Pinned by a test that runs the helper against fixtures for 1D records-as-rows, 1D records-as-columns, and 2D pivot/crosstab plans.
- **D5 (story updates):** the file-upload review-step stories that pass identity props get those props removed. Enumerated in §"Files touched" below.
- **D6 (warning filter scope):** the helper runs only inside the file-upload workflow. No effect on cloud-spreadsheet workflows. Spec asserts this by structural argument (no other consumer imports the helper) and reinforces with a test stub that imports the helper from the file-upload `utils/` path.

After this change: no file-upload commit can fail with `LAYOUT_PLAN_DRIFT_IDENTITY_CHANGED`, the IdentityPanel does not appear in the review step, and no region in the file-upload editor shows a `ROW_POSITION_IDENTITY` warning chip.

---

## Scope

### In scope

1. **New helper** `lockPlanIdentityToRowPosition` in `apps/web/src/workflows/FileUploadConnector/utils/lock-identity.util.ts`. Pure function; takes a `LayoutPlan`, returns a new `LayoutPlan` with each region's `identityStrategy` replaced and each region's `warnings` array filtered.
2. **Workflow wiring change** in `FileUploadConnectorWorkflow.component.tsx`:
   - Import the helper.
   - In `runInterpret` (around line 484–506), call the helper on `result.plan` after `preserveUserRegionConfig` and before `planRegionsToDrafts`. The locked plan is what becomes the workflow's persisted plan.
   - Drop the two props `resolveIdentityLocatorOptions` and `onIdentityUpdate` from the `<FileUploadReviewStepUI>` render at lines 309–336. The module's existing gate at `RegionReviewCard.component.tsx:277-280` hides the IdentityPanel when these are undefined.
   - Drop any now-unused imports (e.g., `resolveLocatorOptionsFor`, `buildIdentityUpdater` from `identity-panel-wiring.util`) from this file. The util module itself stays — it's still used by the cloud-spreadsheet workflows.
3. **Story updates** — the file-upload workflow stories that render the review step pass identity props today. Drop those props in the stories so the rendered story matches the new posture. Specifically: every `*.stories.tsx` under `apps/web/src/workflows/FileUploadConnector/stories/` that constructs review-step args.
4. **Test coverage** for the helper (full suite below) plus updates to any existing FileUpload tests that asserted the IdentityPanel render.

### Out of scope

- Changes to `@portalai/spreadsheet-parsing`. The parser keeps emitting `ROW_POSITION_IDENTITY` and keeps running `pickIdentity(...)` heuristics. The file-upload workflow simply discards both before they reach the editor.
- Changes to `RegionEditor` module surface. No new prop. The existing `undefined`-prop escape hatch is what we use.
- Changes to cloud-spreadsheet workflows (`GoogleSheetsConnector`, `MicrosoftExcelConnector`). They keep wiring `resolveIdentityLocatorOptions` / `onIdentityUpdate`, keep showing the panel, keep showing rowPosition warnings.
- Changes to `LayoutPlanCommitService` or any API code. The drift gate's `column`-keyed identity branches become unreachable for file-upload organically because no region will be `kind: "column"`; no API change required.
- Re-wording any error message or API code. `LAYOUT_PLAN_DRIFT_IDENTITY_CHANGED` keeps its current wording — just won't fire on file-upload commits anymore.
- Backfill of historical file-upload connector instances. Not needed — file-upload doesn't re-sync, so the historical identity strategy is never re-read. New uploads pick up the new behavior; old data is unaffected.

---

## Helper specification

**File:** `apps/web/src/workflows/FileUploadConnector/utils/lock-identity.util.ts`.

**Signature:**

```ts
import type { LayoutPlan } from "@portalai/core/contracts";

/**
 * Returns a new `LayoutPlan` with every region locked to `rowPosition`
 * identity and the resulting `ROW_POSITION_IDENTITY` advisory warning
 * stripped. File-upload-only: the lock and the warning suppression are
 * both context-specific to one-shot uploads where stable-by-value
 * identity is meaningless.
 *
 * Sets `identityStrategy.source = "user"` so subsequent re-interpret
 * passes (via `regionDraftsToHints`) preserve the lock rather than
 * letting the parser re-detect a column.
 */
export function lockPlanIdentityToRowPosition(plan: LayoutPlan): LayoutPlan;
```

**Behavior:**

- Returns a new `LayoutPlan` object (not a mutation of the input). Region array is rebuilt; each region object is rebuilt; `identityStrategy` and `warnings` are replaced. All other plan + region fields pass through by reference (acceptable because the rest of the workflow treats the plan as immutable).
- Every region's `identityStrategy` becomes:

  ```ts
  { kind: "rowPosition", confidence: 1, source: "user" }
  ```

  No conditional on the prior strategy. A region whose prior strategy was already `rowPosition` still gets rewritten — idempotency is the contract. A region whose prior strategy was `composite` gets rewritten too — none of the discriminator cases survive.

- Every region's `warnings` is filtered to exclude entries whose `code === "ROW_POSITION_IDENTITY"`. All other warning codes pass through unchanged.
- The returned plan's `planVersion` is unchanged.

**No-op behavior:**

- A plan with zero regions returns a plan with zero regions (and a fresh array reference).
- A plan whose regions have no `ROW_POSITION_IDENTITY` warnings returns the same warning content (filtered output equals input length, but a fresh array reference is fine — the workflow doesn't compare warnings by reference).

---

## Workflow integration

In `FileUploadConnectorWorkflow.component.tsx`, the existing `runInterpret`:

```ts
const runInterpret = useCallback(
  async (regions) => {
    const workbook = workbookRef.current;
    const uploadSessionId = uploadSessionIdRef.current;
    if (!workbook) throw new Error("Workbook not parsed");
    if (!uploadSessionId) throw new Error("Upload session missing");
    const res = await interpretMutate({
      uploadSessionId,
      regionHints: regionDraftsToHints(workbook, regions),
    });
    const plan = preserveUserRegionConfig(res.plan, regions);
    return {
      regions: planRegionsToDrafts(plan, workbook),
      plan,
      overallConfidence: overallConfidenceFromPlan(plan),
    };
  },
  [interpretMutate]
);
```

becomes:

```ts
const runInterpret = useCallback(
  async (regions) => {
    const workbook = workbookRef.current;
    const uploadSessionId = uploadSessionIdRef.current;
    if (!workbook) throw new Error("Workbook not parsed");
    if (!uploadSessionId) throw new Error("Upload session missing");
    const res = await interpretMutate({
      uploadSessionId,
      regionHints: regionDraftsToHints(workbook, regions),
    });
    const lockedPlan = lockPlanIdentityToRowPosition(
      preserveUserRegionConfig(res.plan, regions)
    );
    return {
      regions: planRegionsToDrafts(lockedPlan, workbook),
      plan: lockedPlan,
      overallConfidence: overallConfidenceFromPlan(lockedPlan),
    };
  },
  [interpretMutate]
);
```

The lock applies to *every* interpret call (initial + every re-interpret). Re-interpret is idempotent because `regionDraftsToHints` round-trips `source: "user"` and the helper re-applies regardless. No additional caching or guard needed.

The `<FileUploadReviewStepUI>` block at lines 309–336 drops two props:

```diff
                resolveColumnLabel={resolveColumnLabel}
-                resolveIdentityLocatorOptions={(region) =>
-                  resolveLocatorOptionsFor(workbook, region)
-                }
-                onIdentityUpdate={buildIdentityUpdater({
-                  workbook,
-                  regions,
-                  onRegionUpdate,
-                })}
                onCommit={onCommit}
```

The two helpers being removed (`resolveLocatorOptionsFor`, `buildIdentityUpdater`) are imported from `../../modules/RegionEditor/utils/identity-panel-wiring.util` — the import line stays only if other usages remain in this file. If the file no longer references them, the import drops too.

---

## Test plan

### Helper unit tests

`apps/web/src/workflows/FileUploadConnector/__tests__/lock-identity.util.test.ts`. Cases:

1. **Locks `kind: "column"` strategy to rowPosition.** Input: a plan with one region whose `identityStrategy` is `{ kind: "column", sourceLocator: ..., confidence: 0.85, source: "heuristic" }`. Output: that region's strategy is `{ kind: "rowPosition", confidence: 1, source: "user" }`. Other region fields equal by deep-equality.
2. **Locks `kind: "composite"` strategy to rowPosition.** Same shape, composite input.
3. **Idempotent on `kind: "rowPosition"` (already locked).** Input region already has `{ kind: "rowPosition", confidence: 1, source: "user" }`. Output is structurally equal (deep equal). The function still returns a new plan reference (fresh array) but content matches.
4. **Strips `ROW_POSITION_IDENTITY` warning.** Input region has `warnings: [{ code: "ROW_POSITION_IDENTITY", ... }, { code: "MULTIPLE_HEADER_CANDIDATES", ... }]`. Output region's `warnings` is `[{ code: "MULTIPLE_HEADER_CANDIDATES", ... }]`.
5. **Preserves all other warning codes.** Input region has multiple warnings, none of which are `ROW_POSITION_IDENTITY`. Output region's warnings are deep-equal to input.
6. **Multi-region plan.** Three regions, each with a different identity-strategy kind and a different mix of warnings. Output: every region rewritten, each warning array correctly filtered.
7. **Empty regions array.** Input: plan with zero regions. Output: plan with zero regions; doesn't throw.
8. **Preserves non-identity, non-warning region fields.** Pin a representative subset (`bounds`, `headerAxes`, `segmentsByAxis`, `columnBindings`, `cellValueField`, `targetEntityDefinitionId`, `confidence`, `proposedLabel`, `drift`) to deep-equal the input.
9. **Preserves `planVersion` and other top-level plan fields.** Whatever else lives at the plan envelope passes through.

Run these via `cd apps/web && npm run test:unit -- lock-identity` per `feedback_use_npm_test_scripts`.

### Workflow integration tests

Update or add cases in the existing FileUpload workflow tests under `apps/web/src/workflows/FileUploadConnector/__tests__/`:

10. **Post-interpret plan has every region locked.** Mock `interpretMutate` to return a plan with `kind: "column"` identity. Drive the workflow through `runInterpret`. Assert the workflow's persisted plan has every region as `rowPosition` with `source: "user"`.
11. **Re-interpret preserves the lock.** Run `runInterpret` twice (simulating user redraw + re-interpret). Assert the lock is preserved through both passes — second-pass `interpretMutate` is called with `regionHints` that include `source: "user"` for the identity, and the second-pass returned plan is locked.
12. **Review step renders no IdentityPanel.** Render `FileUploadConnectorWorkflow` at the review step with mock plan + workbook fixtures. Assert no element matching the IdentityPanel's "Record identity" / "No stable identity" headings is in the DOM.
13. **No `ROW_POSITION_IDENTITY` warning chip in the review step.** With the locked plan and a region that *would* have had the warning, render the review step and assert no UI surface that displays warning chips contains the `ROW_POSITION_IDENTITY` code.

### Cloud-spreadsheet regression test

14. **Google Sheets review step still renders the IdentityPanel.** This test almost certainly already exists somewhere in the GoogleSheets workflow tests; verify it still passes. If absent, add a minimal one.

### Story snapshots

The Storybook stories under `apps/web/src/workflows/FileUploadConnector/stories/` that today render the review step with identity props update:

- Drop `resolveIdentityLocatorOptions` / `onIdentityUpdate` from story args.
- Update any fixture plans that still have non-rowPosition identity to use rowPosition (for visual fidelity with the production behavior). Optional but recommended — otherwise stories drift from reality.

Enumerate the file list during plan execution; the spec doesn't pre-declare which stories because it depends on what's there at branch tip.

---

## Behavior on edge cases

- **Region with no warnings array (older fixtures).** `region.warnings ?? []` defensively. The runtime contract is that `warnings` is always present (it's in the schema), but tests/fixtures sometimes omit it; helper handles the absence cleanly.
- **Region with malformed identity strategy (test fixture only).** The helper unconditionally replaces with rowPosition, so malformed input is overwritten. Real plans always have a valid strategy because they came through `LayoutPlanSchema.safeParse` server-side; the helper doesn't re-validate.
- **Plan returned from server already has all regions as rowPosition.** Helper still runs, returns a deep-equal plan with fresh references. Cheap and idempotent.

---

## Risks & rollback

| Risk | Mitigation |
|---|---|
| Existing file-upload integration test mocks an interpret response that asserts on a `column` identity reaching the review step. | Update the mock + assertion to reflect the locked posture. The helper change is additive in the workflow's `runInterpret`, not a bypass — tests that pinned the *prior* plan-shape need to update. Enumerated as part of the plan's slice 2. |
| `regionDraftsToHints` doesn't actually round-trip `source: "user"` for `rowPosition`, in which case re-interpret could break the lock. | Test (11) above pins the round-trip explicitly. If it fails, the helper needs to also pre-seed the regionHint independently — but this should not be required because the existing record-identity-review work landed exactly this round-trip. |
| Removing IdentityPanel breaks the user's mental model of "what column is the identity." | The IdentityPanel was the wrong UI for file-upload — it asks a question with no consequence. Removing it doesn't hide information, it removes a misleading control. Confirmed by the discovery's audit: no downstream code consumes the strategy on file-upload. |
| Helper diverges from a future identity-strategy kind. | TypeScript exhaustiveness checking on the discriminated union (helper switches over `prior.kind` even though it always overwrites — see the "Defensive form" note below). New kinds force a compile error. |

**Rollback** is reverting the workflow file (re-add the two props, drop the helper call) and deleting the new helper + test files. No state to clean up.

### Defensive form

Although the helper always overwrites the strategy, write the rewrite in a form that makes the type-checker happy on additions:

```ts
const newStrategy: IdentityStrategy = {
  kind: "rowPosition",
  confidence: 1,
  source: "user",
};
```

The compiler verifies this matches the `IdentityStrategyRowPositionSchema` shape. If a future schema change requires extra fields on `rowPosition`, the helper fails to compile, forcing a deliberate update. No exhaustive `switch` is needed because we're constructing not destructuring — but if reviewers prefer a `switch (prior.kind)` with `assertNever(_)` as a safety net, that's also fine.

---

## Acceptance criteria

- [ ] `lockPlanIdentityToRowPosition` exists at `apps/web/src/workflows/FileUploadConnector/utils/lock-identity.util.ts` and passes its unit-test suite.
- [ ] `FileUploadConnectorWorkflow.component.tsx`'s `runInterpret` calls the helper on every interpret response.
- [ ] The `<FileUploadReviewStepUI>` render no longer passes `resolveIdentityLocatorOptions` or `onIdentityUpdate`.
- [ ] FileUpload review-step rendering shows no IdentityPanel and no `ROW_POSITION_IDENTITY` warning chip in the test fixture covering a previously-affected workbook.
- [ ] Google Sheets / Microsoft Excel review steps still render the IdentityPanel (regression test green).
- [ ] `cd apps/web && npm run test:unit` is green end-to-end.
- [ ] Manual smoke test: upload a CSV whose AI-detected identity column has duplicates or blanks. Confirm commit succeeds (no `LAYOUT_PLAN_DRIFT_IDENTITY_CHANGED` 409). Confirm the review step shows no IdentityPanel and no rowPosition warning. Confirm `entity_records` rows are created and queryable post-commit.

---

## Files touched

- New: `apps/web/src/workflows/FileUploadConnector/utils/lock-identity.util.ts`
- New: `apps/web/src/workflows/FileUploadConnector/__tests__/lock-identity.util.test.ts`
- Edit: `apps/web/src/workflows/FileUploadConnector/FileUploadConnectorWorkflow.component.tsx`
- Edit: `apps/web/src/workflows/FileUploadConnector/__tests__/FileUploadConnector*.test.tsx` (cases that asserted IdentityPanel render and any that pinned a non-rowPosition identity post-interpret)
- Edit: `apps/web/src/workflows/FileUploadConnector/stories/*.stories.tsx` (drop identity props, update fixture plans to rowPosition for visual fidelity)

No DB migration. No API change. No contract change. No SDK surface change. No change to `@portalai/spreadsheet-parsing`. No change to `RegionEditor` module exports. No change to GoogleSheets / MicrosoftExcel workflows.
