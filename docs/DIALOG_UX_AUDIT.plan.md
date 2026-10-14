# Dialog UX audit — Plan

**TDD-sequenced implementation of the `Modal` dialog contract (`onSubmit` / `submitDisabled` / `pending`, own-form submits, Escape deferral), the bounded write timeout, the per-dialog AST guard, and the migration of all 57 dialogs and 4 wizards onto it.**

Spec: `docs/DIALOG_UX_AUDIT.spec.md`. Discovery: `docs/DIALOG_UX_AUDIT.discovery.md`. Issue: #789. Builds on shipped #751 (request-layer dedupe) and #758 (the FormAlert-keyed guard this replaces).

There are nine slices. Each sits behind a green test suite and leaves the repo compilable. They land as **commits on `feat/789-dialog-ux-audit` / PR #790**: one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package. Never invoke jest directly (`feedback_use_npm_test_scripts`); run only the touched/affected files locally (`feedback_test_only_touched_files_locally`):

```bash
cd packages/core && npm run test:unit -- --testPathPattern '<pattern>'
cd apps/web && npm run test:unit -- --testPathPattern '<pattern>'
npm run type-check && npm run lint     # repo root, at every boundary
```

Each slice: (1) write the failing tests; (2) make the smallest change that turns them green; (3) do a focused run; (4) run root `npm run build && npm run type-check && npm run lint` at the boundary, because a core prop change ripples into web (`feedback_core_model_change_run_full_build`); (5) move to the next slice.

Sequencing rationale:

- **Slice 1:** the timeout depends on nothing. It lands first so `pending` (slice 2) never blocks dismissal without a bound on how long a write can hang. (It was swapped ahead of the contract at plan review.)
- **Slice 2:** the contract and its 43 call sites ship together. The type union leaves no compilable halfway state, and there are no aliases (`feedback_no_compat_aliases`). The old regex guard counts `component: "form"`, so it can't survive the migration. It is replaced here by the AST guard's R1 and R2.
- **Slice 3:** the raw Dialogs need slice 2's `Modal` contract. R3 (the ban) can only pass once they're gone.
- **Slice 4:** the wizards need `handleOwnSubmit` and plain-variant `pending` (slice 2).
- **Slice 5:** blur needs the `data-dialog-controls` markers (slice 2) and the migrated raw dialogs (slice 3), so it adopts across every dialog at once.
- **Slices 6–8:** independent hygiene sweeps over the now-uniform dialogs, each closed by a guard rule (R4, R5).
- **Slice 9:** docs, last, describing what actually shipped.

No migration, no seed.

---

## Slice 1 — Bounded write timeout + SDK overrides

**Files**

- Edit: `apps/web/src/utils/api.util.ts`. Add `WRITE_TIMEOUT_MS`, `LONG_WRITE_TIMEOUT_MS`, `timeoutMs` on the mutation options, the `AbortSignal.timeout` + `AbortSignal.any` composition for non-`GET`s, and the `TimeoutError` → `ApiError("…", "REQUEST_TIMEOUT", 0)` mapping in `fetchWithAuth`.
- Edit: the SDK files in the spec's overrides table (`layout-plans`, `connector-instance-layout-plans`, `file-uploads`, `api-connector`, `connector-instances`, `toolpacks`, `portal-sql`, `portal-results`, and `entity-records` only where its route is synchronous).
- Edit: `apps/web/src/__tests__/api.util.test.tsx` (timeout block).

**Steps**

1. **Tests (spec → web infrastructure, api.util timeout, 6 cases).** Use fake timers and a never-resolving `fetch` stub. Run; they fail.
2. **Implement** the timeout and the mapping. Green.
3. **Verify each override against its route.** For `entityRecords.import`/`.revalidate`, read the route: a `202` enqueue keeps the default. Record the outcome in the commit message.
4. Lint + type-check.

**Done when:** all 6 cases pass; every long endpoint in the table declares `timeoutMs`; `REQUEST_TIMEOUT` renders through `FormAlert` (covered by the existing `toServerError` path).

**Risk:** a slow-but-legitimate write that isn't on the list would now time out at 30s. Mitigated by the route review in step 3 and by app-dev smoke (spec → Risks).

