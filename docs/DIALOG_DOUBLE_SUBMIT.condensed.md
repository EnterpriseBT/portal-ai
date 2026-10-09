# Dialog double-click submit — Condensed design (#751)

**Issue:** [EnterpriseBT/portal-ai#751](https://github.com/EnterpriseBT/portal-ai/issues/751) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Double-clicking a dialog's visible submit sends the create twice (measured 4 of 4 on New Station; a single click sends one). A mutation's `isPending` reaches the button's `disabled` a macrotask after `mutate()`, because react-query notifies observers on a timeout, so the second click of a double-click lands on a still-enabled button. #747 closed the **Enter** path with a submit hold in core's `Modal`, but visible submits are `type="button"` with their own `onClick`, so a click never passes through the form's `onSubmit`. Touches `packages/core` (`Modal`) and `apps/web` (two raw `Dialog` forms plus the guard test).

## Current shape

| Piece | Location | Note |
|---|---|---|
| Enter-path hold (#747) | `packages/core/src/ui/Modal.tsx:16` (`SUBMIT_HOLD_MS`), `:106` | wraps the paper form's `onSubmit` only |
| Modal actions | `packages/core/src/ui/Modal.tsx:158` | `<DialogActions>{actions}</DialogActions>`: every Modal dialog's buttons render here |
| Visible submit, typical | `apps/web/src/components/CreateStationDialog.component.tsx:198–200` | `type="button"`, `onClick={handleSubmit}`, `disabled={isPending}` |
| Submit shapes in the wild | 40 `submitDisabled` dialogs | 18 `onClick={handleSubmit}`; the rest `onConfirm`, inline lambdas, `onSubmit` props, a few `type="submit"` |
| Raw `Dialog` forms (no Modal) | `apps/web/src/views/EntityGroups.view.tsx:290,328–340` (`type="submit"`); `apps/web/src/views/EntityGroupDetail.view.tsx:151,189–203` (`FormDefaultButton`) | their own `<DialogActions>`, no hold at all |
| Convention guard | `apps/web/src/__tests__/dialog-enter-submit.guard.test.ts` | asserts `submitDisabled` / `FormDefaultButton disabled` over source |

## Decision — swallow the repeat click where every dialog's actions render

Options:
- **(a) Guard each dialog's handler.** 40 edits across 5 submit shapes, and every new dialog must remember it.
- **(b) Visible submits become `type="submit"` with no `onClick`**, so clicks go through the #747 form hold. One path, but it reverses the `type="button"` convention in ~40 dialogs.
- **(c) An in-flight guard in `useAuthMutation`.** Reaches every mutation, including non-dialog ones, and blocks legitimately parallel calls on one hook instance (per-row toggles).
- **(d) `Modal` swallows a repeat click in its actions.** The second click of a double-click carries `MouseEvent.detail ≥ 2`. A capture-phase click handler on `DialogActions` stops it before any button's `onClick`. It needs no state and no per-dialog edit. A keyboard activation has `detail` 0 and a single click 1, so neither is affected.

**Decision: (d).** One change at the one place every Modal dialog's buttons render. Core exports the handler as `swallowRepeatClick` and `Modal` applies it to its `DialogActions`. The two raw `Dialog` forms opt in on their own `<DialogActions>`. The guard test is extended so a raw `<DialogActions>` inside a `<form>` must carry it, the same way #747's guard holds `FormDefaultButton disabled`. The #747 Enter hold stays as is; the two cover the two input paths.

Accepted limit: two clicks far enough apart in *space* that the browser doesn't count them as a double-click, yet faster than the ~100 ms disable render, aren't caught. A human can't place two deliberate separate clicks that fast.

## Plan — 1 slice

**Files:** edit `packages/core/src/ui/Modal.tsx` (new exported `swallowRepeatClick`, applied as `onClickCapture` on `DialogActions`) (already exported through `ui/index.ts`'s `export * from "./Modal.js"`); edit `apps/web/src/views/EntityGroups.view.tsx` and `apps/web/src/views/EntityGroupDetail.view.tsx` (`<DialogActions onClickCapture={swallowRepeatClick}>`); edit `apps/web/src/__tests__/dialog-enter-submit.guard.test.ts` (raw form `DialogActions` must carry it); CLAUDE.md "Form & Dialog Pattern" + `.github/copilot-instructions.md` (one clause).

**Tests:** `packages/core/src/__tests__/ui/Modal.test.tsx`: `user.dblClick` on the visible submit fires its `onClick` once; a single click fires once; two clicks separated by `{ detail: 1 }` each still fire twice (only a repeat is swallowed); Cancel's single click still closes. The guard test covers the raw dialogs. Run with `npm run test:unit -- --testPathPattern '<files>'` in core and web, plus `type-check`, `lint`, `format:check`.

## Smoke (manual, against your dev stack)

1. **Stations → New Station**: name it, double-click **Create** → DevTools Network shows **one** `POST /api/stations` and one new station. Delete it afterwards.
2. Repeat on one confirm dialog (Delete Station on that test station): double-click **Delete** → one `DELETE`, no error toast from a second call on a gone row.
3. **Entity Groups → New group** (raw `Dialog`): double-click the submit → one create.
4. A single click and Enter still submit once each in all three; Cancel still closes on one click.

## Out of scope

- Non-dialog double-clicks (page-level primary buttons, menu items): different surface, not reported.
- The #747 Enter hold: unchanged.
