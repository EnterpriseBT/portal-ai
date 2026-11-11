# Sheet canvas on the theme — Condensed design (#996)

**Issue:** [EnterpriseBT/portal-ai#996](https://github.com/EnterpriseBT/portal-ai/issues/996) · Task · **small / condensed** (discovery + spec + plan + smoke in one doc). Epic child of #791 (follow-up from #795, PR #995's code-review finding 10).

**Why.** The RegionEditor's sheet canvas hard-codes about 30 colours: cell and header fills, gridlines, header text, the marquee, region-tab badges, handles, label backdrops, and three kind-keyed overlay maps. It renders light in Brand Dark, and `theme-contrast.test.ts` never sees it. Measured in Brand, many of those colours fail AA:
- five of the 12 entity colours give 3.2–3.8:1 for white tab text and for their badges;
- every segment/intersection chip (white text on a 55–75% alpha fill) gives 2.1–3.5:1.

This change moves every canvas colour into the theme, adds dark values, and fixes those failures in both themes (issue amended 2026-11-11). It touches `packages/core` (theme, typing, contrast test) and `apps/web` (RegionEditor).

## Current shape

| Piece | Location | Note |
|---|---|---|
| Theme JSONs | `packages/core/src/assets/themes/brand-theme.json`, `brand-theme-dark.json` | standard MUI palette keys only; no custom key yet |
| Theme build | `packages/core/src/ui/ThemeProvider.tsx:21-27`, `:59-129` | `createTheme(options, a11yComponents(palette))`; `MuiCssBaseline` already styles `[role="gridcell"]:focus-visible` (#795, `:70-77`) |
| Palette typing | `packages/core/src/types/theme.d.ts:3-12` | the one `@mui/material/styles` augmentation (typography only); JSONs are cast `as ThemeOptions`, so they aren't type-checked |
| Contrast test | `packages/core/src/__tests__/ui/theme-contrast.test.ts:14-15`, `:26` | `describe.each(THEME_MAP)`, AA 4.5 / 3; `getContrastRatio` ignores alpha |
| Canvas literals | `apps/web/src/modules/RegionEditor/SheetCanvas.component.tsx:1088-1135`, `:1177-1196`, `:1233`, `:1518`, `:1530`, `:1609`, `:1785`, `:1803`, `:1926-1930`, `:2019` | inline `style` objects on virtualized cells, `sx` on overlays |
| Region tab + badges | `RegionOverlay.component.tsx:91`, `:211`, `:235`, `:249`, `:295` | white text on the entity colour; white badges in the entity colour |
| Overlay maps | `utils/region-editor-decorations.util.ts:52`, `:435-466`, `:527-547` | `DECORATION_*`, `SEGMENT_OVERLAY_*`, `INTERSECTION_OVERLAY_*` rgba maps |
| Entity colours | `utils/region-editor-colors.util.ts:1-24` | 12 fixed hex values plus a `#64748b` fallback (4.76:1, passes) |

## Decision 1 — tokens live in a `palette.sheet` group in both JSONs

- **Chosen:** the theme's first custom palette key, typed by `Palette.sheet` / `PaletteOptions.sheet` in `theme.d.ts`.
- **What it holds:**
  - the surfaces: cell, header, gridline, header text, placeholder, marquee;
  - the tab text, badge, label backdrop and handle;
  - `decoration.*`, `segment.<kind>.{fill,border,chip}`, `intersection.<kind>.{fill,border,chip}`, `intersectionHover` and `divider.{rest,active}`.
- **A parity test** asserts both JSONs carry every key, since the cast hides a missing one.
- **Rejected alternatives:**
  - deriving colours from status colours with `alpha()` in code: the literals belong in the JSONs, per CLAUDE.md;
  - keeping the maps in `apps/web` and switching on mode: a second theme outside the theme.

## Decision 2 — the theme styles the canvas through CSS rules on data attributes

- **The rules:** `a11yComponents()` adds object-form `MuiCssBaseline` rules for `[data-sheet-part="cell|col-header|row-header|corner|marquee|region-tab|region-badge|handle|deco-chip|segment|segment-chip|intersection|intersection-chip|divider"]`, plus `[data-kind=…]`. All values come from `palette.sheet`.
- **What stays in the components:** inline `style`/`sx` keep layout only (size, position, z-index, touch-action).
- **The runtime value:** the entity colour, the one value known only at runtime, is passed as a `--region-color` custom property on the overlay. Tabs and badges read `var(--region-color)`.
- **Rejected alternative:** `useTheme()` in each style memo. It reads the theme into thousands of virtualized cell styles on every render, and it puts theme context in pure UI components. The CSS route follows #795's `[role="gridcell"]` precedent, and a theme switch restyles without re-rendering.

## Decision 3 — AA in both themes, with two decorative exceptions

- **Entity colours:** the five that fail move to their 700 tones: `#059669→#047857` 5.48, `#d97706→#b45309` 5.02, `#0891b2→#0e7490` 5.36, `#16a34a→#15803d` 5.02, `#ea580c→#c2410c` 5.18. `#db2777` (4.60) passes and stays, since its 700 tone `#be185d` is already in the palette.
- **Chips:** every overlay chip is held to 4.5:1 in both themes:
  - the segment chips (`field`, `pivot`, `skip`) and the intersection chip take opaque fills with white text;
  - the decoration label chips (header, axis labels, axis name, cell values, skipped) keep `text.primary` on an opaque backdrop, so the decoration tint beneath can't lower it;
  - the region tab and its badges are covered under Badges below.
- **Badges:** they keep a light background with entity-colour text in both themes, so it's the same pair as the tab.
- **The contrast test** gains a `composite(fg, bg)` helper (MUI's `blend`) for the alpha pairs:
  - header text on the header fill;
  - each chip on the cell surface;
  - the deco-chip text on its backdrop over each decoration;
  - tab text and the badge pair.
- **Entity colours are checked in web:** `region-editor-colors.util.test.ts` checks every entity colour against each built theme's `sheet.tabText` / `sheet.badgeBackground` (`THEME_MAP` from `@portalai/core/ui`), because the palette lives in web.
- **Exempt and recorded:**
  - gridlines: decorative, since headers and the keyboard grid locate a cell (the issue's out of scope);
  - the `aria-hidden` "…" on loading rows: "Loading…" is read instead.

## Decision 4 — entity colours are per theme (code review)

- **The problem:** in Brand Dark, one shared palette left four entity outlines at 2.6–2.95:1 against the dark sheet, under 1.4.11's 3:1.
- **The fix:** the colours move into `palette.sheet.entities`, one set per theme.
  - Light keeps the 700-tone set with white tab text.
  - Dark uses 400 tones (≥ 5.4:1) with dark tab text (`entityText`) and a dark badge.
- **How components use it:** they set `data-entity` (`entitySlot`: "0"…"11", or "none"), and the theme maps each slot to `--region-color`. That covers the region, its extension fades, the legend chip and dot, and the Review step and panel dots. `colorForEntity` and `ENTITY_COLOR_PALETTE` are gone.
- **Confidence and drift colours** follow the same pattern (`data-confidence`, `drift-banner`). The banner was pastel in dark, and the yellow and "none" bands were under 3:1.
- **The guard** covers the whole module with no allowlist, and also catches `${color}33`.
- **The contrast test** composites stacked tints. Dark's hover tint drops to 22% to keep AA.

## Plan — 2 slices

1. **core: tokens + rules + tests**
   - **Files:** both theme JSONs (`palette.sheet`), `types/theme.d.ts`, `ui/ThemeProvider.tsx` (the `MuiCssBaseline` sheet rules).
   - **Tests:** `__tests__/ui/theme-contrast.test.ts` gets the composite helper, the sheet pairs and the key parity. Run `npm run test:unit -- --testPathPattern theme-contrast` and `npm run build` in `packages/core`.
2. **web: the canvas reads the theme**
   - **Files:**
     - `SheetCanvas.component.tsx` and `RegionOverlay.component.tsx`: `data-sheet-part` / `data-kind`, `--region-color`, no colour literals;
     - `utils/region-editor-decorations.util.ts`: the colour maps go, kinds and labels stay;
     - `utils/region-editor-colors.util.ts`: 700 tones;
     - `index.ts`: drop the removed exports.
     - `RegionConfigurationPanel.component.tsx`, added in implementation: its legend swatches and its pivot × pivot notes and chip used the same colours, and that chip put white on 85% amber (about 4.4:1);
     - the intersection chip's inherited name no longer fades to 85%, which took it under AA;
     - core's `types/theme.d.ts` becomes `theme.ts`, imported by `ThemeProvider`, so the build emits the augmentation and web can see `palette.sheet`;
     - `apps/site/scripts/generate-tokens.mjs` skips the app-only `sheet` group.
   - **Tests:**
     - `modules/RegionEditor/__tests__/region-editor-colors.util.test.ts`: entity AA in both themes;
     - new `__tests__/sheet-canvas-colors.guard.test.ts` (on `guard-source.util.ts`): no hex/rgba literal in the three canvas files;
     - the existing RegionEditor / SheetCanvas suites stay green: `npm run test:unit -- --testPathPattern "RegionEditor|SheetCanvas|region-editor"`.

## Smoke (manual, against your dev stack)

1. Connectors → File Upload → upload `supported_layouts.xlsx`. In Brand, the sheet, headers and gridlines look as before. Draw two regions with different entities, including one whose colour was amber/green/cyan/orange. Its tab and badge read in a deeper tone with white tab text.
2. Add a row axis with a pivot segment and a crosstab region (Crosstab sheet). The segment chips (`field`, `pivot`) and the `pivot × pivot` intersection chip have solid fills with white text, and the hover tint and divider tints still show.
3. Switch to Brand Dark from the header's theme menu. The sheet, headers, gridlines and label backdrops are dark, the cell text is light, and the tabs, badges, chips and marquee (drag-select) are all legible.
4. `npm run a11y:report` adds no rows to `docs/A11Y_AUDIT.md`. — backend

## Out of scope

- Canvas layout, sizing and interaction (#795).
- Which entity gets which colour (assignment order unchanged).