---

## Slice 2 — `Modal` contract + 43-site migration + AST guard (R1, R2)

The core `Modal` gains the `ModalFormProps | ModalPlainProps` union, `pending` dismissal-blocking, Escape `defaultPrevented` deferral, own-form submits and control markers. Every form-paper call site moves to `onSubmit`. The regex guard is replaced by the AST guard, which carries R1 (submitting dialog has `onSubmit`) and R2 (no `slotProps` `component`).

**Files**

- Edit: `packages/core/src/ui/Modal.tsx`. Add the props union. The paper becomes a `<form noValidate>` when `onSubmit` is set. Wrap `onClose` (pending, Escape `defaultPrevented`). Add `disabled={pending}` to the X. Move the spread ahead of `open`/`onClose`. Add `data-dialog-controls` on the actions and the header box. Delete the `slotProps` sniffing (`:59-62`).
- New: `packages/core/src/ui/handle-own-submit.ts`. Edit `packages/core/src/ui/index.ts` to export it.
- Edit: `packages/core/src/__tests__/ui/Modal.test.tsx`, which keeps its existing cases and changes their form cases to `onSubmit`. New: `Modal.types.test.tsx`, `handle-own-submit.test.tsx`. Edit `packages/core/src/stories/Modal.stories.tsx`, whose form story uses `onSubmit`.
- Edit: the 43 `apps/web` form-`Modal` call sites (inventory rows 1–28, 30–35, 38, 41–44, 54, 56). Replace `slotProps.paper.{component,onSubmit}` with `onSubmit={handleSubmit}` and keep `submitDisabled`. Add `pending={isPending}`, or `pending={false}` on `NewEntityDialog`/`ApiEndpointForm` (their real `submitDisabled` arrives in slice 7). Remove `DeleteAccessItemDialog`'s hand-rolled `isPending ? () => undefined : onClose` (`:39`), because `pending` replaces it.
- New: `apps/web/src/__tests__/dialog-contract.guard.test.ts` with R1 and R2, fixture self-tests, a non-vacuity floor, and `EXEMPT` = `EndpointTestDialog` (must still match).
- Delete: `apps/web/src/__tests__/dialog-enter-submit.guard.test.ts`.

**Steps**

1. **Tests (spec → TDD test plan → packages/core, all cases).** Write `Modal.test.tsx`'s new cases: a real Enter submits; `submitDisabled` blocks it; `pending` blocks Enter, Escape, the backdrop and the X; a `defaultPrevented` Escape stays open; a portaled child form doesn't fire `onSubmit`; plain-variant `pending` blocks; the markers are present; the spread can't override `onClose`. Then the 4 `@ts-expect-error` type cases and the 3 `handleOwnSubmit` cases. Run; they fail.
2. **Implement** `Modal` and `handleOwnSubmit`. Core is green.
3. **Tests (spec → guards, R1, R2).** Write the guard with fixtures first. Run against the tree: R2 fails on all 43 sites. That is the red.
4. **Migrate** the 43 sites. `tsc` drives this, since a site missing `pending` won't compile. R1 and R2 go green. Run the existing tests for each touched dialog; they pass unchanged, because `fireEvent.submit` still reaches the form and the migration to real Enter is slice 8.
5. Root build + type-check + lint.

**Done when:** core Modal cases pass; R1/R2 pass with only the reasoned exemption; every existing dialog test is green; no `component: "form"` remains under `apps/web/src`.

**Risk:** the diff is large. Keep it mechanical, with no behavior edits beyond `pending`, so the review is a pattern check. A dialog whose visible submit's `disabled` differs from its `submitDisabled` was already wrong before this change. Note it for slice 7 rather than fixing it here.

---

## Slice 3 — Raw MUI `Dialog` → `Modal` + R3

**Files**

- New, one component file each, with tests (spec → web dialogs, moved raw dialogs):
  - `components/RenamePinnedResultDialog.component.tsx` (Zod against the pin rename contract, `FormAlert`, `aria-invalid`, autofocus; the `onKeyDown` Enter at `PinnedResultDetail.view.tsx:242-243` is deleted)
  - `DeletePinnedResultDialog`
  - `AddGroupMemberDialog`
  - `RemoveGroupMemberDialog`
  - `CreateEntityGroupDialog` (visible `type="submit"` → `type="button"`)
