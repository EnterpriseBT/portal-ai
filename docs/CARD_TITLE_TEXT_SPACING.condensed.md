# Card titles under text spacing — Condensed design (#1020)

**Issue:** [EnterpriseBT/portal-ai#1020](https://github.com/EnterpriseBT/portal-ai/issues/1020) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc). Child of epic #791 (found by #800); branch `fix/1020-card-title-text-spacing` → `epic/a11y-conformance`.

**Why.** At 320 CSS px with WCAG's text-spacing overrides (1.4.12), a long `DetailCard` title runs past its card and is cut mid-word with no ellipsis. It's the same cause as #1019: on xs the card's content row is a flex column with `alignItems: flex-start`, so the title's column takes its content's width and the title's `minWidth: 0` and ellipsis never engage. One rule in core fixes every card list (14 web files use `DetailCard`). The ACR's 1.4.12 row moves to Supports in the same PR.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Card content row | `packages/core/src/ui/DetailCard.tsx:177-182` | `direction={{ xs: "column", sm: "row" }}`, `alignItems={{ xs: "flex-start", sm: "center" }}` |
| Title + body column | `DetailCard.tsx:183` | `minWidth: 0, flex: 1`; on xs it's not stretched, so its width is its content's |
| Title row and heading | `DetailCard.tsx:120-152` | The row has `minWidth: 0`; the heading has `overflow: hidden; textOverflow: ellipsis; whiteSpace: nowrap`, which never engages |
| Card | `MuiCard` | Its `overflow: hidden` does the clipping |

**Checked live (2026-11-14, 320×720, text-spacing overrides, `/connectors`):** "File Upload — XLSX", "File Upload — CSV" and "smoke_931_rest_redirect" ended at x 296, 285 and 351 in a card ending at 280, with no ellipsis (column widths 235, 224, 290). With `alignSelf: stretch` patched onto the column, every column was 198px and all three ended at 259 with an ellipsis. Short titles were unchanged.

## Decision — stretch the column, keep the ellipsis

- **Stretch:** the title + body column gets `alignSelf: "stretch"`, as #1019 did for `MetadataList`. On sm+ (row) it only stretches the height of a box whose width comes from `flex: 1`.
- **Ellipsis, not wrap:** the card keeps its one-line title, which the issue allows. The full name stays readable on the page the card opens, and in the card's link or button name. Wrapping to two lines would change every card list's rhythm for a narrow-and-spaced case.
- **ACR:** 1.4.12 moves to Supports, and RZ-02 is marked closed by #1020.

## Plan — 1 slice

**Files:**
- **Edit:** `packages/core/src/ui/DetailCard.tsx`; `docs/ACCESSIBILITY_CONFORMANCE_REPORT.md` (the 1.4.12 row; the evaluated-build note); `docs/A11Y_AUDIT.md` (RZ-02).

**Tests:**
- `packages/core/src/__tests__/ui/DetailCard.test.tsx`: the title's column (the heading's nearest Stack's parent) has `align-self: stretch` and `min-width: 0`.
- `npm run test:unit -w @portalai/core -- --testPathPattern DetailCard`; `npm run lint:doc-pointers`.

## Smoke (manual, against your dev stack)

1. Viewport 320×720. Apply the text-spacing overrides (line-height 1.5, letter-spacing 0.12em, word-spacing 0.16em, paragraph spacing 2em). Open **Connectors**, Connected tab. Every card title ends inside its card, and a long one ends in "…".
2. The same on **Stations** and one other card list.
3. Tab to a truncated card's title: its accessible name is the full title.
4. Without the overrides at 1280px, card lists look as before: short titles unchanged, actions on the right.
5. Brand Dark: repeat step 1.

## Out of scope

- Wrapping card titles to two lines.
- Other text-spacing findings (none open).
