# File Upload — Lock Identity to `rowPosition` — Discovery

## Goal

Stop asking the user to pick an identity column in the file-upload connector workflow, since file uploads are one-shot and have no second sync that would consume a stable-by-value identity. Concretely:

1. After `interpret` returns a layout plan, **rewrite every region's `identityStrategy` to `{ kind: "rowPosition", confidence: 1, source: "user" }`** — purely client-side in the file-upload workflow. The cloud-spreadsheet workflows (Google Sheets, Microsoft Excel) keep their current behavior unchanged.
2. **Hide the `IdentityPanel`** on the file-upload review step. With the strategy locked, there's no decision left to make and the panel narrates sync semantics that don't apply.
3. **Suppress the `ROW_POSITION_IDENTITY` warning** in the file-upload context. With the lock on, the warning would fire on every region with `warn` severity for an entirely defensible default and dilute the signal of every other warning.

After this change: the confusing first-commit error class — `LAYOUT_PLAN_DRIFT_IDENTITY_CHANGED` triggered by duplicate-or-blank values in whatever column the AI heuristic happened to pick as identity — is structurally impossible on file-upload, because the drift gate's identity-changing branches at `packages/spreadsheet-parsing/src/replay/drift.ts:201` are gated on `region.identityStrategy.kind === "column"`. Pin every region to `rowPosition` and that branch becomes unreachable.

Out of scope:

- Changing how Google Sheets / Microsoft Excel handle identity. Those connectors sync, they need a real identity, the dropdown stays.
- Changing the parser package (`@portalai/spreadsheet-parsing`). The interpret pipeline keeps emitting heuristic identity guesses; the file-upload workflow simply discards them before they reach the editor.
- Re-wording the `LAYOUT_PLAN_DRIFT_IDENTITY_CHANGED` error message for the case where it *does* still fire (e.g. cloud-spreadsheet first commit). Separate concern.
- Propagating identity into `field_mappings.is_primary_key` so the AI can see a "natural key" hint downstream. Currently dead code (`LayoutPlanCommitService` writes `false` everywhere); fixing that is a different workstream and out of scope here.
- Backfill of already-committed file-upload connectors. The change applies to *new* uploads only; existing connector instances keep whatever identity they have. No migration needed because file-upload doesn't re-sync, so the old identity strategy never gets re-read post-commit.

---

## Existing State

### How file-upload integrates with `RegionEditor` today

The file-upload workflow consumes the `RegionEditor` module's pure UI exports and wires its own container around them:

- `apps/web/src/workflows/FileUploadConnector/FileUploadConnectorWorkflow.component.tsx` — top-level container. Calls `useFileUploadWorkflow(...)` (the workflow harness) which exposes the regions, callbacks, and `runInterpret`/`runCommit` mutations.
- The workflow harness's `runInterpret` callback (lines 484–506) calls `interpretMutate`, then post-processes the result via `preserveUserRegionConfig(...)` and `planRegionsToDrafts(...)` to produce the `RegionDraft[]` the editor renders.
- `FileUploadReviewStep.component.tsx` is a thin wrapper that renders the module's `ReviewStepUI` and adds a `<FormAlert>` for server errors. It passes through every prop verbatim.
- The container at `FileUploadConnectorWorkflow.component.tsx:309-336` passes `resolveIdentityLocatorOptions` and `onIdentityUpdate` into `FileUploadReviewStepUI` so the IdentityPanel renders.

### How the IdentityPanel is gated today

Inside the module, `RegionReviewCard.component.tsx:277-280` hides the panel for any region where either the resolver is undefined or it returns an empty array:

```ts
const showIdentityPanel =
  identityLocatorOptions !== undefined &&
  onIdentityUpdate !== undefined &&
  identityLocatorOptions.length > 0;
```

This means the module **already has the escape hatch we need**: a consumer that simply doesn't pass `resolveIdentityLocatorOptions`/`onIdentityUpdate` gets no IdentityPanel. No new prop on the module is required for hiding the panel. The cloud-spreadsheet workflows (Google Sheets, MS Excel) pass these props; file-upload would stop passing them.

### Where heuristic identity is set

`packages/spreadsheet-parsing/src/interpret/stages/propose-bindings.ts:192` calls `pickIdentity(...)` and writes the winning candidate onto `region.identityStrategy` with `source: "heuristic"`. If the user later overrides it via the IdentityPanel, the workflow patches it with `source: "user"` so `regionDraftsToHints` round-trips the lock to subsequent interpret passes — see `apps/api/src/__tests__/...` and the existing reconcile-with-prior tests.

