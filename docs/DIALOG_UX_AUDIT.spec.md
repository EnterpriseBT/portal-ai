# Dialog UX audit — Spec

**Issue:** [EnterpriseBT/portal-ai#789](https://github.com/EnterpriseBT/portal-ai/issues/789) · **Discovery:** `docs/DIALOG_UX_AUDIT.discovery.md`

This spec pins the `Modal` contract that every dialog in `apps/web` builds on. That covers the `onSubmit` form variant, close-blocking while `pending`, own-form submit handling, and Escape deferral. It also pins the bounded write timeout in `useAuthMutation`, the guards that enforce the contract per dialog, and the fixes for the 57 dialogs inventoried in discovery.

## Key decisions (flag for review)

1. **`Modal` declares a form with `onSubmit`** (discovery D1). If `onSubmit` is set, the props type requires `submitDisabled` and `pending`. The `slotProps.paper.component = "form"` path is removed with no alias, and all 43 call sites migrate.
2. **`pending` blocks every dismissal** (D2). Backdrop, Escape and the header X do nothing, and the default button is disabled. `pending` is also accepted on a non-form `Modal`, which the spreadsheet wizards need.
3. **Writes time out** (D2, Q1, PRD amendment). The default is **30s**. Endpoints listed under *Surface → SDK overrides* use `LONG_WRITE_TIMEOUT_MS` (**5 min**). A timeout throws `ApiError` with code `REQUEST_TIMEOUT` and a message saying the write **may still have completed**, because a timed-out write isn't known to have failed.
4. **Own-form submits only** (D5). `Modal`, and every step-level form, act only on a submit whose `target` is their own form. React bubbles portaled child forms (BindingEditor, NewEntity, ApiEndpointForm) through to the parent, so without this check a child's submit would fire the parent's handler.
5. **Deviation from discovery D5, for review:** the form goes **wherever the primary button lives**. RestApi's primary sits in the Modal `actions`, so its Modal takes `onSubmit`. The spreadsheet wizards' primaries live inside `RegionDrawingStepUI` (Interpret) and `ReviewStepUI` (Commit plan), and Interpret runs click-time validation that the step owns (`attemptedInterpret`). Those steps therefore render their own form around their primary, and the wizard Modal takes only `pending`. FileUpload step 0's Upload is in the container, so the container wraps it. There is still one rule ("Enter = this step's primary, gated the same way"), and no state is lifted out of the steps.
6. **Escape is deferred to whatever handled it** (Q2, verified). MUI's Dialog handles Escape on its root and calls `stopPropagation`, so `RegionDrawingStep`'s document listener (bubble phase, `:317`) never runs. The step listens in the **capture** phase and calls `preventDefault`, and `Modal` ignores an Escape whose event is `defaultPrevented`.
7. **Blur toward the dialog's own controls doesn't mark a field touched** (D6, refined). When focus leaves a field for a button in the dialog's actions or header, `handleBlur` skips the touched state. Cancel doesn't flash an error, and Save still submits and validates. No per-button marker is needed.
8. **A view resets a dialog's mutation before opening it** (D7). A guard pairs every `serverError={toServerError(X.error)}` with an `X.reset()` in the same file.
9. **All raw MUI `Dialog`s become `Modal`s, and the raw import is banned** (D4).
10. **Recorded exception (Q5):** `Create/EditEntityRecordDialog` keep `validateRequiredFields`, because their schema is built at runtime from column definitions. They still meet touched/errors, `aria-invalid` and `focusFirstInvalidField`.
11. **Policy amendment (PRD):** local UI state (field values, touched, errors) inside a dialog is not wiring under the Component File Policy.

## Scope

### In scope
- Core: the `Modal` contract, the `handleOwnSubmit` helper, `Modal` tests, stories and type tests.
- Web: the request-layer timeout, SDK overrides, the dialog guards (replacing `dialog-enter-submit.guard.test.ts`), `isDialogControlBlur`, the 43-site migration, the 7 raw-Dialog migrations, the 4 wizards, the per-dialog gaps from the discovery inventory, resets on open, and tests.
- Docs: CLAUDE.md (Form & Dialog Pattern, Component File Policy, Dialog & Form Test Checklist) and `.github/copilot-instructions.md`.

### Out of scope
- Visual redesign; non-dialog forms and popovers outside a `Modal`; a server-side commit-cancel endpoint; #751's dedupe (unchanged; see Risks for how it interacts with timeouts).

## Surface

### `packages/core/src/ui/Modal.tsx`: the props union

```ts
interface ModalBaseProps
  extends Omit<DialogProps, "title" | "onClose" | "open" | "onSubmit"> {
  open: boolean;
  onClose: () => void;            // unchanged signature; never called while `pending`
  title?: React.ReactNode;
  actions?: React.ReactNode;
  showCloseButton?: boolean;
  maximizable?: boolean;
  defaultMaximized?: boolean;
  children?: React.ReactNode;
}

/** A dialog that submits. Enter submits exactly when the visible submit could. */
interface ModalFormProps {
  onSubmit: () => void;
  /** Same expression as the visible submit's `disabled`. */
  submitDisabled: boolean;
  /** The submit's request is in flight: dismissal and Enter are blocked. */
  pending: boolean;
}

/** A dialog that doesn't submit (viewer, or a wizard whose forms live in its steps). */
interface ModalPlainProps {
  onSubmit?: never;
  submitDisabled?: never;
  /** Blocks dismissal while true (e.g. a wizard committing). Defaults to false. */
  pending?: boolean;
}

export type ModalProps = ModalBaseProps & (ModalFormProps | ModalPlainProps);
```

Behavior:
- **Form variant:** the paper renders as `<form noValidate>`, merged into `slotProps.paper`, with `onSubmit={handleOwnSubmit(() => { if (!submitDisabled && !pending) onSubmit(); })}`. It renders `<FormDefaultButton disabled={submitDisabled || pending} />`. The `slotProps.paper.component` sniffing (`Modal.tsx:59-62`) is deleted.
- **Dismissal:** MUI's `onClose` is wrapped as `(event, reason) => { if (pending) return; if (reason === "escapeKeyDown" && (event as React.SyntheticEvent).defaultPrevented) return; onClose(); }`. The header X is `disabled={pending}`. The `{...props}` spread moves **before** `open`/`onClose`, so a caller can't override the wrapped handler.
- **Control markers:** `DialogActions` gets `data-dialog-controls` and the header button box gets `data-dialog-controls`. `isDialogControlBlur` reads these.

### `packages/core/src/ui/handle-own-submit.ts` (new, exported from `@portalai/core/ui`)

```ts
/** A form onSubmit that ignores submits bubbled from a portaled child form. */
export function handleOwnSubmit(
  run: () => void
): (event: React.FormEvent<HTMLFormElement>) => void;
// event.target !== event.currentTarget → return (no preventDefault: the child owns it)
// else event.preventDefault(); run();
```

### `apps/web/src/utils/api.util.ts`: write timeout

- New exports: `WRITE_TIMEOUT_MS = 30_000` and `LONG_WRITE_TIMEOUT_MS = 300_000`.
- `UseAuthMutationOptions` gains `timeoutMs?: number`. For a non-`GET` method the effective timeout is `timeoutMs ?? WRITE_TIMEOUT_MS`. `GET` (imperative reads) gets none, since the read-pause signal logic is unchanged.
- The mutation's fetch passes `signal: AbortSignal.timeout(ms)`, combined with any caller `options.signal` through `AbortSignal.any`.
- `fetchWithAuth` maps an abort caused by that timeout (`DOMException` name `"TimeoutError"`) to `new ApiError(REQUEST_TIMEOUT_MESSAGE, "REQUEST_TIMEOUT", 0)`. The message is: "This is taking longer than expected. It may still finish, so check before trying again." A caller-initiated abort keeps its current behavior.
- `REQUEST_TIMEOUT` is a client-side code. It isn't added to the API's `ApiCode` enum, since the server never sends it, and `serverErrorMessage` passes its message through.

### SDK overrides (`timeoutMs: LONG_WRITE_TIMEOUT_MS`)

| Endpoint | File |
|---|---|
| `layoutPlans.interpret`, `layoutPlans.commit` | `api/layout-plans.api.ts:21,29` |
| `connectorInstanceLayoutPlans.interpret`, `.commit` | `api/connector-instance-layout-plans.api.ts:20,72` |
| `fileUploads.confirm`, `fileUploads.parse` | `api/file-uploads.api.ts:29,35` |
| `apiConnector.discoverColumns`, `.probeDraft`, `.previewPage`, `.suggestTransform` | `api/api-connector.api.ts:145,165,178,200` |
| `connectorInstances.testConnection` | `api/connector-instances.api.ts:234` |
| `toolpacks` refresh, `portalSql` widget-refresh, `portalResults` refresh | `api/toolpacks.api.ts:69`, `api/portal-sql.api.ts:72`, `api/portal-results.api.ts:90` |
| `entityRecords` import, revalidate | `api/entity-records.api.ts:64,108`: only if the route answers synchronously. A `202` enqueue keeps the default. The plan verifies each route. |

### `apps/web/src/utils/dialog-blur.util.ts` (new)

```ts
/** True when focus is leaving a field for one of its dialog's own controls
 *  (an action button, the close/maximize X). A blur handler skips marking the
 *  field touched in that case: Cancel then shows no error, and Save validates
 *  on submit anyway. */
export function isDialogControlBlur(event: React.FocusEvent): boolean;
// (event.relatedTarget as Element | null)?.closest?.("[data-dialog-controls]") != null
```

Every dialog `onBlur`/`handleBlur` that sets touched first returns early when `isDialogControlBlur(e)` is true (32 files, from the discovery survey).

### Wizards

- **RestApi** (`RestApiConnectorWorkflow.component.tsx`): `Modal onSubmit={handlePrimary}`, `submitDisabled={!canAdvance || isCommitting}`, `pending={isCommitting}`. `handlePrimary` runs Next, or Commit on the last step, exactly as the footer button's `onClick` does. Cancel and Back are unchanged (already `disabled={isCommitting}`).
- **FileUpload / GoogleSheets / MicrosoftExcel**: `Modal pending={isCommitting}`, with no `onSubmit`. `handleClose` is unreachable while pending.
  - FileUpload step 0 wraps the step and its Upload footer in `<form onSubmit={handleOwnSubmit(upload)}>` with `<FormDefaultButton disabled={isUploadDisabled} />`.
  - Sheets/Excel steps 0–1 (OAuth, picker) have no primary and no form.
- **`RegionDrawingStepUI`** (`modules/RegionEditor/RegionDrawingStep.component.tsx`): wraps its panel in `<form onSubmit={handleOwnSubmit(handleInterpret)}>` with `<FormDefaultButton disabled={interpretDisabled} />`, where `interpretDisabled` is the existing button expression (`regions.length === 0`, `:662-667`). The Interpret button becomes `type="button"`.
- **`ReviewStepUI`** (`modules/RegionEditor/ReviewStep.component.tsx`): same shape, around `onCommit`. `disabled` is the existing commit expression (`isCommitting || hasBlockers || effectiveCommitDisabledReason`, `:519-528`). "Back to regions" (`:516`) becomes `disabled={isCommitting}`.
- **Escape:** `RegionDrawingStep`'s keydown listener (`:317`) registers with `{ capture: true }`. Its existing `preventDefault` on Escape (`:305`) then reaches `Modal`'s wrapped `onClose` first.

### Raw `Dialog` → `Modal` (7)

| Dialog | Becomes |
|---|---|
| `views/PinnedResultDetail.view.tsx:232` rename | form `Modal`. The `onKeyDown` Enter handler (`:242-243`) is deleted. Gains `FormAlert`, Zod validation (the pin rename contract), `aria-invalid` and `useDialogAutoFocus`. |
| `views/PinnedResultDetail.view.tsx:262` delete | confirm form `Modal` with `FormAlert` |
| `views/EntityGroupDetail.view.tsx:150` add member | form `Modal`; its `FormDefaultButton` and native form are removed |
| `views/EntityGroupDetail.view.tsx:497` remove member | confirm form `Modal` with `FormAlert` |
| `views/EntityGroups.view.tsx:289` create group | form `Modal`; the visible `type="submit"` becomes `type="button"` |
| `components/SidebarNav.component.tsx:279`, `components/ToolpackMetadataModal.component.tsx:39` | plain `Modal` (viewers) |

Each inline dialog in a view moves to its own `components/<Name>.component.tsx` under the Component File Policy.

### Per-dialog gaps (from the discovery inventory)

- **`NewEntityDialog`, `ApiEndpointForm`:** `submitDisabled` becomes their real validity expression, and `pending={false}` (local creates, no request).
- **`EditConnectorInstanceDialog`:** gains `serverError` and `FormAlert`. `ConnectorInstance.view.tsx:657` passes `toServerError(<its update mutation>.error)`.
- **`ShareDialog`, `AccessAuthoring/{Group,Policy,Role}EditorDialog`:** gain `validateWithSchema` against their contract body schemas, touched/errors and `aria-invalid`. The editors replace raw `autoFocus` with `useDialogAutoFocus`.
- **`CreatePortalDialog`:** gains an explicit `aria-invalid` on the station field.

### Guards: `apps/web/src/__tests__/dialog-contract.guard.test.ts` (replaces `dialog-enter-submit.guard.test.ts`)

The guard parses with `typescript`'s `createSourceFile` and walks every `JsxElement`/`JsxSelfClosingElement`. Each rule self-tests against embedded fixtures before scanning the tree.

| Rule | Fails when |
|---|---|
| R1 submitting dialog | a `<Modal>` whose children or `actions` render `<FormAlert>` has no `onSubmit` attribute. `EXEMPT`: `components/EndpointTestDialog.component.tsx` ("result viewer: the request fires on open; Close is its only action") |
| R2 no inferred form | any `slotProps` on `<Modal>` contains a `component` property |
| R3 no raw Dialog | any import of `@mui/material/Dialog`, or `Dialog` from `@mui/material`, in `apps/web/src` outside tests and stories. The allowlist is empty |
| R4 reset on open | a file with `serverError={toServerError(X.error)}` has no `X.reset()` |
| R5 real Enter | `fireEvent.submit(` appears in any `apps/web/src/**/__tests__/*.test.tsx`. The allowlist is empty (26 files migrate) |

## Migration / Seed

None. No schema change.

## TDD test plan

Run per package with `npm run test:unit -- --testPathPattern <…>` (never raw jest). `npm run type-check` covers the type tests.

### packages/core
- `src/__tests__/ui/Modal.test.tsx`, about 14 cases:
  - form variant: a real Enter submits; Enter with `submitDisabled` doesn't; Enter with `pending` doesn't.
  - `pending`: Escape doesn't close; a backdrop click doesn't close; the X is disabled.
  - not pending: Escape closes; an Escape with `defaultPrevented` from a capture listener doesn't close.
  - a portaled child form's submit doesn't fire `onSubmit`.
  - a plain Modal with `pending` blocks dismissal.
  - the actions and header carry `data-dialog-controls`.
  - a caller can't override the wrapped `onClose` through spread.
- `src/__tests__/ui/Modal.types.test.tsx`, 4 cases using `// @ts-expect-error`:
  - `onSubmit` without `submitDisabled` is a type error.
  - `onSubmit` without `pending` is a type error.
  - `submitDisabled` without `onSubmit` is a type error.
  - a plain variant compiles.
- `src/__tests__/ui/handle-own-submit.test.tsx`, 3 cases:
  - its own submit runs and calls `preventDefault`.
  - a bubbled child submit is ignored, with no `preventDefault`.
  - `run` is called once.

### apps/web: infrastructure
- `src/__tests__/api.util.test.tsx` (timeout block), about 6 cases:
  - a hung write rejects after `WRITE_TIMEOUT_MS` with `REQUEST_TIMEOUT` and status 0.
  - the message says the write may still finish.
  - a `GET` mutation has no timeout.
  - `timeoutMs` overrides the default.
  - a caller abort still aborts.
  - a timed-out request is released from the #751 in-flight map.
- `src/__tests__/dialog-blur.util.test.ts`, 4 cases: blur to an action button, blur to the header X, blur to another field, and a null `relatedTarget`.
- `src/__tests__/dialog-contract.guard.test.ts`, about 12 cases: R1–R5 each with a passing and failing fixture, plus the non-vacuity floors and the exempt-still-matches check.

### apps/web: dialogs
- **26 `fireEvent.submit` tests migrate to `user.type(field, "x{Enter}")`**, or `user.keyboard("{Enter}")` on a focused confirm button. These are the files listed by R5.
- **14 dialogs without an Enter test get one** (from the discovery inventory).
- **7 untested dialogs get the full Dialog & Form Test Checklist:** `EditConnectorEntityDialog`, `EditEntityGroupDialog`, `RemoveMemberDialog`, `RecordsPreviewDialog`, plus the 3 wizard containers below. About 40 cases.
- Each moved raw dialog gets its own test file with the checklist. About 30 cases, including PinnedResultDetail: "Enter with an empty name sends nothing".
- Blur-to-Cancel shows no error: one case each in `TagFormModal`, `CreateStationDialog` and `RenamePortalDialog`.

### apps/web: wizards
- RestApi, about 5 cases:
  - Enter on Basics advances when `canAdvance` and doesn't otherwise.
  - Enter on the last step commits.
  - Escape and the X are blocked while committing.
  - a submit inside a nested `ApiEndpointForm` doesn't advance the wizard.
- `RegionDrawingStep.test.tsx`, about 3 cases: Enter in a bounds field doesn't Interpret (field-level `preventDefault`), Enter on the focused form Interprets, and Escape with a region selected deselects without closing (rendered inside a `Modal`).
- `FileUploadReviewStep.test.tsx`/`ReviewStep` tests, about 2 cases: Enter commits only when unblocked, and Back is disabled while committing.
- FileUpload, Sheets and Excel containers, about 6 cases: close blocked while committing, and step-0 Enter uploads (FileUpload).

**Totals: about 160 cases.** Mostly migrations plus about 75 new cases.

## Acceptance criteria

- [ ] In every submitting dialog, Enter submits exactly when its visible primary is enabled. In every wizard step that has a primary, Enter does what that primary does, gated the same way.
- [ ] While any dialog's request or commit is pending, Escape, a backdrop click, the X and Cancel all leave it open.
- [ ] A write that never answers rejects after 30s, or 5 min on a listed long endpoint. Its dialog shows the "may still finish" `FormAlert`, becomes dismissible, and keeps the user's input.
- [ ] Clicking Cancel after clearing a required field closes the dialog with no error flash. Tabbing to a different field still shows the error.
- [ ] Reopening a dialog after a failed submit shows no stale `FormAlert`.
- [ ] Escape in the region editor with a region selected deselects it, and the wizard stays open.
- [ ] `apps/web` has no raw MUI `Dialog`, no `slotProps.paper.component`, and no `fireEvent.submit` in tests. CI fails each per dialog (R1–R5), and tsc fails a form `Modal` missing `submitDisabled` or `pending`.
- [ ] CLAUDE.md and the Copilot mirror describe the `onSubmit`/`pending` contract, the timeout, the guards, the Component File Policy amendment, and the entity-record validation exception.

## Risks & rollback

- **A timeout on a write that did succeed** (failure mode, fail-closed on the UI only). The user sees "may still finish". The #751 dedupe releases on settle, so an immediate identical retry is sent and could create a duplicate row. The copy tells the user to check first. Idempotency keys on creates are out of scope here. The long list keeps known-slow endpoints off the 30s bound. *Detect:* `REQUEST_TIMEOUT` in toasts or FormAlerts during smoke on app-dev's small task.
- **The 43-site migration in one commit**: the type union makes a missed site a tsc error, not a runtime one, so the build is the safety net. *Rollback:* revert the slice commit. There are no data or migration effects.
- **The capture-phase Escape listener** could swallow Escape for other overlays on the page. The listener is active only while a region is selected, and it skips inputs (`:291-302`), as it already does.
- **Blocking dismissal traps a user** only if `pending` never settles. The timeout bounds every write, so that can't happen.

## Files touched

- **core:** `src/ui/Modal.tsx`, `src/ui/handle-own-submit.ts` (new), `src/ui/index.ts`, `src/__tests__/ui/Modal.test.tsx`, `src/__tests__/ui/Modal.types.test.tsx` (new), `src/__tests__/ui/handle-own-submit.test.tsx` (new), `src/stories/Modal.stories.tsx`.
- **web infrastructure:** `utils/api.util.ts`, `utils/dialog-blur.util.ts` (new), and the 7 SDK files in the overrides table. `__tests__/dialog-contract.guard.test.ts` is new and `dialog-enter-submit.guard.test.ts` is deleted.
- **web dialogs:** the 43 form-`Modal` call sites (from the inventory), 32 blur handlers, the 22 views with `serverError` wiring, the 7 raw-Dialog sites plus about 5 new `components/*Dialog.component.tsx` files, and `ConnectorInstance.view.tsx`.
- **web wizards:** the 4 `*Workflow.component.tsx`, `modules/RegionEditor/{RegionDrawingStep,ReviewStep}.component.tsx`, `workflows/FileUploadConnector/UploadStep.component.tsx` (or its container footer), and their tests.
- **docs:** `CLAUDE.md`, `.github/copilot-instructions.md`.

## Next step

`/plan 789` writes `docs/DIALOG_UX_AUDIT.plan.md` as about 9 TDD slices on this branch:

1. Core `Modal` contract plus `handleOwnSubmit`, with all 43 call sites migrated (tsc-driven).
2. The write timeout plus SDK overrides.
3. The AST guard (R1–R3) replacing the old guard.
4. Raw Dialog → Modal migrations.
5. Wizards (RestApi `onSubmit`, step forms, capture-phase Escape, `pending`).
6. `isDialogControlBlur` adoption.
7. Reset on open plus R4.
8. Per-dialog gaps plus test migration plus R5.
9. Docs.
