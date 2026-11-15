# Toasts that step aside for focus — Condensed design (#1024)

**Issue:** [EnterpriseBT/portal-ai#1024](https://github.com/EnterpriseBT/portal-ai/issues/1024) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc). Child of epic #791 (found by #800); branch `fix/1024-toast-focus-not-obscured` → `epic/a11y-conformance`.

**Why.** WCAG 2.4.11 Focus Not Obscured (AA): the toast stack is fixed at the bottom right over the page, and error toasts persist (since #1021, info and warning do too). Tab down a list whose last rows reach the bottom of the viewport and their actions take focus fully hidden under the stack (KB-11: Toolpacks, 100% covered at 1280×720; whole rows at 390×844). The fix is in web only: `ToastHost` moves the stack to the top right while the focused control would be under it. The ACR's 2.4.11 row and the audit's KB-11 close in the same PR.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Stack position | `apps/web/src/components/ToastHost.component.tsx:222-226` | `position: fixed`, `zIndex: snackbar`, anchored by `TOAST_ANCHOR` (bottom-right, `spacing(3)` from each edge), `maxWidth: 480` |
| Anchor | `apps/web/src/utils/toast.constants.ts:40` | `{ vertical: "bottom", horizontal: "right" }` |
| Scrollers | `layouts/Authorized.layout.tsx:66-76`, `layouts/Public.layout.tsx:30-36` | `main#main-content` scrolls (`overflow: auto`). `FullScreen.layout.tsx` doesn't: its pages scroll inside themselves |
| Dialogs | MUI `zIndex.modal` (1300) < `snackbar` (1400) | The stack sits over an open dialog too, where Save and Cancel are at the bottom right |

## Decision — the stack moves to the top while it would cover focus

- **Rule:** on keyboard focus outside the stack (a pointer press doesn't move it; code review), on scroll and resize, and whenever the stack changes size, `ToastHost` compares the focused element's box with where the stack sits at the bottom (its measured width and height, `spacing(3)` from the bottom-right corner). If they overlap, the stack anchors to the **top right**; otherwise it returns to the bottom right. It's measured against the bottom position, never the current one, so the stack doesn't flip back and forth, and Shift+Tab up to the header returns it to the bottom.
- **Why top:** the focus that collides is near the bottom, so the top is the free edge. Bottom-left would cover the same table rows (their link column) and the sidebar.
- **Why this over `scroll-padding-bottom` on `main`** (the issue's first option): padding only helps `main`'s own scroll. A row at the very end of the content can't scroll above the stack without extra bottom padding as well. It also wouldn't reach dialogs (Save under the stack), nested scrollers such as table containers, or FullScreen pages. Moving the stack covers all of them with one rule, and the page layout never changes.
- **Pure geometry:** the overlap test is a small util (`toastStackCovers(focusRect, stackSize, viewport)`), unit-tested with plain rects. `ToastHost` measures and applies it, since jsdom can't lay anything out.
- **Unchanged:** nothing moves focus, the stack's nodes and order stay the same (so nothing is re-announced), and there's no animation.
- **Docs:** `CLAUDE.md` → Toast Pattern → Stacking says the stack moves to the top right while it would cover focus. The ACR's 2.4.11 row moves to Supports if nothing else in it is open (the header and dialogs already pass), and KB-11 is closed by #1024.

## Plan — 1 slice

**Files:**
- **New:** `apps/web/src/utils/toast-placement.util.ts` (the overlap test).
- **Edit:** `apps/web/src/components/ToastHost.component.tsx` (a `focusin` listener on `document` and a window `resize` listener, re-checked whenever the toasts change; the anchor in state); `CLAUDE.md`; `docs/ACCESSIBILITY_CONFORMANCE_REPORT.md` (2.4.11, the evaluated-build note); `docs/A11Y_AUDIT.md` (KB-11).

**Tests:**
- `apps/web/src/__tests__/toast-placement.util.test.ts`: overlap, no overlap, touching edges, a focused box taller than the viewport, narrow viewports where the stack is full width.
- `apps/web/src/__tests__/ToastHost.test.tsx`: with `getBoundingClientRect` stubbed, focusing a control under the bottom stack anchors it to the top; focusing one elsewhere returns it; focus inside the stack never moves it; the listener is removed on unmount; axe still clean.
- `npm run test:unit -w @portalai/web -- --testPathPattern "(ToastHost|toast-placement)"`; `npm run lint -w @portalai/web`; `npm run lint:doc-pointers`.

## Smoke (manual, against your dev stack)

1. 1280×720, **Toolpacks**. Raise three error toasts (fail a custom toolpack's Refresh a few times, e.g. its webhook down). Tab down the table: when a row's Refresh, Edit or Delete would be under the stack, the stack moves to the top right and the focused control is fully visible.
2. Shift+Tab back up to the first rows, then on to the header: the stack returns to the bottom right once focus is clear of it.
3. 390×844: repeat step 1. Whole rows stay visible as they take focus.
4. With the toasts up, open a dialog whose Save sits at the bottom right (e.g. Edit on a toolpack) and Tab to Save: it's visible.
5. Tab into the stack (or use "Skip to notifications"): it stays where it is while focus is inside it.
6. Brand Dark: repeat step 1.

## Out of scope

- `UpdateBanner` (bottom-center, a recorded local `Snackbar`): it isn't persistent the way an error stack is, and it's covered by its own walk.
- Other 2.4.11 findings (none open).