The lock contract is exactly the lever this discovery uses: file-upload writes `source: "user"` as if the user had picked rowPosition, and the rest of the pipeline honors it.

### Where the `ROW_POSITION_IDENTITY` warning is emitted

`packages/spreadsheet-parsing/src/interpret/stages/score-and-warn.ts:103-109` emits the warning unconditionally for any region with `identityStrategy.kind === "rowPosition"`. Severity is `warn` (`packages/spreadsheet-parsing/src/warnings/codes.ts:62`). Severity `warn` is advisory at commit time — the blocker-warnings gate at `apps/api/src/services/layout-plan-commit.service.ts:404` only halts on `severity === "blocker"` — but the editor still surfaces it visibly per region, which is the noise we want to remove.

### Where post-commit code reads identity strategy

Three consumers in the codebase, all already mapped:

1. `packages/spreadsheet-parsing/src/replay/identity.ts:40` — drives `source_id` derivation. With `rowPosition` it produces `row-N` / `col-N` / `cell-R-C`. Internal-only, never user-visible.
2. `packages/spreadsheet-parsing/src/replay/drift.ts:201` — duplicate/blank checks gated on `kind === "column"`. With every region locked to `rowPosition` these branches are unreachable.
3. `apps/api/src/services/sync-eligibility.util.ts:29` — sync-flow advisory. File-upload doesn't sync, so this is never invoked on file-upload-imported instances.

No other downstream consumer touches `region.identityStrategy`. Confirmed via `grep -rn "identityStrategy" apps/api/src` — only the sync-eligibility util surfaces it post-commit.

### What `field_mappings.is_primary_key` does today

Dead column. Schema present (`apps/api/src/db/schema/field-mappings.table.ts:36`), exposed in the AI system prompt (`apps/api/src/prompts/system.prompt.ts`) as a queryable attribute on `_field_mappings`, but `LayoutPlanCommitService` writes `isPrimaryKey: false` for every binding it creates (lines 182, 209, 230, 275). No code path reads it for anything load-bearing today. Mentioning here so the spec doesn't accidentally claim "this loses the natural-key signal for the AI" — that signal is *already* lost for every connector type, including the cloud-spreadsheet ones.

---

## Approach

Three small, file-upload-local changes. None of them touch the parser package, the API, the database, or the cloud-spreadsheet workflows.

### 1. Force `rowPosition` after interpret

Add a helper — provisional name `lockPlanIdentityToRowPosition(plan: LayoutPlan): LayoutPlan` — in `apps/web/src/workflows/FileUploadConnector/utils/`. It returns a deep-cloned plan with every region's identity rewritten to `{ kind: "rowPosition", confidence: 1, source: "user" }`. The file-upload workflow's `runInterpret` calls it on the result before passing the plan to `planRegionsToDrafts(...)`. The `source: "user"` flag is what makes the lock survive subsequent re-interpret passes (the user redraws a region, hits Re-interpret, the prior region's identity hint is preserved as user-locked, the parser doesn't override it).

### 2. Hide the IdentityPanel by not wiring it

In `FileUploadConnectorWorkflow.component.tsx`, drop the `resolveIdentityLocatorOptions` and `onIdentityUpdate` props from the `<FileUploadReviewStepUI>` render. The module's existing gate at `RegionReviewCard.component.tsx:277-280` already hides the panel when these are undefined.

No module-surface prop change needed. No new conditional inside the module. The cloud-spreadsheet workflows are unaffected because they keep passing the props.

### 3. Suppress the `ROW_POSITION_IDENTITY` warning at the workflow boundary

The same plan-transform helper from §1 also strips warnings whose code is `ROW_POSITION_IDENTITY` from each region. Done in the same pass, returned as part of the same locked plan, so callers get a single transformation rather than two.

The parser package keeps emitting the warning unconditionally — that's correct for consumers (Google Sheets / MS Excel) where rowPosition genuinely is a "this will full-reap on every sync" hazard. The file-upload workflow filters it out because the hazard doesn't apply to one-shot upload.

### Why the helper, and why colocate it

A single helper that does both transformations is small, pure, easy to test, and lives in the workflow's `utils/` folder per the Workflow Module Pattern in `CLAUDE.md`. Keeping it in the file-upload workflow (rather than in the shared `_shared/spreadsheet/` folder) makes it explicit that this is a file-upload-only behavior; if cloud-spreadsheet workflows ever needed similar treatment they'd opt in deliberately.