- Edit: `views/PinnedResultDetail.view.tsx`, `views/EntityGroupDetail.view.tsx` and `views/EntityGroups.view.tsx`, which render the new components and pass `toServerError(...)` and `isPending`.
- Edit: `components/SidebarNav.component.tsx:279` and `components/ToolpackMetadataModal.component.tsx:39`, which become a plain `Modal`.
- Edit: `dialog-contract.guard.test.ts` + R3 (no raw `Dialog` import, empty allowlist).

**Steps**

1. **Tests.** Each new component gets the Dialog & Form Test Checklist, with a real `{Enter}` from the start. PinnedResultDetail gets "Enter with an empty name sends nothing", which reproduces the live bug against the old view first. Add the R3 fixtures. Run; they fail.
2. **Implement** the components and swap the views. Run the existing `EntityGroupDetailView`, `EntityGroupsView` and `PinnedResultDetail` tests; adjust only their selectors.
3. Lint + type-check.

**Done when:** R3 is green with an empty allowlist; the five new dialog suites pass; the view tests pass.

**Risk:** the `EntityGroupDetailView` test already uses a real Enter on Add Member. It must stay green through the move, which proves the behavior is preserved.

---

## Slice 4 — Wizards: Enter = the step's primary; commit blocks close

**Files**

- Edit: `workflows/RestApiConnector/RestApiConnectorWorkflow.component.tsx`: `onSubmit={handlePrimary}`, `submitDisabled={!canAdvance || isCommitting}`, `pending={isCommitting}`.
- Edit: the `FileUploadConnector`, `GoogleSheetsConnector` and `MicrosoftExcelConnector` `*Workflow.component.tsx` files: `pending={isCommitting}`. FileUpload step 0 is wrapped in `<form onSubmit={handleOwnSubmit(upload)}>` with `FormDefaultButton disabled={isUploadDisabled}`.
- Edit: `modules/RegionEditor/RegionDrawingStep.component.tsx`:
  - step form around Interpret (`handleOwnSubmit(handleInterpret)`, `FormDefaultButton disabled={interpretDisabled}`)
  - the Interpret button becomes `type="button"`
  - the keydown listener (`:317`) becomes `{ capture: true }`
- Edit: `modules/RegionEditor/ReviewStep.component.tsx`: step form around Commit plan using the existing disabled expression (`:519-528`), and "Back to regions" (`:516`) gets `disabled={isCommitting}`.
- Tests (spec → web wizards):
  - New: `workflows/RestApiConnector/__tests__/RestApiConnectorWorkflow.test.tsx`, `workflows/GoogleSheetsConnector/__tests__/GoogleSheetsConnectorWorkflow.test.tsx`, `workflows/MicrosoftExcelConnector/__tests__/MicrosoftExcelConnectorWorkflow.test.tsx`.
  - Edit: `FileUploadConnectorWorkflow.test.tsx`, `modules/RegionEditor/__tests__/RegionDrawingStep.test.tsx`, and the ReviewStep tests.

**Steps**

1. **Tests.**
   - RestApi, 5 cases: Basics Enter advances or doesn't; last-step Enter commits; close is blocked while committing; a nested `ApiEndpointForm` submit doesn't advance.
   - RegionDrawingStep, 3 cases: a bounds-field Enter doesn't Interpret; a form Enter Interprets; Escape with a selected region inside a `Modal` deselects and the dialog stays open.
   - ReviewStep, 2 cases.
   - Containers, about 6 cases.
   - Run; they fail.
2. **Implement.** Green.
3. **Regression:** run the full `modules/RegionEditor` and `workflows` test folders. The step forms change how Enter bubbles there, and `SegmentEditPopover`/`BindingEditorPopover` own their Enter.
4. Lint + type-check.

**Done when:** every wizard step with a primary submits on Enter exactly when its button is enabled; Escape deselects without closing; no wizard closes mid-commit.

