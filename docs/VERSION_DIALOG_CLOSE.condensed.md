# App-version dialog gets a close control — Condensed design (#983)

**Issue:** [EnterpriseBT/portal-ai#983](https://github.com/EnterpriseBT/portal-ai/issues/983) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc). Child of epic #791; branches from and merges into `epic/a11y-conformance`.

**Why.** The dialog the sidebar's version caption opens has no focusable element. Focus sits on MUI's container, Tab cycles the container, the focus-trap sentinel and `body`, and only Escape or a backdrop click closes it. Neither is discoverable from inside the dialog. The APG dialog pattern expects at least one control, normally a visible Close. Only `apps/web` is touched.

## Current shape

| Piece | Location | Note |
|---|---|---|
| The version dialog | `apps/web/src/components/SidebarNav.component.tsx:299` | A `Modal` with `showCloseButton={false}` and `aria-label="App version"` (#793), and a body `Typography` that repeats "App version" as text |
| `Modal`'s header | `packages/core/src/ui/Modal.tsx:116` | `showHeader = !!title \|\| showCloseButton`. The default close `IconButton` (`aria-label="close"`) sits in the header's `data-dialog-controls` box (:177). A `title` names the dialog through MUI's `aria-labelledby`; `aria-label` is only for a dialog with no visible title (:131) |
| The real dialog's test | `apps/web/src/__tests__/SidebarNav.test.tsx:26` | Opens `<SidebarNav />` and runs axe on the dialog (R6) |
| The "Version footer" tests | `apps/web/src/__tests__/SidebarNav.test.tsx:156` | Render a hand-built `VersionFooter` with raw MUI `Dialog`, **not** the shipped dialog, so they would pass whatever `SidebarNav` renders |

## Decision — a visible title and the default close button

- **A. Add an `actions` "Close" button.** This adds a footer to a two-line dialog, and the header still has no title.
- **B (chosen). Pass `title="App version"` and drop `showCloseButton={false}`.** The header shows the title and `Modal`'s standard close button, like every other dialog. The visible title names the dialog, so `aria-label` goes, and so does the body's duplicate "App version" line. The body is just the version code block.

Initial focus doesn't change: MUI focuses the dialog container, and the first Tab reaches Close. That is the APG pattern's allowance for a dialog whose only control is the close.

**Tests follow the shipped dialog.** The fake `VersionFooter` tests are replaced with tests that open the real `<SidebarNav />`, as the axe test already does. The caption's own rendering stays covered by `SidebarVersionCaption.test.tsx`.

## Plan — 1 slice

**Files**
- Edit: `apps/web/src/components/SidebarNav.component.tsx` (`title`, default close button, no `aria-label`, no body label)
- Edit: `apps/web/src/__tests__/SidebarNav.test.tsx` (drop `VersionFooter` and its raw-`Dialog` import; new tests below)

**Tests** (failing first; `cd apps/web && npm run test:unit -- --testPathPattern SidebarNav`)
- Opening the caption shows a dialog named "App version", with a heading "App version" and the version code.
- The dialog holds a focusable `close` button, and pressing Tab from the open dialog lands on it.
- Clicking `close` closes the dialog, and Escape still does.
- The existing axe test stays green.
- Then `npm run lint && npm run type-check && npm run format:check` in `apps/web`.

## Smoke (manual, against your dev stack)

1. Signed in, click the sidebar's "© <year>" caption. The dialog shows the title "App version", a close (×) button and the version code, with no duplicate "App version" line.
2. Press Tab. Focus lands on the close button with a visible focus ring. Further Tabs stay inside the dialog.
3. Press Enter on the close button. The dialog closes and focus returns to the caption.
4. Reopen it and press Escape. It closes. Reopen it and click the backdrop. It closes.
5. With a screen reader (or the accessibility tree), the dialog is named "App version" and the close button "close".

## Out of scope

- The code block's ad hoc `sx` in `SidebarNav` (styling belongs in the theme). It predates this ticket, and moving it is a theme change.
- Initial focus on the close button rather than the container. The pattern allows the container, and `Modal` doesn't take an initial-focus target.
