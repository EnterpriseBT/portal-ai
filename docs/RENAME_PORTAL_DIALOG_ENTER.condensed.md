# Rename Portal dialog submits on Enter — Condensed design (#758)

**Issue:** [EnterpriseBT/portal-ai#758](https://github.com/EnterpriseBT/portal-ai/issues/758) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Pressing Enter in the Rename Portal dialog does nothing; only clicking Save renames. The dialog is an inline helper in `Portal.view.tsx` built on a `Modal` with no form paper, so there is no form for Enter to submit, and the Enter guard never looked at it because it only inspects Modals that already declare one. Fix the dialog, move it into its own file, and close the guard's blind spot. `apps/web`, plus a one-message change to the `@portalai/core` contract.

## Current shape

| Piece | Location | Note |
|---|---|---|
| `RenamePortalDialog` (inline) | `apps/web/src/views/Portal.view.tsx:44–118` | `Modal` with no `slotProps.paper.component="form"`, no `submitDisabled`; Save is `onClick={handleSubmit}` with no `type="button"`; hand-rolled `"Name is required"` check, no `aria-invalid`, no Zod |
| Its caller | `Portal.view.tsx:242–252` | keyed on `item.portal.name`; passes `isPending` + `toServerError(renameMutation.error)` |
| Reference shape | `apps/web/src/components/DeletePortalDialog.component.tsx` | form paper + `submitDisabled={isPending}` + `type="button"` actions |
| Enter guard | `apps/web/src/__tests__/dialog-enter-submit.guard.test.ts:44–46` | selects files with `<Modal` **and** `component: "form"`, so a Modal with no form is never checked |
| Contract | `packages/core/src/contracts/portal.contract.ts:132` | `UpdatePortalBodySchema`: `name: z.string().trim().min(1).optional()` |

A sweep of every web file whose `<Modal` count exceeds its `component: "form"` count turns up 10. Five render a `FormAlert`, the marker the Form & Dialog Pattern uses for "this dialog triggers a mutation":
- `Portal.view.tsx` (this bug)
- `DeleteCuratedViewDialog.component.tsx`: the same bug. A one-click confirm with no form, while its sibling `DeletePortalDialog` has one.
- `EndpointTestDialog.component.tsx`: a result viewer. The test fires on open, and its only action is Close.
- `RestApiConnectorWorkflow.component.tsx`: a multi-step wizard driven by Back/Next, with no single submit. It matches only because a comment mentions `<FormAlert>`.

The other five (`UsageLedgerDialog`, `SigningSecretRevealDialog`, `RecordsPreviewDialog`, the File/Sheets/Excel workflow wizards) render no `FormAlert` and are read-only or wizards.

## Decision — what the guard treats as a submitting dialog

Options: (a) every `<Modal` needs a form paper unless allowlisted, which means 9 allowlist entries for read-only viewers and turns it into a list of exceptions; (b) a file that renders `<FormAlert` (JSX, with comments stripped) next to a `<Modal` is a submitting dialog, so each of its Modals needs a form paper unless the file is on an `EXEMPT` list that carries a reason; (c) heuristics based on button labels, which are fragile.

**Decision: (b).** `FormAlert` is already the convention's own marker for a mutating dialog ("Every dialog that triggers a mutation must render `<FormAlert>`"), so the guard keys on the thing the pattern requires. `EXEMPT` starts with exactly one reasoned entry, `EndpointTestDialog` ("result viewer: the request fires on open; no submit action"). Once comments are stripped, `RestApiConnectorWorkflow` no longer matches. The rule is per file: the number of form papers must be at least the number of `<Modal`s, matching the existing `submitDisabled` count rule. `DeleteCuratedViewDialog` gets fixed rather than exempted, because it is the same bug.

The dialog itself moves to `components/RenamePortalDialog.component.tsx` as a single pure-UI component, named `RenamePortalDialog` to match `DeletePortalDialog`. It renders only from props; the `name`/`touched`/`errors` form state is local UI state, the same as other dialog components. It follows the full pattern: form paper with `onSubmit`, `submitDisabled={isPending}`, `type="button"` actions, and validation through `validateWithSchema(UpdatePortalBodySchema, { name })`. The schema's `name` rule gains the message `"Name is required"` (`.min(1, "Name is required")`), so the dialog shows the contract's own error instead of keeping a second copy of the rule. A blank or whitespace-only name fails the rule, because the schema trims before it checks length. The API's 400 for a blank name now names the field the same way. Errors show after blur or submit, with `aria-invalid` and `focusFirstInvalidField()`. An unchanged name still closes without a request.

## Plan — 2 slices

**Slice 1 — guard first (red), then fix both dialogs.**
- Edit `apps/web/src/__tests__/dialog-enter-submit.guard.test.ts`: add the FormAlert-keyed "has a form paper" case plus `EXEMPT`, and a non-vacuity assertion. It fails on `Portal.view.tsx` and `DeleteCuratedViewDialog`.
- New `apps/web/src/components/RenamePortalDialog.component.tsx`; edit `Portal.view.tsx` to import it and remove the inline component and its now-unused imports.
- Edit `DeleteCuratedViewDialog.component.tsx`: form paper + `submitDisabled={!!isPending}`.
- Edit `packages/core/src/contracts/portal.contract.ts`: the `name` message, pinned in `portal.contract.test.ts`.
- **Tests:** new `apps/web/src/__tests__/RenamePortalDialog.test.tsx` covering the full Dialog & Form Test Checklist, including a real `user.type(field, "x{Enter}")` that calls `onSubmit`, and Enter while `isPending` that does not. New `DeleteCuratedViewDialog.test.tsx` (it had none): the checklist, plus Enter on a focused Delete confirms exactly once and is ignored while pending. Re-run `PortalView.gates.test.tsx` and `cache-invalidation.test.tsx`.
- Run `npm run test:unit -- --testPathPattern '(dialog-enter-submit|RenamePortalDialog|DeleteCuratedViewDialog|PortalView|cache-invalidation|CuratedView)'`, then `npm run type-check` and `npm run lint` (web).

**Slice 2 — docs.** CLAUDE.md "Form & Dialog Pattern" + `.github/copilot-instructions.md`: one clause saying the guard also fails a `FormAlert`-bearing `Modal` that has no form paper.

## Smoke (manual, against your dev stack)

1. Open a portal and click **Rename**. The Name field is focused. Change the name and press **Enter**: one PATCH is sent, the dialog closes, and the header shows the new name.
2. Reopen the dialog, clear the name, and press **Enter**: "Name is required" appears, the field is `aria-invalid`, and no request is sent.
3. Reopen the dialog and press **Enter** without changing anything: it closes with no PATCH.
4. Throttle the network, then press **Enter** twice quickly: exactly one PATCH is sent, and the Save button reads "Saving...".
5. On Views, open **Delete** on a view you own, Tab to **Delete**, and press **Enter**: the view is deleted once.

## Out of scope

- The connector wizards' Modals. They advance step by step and have no single submit, so a per-step Enter behavior would be a separate design.
- `EndpointTestDialog`, which has no submit action.
- A UX audit of every dialog, wizards included, to check they follow best practice. Tracked as its own follow-up ticket.