**Risk:** `RegionDrawingStep`/`ReviewStep` also render in `views/EditLayoutPlan.view.tsx`, outside a Modal. The step forms make Enter Interpret/Commit there too, which is the same rule and is intended. Add one EditLayoutPlan Enter case to its existing tests so the change is pinned rather than accidental.

---

## Slice 5 — `isDialogControlBlur` adoption

**Files**

- New: `apps/web/src/utils/dialog-blur.util.ts` and its test (4 cases).
- Edit: the 32 dialog/module/workflow files with a touched-setting `onBlur`/`handleBlur`, which return early when `isDialogControlBlur(e)` is true.
- Tests: add a blur-to-Cancel case in `TagFormModal.test.tsx`, `CreateStationDialog.test.tsx` and `RenamePortalDialog.test.tsx`: clear the field, click Cancel, and no error renders. Add a Tab-to-another-field case that still shows the error.

**Steps**

1. Write the util tests and the 3 dialog cases. Run; they fail.
2. Implement the util and adopt it in all 32 files. Find them with `grep -rln "onBlur" apps/web/src --include=*.tsx` against the slice-1 dialog set.
3. Lint + type-check.

**Done when:** the util and the 3 dialog cases pass, and the blur flash no longer reproduces in any dialog with blur validation.

**Risk:** a blur handler that does more than set touched (for example normalizing the value on blur) must still normalize. Skip only the touched/validate part.

---

## Slice 6 — Reset the mutation when a dialog opens + R4

**Files**

- Edit: the 22 views/modules with `serverError={toServerError(X.error)}`. The open handler calls `X.reset()` before `setOpen(true)`, matching the `Portal.view.tsx:134` precedent. `EntityDetail.view.tsx:773,889` move from reset-on-success to reset-on-open.
- Edit: `dialog-contract.guard.test.ts` + R4.
- Tests: in two representative view tests (`EntityDetail` and `StationDetail`), fail a submit, close the dialog, reopen it, and check that no `FormAlert` renders.

**Steps**

1. Write the R4 fixtures and the 2 view cases. Run; R4 fails on about 14 files.
2. Add the resets. Green.
3. Lint + type-check.

**Done when:** R4 passes with an empty allowlist and the 2 view cases pass.

**Risk:** view tests that mock an SDK mutation without `reset` now crash on open. This affects mocks like `cache-invalidation.test.tsx`'s `{ mutate }` shapes. Add `reset: jest.fn()` to those mocks as part of this slice.

---

## Slice 7 — Per-dialog gaps + tests for untested dialogs

**Files**

- Edit:
  - `modules/RegionEditor/NewEntityDialog.component.tsx` and `workflows/RestApiConnector/ApiEndpointForm.component.tsx`: real `submitDisabled`.
  - `components/EditConnectorInstanceDialog.component.tsx` + `views/ConnectorInstance.view.tsx:657`: `serverError` and `FormAlert`.
  - `components/ShareDialog.component.tsx` and `modules/AccessAuthoring/{Group,Policy,Role}EditorDialog.component.tsx`: `validateWithSchema`, touched/errors, `aria-invalid`, and `useDialogAutoFocus` in place of `autoFocus`.
  - `components/CreatePortalDialog.component.tsx`: explicit `aria-invalid`.
- New tests:
  - `EditConnectorEntityDialog.test.tsx`
  - `EditEntityGroupDialog.test.tsx`
  - `RemoveMemberDialog.test.tsx`
  - `modules/RegionEditor/__tests__/RecordsPreviewDialog.test.tsx`

**Steps**

1. **Tests.** Each fixed dialog gets the checklist cases its gap breaks:
   - `NewEntityDialog` and `ApiEndpointForm`: Enter while invalid sends nothing.
   - `EditConnectorInstanceDialog`: renders `FormAlert`.
   - `ShareDialog` and the editors: invalid submit shows field errors and `aria-invalid`.
   - The 4 untested dialogs get the full checklist.
   - Run; they fail.
2. **Implement** the fixes. Green.
3. Lint + type-check.

**Done when:** every dialog in the discovery inventory meets the checklist, except the recorded `Create/EditEntityRecordDialog` validation exception (spec Key decision 10).

---

## Slice 8 — Real Enter everywhere + R5

**Files**

