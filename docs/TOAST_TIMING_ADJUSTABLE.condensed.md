# Toasts the user can read at their own pace — Condensed design (#1021)

**Issue:** [EnterpriseBT/portal-ai#1021](https://github.com/EnterpriseBT/portal-ai/issues/1021) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc). Child of epic #791 (found by #800); branch `fix/1021-toast-timing-adjustable` → `epic/a11y-conformance`.

**Why.** WCAG 2.2.1 Timing Adjustable (A): an info or warning toast vanishes after 6 s and a success after 4 s, and hovering or focusing a toast doesn't stop the clock. Two info notices (a cleared curated-view filter, an unconfirmed Stripe subscription) say something the page shows nowhere else, so a slow reader, a magnifier user or a switch user can miss them. The fix is in web only: the toast provider's timing policy, a hold signal from `ToastHost`, and the policy text in `CLAUDE.md`. The ACR's 2.2.1 row moves to Supports in the same PR.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Durations | `apps/web/src/utils/toast.constants.ts:26-31` | `success` 4 s, `info`/`warning` 6 s, `error` null (persists) |
| Timers | `apps/web/src/providers/Toast.provider.tsx:95-122` | One `setTimeout` per visible toast, armed on promotion; nothing pauses it. `autoHideMs` overrides, except on an error |
| Host | `apps/web/src/components/ToastHost.component.tsx:62-75, 142-156` | Pure UI. It already tracks focus inside the stack (`handleFocus`/`handleBlur`) to hand focus on when a toast goes, but tells the provider nothing |
| Info/warning call sites | `views/CuratedViewDetail.view.tsx:227`, `views/Settings.view.tsx:104,129`, `views/EntityDetail.view.tsx:755` (`successSeverity: "info"`), `utils/use-rate-limit-notice.util.ts:41` | The rate-limit warning passes `autoHideMs: waitMs` (#747) and dismisses itself when the wait ends |
| Policy text | `CLAUDE.md` → Toast Pattern → Timing row | Says what the provider does today |

## Decision — info and warning persist; success pauses while held

- **`info` and `warning` persist until dismissed**, like errors (`TOAST_AUTO_HIDE_MS` → `null` for both). They carry information the user needs, and only a toast that waits for the user meets 2.2.1 for a screen-reader user who hears it once and never focuses it. A caller whose notice has a known end still passes `autoHideMs`: the rate-limit warning keeps its wait-length timer, since after the wait it's no longer true.
- **`success` keeps its 4 s, but the stack holds while the pointer is over it or focus is inside it**, and every timer restarts in full when the hold ends. A success confirms an outcome the page already shows, so nothing is lost when it goes; the hold means it never disappears out from under someone reading it or reaching for its action.
- **One hold for the whole stack, not per toast.** The toasts sit 8 px apart, and moving the pointer from one to the next shouldn't restart the clock on the one just left. It's also one signal (`onHoldChange(held)`) from a host that already sees both pointer and focus.
- **The hold always releases.** It's pointer-inside OR focus-inside, and focus-inside is recomputed whenever the host moves focus (after the last toast goes, focus lands on `main`, and a removed node fires no blur). A hold stuck on would make every later success persist.
- Rejected: pause-on-hover alone (a screen-reader user never hovers, so info would still vanish); a "keep" button on each toast (another control per toast, for what persistence already gives).
- **ACR:** 2.2.1 moves to Supports, citing #1021. The `toast.constants.ts` and provider comments, and `CLAUDE.md`'s Timing row, describe the new policy.

## Plan — 1 slice

**Files:**
- **Edit:** `apps/web/src/utils/toast.constants.ts`; `apps/web/src/providers/Toast.provider.tsx` (a `held` state; while held, clear every timer; on release, re-arm each visible toast in full); `apps/web/src/components/ToastHost.component.tsx` (`onHoldChange` prop from `onMouseEnter`/`onMouseLeave` and focus in/out, recomputed in its layout effect); `CLAUDE.md` (Toast Pattern → Timing); `docs/ACCESSIBILITY_CONFORMANCE_REPORT.md` (the 2.2.1 row; the evaluated-build note).

**Tests:**
- `apps/web/src/__tests__/Toast.provider.test.tsx`: info and warning persist past 6 s; a warning with `autoHideMs` still hides; a success held by pointer or by focus outlives 4 s, then hides 4 s after release (not sooner); a hold ending when the last toast goes doesn't stop the next success from hiding. The existing "auto-dismisses info and warning" case changes to assert persistence.
- `apps/web/src/__tests__/ToastHost.test.tsx`: `onHoldChange(true)` on pointer enter and on focus into a toast, `false` on leave and on Tab out; axe still clean.
- `npm run test:unit -w @portalai/web -- --testPathPattern "Toast"`; `npm run lint -w @portalai/web`; `npm run lint:doc-pointers`.

## Smoke (manual, against your dev stack)

1. Open a curated view, apply a filter on a column, then trigger the cleared-filter notice (or come back from `/settings?billing=cancelled`). The info toast is still there after 30 s, and closes with its Close button.
2. Trigger a success toast (save an edit somewhere) and hover it: it stays for as long as the pointer is over it. Move the pointer off: it goes about 4 s later.
3. Trigger a success toast and Tab into the stack (or use the Notifications skip link): it stays while focus is inside. Tab out: it goes about 4 s later.
4. Dismiss the last toast with the keyboard (focus moves to `main`), then trigger another success without touching the stack: it hides after about 4 s.
5. An error toast still persists, and a warning (e.g. the rate-limit notice, if it's reachable) still hides when its wait ends.
6. Brand Dark: repeat step 2.

## Out of scope

- Toasts covering the focused control (2.4.11), which is #1024 and touches `ToastHost` next.
- `UpdateBanner` and `ConnectorInstanceSyncFeedback`, the recorded local-`Snackbar` exceptions: neither auto-hides content the user needs.
