# File Upload — Lock Identity to `rowPosition` — Plan

**TDD-sequenced implementation of `lockPlanIdentityToRowPosition` and its wiring into the file-upload workflow.**

Spec: `docs/FILE_UPLOAD_IDENTITY_LOCK.spec.md`. Discovery: `docs/FILE_UPLOAD_IDENTITY_LOCK.discovery.md`.

The change is small enough to land as two slices on a single branch — one PR. Slice 1 is the pure helper (write-test-first, then implement). Slice 2 is the workflow wiring + story/test updates that make the helper take effect end-to-end.

Run tests with `cd apps/web && npm run test:unit` per `feedback_use_npm_test_scripts` — never invoke jest directly.

---

## Slice 1 — Helper + unit tests

**Files**

- New: `apps/web/src/workflows/FileUploadConnector/utils/lock-identity.util.ts`.
- New: `apps/web/src/workflows/FileUploadConnector/__tests__/lock-identity.util.test.ts`.

**Steps**

1. **Audit the existing fixtures** so the test cases have realistic plan shapes.
   - Read `apps/web/src/workflows/FileUploadConnector/utils/file-upload-fixtures.util.ts` to find any `LayoutPlan` / region builders the test can compose.
   - Read `apps/web/src/modules/RegionEditor/stories/utils/region-editor-fixtures.util.ts` for the canonical 1D-rows / 1D-cols / 2D-pivot region fixtures referenced in spec test plan §(D4).
   - If suitable fixtures don't exist, the test file inlines minimal `LayoutPlan` literals — this is a unit test, not an integration test, so hand-rolled fixtures are acceptable.