- Edit: the 26 test files R5 lists, replacing `fireEvent.submit` with `user.type(field, "x{Enter}")`, or `user.keyboard("{Enter}")` on a focused confirm button.
- Edit: the 14 dialogs' tests that have no Enter case, adding one each. Those are:
  - `CreatePortalDialog`
  - `CuratedViewEditorDialog`
  - `EditToolpackDialog`
  - `RegisterToolpackDialog`
  - `ShareDialog`
  - `GroupEditorDialog`, `PolicyEditorDialog`, `RoleEditorDialog`
  - `NewEntityDialog`
  - `ApiEndpointForm`
  - `EntityGroupsView`, which is covered by slice 3's new component
  - `DeleteAccessItemDialog`
  - `DeletePortalDialog`
  - `DeleteToolpackDialog`
- Edit: `dialog-contract.guard.test.ts` + R5 (empty allowlist).

**Steps**

1. Write the R5 fixtures and run it; it fails on 26 files.
2. Migrate each file. A case that turns red under a real Enter is a **real bug**: fix the dialog in this slice and note it in the commit message.
3. Lint + type-check.

**Done when:** R5 passes, and every form or confirm dialog has a real-Enter test.

**Risk:** `BindingEditorPopover.test.tsx` is a popover, not a dialog, but it falls under R5's scope. Migrate it too; there is no carve-out.

---

## Slice 9 — Docs

**Files**

- Edit: `CLAUDE.md`:
  - Form & Dialog Pattern: rewrite the form-wrapping and Enter bullets around `onSubmit`/`submitDisabled`/`pending`, plus the dismissal block, the timeout, `handleOwnSubmit` for step forms, `isDialogControlBlur`, and reset on open.
  - The guard description (R1–R5).
  - Component File Policy amendment (local UI state is not wiring).
  - Dialog & Form Test Checklist: add close-while-pending and blur-to-Cancel.
  - Record the entity-record validation exception.
- Edit: `.github/copilot-instructions.md` (mirror).
- Edit: `packages/core/README.md` if it documents `Modal` props (check).

**Steps**

1. Check the doc surfaces against what shipped in slices 1–8, using the `rg` symbol names from the spec's Surface.
2. `npm run lint:doc-pointers` (durable-doc pointers).

**Done when:** no doc describes `slotProps.paper.component="form"`, `fireEvent.submit` or the old guard.

---

## Sequence summary

| # | Lands | Gate |
|---|---|---|
| 1 | Write timeout + overrides | api.util timeout block |
| 2 | `Modal` contract + 43 sites + R1/R2 | core Modal suite, tsc, R1/R2 |
| 3 | 7 raw Dialogs → `Modal` + R3 | new dialog suites, R3 |
| 4 | Wizards (Enter, pending, Escape) | wizard + RegionEditor suites |
| 5 | Blur toward controls | util + 3 dialog cases |
| 6 | Reset on open + R4 | R4 + 2 view cases |
| 7 | Per-dialog gaps + untested dialogs | checklist suites |
| 8 | Real Enter + R5 | R5 |
| 9 | CLAUDE.md + Copilot mirror | doc-pointers |

## Cross-slice notes

- **One guard file grows across slices.** R1 and R2 land in slice 2, R3 in 3, R4 in 6 and R5 in 8. Each rule ships with its fixtures and goes green in its own slice, so no rule is ever red at a boundary.
- **Core rebuild.** Web consumes core's `dist`. After slice 2's `Modal` change, rebuild core before running web tests or type-check (`project_stale_core_dist_after_branch_switch`).
- **`fireEvent.submit` keeps working in slices 1–7.** The form is still a form, so old tests stay green until slice 8 migrates them. No test is red across a boundary.
- **Behavior changes users will notice:** writes over 30s fail with the "may still finish" message (slice 1); dialogs can't be dismissed mid-save (slice 2); Enter now works in wizards and in EditLayoutPlan (slice 4). The smoke doc (`/smoke 789`) walks each.
- **Doc sync** is slice 9, and also the per-slice commit messages. No user-facing Help/glossary surfaces change.

## Next step

Implementation begins on this branch with slice 1 (the timeout), tests first and one commit per slice, once discovery, spec and plan are confirmed.
