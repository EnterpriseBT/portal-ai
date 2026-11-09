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

## Decision — `overflow-wrap: anywhere` on dialog content and title, in both theme JSONs

- **Where.** Both JSONs, on `MuiDialogContent` and `MuiDialogTitle` `root`, beside their padding. It's a literal, so it belongs in the JSONs rather than `a11yComponents()`. It reaches every dialog through the theme: no `sx` and no per-dialog change.
- **`anywhere`, not `break-word`.** Both break a long token only when it can't fit. `anywhere` also lowers the element's min-content width, so a long token inside a flex or grid child (a `Stack` row, a list item's text) shrinks instead of pushing its container wider. Ordinary text with spaces wraps at the spaces, unchanged.
- **Not `word-break: break-all`.** It breaks every word mid-word, even ones that fit.
- **Not in scope:** card titles keep their ellipsis; page titles already wrap.

## Plan — 1 slice

**Files**
- Edit: `packages/core/src/assets/themes/brand-theme.json`, `brand-theme-dark.json` (`"overflowWrap": "anywhere"` on both overrides)

**Tests** (failing first; `cd packages/core && npm run test:unit -- --testPathPattern theme-text-wrap`)
- New `packages/core/src/__tests__/ui/theme-text-wrap.test.ts`: for each theme in `THEME_MAP`, `MuiDialogContent` and `MuiDialogTitle` set `overflowWrap: "anywhere"`, and the padding is still there. jsdom has no layout, so the measured overflow is the smoke walk's job.
- Then `npm run build`, `npm run lint && npm run type-check && npm run format:check` in `packages/core`.

## Smoke (manual, against your dev stack)

1. On `/tags`, create a tag named `Adv` + `L` × 117 (120 characters, no spaces), and open its **Delete** confirm at 1280×720. The name wraps inside the dialog, nothing is clipped, and the content's `scrollWidth` equals its `clientWidth`.
2. Resize to 320px wide. The confirm still has no horizontal overflow, and its buttons stay visible.
3. Open **Share** on a station whose name is 120 characters with no spaces. The title "Share “…”" wraps under the close button rather than behind it.
4. Open any dialog with ordinary text (Create Tag). Its title and fields look as before.
5. Repeat step 1 in the dark theme.
6. Delete the tag and rename or delete the station afterwards.

## Out of scope

- Long tokens outside dialogs (table cells, chips, the records grid): #794's area.
- Card titles' ellipsis (`DetailCard`), which is deliberate.