---

## Decision points for the spec phase

1. **Helper name and signature.** `lockPlanIdentityToRowPosition(plan: LayoutPlan): LayoutPlan` is the working draft. Could split into two helpers (`lockIdentityToRowPosition` + `stripRowPositionIdentityWarnings`) for testability — recommend the spec keep them as one because they are always called together for file-upload and never separately.
2. **Where to call the helper.** Two candidate sites: (a) inside `runInterpret` before `planRegionsToDrafts`, or (b) inside `planRegionsToDrafts` itself. (a) is cleaner because `planRegionsToDrafts` is shared utility; we don't want to embed a file-upload-specific transform inside a shared function. Recommend the spec lock in (a).
3. **Behavior on re-interpret with user-redrawn regions.** When the user redraws a region and hits Re-interpret, the workflow re-calls `runInterpret`, which re-applies the lock helper. Existing `regionDraftsToHints` round-trips `source: "user"` so the new interpret pass preserves the lock. Spec to confirm with a test.
4. **What to do with regions where `rowPosition` is structurally invalid.** Per `extract-records.ts`, `rowPosition` works for any region — it derives from coordinates, which always exist. There is no "this region can't use rowPosition" case. Spec to assert this with a test covering 1D records-as-rows, 1D records-as-columns, and 2D pivot/crosstab.
5. **Storybook / tests for the file-upload review step.** The existing stories pass identity props; the new file-upload review-step stories should *not* pass them. Spec to enumerate which fixtures need updating.
6. **Test coverage of warning filtering.** Should the helper also strip warnings for a *user-picked* `rowPosition` (in cloud-spreadsheet, hypothetically)? No — the helper lives in the file-upload workflow only, never runs against cloud-spreadsheet flows, so the question doesn't arise. Spec to clarify.

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Re-interpret loses the lock somehow and a column-identity sneaks back in. | Test: redraw a region, re-interpret, assert the post-helper plan has every region locked to rowPosition with `source: "user"`. |
| The IdentityPanel disappears on cloud-spreadsheet workflows accidentally. | Cloud-spreadsheet workflows don't use the helper or change their prop wiring; their existing tests assert the panel renders. Verify those tests still pass. |
| Users uploading the same CSV twice expect their second upload to "update" matching rows. | Already not supported. Each file-upload creates a new connector instance per `commitDraft`. The lock doesn't change this; it just makes the failure mode explicit (full reap on hypothetical re-sync) rather than confusing (unrelated drift error on first commit). |
| The `ROW_POSITION_IDENTITY` warning carries a load-bearing signal we shouldn't suppress. | It doesn't, in the file-upload context — its message ("breaks if rows reorder") refers to sync, which file-upload doesn't do. Suppression is contextually correct, not a semantic loss. |
| Overwriting `confidence: 1` is misleading because the parser didn't actually score this. | Considered using `confidence: 0`; rejected. Confidence in the plan blob is a UI signal feeding `ConfidenceChipUI`, and a "Set by you" badge already overrides confidence display when `source === "user"`. The numeric value is unobserved in this code path. Spec to confirm. |
| The helper drifts out-of-sync with the parser if a new identity-strategy kind ever lands. | Helper is exhaustive over the discriminated union (TypeScript's `never` check on default). New kinds would fail compilation, forcing a deliberate decision. |

---

## Files anticipated touched

- New: `apps/web/src/workflows/FileUploadConnector/utils/lock-identity.util.ts` — the helper.
- New: `apps/web/src/workflows/FileUploadConnector/__tests__/lock-identity.util.test.ts` — tests for the helper.
- Edit: `apps/web/src/workflows/FileUploadConnector/FileUploadConnectorWorkflow.component.tsx` — drop the two identity props from the `<FileUploadReviewStepUI>` render; call the helper in `runInterpret`.
- Edit: file-upload stories that currently render the review step with identity props — drop those props so the stories reflect the new posture. Enumerate in the spec.
- Edit (possibly): `apps/web/src/workflows/FileUploadConnector/__tests__/FileUploadConnector.test.tsx` if any existing test asserts the IdentityPanel renders. Removing those assertions and adding a "panel hidden" assertion.

No DB migration. No API change. No contract change. No SDK change. No change to `@portalai/spreadsheet-parsing`. No change to other workflows.
