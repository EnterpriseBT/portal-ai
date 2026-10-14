# Dialog UX audit — Discovery

**Issue:** [EnterpriseBT/portal-ai#789](https://github.com/EnterpriseBT/portal-ai/issues/789)

**Why this exists.** #758 found a dialog where Enter did nothing. It was a `Modal` with no form, and the guard meant to catch that only looked at Modals that already had one. The review of its fix (PR #788) found that the gap wasn't one dialog. It's how the conventions are enforced. `Modal` *infers* that it is a form from `slotProps.paper.component`. The guard counts regex matches per file. Escape and the backdrop close any dialog mid-save. Raw MUI `Dialog`s are invisible to every check. The connector wizards have no Enter behavior at all. Each convention was added one dialog at a time, so each dialog is as correct as the last person who touched it.

This is the change that moves the dialog conventions **into `Modal`'s contract and the type checker**, so that a correct dialog is the easy path and an incorrect one fails CI per dialog. It then brings all 57 dialogs up to that contract.

## The current shape

### `Modal` (packages/core)

| Piece | Location | Note |
|---|---|---|
| Props | `packages/core/src/ui/Modal.tsx:14-40` | MUI `DialogProps` minus title/onClose/open, plus `onClose: () => void`, `title`, `actions`, `showCloseButton`, `maximizable`, `defaultMaximized`, `submitDisabled` |
| Form detection | `Modal.tsx:59-62` | `isForm` = `slotProps.paper.component === "form"`, which is inferred, not declared |
| Close wiring | `Modal.tsx:66`, X at `:98-101` | `onClose` goes straight to MUI. `reason` is ignored, there is no `disableEscapeKeyDown`, and `{...props}` spreads after it |
| Default button | `Modal.tsx:109`, `FormDefaultButton.tsx:32-49` | hidden `type="submit"` with `disabled={submitDisabled}`, rendered only when `isForm` |
| Tests | `packages/core/src/__tests__/ui/Modal.test.tsx:66,96,277-376` | close X, backdrop, and Enter with `submitDisabled`; nothing tests Escape or pending |

### Inventory: 57 dialogs in 55 files (`apps/web/src`)

| Kind | Count | State |
|---|---|---|
| Form | 30 | 26 are `Modal`-based and mostly compliant. The gaps: `PinnedResultDetail.view.tsx:232` rename (raw Dialog, no form, `onKeyDown` Enter at `:242-243` calls submit **even while Save is disabled**, which is a live bug); `EntityGroups.view.tsx:289` (visible `type="submit"`, no `FormDefaultButton`); `NewEntityDialog.component.tsx:140` and `ApiEndpointForm.component.tsx:178` (hard-coded `submitDisabled={false}`); `EditConnectorInstanceDialog` (no `FormAlert`/`serverError`, and `ConnectorInstance.view.tsx:657` passes none); `ShareDialog` and `AccessAuthoring/{Group,Policy,Role}EditorDialog` (no Zod, no `aria-invalid`, and the editors use a raw `autoFocus`) |
| Confirm | 17 | 15 `Modal`s with form paper. 2 raw-Dialog confirms with no form or alert (`EntityGroupDetail.view.tsx:497`, `PinnedResultDetail.view.tsx:262`) |
| Viewer | 6 | `EndpointTestDialog` (guard-exempt), `SigningSecretRevealDialog`, `UsageLedgerDialog`, `RecordsPreviewDialog`, and 2 raw Dialogs (`SidebarNav.component.tsx:279`, `ToolpackMetadataModal.component.tsx:39`) |
| Wizard | 4 | FileUpload, GoogleSheets, MicrosoftExcel and RestApi. None is a form, and none blocks close mid-commit |

Close-while-pending is handled in **1 of 50** Modals (`DeleteAccessItemDialog.component.tsx:39`: `onClose={isPending ? () => undefined : onClose}`). About 40 dialog components already take an `isPending` prop. Nothing in `apps/web` reads a close `reason`.

### Enforcement today

| Guard | Location | Matches |
|---|---|---|
| Enter/`submitDisabled` | `apps/web/src/__tests__/dialog-enter-submit.guard.test.ts:50-52,83-90` | files with `<Modal` + `component: "form"`; needs ≥ that many `submitDisabled={` per **file** |
| Form-less submitting Modal (#758) | same file `:57-72,110-118` | files with `<Modal` + `<FormAlert`; needs form papers ≥ Modals per **file**; `EXEMPT` = `EndpointTestDialog` |
| Raw default button | same file `:120-126` | `<FormDefaultButton` carries `disabled=` |
| Raw `<Dialog>` | none | not scanned |

### The wizards

| Wizard | Modal | Primary action lives | Close mid-commit |
|---|---|---|---|
| FileUpload | `FileUploadConnectorWorkflow.component.tsx:260-266`, no `actions` | step 0: Upload (`:343-349`); Interpret in `RegionDrawingStep`; Commit in `ReviewStepUI` | `handleClose` `:597-604` resets unconditionally |
| GoogleSheets | `GoogleSheetsConnectorWorkflow.component.tsx:470-481` | steps 0–1 advance by side effect (OAuth, picker); then Interpret and Commit as above | `:236-244` unguarded |
| MicrosoftExcel | `MicrosoftExcelConnectorWorkflow.component.tsx:482-606` | same as Sheets; step 1 is `SelectWorkbookStep` (autocomplete) | `:236-243` unguarded |
| RestApi | `RestApiConnectorWorkflow.component.tsx:162-209`, footer in `actions` | Next/Commit gated by `!canAdvance \|\| isCommitting` (`:310-320`) | `:807` unguarded |

Closing a spreadsheet wizard mid-commit drops the run token (`_shared/spreadsheet/use-spreadsheet-workflow.util.ts:736-744`). The server commit still runs, and its result is thrown away (`:713`).

Nested forms are portaled, but React submit events bubble through portals: `BindingEditorPopover.component.tsx:233-236`, `NewEntityDialog.component.tsx:139-149`, `ApiEndpointForm.component.tsx:177-195` (opened from `EndpointsStep.component.tsx:186`). A wizard-level `onSubmit` would fire on their submits. Some steps already own Enter: `RegionBoundsInputs.component.tsx:138-142` (commits the field, `preventDefault`), `SegmentEditPopover.component.tsx:186-200`, `SheetCanvas.component.tsx:1515-1520` (a keydown on the canvas, not a field). `RegionDrawingStep.component.tsx:286-314` listens for Escape at the document level, where MUI's Escape would also close the whole wizard.

### Validation, errors, tests

- **Blur validation is hand-rolled** in 32 files (15 define `handleBlur`; e.g. `TagFormModal.component.tsx:110-113`, `CreateStationDialog.component.tsx:140-143`). Nothing reads `relatedTarget`, so clicking Cancel blurs the field and flashes the error.
- **Stale server errors**: 38 `serverError={toServerError(…)}` sites in 22 files. About 8 reset the mutation, and only `Portal.view.tsx:134` does it on open. `EntityDetail.view.tsx:773,889` reset only on success.
- **Tests**: 20 dialog tests use `fireEvent.submit`, which CLAUDE.md says passes even when Enter does nothing. 14 have no Enter test. 7 dialogs have no test at all (`EditConnectorEntityDialog`, `EditEntityGroupDialog`, `RemoveMemberDialog`, `RecordsPreviewDialog`, and three wizards). `dialog-single-flight.integration.test.tsx` is the real-Enter precedent (`:123`).
- **Request layer**: `useAuthMutation` (`utils/api.util.ts`) sets no timeout on writes, so a pending state can last indefinitely.

## The design space

### Decision 1 — How a dialog declares it submits

**A. Keep inference.** `slotProps.paper.component = "form"` stays, and guards keep scanning text. **B. A `form` boolean prop.** Explicit, but the caller still wires `onSubmit` into `slotProps`. **C. An `onSubmit` prop on `Modal`.** Modal renders its own form paper, calls `preventDefault`, and calls `onSubmit`. The props type makes `submitDisabled` and `pending` required whenever `onSubmit` is present (a discriminated union), and the slotProps path is removed.

| | A | B | C |
|---|---|---|---|
| Missing `submitDisabled` caught by | regex guard | regex guard | **tsc** |
| Call-site boilerplate | 10 lines | 10 lines | 1 prop |
| Migration | none | 43 sites | 43 sites (mechanical) |

**Lean: C.** It turns the two most-violated rules into type errors, and the 43-site migration is a find-and-replace of a shape that is already uniform. The cut is clean: the slotProps form path is removed rather than aliased.

### Decision 2 — Blocking close while pending

**A. A per-call guard** (`DeleteAccessItemDialog`'s `isPending ? noop : onClose`), in 50 places. **B. `Modal` takes `pending`.** While it is true, Modal ignores backdrop and Escape, disables the X, and forces the default button disabled (`submitDisabled || pending`). **C. B, plus a timeout escape hatch** in Modal (the X re-enables after N seconds).

| | A | B | C |
|---|---|---|---|
| Single source | no | yes | yes |
| Trapped by a hung request | yes | yes | no, but a UI timer hides a request-layer gap |

**Lean: B, with the hang fixed where it lives** (the timeout was added to #789's PRD at discovery). Modal owns `pending`. `useAuthMutation` gets a bounded write timeout, so `pending` always ends in success or a `FormAlert`. A UI timer would recreate exactly the "UI timer instead of request-layer fix" #751 warns against. (See Open question 1.)

### Decision 3 — Per-dialog enforcement

**A. Better regex** (slice the source per `<Modal`). **B. A TypeScript-AST guard.** `ts.createSourceFile` walks every `JsxElement` named `Modal`. A Modal whose subtree renders `FormAlert`, or whose `actions` hold a non-dismiss button, must have `onSubmit`, unless the file is on a reasoned `EXEMPT` list. **C. Types only**, with no guard.

**Lean: B, alongside Decision 1's types.** tsc enforces the props that come with `onSubmit`, and the AST guard enforces that a submitting dialog *has* `onSubmit`. Neither can be fooled by a nested `component: "form"` or by comments (the #758 review's findings 3 and 4). `typescript` is already a dependency.

### Decision 4 — Raw MUI `Dialog`

**A. Extend the guards to raw Dialog.** **B. Migrate all 7 raw Dialogs to `Modal`**, then ban `@mui/material/Dialog` imports in `apps/web` (allowlist empty).

**Lean: B.** It puts every dialog behind one contract and fixes the `PinnedResultDetail` Enter bug and the two form-less confirms on the way. The two viewers move too, so there are no exceptions to maintain.

### Decision 5 — Wizards: Enter does what the step's primary button does

**A. One wizard-level form.** The wizard Modal gets `onSubmit={primary.run}` and `submitDisabled={primary.disabled}`, and each step registers its `primary` (`{ run, disabled }`). **B. Each step renders its own form.** This means nesting inside the Modal body, which fights the shared footer. **C. Leave wizards click-only** (rejected in the PRD).

For A to work, `Modal`'s submit handler ignores events whose `target !== currentTarget`, so portaled child forms (BindingEditor, NewEntity, ApiEndpointForm) don't bubble into the wizard. Steps with no primary (OAuth, the picker) register `disabled: true`.

**Lean: A.** It reuses Decision 1's `onSubmit`/`submitDisabled`, keeps the wizard as the single owner of "what Enter means here", and needs only `RegionDrawingStep`/`ReviewStepUI` to expose their primary rather than render it standalone. The `target` check is one line in Modal and protects every future nested form.

### Decision 6 — Blur into Cancel

**A. A dismiss check on `relatedTarget`.** Modal marks its X, and a core `DialogCancelButton` (or a `data-dialog-dismiss` attribute) marks Cancel. A web util `isDismissBlur(e)` returns true when focus is moving to a dismiss control, and every `handleBlur` skips marking touched in that case. **B. `onMouseDown` + `preventDefault` on Cancel.** Pointer only, while Tab still flashes. **C. Drop blur validation.** This contradicts the CLAUDE.md rule.

**Lean: A.** It covers pointer and keyboard. The guard can require that Cancel buttons in Modal `actions` carry the marker, so the 15 hand-rolled `handleBlur`s adopt one helper.

### Decision 7 — Stale server error on reopen

**A. Views reset the mutation when they open a dialog** (`Portal.view.tsx:134` precedent). A small `openWith(mutation, setOpen)` helper keeps it to one line per site. **B. Modal or FormAlert hides errors until a submit since open.** Confirm buttons call `onConfirm` directly, not through a submit, so Modal can't see every attempt.

**Lean: A.** The error belongs to the attempt, and the mutation is where the attempt lives. B is fooled by confirm dialogs.

## Tradeoff comparison

|  | D1 `onSubmit` prop | D2 `pending` + timeout | D3 AST guard | D4 migrate Dialogs | D5 wizard primary | D6 dismiss blur | D7 reset on open |
|---|---|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Touches core | Yes | Yes | No | No | Yes (target check) | Yes (X marker) | No |
| Call sites | 43 | ~45 | 0 | 7 | 4 + 2 steps | ~32 | 22 |

## Recommendation

1. `Modal` takes `onSubmit`, which makes it a form. When `onSubmit` is set, `submitDisabled` and `pending` are required props, and `slotProps.paper.component = "form"` is no longer recognized.
2. While `pending`, `Modal` ignores backdrop and Escape, disables its close X, and keeps the default button disabled.
3. `Modal`'s submit handler acts only on its own form (`event.target === event.currentTarget`).
4. `useAuthMutation` writes get a bounded timeout, so `pending` always settles.
5. A TS-AST guard replaces the regex guard and checks each `<Modal>`: a submitting dialog has `onSubmit`, and dismiss buttons carry the dismiss marker.
6. All 7 raw MUI `Dialog`s move to `Modal`, and a guard bans the raw import in `apps/web`.
7. Each wizard's Modal submits to the current step's registered primary action, gated by its `disabled`.
8. `isDismissBlur` skips touched-marking when focus moves to a dismiss control, adopted by every dialog `handleBlur`.
9. Every view that opens a mutating dialog resets that mutation on open.
10. The per-dialog gaps in the inventory are fixed. Every dialog test uses a real `{Enter}`, and a guard bans `fireEvent.submit` in dialog tests. The 7 untested dialogs get tests.
11. CLAUDE.md's Component File Policy says local UI state (field values, touched, errors) is not wiring. The Form & Dialog Pattern is rewritten around `onSubmit`/`pending`, mirrored in `.github/copilot-instructions.md`.

## Open questions

1. **What write timeout?** Uploads and the RestApi commit can legitimately take a while, but a bound is still needed. Lean: a default of 30s for JSON writes (matching `DB_ADMISSION_MAX_WAIT_MS`), with per-endpoint overrides for uploads. A timeout surfaces as a `ServerError` in `FormAlert`.
2. **Escape inside `RegionDrawingStep`.** Its document listener (`:304`) cancels the in-progress draw, but MUI's Escape also closes the wizard. Lean: while a draw or popover is active, the step marks the event handled, and Modal ignores an Escape with `defaultPrevented`. Verify at spec time with a real key test.
3. **`NewEntityDialog` has no mutation** (a local create, `submitDisabled={false}`). Lean: it still takes `onSubmit`, with `submitDisabled` mirroring its own validity and `pending={false}`. The type requires the prop, so it states that explicitly.
4. **`EditConnectorInstanceDialog` has no `serverError`.** Lean: add `serverError`, and `ConnectorInstance.view.tsx:657` passes `toServerError(updateMutation.error)`. This is a missing-feedback bug, not a style issue.
5. **Do the Create/EditEntityRecord dialogs move to Zod?** Their `validateRequiredFields` is driven by the dynamic column schema. Lean: no. That is a schema built from column definitions at runtime, and a Zod wrapper adds nothing. Record it as a reasoned exception in the spec.

## Enterprise-scale considerations

- **Concurrency & correctness.** Lean: closing mid-commit currently orphans a server-side commit whose result is discarded (`use-spreadsheet-workflow.util.ts:713`). Blocking close keeps the user attached to the outcome. Duplicate submits stay #751's request-layer job.
- **Accuracy & auditability.** N/A: no record of truth changes, and feedback only becomes more faithful.
- **Failure modes.** Lean: fail-closed on dismissal while pending, which is only safe because of recommendation 4. A hung request settles to an error the user can read and retry, not a trapped modal.
- **Scale & unbounded growth.** N/A: client-side UI, with no fan-out. The guards are linear in the number of source files.
- **Multi-tenancy.** N/A: no data path changes. Lock (409) and permission (403) refusals keep reaching `FormAlert` through `serverErrorMessage`, and with close blocked the user always sees them.
- **Contract stability.** Lean: `Modal`'s new props are the contract every future dialog builds on. The typed union means a future dialog can't omit them.
- **Data lifecycle.** N/A.

## What this doesn't decide

- Visual redesign, copy, or sizing of any dialog (out of scope in the PRD).
- Non-dialog surfaces: inline forms and popovers outside a `Modal`.
- Whether the server-side commit should be cancellable when a wizard is abandoned. Blocking close sidesteps it here, and a cancel endpoint is a separate feature.
- The request layer's dedupe (#751), which is unchanged.

## Next step

`/spec 789` writes `docs/DIALOG_UX_AUDIT.spec.md`: the `Modal` prop contract and its types, the AST guard rules, the timeout contract, the wizard primary-action interface, and the full test plan. `/plan 789` slices it TDD-first, roughly:

1. Modal `onSubmit`/`pending`/target check plus the type union, with all 43 call sites migrated in one commit (no aliases).
2. AST guard replaces the regex guard.
3. Write timeout.
4. Raw Dialog migration plus the ban.
5. Wizards.
6. Dismiss-blur.
7. Reset on open.
8. Per-dialog gaps plus tests (`fsub` → `{Enter}`, the 7 untested dialogs, the `fireEvent.submit` ban).
9. CLAUDE.md and the Copilot mirror.
