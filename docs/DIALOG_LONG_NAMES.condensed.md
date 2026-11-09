# Long unbroken names wrap inside dialogs — Condensed design (#984)

**Issue:** [EnterpriseBT/portal-ai#984](https://github.com/EnterpriseBT/portal-ai/issues/984) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc). Child of epic #791; branches from and merges into `epic/a11y-conformance`.

**Why.** A name can be 120 characters with no spaces (`nameField`, #801). In a dialog it doesn't wrap: the Delete Tag confirm's content measured `scrollWidth` 993 against `clientWidth` 598 at 1280×720, so the name runs past the dialog's edge and is clipped (WCAG 1.4.10 Reflow). The same holds for a URL, an id or a hash in any dialog, and it's worse at 320px or 400% zoom. Only `packages/core`'s two theme JSONs change, and every dialog inherits the fix.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Dialog content | `packages/core/src/assets/themes/brand-theme.json:544`, `brand-theme-dark.json:560` | `MuiDialogContent.styleOverrides.root` sets only `padding`. No `overflow-wrap` |
| Dialog title | `brand-theme.json:534`, `brand-theme-dark.json:550` | `MuiDialogTitle` likewise. Titles embed names: `ShareDialog.component.tsx:127` (`Share “<name>”`), `EndpointTestDialog.component.tsx:51` |
| `Modal`'s title | `packages/core/src/ui/Modal.tsx:149` | Already pads right (`pr`) for the close and maximize buttons, so wrapped title text stays clear of them |
| Theme rule | `CLAUDE.md` → Accessibility Requirements | Literal values go in both theme JSONs; palette-derived rules in `a11yComponents()` (`ThemeProvider.tsx:59`). `overflow-wrap` is a literal |
| Page titles | `PageHeader.tsx:88` | Already `overflowWrap`/`wordBreak: "break-word"` |
| Card titles | `DetailCard.tsx:79` | Truncate with an ellipsis, by design; the issue calls that fine |
| Theme tests | `packages/core/src/__tests__/ui/theme-contrast.test.ts` | `describe.each` over `THEME_MAP`, the pattern for a per-theme assertion |

## Decision — `break-word` on dialog content, `anywhere` on the title, in both theme JSONs

- **Where.** Both JSONs, on `MuiDialogContent` and `MuiDialogTitle` `root`, beside their padding. It's a literal, so it belongs in the JSONs rather than `a11yComponents()`, and every `Modal` gets it from the theme, with no `sx`.
- **Content: `break-word`.** `overflow-wrap` is inherited by everything in the dialog. `break-word` breaks a token only when it can't fit its line and leaves min-content widths alone, so a long name in the confirm's paragraph wraps while a table keeps its columns (and scrolls) and a button row keeps its words whole. `anywhere` would also shrink every word's min-content width, so auto-layout tables and flex rows (UsageLedgerDialog's table and toolbar, wizard steppers) would split ordinary words mid-word at narrow widths. Code review caught this in the first draft, which used `anywhere` for both.
- **Title: `anywhere`.** `Modal`'s `DialogTitle` is `display: flex` (`Modal.tsx:149`), so its text is a flex item that won't shrink below its longest word under `break-word`, and a long name would still overflow. `anywhere` lets it shrink. Since #983 the title holds only its text (the buttons sit beside it), so nothing else in it is affected.
- **Not `word-break: break-all`.** It breaks every word mid-word, even ones that fit.

## Plan — 1 slice

**Files**
- Edit: `packages/core/src/assets/themes/brand-theme.json`, `brand-theme-dark.json` (`overflowWrap` on both overrides)

**Tests** (failing first; `cd packages/core && npm run test:unit -- --testPathPattern theme-text-wrap`)
- New `packages/core/src/__tests__/ui/theme-text-wrap.test.tsx`: for each theme in `THEME_MAP`, `MuiDialogContent` sets `break-word` and `MuiDialogTitle` `anywhere`, with their padding kept; and a `Modal` rendered under `ThemeProvider` computes those values on its title and content, so a later `sx` in `Modal` can't silently undo them. jsdom has no layout, so the measured overflow is the smoke walk's job.
- Then `npm run build`, `npm run lint && npm run type-check && npm run format:check` in `packages/core`.

## Smoke (manual, against your dev stack)

1. On `/tags`, create a tag named `Adv` + `L` × 117 (120 characters, no spaces), and open its **Delete** confirm at 1280×720. The name wraps inside the dialog, nothing is clipped, and the content's `scrollWidth` equals its `clientWidth`.
2. Resize to 320px wide. The confirm still has no horizontal overflow, and its buttons stay visible.
3. Open **Share** on a station whose name is 120 characters with no spaces. The title "Share “…”" wraps under the close button rather than behind it.
4. Open any dialog with ordinary text (Create Tag). Its title and fields look as before.
5. At 320px, open Settings → Organization → "Itemized usage". The toolbar's buttons and the table's headers and cells keep their words whole (no mid-word splits); a table wider than the dialog scrolls, as before.
6. Repeat step 1 in the dark theme.
7. Delete the tag and rename or delete the station afterwards.

## Out of scope

- Long tokens outside dialogs (table cells, chips, the records grid): #794's area.
- Long tokens in portaled surfaces opened from a dialog or elsewhere: a select's listbox, menus, tooltips and toasts. They render outside `DialogContent`, so this rule never reaches them (code review). A follow-up, not this ticket.
- Card titles' ellipsis (`DetailCard`), which is deliberate.
