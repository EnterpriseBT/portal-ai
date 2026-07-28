# Pin dialog — surface failures — Condensed design (#285)

**Issue:** [EnterpriseBT/portal-ai#285](https://github.com/EnterpriseBT/portal-ai/issues/285) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** A failed pin closes the dialog as if it succeeded. `pin.mutate` is called with an `onSuccess` handler and no `onError`, so a rejection updates no state and renders nothing — the user believes the result is saved, the pinned list never shows it, and there is no signal to retry. Pinning is the only way to keep a result past a session, so this is silent loss of a deliberate action. Single package: `apps/web`.

The `onError` gap is the symptom; the cause is that this dialog predates the house **Form & Dialog Pattern** (`CLAUDE.md` → apps/web) and satisfies almost none of it. It was found during the #273 smoke walk, where a missing `portal_results` row was indistinguishable from an unclicked button — that ambiguity *is* the bug.

## Current shape

| Piece | Location | Gap against the house pattern |
|---|---|---|
| Mutation call | `apps/web/src/components/PortalMessage.component.tsx:322-333` | `onSuccess` only — **no `onError`**; `pin.error` never read |
| Dialog markup | same file, `:270-297` | Raw MUI `<Dialog>`; `DialogContent`/`DialogActions` **not wrapped in a `<form onSubmit>`**, so Enter does not submit |
| Action buttons | same file, `:289-296` | No `type="button"` |
| Server error | — | No `serverError` prop, no `<FormAlert>` anywhere |
| Name field | same file, `:279-286` | No Zod validation, no `touched`/`errors`, no `aria-invalid`, no `helperText`; gates only on `!pinName.trim()` |
| Autofocus | same file, `:272-275` | Hand-rolled via `TransitionProps.onEntered` + `inputRef` instead of `useDialogAutoFocus(open)` |
| Existing tests | `apps/web/src/__tests__/PortalMessage.test.tsx:376+` | `describe("pin dialog")` covers opening only |

**The pieces it should be using all exist.**

| Utility | Location |
|---|---|
| `FormAlert` | `apps/web/src/components/FormAlert.component.tsx` — renders message + code |
| `toServerError` / `ServerError` | `apps/web/src/utils/api.util.ts` |
| `validateWithSchema`, `focusFirstInvalidField`, `FormErrors` | `apps/web/src/utils/form-validation.util.ts` |
| `useDialogAutoFocus` | `apps/web/src/utils/use-dialog-autofocus.util.ts` |
| **The schema** | `packages/core/src/contracts/portal.contract.ts:141-146` — `PinResultBodySchema`, whose `name` is `z.string().min(1)` |
| Exemplar to copy | `apps/web/src/components/CreatePortalDialog.component.tsx:93-99`, `:144-164`, `:204` — props `{open, onClose, onSubmit, isPending, serverError}`, `slotProps.paper.component: "form"`, `type="button"`, `FormAlert` |

## Decision — extract the dialog to its own file and put it on the house pattern

Keeping the dialog inline is not an option: `PortalMessage.component.tsx` already exports exactly two components (`PortalMessageUI` + `PortalMessage`), which is the **Component File Policy** ceiling, and the policy states that a JSX fragment worth naming is worth its own file. So the fix and the policy point the same way.

**Chosen shape** — a new `PinResultDialog.component.tsx`, mirroring `CreatePortalDialog`:

- Props `{ open, onClose, onSubmit(name: string), isPending, serverError }` — a pure UI component, no SDK, no hooks beyond local form state.
- The dialog collects and validates **only the name**, against `PinResultBodySchema.pick({ name: true })`, and emits it. The container owns `portalId` / `messageId` / `blockIndex` and assembles the body — keeping the dialog context-agnostic rather than teaching it about blocks.
- `slotProps.paper` with `component: "form"` and `onSubmit`, so **Enter submits**; action buttons get `type="button"`.
- `<FormAlert serverError={serverError} />` inside the content; the container passes `toServerError(pin.error)`.
- `useDialogAutoFocus(open)` replaces the hand-rolled `TransitionProps` focus.
- `touched`/`errors` state with `error` + `helperText` + `aria-invalid` on the field, and `focusFirstInvalidField()` after a failed submit.

**The container stops closing on submit.** Today `handleConfirm` closes unconditionally; the dialog must stay open on failure so the alert is visible and the user can retry. It closes in `onSuccess` only.

**This does not fix unpin (#286).** Worth stating plainly, because the two tickets were sequenced on the assumption that it would: unpin is an icon click with no dialog, so `FormAlert` has nowhere to render. #285 establishes the *dialog* pattern (which `CLAUDE.md` already codifies); #286 still owns choosing a non-dialog surface for its failure — the nearest precedent being the per-feature MUI `Snackbar` in `ConnectorInstanceSyncFeedback.component.tsx:130`.

## Plan — 1 slice

**Files**

- New: `apps/web/src/components/PinResultDialog.component.tsx` — the pure UI dialog described above.
- Edit: `apps/web/src/components/PortalMessage.component.tsx` — delete the inline dialog and its `pinName`/`inputRef` state; render `<PinResultDialog>`; `handlePin` gains `onError` and only closes on success; thread `isPinPending` and `toServerError(pin.error)` from the container.
- New: `apps/web/src/__tests__/PinResultDialog.test.tsx` — the dialog's own suite.
- Edit: `apps/web/src/__tests__/PortalMessage.test.tsx` — the existing `describe("pin dialog")` still passes against the extracted dialog.

**Tests** (`cd apps/web && npm run test:unit`) — the full **Dialog & Form Test Checklist** from `CLAUDE.md`, which is the standard this dialog never met:

1. Renders title and content when `open={true}`; 2. renders nothing when `open={false}`; 3. calls `onSubmit` with the name on button click; 4. **Enter key submits** (form submit event); 5. calls `onClose` on Cancel; 6. shows loading state when `isPending`; 7. renders `<FormAlert>` when `serverError` is provided; 8. does **not** render it when `serverError` is null; 9. blank name shows a field-level error and does **not** call `onSubmit`; 10. `aria-invalid="true"` on the invalid field; 11. `required` present on the name field.

Plus the two that encode this bug specifically:

12. **A failed pin keeps the dialog open** — `serverError` set while `open` stays true, alert visible, name preserved for retry.
13. The container's `handlePin` passes an `onError` (asserted through the container test, where the mutation mock rejects).

## Smoke (manual, against your dev stack)

1. `npm run dev`; in a portal session, hover an assistant text block and click the pin icon.
2. Type a name, press **Enter** — it pins without touching the button (this did nothing before).
3. Clear the name and submit — an inline field error appears, the dialog stays open, nothing is pinned.
4. Force a failure: stop the API (or go offline in devtools), then pin. **The dialog stays open with a red alert showing the message and error code** — previously it closed silently.
5. Restart the API and retry from the still-open dialog — it succeeds, the dialog closes, the result appears in the station's pinned list.
6. Pin a data-table block the same way; confirm the first field is auto-focused when the dialog opens.
7. Cancel closes without pinning; pinning an already-pinned block is still not offered (the icon shows unpin).

## Out of scope

- **Unpin failures (#286)** — different interaction, no dialog; see the decision above.
- **A shared app-wide toast/snackbar.** Only justified once a second non-dialog surface needs it; #286 is where that argument gets made.
- **The pin affordance's placement or visibility rules** (#273 settled which blocks can pin).
- **Auditing other dialogs** against the checklist. This one was found failing; a sweep is its own ticket.