2. **Write the test file first** with all nine cases from the spec's "Helper unit tests" section. Cases 1–9 verbatim from the spec; structure them as one `describe("lockPlanIdentityToRowPosition", () => { ... })` block. For each case:
   - `it("locks kind: column identity to rowPosition", ...)` — input plan with one `kind: "column"` region, assert output region's `identityStrategy` is `{ kind: "rowPosition", confidence: 1, source: "user" }`. Other region fields deep-equal the input via a partial-equality helper or explicit per-field assertions.
   - `it("locks kind: composite identity to rowPosition", ...)` — same shape, composite input.
   - `it("is idempotent on already-rowPosition input", ...)` — input region with rowPosition + `source: "user"`, output structurally equal.
   - `it("strips ROW_POSITION_IDENTITY warnings", ...)` — input region's warnings array contains the code, output excludes it.
   - `it("preserves all other warning codes", ...)` — input warnings has only non-rowPosition codes, output equals input.
   - `it("rewrites every region in a multi-region plan", ...)` — three regions, mixed strategies and warnings, all transformed correctly.
   - `it("returns a plan with zero regions when given zero regions", ...)` — empty regions array round-trips.
   - `it("preserves non-identity, non-warning region fields", ...)` — pin `bounds`, `headerAxes`, `segmentsByAxis`, `columnBindings`, `cellValueField`, `targetEntityDefinitionId`, `confidence`, `proposedLabel`, `drift` to deep-equal input.
   - `it("preserves planVersion and other top-level plan fields", ...)` — pin `planVersion`.
   - Run; verify all nine fail (helper module doesn't exist).

3. **Implement the helper.** A single function, ~20 lines, no internal helpers. Sketch:

   ```ts
   import type { LayoutPlan, IdentityStrategy } from "@portalai/core/contracts";

   export function lockPlanIdentityToRowPosition(plan: LayoutPlan): LayoutPlan {
     const lockedStrategy: IdentityStrategy = {
       kind: "rowPosition",
       confidence: 1,
       source: "user",
     };
     return {
       ...plan,
       regions: plan.regions.map((region) => ({
         ...region,
         identityStrategy: { ...lockedStrategy },
         warnings: (region.warnings ?? []).filter(
           (w) => w.code !== "ROW_POSITION_IDENTITY"
         ),
       })),
     };
   }
   ```

   Confirm `LayoutPlan` and `IdentityStrategy` are reachable from `@portalai/core/contracts` (they are — see existing imports in `apps/web/src/workflows/FileUploadConnector/utils/layout-plan-mapping.util.ts`). Cloning `lockedStrategy` per region (`{ ...lockedStrategy }`) is defensive — guards against any consumer mutating it later.

4. **Run the focused suite.** `cd apps/web && npm run test:unit -- lock-identity`. All nine cases pass. If any fail, fix the helper, not the test (the spec is the source of truth).

**Done when:**

- The helper file exists, exports `lockPlanIdentityToRowPosition`, and is the only export.
- All nine unit test cases pass.
- The helper is not yet imported anywhere outside its test file (slice 2 wires it).

**Risk:** the only realistic failure mode here is a TypeScript mismatch on the `IdentityStrategy` discriminated union if the contract has changed since the spec. If `tsc` flags it, read the latest `IdentityStrategy` shape from `packages/core/src/contracts/` (or wherever it's re-exported from) and adjust the literal. The unit-test cases don't depend on the literal's exact field set beyond `kind`, `confidence`, `source`.

---

## Slice 2 — Workflow wiring + test/story updates

**Files**

- Edit: `apps/web/src/workflows/FileUploadConnector/FileUploadConnectorWorkflow.component.tsx`.
- Edit: existing tests under `apps/web/src/workflows/FileUploadConnector/__tests__/` that pin pre-lock behavior (enumerated below by audit).
- Edit: existing stories under `apps/web/src/workflows/FileUploadConnector/stories/` that pass identity props or fixture plans with non-rowPosition identity.

**Steps**

1. **Audit existing FileUpload tests for assertions that will need updating.**
   - `cd apps/web && grep -rn "IdentityPanel\|identityStrategy.*column\|resolveLocatorOptionsFor\|buildIdentityUpdater\|onIdentityUpdate\|resolveIdentityLocatorOptions" src/workflows/FileUploadConnector/__tests__`
   - For each match, decide:
     - **Keep:** test exercises a non-identity behavior and only references identity tangentially.
     - **Update:** test asserts the IdentityPanel renders or the post-interpret plan has `kind: "column"` identity. Rewrite to assert the lock posture (no panel; rowPosition identity).
     - **Delete:** test exists *only* to exercise the IdentityPanel wiring inside the file-upload workflow. Delete and replace with the new "panel hidden" assertion in step (4).
   - Record the disposition for each in the PR description so reviewers can verify intent matches.

2. **Audit existing FileUpload stories.**
   - `cd apps/web && grep -rn "resolveIdentityLocatorOptions\|onIdentityUpdate\|kind: \"column\"\|kind: \"composite\"" src/workflows/FileUploadConnector/stories`
   - Each match falls into one of:
     - Story args pass identity wiring → drop those args.
     - Fixture plan pins a non-rowPosition identity → either pass it through `lockPlanIdentityToRowPosition` once at fixture build-time, or rewrite the literal to use rowPosition. Pick whichever is shorter; consistency with the production posture matters more than fixture purity.

3. **Wire the helper into `FileUploadConnectorWorkflow.component.tsx`.**
   - Add the import: `import { lockPlanIdentityToRowPosition } from "./utils/lock-identity.util";`.
   - In `runInterpret` (lines 484–506), replace:
     ```ts
     const plan = preserveUserRegionConfig(res.plan, regions);
     return {
       regions: planRegionsToDrafts(plan, workbook),
       plan,
       overallConfidence: overallConfidenceFromPlan(plan),
     };
     ```
     with:
     ```ts
     const lockedPlan = lockPlanIdentityToRowPosition(
       preserveUserRegionConfig(res.plan, regions)
     );
     return {
       regions: planRegionsToDrafts(lockedPlan, workbook),
       plan: lockedPlan,
       overallConfidence: overallConfidenceFromPlan(lockedPlan),
     };
     ```
   - In the `<FileUploadReviewStepUI>` render (lines 309–336), drop the two props:
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
   - Drop now-unused imports (`resolveLocatorOptionsFor`, `buildIdentityUpdater` from `../../modules/RegionEditor/utils/identity-panel-wiring.util`). If those are the only consumers in the file, the entire import line goes; if other identity-panel utils are still referenced in the file, keep just those.
   - Run `npx tsc --noEmit` (or rely on the watch process) to confirm no unused-import / unreferenced-binding errors. Do not silence them with comments.

4. **Add the new integration assertions** (test plan §(10)–(13) from the spec):
   - **§10 "Post-interpret plan has every region locked":** in the existing workflow test that mocks `interpretMutate`, inject a response whose plan has `kind: "column"` identity. After driving the workflow through `runInterpret`, assert the plan handed to `planRegionsToDrafts` (or stored on the workflow) has every region as rowPosition with `source: "user"`.
   - **§11 "Re-interpret preserves the lock":** call `runInterpret` twice. On the second call, assert `interpretMutate` receives `regionHints` that include `source: "user"` for the identity (so the parser sees the lock). Assert the second-pass returned plan is also locked.
   - **§12 "Review step renders no IdentityPanel":** render the workflow at the review step. Assert no element with the IdentityPanel's distinctive copy ("Record identity", "No stable identity", "Use position-based ids") is in the DOM.
   - **§13 "No ROW_POSITION_IDENTITY warning chip":** with a fixture plan that includes the warning, render the review step, assert no rendered warning surface contains the code.
   - These can land in the existing FileUpload integration test file or a new one (`__tests__/identity-lock.test.tsx`) — pick whichever the existing test layout dictates.

5. **Add the cloud-spreadsheet regression test** if not already present.
   - `cd apps/web && grep -rn "IdentityPanel" src/workflows/GoogleSheetsConnector/__tests__ src/workflows/MicrosoftExcelConnector/__tests__`
   - If a test already asserts the IdentityPanel renders in those workflows, no work needed beyond verifying it still passes after this slice.
   - If no such test exists, add a minimal one in the appropriate workflow's `__tests__/` folder. One assertion is enough: render the cloud-spreadsheet review step with normal props, find an IdentityPanel surface, expect it to be in the DOM.

6. **Run the unit suite.** `cd apps/web && npm run test:unit`. All cases pass — including the slice-1 helper tests, the updated FileUpload tests, the new integration assertions, and the cloud-spreadsheet regression. If anything red is unrelated to this work, stop and investigate before merging.

7. **Run lint + type-check.** `npm run lint` + `npm run type-check` from repo root. Zero errors, zero warnings (`feedback_lint_clean` policy from prior PRs).

8. **Manual smoke test.**
   - Start API + web: `npm run dev` from repo root.
   - Upload a CSV whose AI-detected identity column has duplicates or blanks (the failure case the user reported). Walk through the stepper to the review step. Confirm:
     - **No IdentityPanel** is rendered on any region.
     - **No `ROW_POSITION_IDENTITY` warning chip** is visible.
     - The review step otherwise renders normally (region cards, binding chips, commit button).
   - Hit Commit. Confirm:
     - **No 409 with `LAYOUT_PLAN_DRIFT_IDENTITY_CHANGED`.**
     - The connector instance is created successfully.
     - Records are queryable post-commit (open the connector's entity in the portal session and run `SELECT COUNT(*) FROM <entity>`).
   - Sanity-check Google Sheets: in a separate browser tab, open the Google Sheets connect flow, walk through to the review step. Confirm the IdentityPanel **is** rendered (regression check that this slice didn't accidentally affect the cloud workflows).

**Done when:**

- All steps above complete, all suites green, lint + type-check clean.
- Manual smoke test confirms the user's reported failure case no longer reproduces.
- The cloud-spreadsheet regression test passes (IdentityPanel still renders for those workflows).

**Risks:**

- **Existing test mocks a heuristic-identity post-interpret plan** that the lock will now overwrite. Step 1's audit catches these; updates are mechanical (swap `kind: "column"` to `kind: "rowPosition"`, `source: "heuristic"` to `source: "user"` in the assertion).
- **`regionDraftsToHints` doesn't actually round-trip `source: "user"` for `rowPosition`**, breaking re-interpret idempotence. Step 4's §11 test exercises this directly. If it fails, the helper alone isn't enough — we'd need to also force the regionHint payload from the workflow. Most likely it works as-expected because the record-identity-review work landed exactly this round-trip; if not, that becomes a sub-slice (~10 lines in `regionDraftsToHints` or its caller).

---

## Out-of-band considerations

- **No deployment coordination.** The workflow re-runs interpret on every user action that changes regions; the lock takes effect on the first interpret call after deploy. No state migration, no flag, no warmup.
- **No backwards-compat shims for old data.** Per `feedback_no_compat_aliases`. Old file-upload connector instances keep whatever identity strategy they were committed with — the lock applies only to *new* uploads. There is no read path that consumes the old strategy on file-upload connectors (file-upload doesn't sync, so `assertSyncEligibleIdentity` is never called against them), so no inconsistency is observable.
- **No telemetry change.** If we want to measure how many file-upload commits previously failed with `LAYOUT_PLAN_DRIFT_IDENTITY_CHANGED` (and therefore confirm the lock fixed the right problem), that's an analytics workstream — out of scope here.
- **No follow-up slice planned in this PR.** The discovery flagged a possible later workstream around propagating identity strategy into `field_mappings.is_primary_key` so the AI can see a natural-key hint. That work is not started here and is genuinely separate (it requires a server-side commit-pipeline change, not a workflow-side lock).

---

## PR shape

- Branch: a new branch, name suggestion `feat/lock-file-upload-identity-to-row-position` (or whatever's convention-compatible). Not the brevity branch.
- Commits: two commits matching the slices, conventional-commits style:
  - `feat(file-upload): add lockPlanIdentityToRowPosition helper`
  - `feat(file-upload): pin every region's identity to rowPosition; hide IdentityPanel`
- PR description: link the discovery + spec + plan docs. Paste a screenshot or video of the review step before/after if practical (the absence of the IdentityPanel + warning chips is the visible delta). Note the failing-CSV scenario from the manual smoke test as the bug this fixes.
